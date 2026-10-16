import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { loadState, saveState } from "../forge-loop.js";
import {
  AskMeActionSchema,
  AskMeItemSchema,
  AskMeReasonClassSchema,
  HiveLedgerSchema,
  IraEventSchema,
  agentIdSchema,
  featureIdSchema,
} from "./schema.js";
import { EVENT_LOCK_WAIT_MS, LEDGER_LOCK_WAIT_MS, appendJsonlLine, withLock, writeJsonAtomic } from "./store.js";
import type { AskMeAction, AskMeItem, AskMeReasonClass, CommandPlaneErrorCode, HiveLedger, HiveTask, HiveTaskStatus } from "./types.js";

const isoTimestamp = z.string().datetime({ offset: true });

/** Higher weight sorts first. Same class then breaks ties by older `createdAt`. */
const REASON_WEIGHT: Record<AskMeReasonClass, number> = {
  budget_exceed: 100,
  destructive_git: 90,
  constitution_violation: 80,
  spec_scope_change: 70,
  untrusted_import: 60,
  repeated_review_failure: 50,
  ambiguous_requirement: 40,
};

const ASK_ID = /^ask_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AskMeFailure = { ok: false; error: CommandPlaneErrorCode; message: string };

export type OpenAskMeResult = { ok: true; created: boolean; item: AskMeItem } | AskMeFailure;

export type AskMeListItem = AskMeItem & { ageSeconds: number };

export type ListAskMeResult = { ok: true; items: AskMeListItem[] } | AskMeFailure;

export type AskMeTaskSnapshot = { id: string; status: HiveTaskStatus; reviewFailures: number };

export type AnswerAskMeResult =
  | { ok: true; item: AskMeItem; task: AskMeTaskSnapshot | null }
  | AskMeFailure;

type OpenAskMeInput = {
  hiveRoot: string;
  featureId: string | null;
  taskId: string | null;
  agentId: string | null;
  reasonClass: AskMeReasonClass;
  question: string;
  now?: string;
};

function fail(error: CommandPlaneErrorCode, message: string): AskMeFailure {
  return { ok: false, error, message };
}

/**
 * Critical-class order: higher severity first, then older `createdAt`.
 * Returns a negative number when `a` should appear before `b`.
 */
export function compareAskMeOrder(
  a: { reasonClass: string; createdAt: string },
  b: { reasonClass: string; createdAt: string },
): number {
  const byWeight = weight(b.reasonClass) - weight(a.reasonClass);
  if (byWeight !== 0) return byWeight;
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  return 0;
}

function weight(reasonClass: string): number {
  return reasonClass in REASON_WEIGHT ? REASON_WEIGHT[reasonClass as AskMeReasonClass] : 0;
}

/** Create an Ask-Me item with `wx`, or return the open item for the same key. */
export async function openAskMeItem(input: OpenAskMeInput): Promise<OpenAskMeResult> {
  const hive = await requireHive(input.hiveRoot);
  if (!hive.ok) return hive;

  const stamped = timestamp(input.now);
  if (!stamped.ok) return stamped;
  const built = buildOpenItem(input, stamped.value);
  if (!built.ok) return built;
  const linkable = await ensureLedgerLinkable(input.hiveRoot, input.featureId, input.taskId);
  if (!linkable.ok) return linkable;

  const dir = join(input.hiveRoot, "ask-me");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const existing = await findOpenDuplicate(dir, built.item);
  if (existing) {
    const linked = await linkOpenItem(input.hiveRoot, existing, stamped.value);
    if (!linked.ok) return linked;
    return { ok: true, created: false, item: existing };
  }

  const written = await createExclusive(dir, built.item);
  if (!written.ok) return written;
  const linked = await linkOpenItem(input.hiveRoot, written.item, stamped.value);
  if (!linked.ok) return linked;
  if (written.created) {
    await appendEvent(input.hiveRoot, written.item.featureId, "ask_me.opened", {
      askMeId: written.item.id,
      reasonClass: written.item.reasonClass,
      taskId: written.item.taskId,
    }, { kind: "ira", id: "ira" }, stamped.value);
  }
  return { ok: true, created: written.created, item: written.item };
}

/** List inbox items. `state` omitted returns open and resolved. */
export async function listAskMe(input: {
  hiveRoot: string;
  state?: "open" | "resolved";
  featureId?: string;
  now?: string;
}): Promise<ListAskMeResult> {
  const hive = await requireHive(input.hiveRoot);
  if (!hive.ok) return hive;
  if (input.state !== undefined && input.state !== "open" && input.state !== "resolved") {
    return fail("INVALID_INPUT", "Ask-Me state filter is invalid.");
  }
  if (input.featureId !== undefined && !featureIdSchema.safeParse(input.featureId).success) {
    return fail("INVALID_INPUT", "Feature id is invalid.");
  }
  const stamped = timestamp(input.now);
  if (!stamped.ok) return stamped;

  const items = (await readAllItems(join(input.hiveRoot, "ask-me")))
    .filter((item) => (input.state === undefined ? true : item.state === input.state))
    .filter((item) => (input.featureId === undefined ? true : item.featureId === input.featureId))
    .sort(compareAskMeOrder)
    .map((item) => ({ ...item, ageSeconds: ageSeconds(item.createdAt, stamped.value) }));
  return { ok: true, items };
}

/**
 * Resolve an open item. `retry` releases a task blocked only by this item
 * without incrementing forge `reviewFailures`.
 */
export async function answerAskMe(input: {
  hiveRoot: string;
  id: string;
  text: string;
  action: AskMeAction;
  now?: string;
}): Promise<AnswerAskMeResult> {
  const hive = await requireHive(input.hiveRoot);
  if (!hive.ok) return hive;
  if (!ASK_ID.test(input.id)) return fail("INVALID_INPUT", "Ask-Me id is invalid.");
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length === 0) return fail("INVALID_INPUT", "Answer text is empty.");
  const action = AskMeActionSchema.safeParse(input.action);
  if (!action.success) return fail("INVALID_INPUT", "Answer action is invalid.");
  const stamped = timestamp(input.now);
  if (!stamped.ok) return stamped;

  const loaded = await readItemById(input.hiveRoot, input.id);
  if (!loaded.ok) return loaded;
  if (loaded.item.state === "resolved") {
    return fail("ASK_ME_ALREADY_RESOLVED", "Ask-Me item is already resolved.");
  }

  const resolved = AskMeItemSchema.safeParse({
    ...loaded.item,
    answer: text,
    action: action.data,
    state: "resolved",
    resolvedAt: stamped.value,
  });
  if (!resolved.success) return fail("INVALID_INPUT", "Ask-Me answer is invalid.");

  const task = await taskEffect(input.hiveRoot, loaded.item, action.data, stamped.value);
  if (!task.ok) return task;

  await writeJsonAtomic(itemPath(input.hiveRoot, input.id), resolved.data);
  await appendEvent(input.hiveRoot, resolved.data.featureId, "ask_me.resolved", {
    askMeId: resolved.data.id,
    action: action.data,
  }, { kind: "operator", id: "operator" }, stamped.value);
  return { ok: true, item: resolved.data, task: task.task };
}

function buildOpenItem(input: OpenAskMeInput, now: string): { ok: true; item: AskMeItem } | AskMeFailure {
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (question.length === 0) return fail("INVALID_INPUT", "Question text is empty.");
  if (question.length > 4000) return fail("INVALID_INPUT", "Question text is too long.");
  if (input.featureId !== null && !featureIdSchema.safeParse(input.featureId).success) {
    return fail("INVALID_INPUT", "Feature id is invalid.");
  }
  if (input.taskId !== null && (typeof input.taskId !== "string" || input.taskId.trim().length === 0)) {
    return fail("INVALID_INPUT", "Task id is invalid.");
  }
  if (input.agentId !== null && !agentIdSchema.safeParse(input.agentId).success) {
    return fail("INVALID_INPUT", "Agent id is invalid.");
  }
  if (!AskMeReasonClassSchema.safeParse(input.reasonClass).success) {
    return fail("INVALID_INPUT", "Reason class is invalid.");
  }

  const parsed = AskMeItemSchema.safeParse({
    id: `ask_${randomUUID()}`,
    featureId: input.featureId,
    taskId: input.taskId,
    agentId: input.agentId,
    reasonClass: input.reasonClass,
    question,
    answer: null,
    action: null,
    state: "open",
    createdAt: now,
    resolvedAt: null,
  });
  if (!parsed.success) return fail("INVALID_INPUT", "Ask-Me item is invalid.");
  return { ok: true, item: parsed.data };
}

async function createExclusive(
  dir: string,
  item: AskMeItem,
): Promise<{ ok: true; created: boolean; item: AskMeItem } | AskMeFailure> {
  let current = item;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeFile(join(dir, `${current.id}.json`), `${JSON.stringify(current)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      return { ok: true, created: true, item: current };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const winner = await findOpenDuplicate(dir, current);
      if (winner) return { ok: true, created: false, item: winner };
      current = { ...current, id: `ask_${randomUUID()}` };
    }
  }
  return fail("HIVE_NOT_WRITABLE", "Ask-Me item could not be created.");
}

async function findOpenDuplicate(dir: string, candidate: AskMeItem): Promise<AskMeItem | null> {
  const matches = (await readAllItems(dir)).filter(
    (item) =>
      item.state === "open" &&
      item.featureId === candidate.featureId &&
      item.taskId === candidate.taskId &&
      item.reasonClass === candidate.reasonClass,
  );
  matches.sort((a, b) => compareAskMeOrder(a, b) || a.id.localeCompare(b.id));
  return matches[0] ?? null;
}

/** Missing ledger is a no-op. A busy lock or unreadable ledger fails the open. */
async function ensureLedgerLinkable(
  hiveRoot: string,
  featureId: string | null,
  taskId: string | null,
): Promise<{ ok: true } | AskMeFailure> {
  if (!featureId || !taskId) return { ok: true };
  return withLedger(hiveRoot, featureId, async (loaded) => {
    if (loaded === "missing") return { ok: true as const };
    if (loaded === "corrupt") return fail("HIVE_CORRUPT", "Ledger is unreadable.");
    return { ok: true as const };
  });
}

async function linkOpenItem(hiveRoot: string, item: AskMeItem, now: string): Promise<{ ok: true } | AskMeFailure> {
  const featureId = item.featureId;
  const taskId = item.taskId;
  if (!featureId || !taskId) return { ok: true };
  return withLedger(hiveRoot, featureId, async (loaded) => {
    if (loaded === "missing") return { ok: true as const };
    if (loaded === "corrupt") return fail("HIVE_CORRUPT", "Ledger is unreadable.");
    const index = loaded.ledger.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) return { ok: true as const };
    if (loaded.ledger.tasks[index].blockedByAskMeId) return { ok: true as const };
    const tasks = loaded.ledger.tasks.map((task, taskIndex) =>
      taskIndex === index ? { ...task, blockedByAskMeId: item.id, updatedAt: now } : task,
    );
    await writeJsonAtomic(ledgerFile(hiveRoot, featureId), HiveLedgerSchema.parse({ ...loaded.ledger, updatedAt: now, tasks }));
    return { ok: true as const };
  });
}

async function withLedger<T extends { ok: true } | AskMeFailure>(
  hiveRoot: string,
  featureId: string,
  fn: (loaded: Awaited<ReturnType<typeof readLedger>>) => Promise<T>,
): Promise<T | AskMeFailure> {
  const locked = await withLock(ledgerLock(hiveRoot, featureId), { waitMs: LEDGER_LOCK_WAIT_MS }, async () =>
    fn(await readLedger(ledgerFile(hiveRoot, featureId))),
  );
  if (!locked.ok) return fail("LEDGER_BUSY", "Ledger is busy.");
  return locked.value;
}

async function taskEffect(
  hiveRoot: string,
  item: AskMeItem,
  action: AskMeAction,
  now: string,
): Promise<{ ok: true; task: AskMeTaskSnapshot | null } | AskMeFailure> {
  if (!item.featureId || !item.taskId) return { ok: true, task: null };
  if (action !== "retry") return readTaskSnapshot(hiveRoot, item.featureId, item.taskId);
  return releaseIfBlockedOnlyByItem(hiveRoot, item, now);
}

/**
 * Hive-owned unblock. Sets forge status to `pending` only from `blocked`,
 * and never changes `reviewFailures`.
 */
async function releaseIfBlockedOnlyByItem(
  hiveRoot: string,
  item: AskMeItem,
  now: string,
): Promise<{ ok: true; task: AskMeTaskSnapshot | null } | AskMeFailure> {
  const featureId = item.featureId;
  const taskId = item.taskId;
  if (!featureId || !taskId) return { ok: true, task: null };

  const locked = await withLock(ledgerLock(hiveRoot, featureId), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    const loaded = await readLedger(ledgerFile(hiveRoot, featureId));
    if (loaded === "missing") return { ok: true as const, task: null };
    if (loaded === "corrupt") return fail("HIVE_CORRUPT", "Ledger is unreadable.");
    const task = loaded.ledger.tasks.find((row) => row.id === taskId);
    if (!task) return { ok: true as const, task: null };
    const release = blockedOnlyByThisItem(task, item.id);
    const clearLink = task.blockedByAskMeId === item.id && !hasAbortReason(task);
    if (!release && !clearLink) return { ok: true as const, task: snapshot(task) };
    if (release) {
      const forged = await setForgePendingWithoutReviewIncrement(hiveRoot, loaded.ledger.specDir, taskId);
      if (!forged.ok) return forged;
    }

    const tasks = loaded.ledger.tasks.map((row) =>
      row.id === taskId
        ? {
            ...row,
            status: release ? ("todo" as const) : row.status,
            blockedByAskMeId: null,
            updatedAt: now,
          }
        : row,
    );
    const next = HiveLedgerSchema.parse({ ...loaded.ledger, updatedAt: now, tasks });
    await writeJsonAtomic(ledgerFile(hiveRoot, featureId), next);
    const released = next.tasks.find((row) => row.id === taskId);
    return { ok: true as const, task: snapshot(released ?? task) };
  });
  if (!locked.ok) return fail("LEDGER_BUSY", "Ledger is busy.");
  return locked.value;
}

function blockedOnlyByThisItem(task: HiveTask, itemId: string): boolean {
  if (task.status !== "blocked") return false;
  if (hasAbortReason(task)) return false;
  if (task.blockedByAskMeId && task.blockedByAskMeId !== itemId) return false;
  return true;
}

function hasAbortReason(task: HiveTask): boolean {
  return typeof task.abortReason === "string" && task.abortReason.length > 0;
}

/**
 * Resolves a repo-relative ledger `specDir` under `hive.json` `repositoryRoot`
 * before touching forge. A release that cannot move a blocked forge row fails
 * before the hive ledger is written.
 */
async function setForgePendingWithoutReviewIncrement(
  hiveRoot: string,
  specDir: string,
  taskId: string,
): Promise<{ ok: true } | AskMeFailure> {
  const root = await readRepositoryRoot(hiveRoot);
  if (!root.ok) return root;
  const specDirAbs = resolveInside(root.repositoryRoot, specDir);
  if (!specDirAbs) return fail("HIVE_CORRUPT", "Spec directory is outside the repository.");
  const state = await loadState(specDirAbs);
  if (!state) return fail("HIVE_CORRUPT", "Forge state is missing.");
  const row = state.tasks[taskId];
  if (!row || row.status !== "blocked") return fail("HIVE_CORRUPT", "Forge task is not blocked.");
  state.tasks[taskId] = { ...row, status: "pending" };
  await saveState(specDirAbs, state);
  return { ok: true };
}

async function readRepositoryRoot(hiveRoot: string): Promise<{ ok: true; repositoryRoot: string } | AskMeFailure> {
  try {
    const value: unknown = JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8"));
    const repositoryRoot =
      value && typeof value === "object" ? (value as { repositoryRoot?: unknown }).repositoryRoot : undefined;
    if (typeof repositoryRoot !== "string" || repositoryRoot.trim().length === 0) {
      return fail("HIVE_CORRUPT", "Hive manifest is unreadable.");
    }
    return { ok: true, repositoryRoot };
  } catch {
    return fail("HIVE_CORRUPT", "Hive manifest is unreadable.");
  }
}

function resolveInside(root: string, candidate: string): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  const absRoot = resolve(root);
  const abs = isAbsolute(candidate) ? resolve(candidate) : resolve(absRoot, candidate);
  const rel = relative(absRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

async function readTaskSnapshot(
  hiveRoot: string,
  featureId: string,
  taskId: string,
): Promise<{ ok: true; task: AskMeTaskSnapshot | null } | AskMeFailure> {
  const locked = await withLock(ledgerLock(hiveRoot, featureId), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    const loaded = await readLedger(ledgerFile(hiveRoot, featureId));
    if (loaded === "missing") return { ok: true as const, task: null };
    if (loaded === "corrupt") return fail("HIVE_CORRUPT", "Ledger is unreadable.");
    const task = loaded.ledger.tasks.find((row) => row.id === taskId);
    return { ok: true as const, task: task ? snapshot(task) : null };
  });
  if (!locked.ok) return fail("LEDGER_BUSY", "Ledger is busy.");
  return locked.value;
}

function snapshot(task: Pick<HiveTask, "id" | "status" | "reviewFailures">): AskMeTaskSnapshot {
  return { id: task.id, status: task.status, reviewFailures: task.reviewFailures };
}

async function readLedger(
  ledgerPath: string,
): Promise<{ kind: "ok"; ledger: HiveLedger } | "missing" | "corrupt"> {
  try {
    const parsed = HiveLedgerSchema.safeParse(JSON.parse(await readFile(ledgerPath, "utf8")));
    if (!parsed.success) return "corrupt";
    return { kind: "ok", ledger: parsed.data };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "corrupt";
  }
}

async function readItemById(
  hiveRoot: string,
  id: string,
): Promise<{ ok: true; item: AskMeItem } | AskMeFailure> {
  try {
    const parsed = AskMeItemSchema.safeParse(JSON.parse(await readFile(itemPath(hiveRoot, id), "utf8")));
    if (!parsed.success) return fail("HIVE_CORRUPT", "Ask-Me item is unreadable.");
    return { ok: true, item: parsed.data };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return fail("ASK_ME_NOT_FOUND", "Ask-Me item was not found.");
    }
    return fail("HIVE_CORRUPT", "Ask-Me item is unreadable.");
  }
}

async function readAllItems(dir: string): Promise<AskMeItem[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const items: AskMeItem[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = AskMeItemSchema.safeParse(JSON.parse(await readFile(join(dir, name), "utf8")));
      if (parsed.success) items.push(parsed.data);
    } catch {
      // Unreadable files stay for doctor. Listing and dedupe skip them.
    }
  }
  return items;
}

function ageSeconds(createdAt: string, now: string): number {
  const delta = Date.parse(now) - Date.parse(createdAt);
  if (!Number.isFinite(delta)) return 0;
  return Math.max(0, Math.floor(delta / 1000));
}

function timestamp(now: string | undefined): { ok: true; value: string } | AskMeFailure {
  const value = now ?? new Date().toISOString();
  if (!isoTimestamp.safeParse(value).success) return fail("INVALID_INPUT", "Timestamp is invalid.");
  return { ok: true, value };
}

async function requireHive(hiveRoot: string): Promise<{ ok: true } | AskMeFailure> {
  if (typeof hiveRoot !== "string" || hiveRoot.trim().length === 0) {
    return fail("INVALID_INPUT", "Hive root is missing.");
  }
  try {
    const value: unknown = JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8"));
    const version = value && typeof value === "object" ? (value as { schemaVersion?: unknown }).schemaVersion : undefined;
    if (version === 1) return { ok: true };
    if (typeof version === "number") return fail("HIVE_SCHEMA_MISMATCH", "Hive schema version is not supported.");
    return fail("HIVE_CORRUPT", "Hive manifest is unreadable.");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fail("HIVE_NOT_INITIALIZED", "Hive is not initialized.");
    return fail("HIVE_CORRUPT", "Hive manifest is unreadable.");
  }
}

async function appendEvent(
  hiveRoot: string,
  featureId: string | null,
  type: string,
  data: Record<string, unknown>,
  actor: { kind: "ira" | "operator"; id: string },
  ts: string,
): Promise<void> {
  try {
    await access(join(hiveRoot, "events"), constants.W_OK);
  } catch {
    return;
  }
  const event = IraEventSchema.safeParse({
    id: `evt_${randomUUID()}`,
    type,
    version: 1,
    ts,
    featureId: featureId !== null && featureIdSchema.safeParse(featureId).success ? featureId : null,
    actor,
    data,
  });
  if (!event.success) return;
  const file = join(hiveRoot, "events", "events.jsonl");
  await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
    appendJsonlLine(file, event.data),
  );
}

function itemPath(hiveRoot: string, id: string): string {
  return join(hiveRoot, "ask-me", `${id}.json`);
}

function ledgerFile(hiveRoot: string, featureId: string): string {
  return join(hiveRoot, "ledger", `${featureId}.json`);
}

function ledgerLock(hiveRoot: string, featureId: string): string {
  return join(hiveRoot, "locks", `ledger-${featureId}.lock`);
}
