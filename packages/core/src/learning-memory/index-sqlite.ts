import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { readSkill } from "@superspec-dev/render";
import { parse as parseYaml } from "yaml";
import type { PatternRecord } from "./pattern-io.js";
import { PatternRecordSchema } from "./schema.js";

const require = createRequire(import.meta.url);

const LOCK_WAIT_MS = 2000;
const LOCK_POLL_MS = 25;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS patterns_meta (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  feature_id TEXT,
  task_kind TEXT NOT NULL,
  use_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  engine TEXT,
  error_class TEXT,
  stack_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS patterns_signals (
  pattern_id TEXT NOT NULL,
  fr_tag TEXT NOT NULL,
  PRIMARY KEY (pattern_id, fr_tag)
);

CREATE INDEX IF NOT EXISTS idx_patterns_signals_fr_tag
  ON patterns_signals (fr_tag);

CREATE VIRTUAL TABLE IF NOT EXISTS patterns_fts USING fts5(
  id UNINDEXED,
  summary,
  signal_text,
  tokenize = 'porter unicode61'
);
`;

type SqlValue = string | number | null;

interface SqlStatement {
  run(...params: SqlValue[]): { changes: number };
  all(...params: SqlValue[]): Record<string, unknown>[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  pragma(source: string): unknown;
  transaction(fn: () => void): () => void;
  close(): void;
}

type SqliteConstructor = new (filename: string) => SqliteDatabase;

/** Loader used by tests to simulate a missing or broken native binding. */
export type SqliteLoader = () => SqliteConstructor;

export type UnavailableReason = "BINDING_MISSING" | "OPEN_FAILED";

export type PatternIndexPaths = {
  indexPath: string;
  lockPath: string;
};

export type PatternSearchQuery = {
  frTag?: string;
  taskKind?: string;
  text?: string;
  kind?: string;
  featureId?: string;
  engine?: string;
  errorClass?: string;
  stack?: string;
  limit?: number;
  includeArchived?: boolean;
};

export type PatternSearchHit = {
  id: string;
  summary: string;
  kind: string;
  status: string;
  taskKind: string;
  frTags: string[];
  rank?: number;
};

export interface PatternIndex {
  search(query: PatternSearchQuery): PatternSearchHit[];
  upsert(record: PatternRecord): void;
  close(): void;
}

export type OpenedPatternIndex = {
  index: PatternIndex | null;
  indexAvailable: boolean;
  unavailableReason?: UnavailableReason;
  search(query: PatternSearchQuery): PatternSearchHit[];
  close(): void;
};

export type ReindexReport = {
  indexed: number;
  skipped: number;
};

export function openPatternIndex(paths: PatternIndexPaths): OpenedPatternIndex {
  return openPatternIndexWithLoader(paths, loadBetterSqlite3);
}

export function openPatternIndexWithLoader(
  paths: PatternIndexPaths,
  load: SqliteLoader,
): OpenedPatternIndex {
  let ctor: SqliteConstructor;
  try {
    ctor = load();
  } catch (err) {
    logPatternsIndexUnavailable("BINDING_MISSING", errorDetail(err));
    return unavailable("BINDING_MISSING");
  }

  let nonce: string;
  try {
    nonce = acquireIndexLock(paths.lockPath);
  } catch (err) {
    logPatternsIndexUnavailable("OPEN_FAILED", errorDetail(err));
    return unavailable("OPEN_FAILED");
  }

  try {
    mkdirSync(dirname(paths.indexPath), { recursive: true, mode: 0o700 });
    const db = new ctor(paths.indexPath);
    try {
      ensureSchema(db);
    } catch (err) {
      db.close();
      throw err;
    }
    const index = new SqlitePatternIndex(db, paths.lockPath, nonce);
    return {
      index,
      indexAvailable: true,
      search: (query) => index.search(query),
      close: () => index.close(),
    };
  } catch (err) {
    releaseIndexLock(paths.lockPath, nonce);
    logPatternsIndexUnavailable("OPEN_FAILED", errorDetail(err));
    return unavailable("OPEN_FAILED");
  }
}

export function upsertPattern(index: PatternIndex, record: PatternRecord): void {
  index.upsert(record);
}

export function searchPatterns(index: PatternIndex, query: PatternSearchQuery): PatternSearchHit[] {
  return index.search(query);
}

export function reindexFromMarkdown(
  patternsDir: string,
  indexPath: string,
  lockPath = defaultLockPath(indexPath),
): ReindexReport {
  let ctor: SqliteConstructor;
  try {
    ctor = loadBetterSqlite3();
  } catch (err) {
    logPatternsIndexUnavailable("BINDING_MISSING", errorDetail(err));
    throw err;
  }

  const { records, skipped } = loadPatternRecords(patternsDir);
  const nonce = acquireIndexLock(lockPath);
  try {
    mkdirSync(dirname(indexPath), { recursive: true, mode: 0o700 });
    const db = new ctor(indexPath);
    try {
      ensureSchema(db);
      db.transaction(() => {
        db.exec("DELETE FROM patterns_signals; DELETE FROM patterns_meta;");
        db.exec("DELETE FROM patterns_fts;");
        for (const record of records) writeRecord(db, record);
      })();
    } finally {
      db.close();
    }
    return { indexed: records.length, skipped };
  } catch (err) {
    logPatternsIndexUnavailable("OPEN_FAILED", errorDetail(err));
    throw err;
  } finally {
    releaseIndexLock(lockPath, nonce);
  }
}

function loadBetterSqlite3(): SqliteConstructor {
  const loaded: unknown = require("better-sqlite3");
  if (typeof loaded === "function") return loaded as SqliteConstructor;
  throw new Error("better-sqlite3 export is not a constructor");
}

class SqlitePatternIndex implements PatternIndex {
  private closed = false;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly lockPath: string,
    private readonly lockNonce: string,
  ) {}

  search(query: PatternSearchQuery): PatternSearchHit[] {
    this.assertOpen();
    return queryPatterns(this.db, query);
  }

  upsert(record: PatternRecord): void {
    this.assertOpen();
    const parsed = PatternRecordSchema.parse(record);
    this.db.transaction(() => {
      writeRecord(this.db, parsed);
    })();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
    releaseIndexLock(this.lockPath, this.lockNonce);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Pattern index is closed");
  }
}

function unavailable(reason: UnavailableReason): OpenedPatternIndex {
  return {
    index: null,
    indexAvailable: false,
    unavailableReason: reason,
    search: () => [],
    close: () => undefined,
  };
}

function logPatternsIndexUnavailable(reason: UnavailableReason, detail: string): void {
  const suffix = detail ? ` ${detail}` : "";
  console.error(`PATTERNS_INDEX_UNAVAILABLE ${reason}${suffix}`);
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultLockPath(indexPath: string): string {
  return join(dirname(indexPath), ".index.lock");
}

function ensureSchema(db: SqliteDatabase): void {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 2000");
  db.exec(SCHEMA_SQL);
}

function writeRecord(db: SqliteDatabase, record: PatternRecord): void {
  const fm = record.frontmatter;
  const signals = fm.signals;
  db.prepare(
    `INSERT INTO patterns_meta (
       id, kind, status, feature_id, task_kind, use_count, updated_at,
       summary, engine, error_class, stack_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       status = excluded.status,
       feature_id = excluded.feature_id,
       task_kind = excluded.task_kind,
       use_count = excluded.use_count,
       updated_at = excluded.updated_at,
       summary = excluded.summary,
       engine = excluded.engine,
       error_class = excluded.error_class,
       stack_json = excluded.stack_json`,
  ).run(
    fm.id,
    fm.kind,
    fm.status,
    signals.featureId ?? null,
    signals.taskKind,
    fm.useCount,
    fm.updatedAt,
    record.summary,
    signals.engine ?? null,
    signals.errorClass ?? null,
    JSON.stringify(signals.stack ?? []),
  );
  db.prepare("DELETE FROM patterns_signals WHERE pattern_id = ?").run(fm.id);
  const insertTag = db.prepare(
    "INSERT INTO patterns_signals (pattern_id, fr_tag) VALUES (?, ?)",
  );
  for (const tag of signals.frTags) insertTag.run(fm.id, tag);
  db.prepare("DELETE FROM patterns_fts WHERE id = ?").run(fm.id);
  db.prepare(
    "INSERT INTO patterns_fts (id, summary, signal_text) VALUES (?, ?, ?)",
  ).run(fm.id, record.summary, signalText(signals));
}

function signalText(signals: PatternRecord["frontmatter"]["signals"]): string {
  return [
    ...signals.frTags,
    signals.taskKind,
    ...(signals.stack ?? []),
    signals.engine,
    signals.errorClass,
    signals.featureId,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
}

function queryPatterns(db: SqliteDatabase, query: PatternSearchQuery): PatternSearchHit[] {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (!query.includeArchived) where.push("m.status = 'active'");
  if (query.frTag) {
    where.push(
      "EXISTS (SELECT 1 FROM patterns_signals s WHERE s.pattern_id = m.id AND s.fr_tag = ?)",
    );
    params.push(query.frTag);
  }
  if (query.taskKind) {
    where.push("m.task_kind = ?");
    params.push(query.taskKind);
  }
  if (query.kind) {
    where.push("m.kind = ?");
    params.push(query.kind);
  }
  if (query.featureId) {
    where.push("m.feature_id = ?");
    params.push(query.featureId);
  }
  if (query.engine) {
    where.push("m.engine = ?");
    params.push(query.engine);
  }
  if (query.errorClass) {
    where.push("m.error_class = ?");
    params.push(query.errorClass);
  }
  if (query.stack) {
    where.push("EXISTS (SELECT 1 FROM json_each(m.stack_json) WHERE value = ?)");
    params.push(query.stack);
  }

  const text = query.text?.trim();
  let sql: string;
  if (text) {
    where.push("patterns_fts MATCH ?");
    params.push(toFtsMatch(text));
    sql = `
      SELECT m.id AS id, m.kind AS kind, m.status AS status, m.summary AS summary,
             m.task_kind AS task_kind, bm25(patterns_fts) AS rank
      FROM patterns_fts
      JOIN patterns_meta m ON m.id = patterns_fts.id
      WHERE ${where.join(" AND ")}
      ORDER BY rank
      LIMIT ?`;
  } else {
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    sql = `
      SELECT m.id AS id, m.kind AS kind, m.status AS status, m.summary AS summary,
             m.task_kind AS task_kind
      FROM patterns_meta m
      ${whereSql}
      ORDER BY m.updated_at DESC
      LIMIT ?`;
  }
  params.push(normalizeLimit(query.limit));
  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => toHit(db, row));
}

function toFtsMatch(text: string): string {
  return `"${text.replaceAll('"', '""')}"`;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  if (!Number.isInteger(limit)) return 20;
  if (limit < 1) return 1;
  if (limit > 100) return 100;
  return limit;
}

function toHit(db: SqliteDatabase, row: Record<string, unknown>): PatternSearchHit {
  const id = String(row.id);
  const tags = db
    .prepare("SELECT fr_tag FROM patterns_signals WHERE pattern_id = ? ORDER BY fr_tag")
    .all(id);
  const hit: PatternSearchHit = {
    id,
    summary: String(row.summary ?? ""),
    kind: String(row.kind),
    status: String(row.status),
    taskKind: String(row.task_kind),
    frTags: tags.map((tag) => String(tag.fr_tag)),
  };
  if (typeof row.rank === "number") hit.rank = row.rank;
  return hit;
}

function loadPatternRecords(patternsDir: string): { records: PatternRecord[]; skipped: number } {
  let names: string[];
  try {
    names = readdirSync(patternsDir);
  } catch (err) {
    if (isErrno(err, "ENOENT")) return { records: [], skipped: 0 };
    throw err;
  }
  const records: PatternRecord[] = [];
  let skipped = 0;
  for (const name of names.filter((entry) => entry.endsWith(".md")).sort()) {
    const record = readPatternRecordSync(join(patternsDir, name));
    if (record) records.push(record);
    else skipped += 1;
  }
  return { records, skipped };
}

function readPatternRecordSync(filePath: string): PatternRecord | null {
  try {
    const text = readFileSync(filePath, "utf8");
    const { frontmatter, body } = readSkill(text, basename(filePath, ".md"));
    if (!frontmatter.trim()) return null;
    return PatternRecordSchema.parse({
      frontmatter: parseYaml(frontmatter),
      summary: body,
    });
  } catch {
    return null;
  }
}

function acquireIndexLock(lockPath: string): string {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const nonce = tryCreateLock(lockPath);
    if (nonce) return nonce;
    if (Date.now() >= deadline) {
      throw new Error(`pattern index lock busy: ${lockPath}`);
    }
    if (!stealIfDead(lockPath)) sleepMs(LOCK_POLL_MS);
  }
}

function tryCreateLock(lockPath: string): string | null {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const nonce = randomBytes(16).toString("hex");
  const body = `${JSON.stringify({
    pid: process.pid,
    nonce,
    acquiredAt: new Date().toISOString(),
  })}\n`;
  try {
    writeFileSync(lockPath, body, { flag: "wx", mode: 0o600 });
    return nonce;
  } catch (err) {
    if (isErrno(err, "EEXIST")) return null;
    throw err;
  }
}

function stealIfDead(lockPath: string): boolean {
  let text: string;
  try {
    text = readFileSync(lockPath, "utf8");
  } catch (err) {
    return isErrno(err, "ENOENT");
  }
  let pid: number | null = null;
  try {
    const parsed = JSON.parse(text) as { pid?: unknown };
    pid = typeof parsed.pid === "number" ? parsed.pid : null;
  } catch {
    pid = null;
  }
  if (pid !== null && pidAlive(pid)) return false;
  try {
    unlinkSync(lockPath);
    return true;
  } catch (err) {
    return isErrno(err, "ENOENT");
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return isErrno(err, "EPERM");
  }
}

function releaseIndexLock(lockPath: string, nonce: string): void {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { nonce?: unknown };
    if (parsed.nonce === nonce) unlinkSync(lockPath);
  } catch {
    // Lock already released or replaced by another holder.
  }
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isErrno(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === code;
}
