import { watch as fsWatch, type FSWatcher } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { buildSnapshot, type SnapshotContext } from "./snapshot.js";

/** Comment heartbeat interval. Design: one comment line per second. */
export const SSE_HEARTBEAT_MS = 1000;

/** Size poll used when `fs.watch` does not deliver a change. */
export const SSE_POLL_MS = 500;

const EVENTS_DIR = "events";
const EVENTS_FILE = "events.jsonl";

const REFETCH_PREFIXES = ["task.", "ask_me.", "brief.", "away.", "autonomy.", "hive."] as const;

export type ParsedHiveEvent = {
  id: string;
  type: string;
};

export type ParsedEventLog = {
  events: Array<ParsedHiveEvent & { line: string }>;
  rest: string;
};

export type SseRequest = {
  headers: NodeJS.Dict<string | string[] | undefined>;
  on?(event: string, listener: () => void): void;
};

export type SseResponse = {
  writeHead(statusCode: number, ...args: unknown[]): unknown;
  write(chunk: string, ...args: unknown[]): unknown;
  end?(chunk?: string): unknown;
  on?(event: string, listener: () => void): unknown;
};

export type SseWatchHandle = {
  close(): void;
};

export type SseWatch = (
  path: string,
  listener: (event: string, filename: string | null) => void,
) => SseWatchHandle;

export type SseContext = SnapshotContext & {
  /** Defaults to `fs.watch` on the events directory. Tests stub this to prove the size poll. */
  watch?: SseWatch;
};

/**
 * Id and type from one JSONL line. Unknown `type` values are kept.
 * A truncated line does not parse and returns null.
 */
export function parseEventLine(line: string): ParsedHiveEvent | null {
  const normalized = stripCarriageReturn(line);
  if (normalized.trim().length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(normalized);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  if (typeof record.type !== "string" || record.type.length === 0) return null;
  return { id: record.id, type: record.type };
}

/**
 * Complete JSONL events in `buffer`. The trailing fragment with no newline
 * is returned as `rest` and is not parsed.
 */
export function parseEventLog(buffer: string): ParsedEventLog {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  const events: ParsedEventLog["events"] = [];
  for (const part of parts) {
    const line = stripCarriageReturn(part);
    const parsed = parseEventLine(line);
    if (!parsed) continue;
    events.push({ id: parsed.id, type: parsed.type, line });
  }
  return { events, rest };
}

/** True when the client refetches `GET /api/snapshot` for this hive event type. */
export function eventTriggersRefetch(type: string): boolean {
  if (type === "doctor.ran") return true;
  return REFETCH_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * `GET /api/events`. Writes a snapshot frame, then hive frames for complete
 * lines appended to `events/events.jsonl`. Read-only. Heartbeats every 1s.
 * Reconnect with `Last-Event-ID` replays lines after that id; a missing id
 * keeps the fresh snapshot and resumes at EOF.
 */
export function handleSseRequest(req: SseRequest, res: SseResponse, ctx: SseContext): void {
  let closed = false;
  let watcher: SseWatchHandle | null = null;
  let tail: EventLogTail | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;

  const write = (chunk: string) => {
    if (!closed) res.write(chunk);
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (poll) clearInterval(poll);
    watcher?.close();
    watcher = null;
  };

  req.on?.("close", cleanup);
  req.on?.("aborted", cleanup);
  res.on?.("close", cleanup);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const watchFn = ctx.watch ?? defaultWatch;

  const armWatch = (eventsPath: string) => {
    watcher?.close();
    try {
      watcher = watchFn(dirname(eventsPath), (_event, filename) => {
        if (filename && filename !== EVENTS_FILE) return;
        tail?.schedule(true);
      });
    } catch {
      watcher = null;
    }
  };

  const startClocks = () => {
    heartbeat = setInterval(() => {
      write(": heartbeat\n\n");
    }, SSE_HEARTBEAT_MS);
    unrefTimer(heartbeat);
    poll = setInterval(() => {
      tail?.schedule(false);
    }, SSE_POLL_MS);
    unrefTimer(poll);
  };

  void (async () => {
    try {
      const snapshot = await buildSnapshot({
        repositoryRoot: ctx.repositoryRoot,
        hiveRoot: ctx.hiveRoot,
      });
      if (closed) return;

      const eventsPath = join(snapshot.hiveRoot, EVENTS_DIR, EVENTS_FILE);
      const log = new EventLogTail(
        eventsPath,
        (lines) => {
          for (const line of lines) emitHive(write, line);
        },
        async () => {
          const fresh = await buildSnapshot({
            repositoryRoot: ctx.repositoryRoot,
            hiveRoot: snapshot.hiveRoot,
          });
          if (closed) return;
          writeFrame(write, "snapshot", JSON.stringify(fresh));
        },
      );
      tail = log;

      const replay = await log.open(lastEventId(req));
      if (closed) return;
      armWatch(eventsPath);
      writeFrame(write, "snapshot", JSON.stringify(snapshot));
      for (const line of replay) emitHive(write, line);
      if (closed) return;
      startClocks();
    } catch {
      if (closed) return;
      writeFrame(write, "snapshot", JSON.stringify({ ok: false, stale: true }));
      res.end?.();
      cleanup();
    }
  })();
}

function emitHive(write: (chunk: string) => void, line: string): void {
  const parsed = parseEventLine(line);
  if (!parsed) return;
  writeFrame(write, "hive", line, parsed.id);
}

function writeFrame(write: (chunk: string) => void, event: string, data: string, id?: string): void {
  let frame = `event: ${event}\n`;
  if (id !== undefined) frame += `id: ${id}\n`;
  for (const line of data.split("\n")) frame += `data: ${line}\n`;
  frame += "\n";
  write(frame);
}

function lastEventId(req: SseRequest): string | undefined {
  const value = headerValue(req.headers, "last-event-id");
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function headerValue(headers: SseRequest["headers"], name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, raw] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    if (Array.isArray(raw)) return raw[0];
    if (typeof raw === "string") return raw;
  }
  return undefined;
}

function defaultWatch(path: string, listener: (event: string, filename: string | null) => void): SseWatchHandle {
  let watcher: FSWatcher;
  try {
    watcher = fsWatch(path, (event, filename) => {
      listener(event, filename === null || filename === undefined ? null : filename.toString());
    });
  } catch {
    return { close() {} };
  }
  let closedWatch = false;
  const close = () => {
    if (closedWatch) return;
    closedWatch = true;
    watcher.close();
  };
  watcher.on("error", close);
  if (typeof watcher.unref === "function") watcher.unref();
  return { close };
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer.unref === "function") timer.unref();
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

type FileSnap = {
  offset: number;
  lines: string[];
  rest: Buffer;
};

/**
 * Read-only tail. `offset` is the number of bytes already read.
 * `pending` holds a trailing partial line that has no newline yet.
 */
class EventLogTail {
  private offset = 0;
  private pending: Buffer = Buffer.alloc(0);
  private lastId: string | undefined;
  private replaced = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly onLines: (lines: string[]) => void,
    private readonly onReplaced: () => Promise<void>,
  ) {}

  /** Position at the current file. Returns complete lines after `fromId`, exclusive. */
  async open(fromId: string | undefined): Promise<string[]> {
    const snap = await this.readSnapshot();
    if (!snap) {
      this.offset = 0;
      this.pending = Buffer.alloc(0);
      return [];
    }
    this.offset = snap.offset;
    this.pending = snap.rest;
    if (!fromId) return [];

    const after = linesAfter(snap.lines, fromId);
    if (!after) return [];
    this.lastId = after.lastId;
    return after.lines;
  }

  /**
   * @param fromWatch Watch notifications defer a shrink until the size poll,
   * so a truncate-then-write is not treated as new hive lines.
   */
  schedule(fromWatch: boolean): void {
    this.chain = this.chain.then(() => this.poll(fromWatch)).catch(() => undefined);
  }

  private async poll(fromWatch: boolean): Promise<void> {
    let info;
    try {
      info = await stat(this.path);
    } catch (err) {
      if (errno(err) === "ENOENT") return;
      return;
    }
    if (!info.isFile()) return;

    if (info.size < this.offset || this.replaced) {
      if (fromWatch) {
        this.replaced = true;
        return;
      }
      this.replaced = false;
      await this.finishReplace();
      return;
    }

    if (info.size === this.offset) return;

    const chunk = await readRange(this.path, this.offset, info.size);
    if (chunk.length === 0) return;
    this.offset += chunk.length;
    this.pending = Buffer.concat([this.pending, chunk]);
    this.emitReady();
  }

  private emitReady(): void {
    const { lines, rest } = splitCompleteBuffers(this.pending);
    this.pending = rest;
    const ready = hiveLines(lines);
    if (ready.length === 0) return;
    this.lastId = ready[ready.length - 1]?.id ?? this.lastId;
    this.onLines(ready.map((event) => event.line));
  }

  /** Id still in the file: replay after it. Id gone: fresh snapshot, resume at EOF. */
  private async finishReplace(): Promise<void> {
    const snap = await this.readSnapshot();
    if (!snap) {
      this.offset = 0;
      this.pending = Buffer.alloc(0);
      await this.onReplaced();
      return;
    }

    if (this.lastId) {
      const after = linesAfter(snap.lines, this.lastId);
      if (after) {
        this.offset = snap.offset;
        this.pending = snap.rest;
        if (after.lines.length > 0) {
          this.lastId = after.lastId;
          this.onLines(after.lines);
        }
        return;
      }
    }

    this.offset = snap.offset;
    this.pending = snap.rest;
    await this.onReplaced();
  }

  private async readSnapshot(): Promise<FileSnap | null> {
    try {
      const info = await stat(this.path);
      if (!info.isFile()) return null;
      const buf = await readRange(this.path, 0, info.size);
      const { lines, rest } = splitCompleteBuffers(buf);
      return { offset: buf.length, lines, rest };
    } catch (err) {
      if (errno(err) === "ENOENT") return null;
      throw err;
    }
  }
}

function hiveLines(lines: string[]): Array<{ line: string; id: string }> {
  const ready: Array<{ line: string; id: string }> = [];
  for (const raw of lines) {
    const line = stripCarriageReturn(raw);
    const parsed = parseEventLine(line);
    if (!parsed) continue;
    ready.push({ line, id: parsed.id });
  }
  return ready;
}

/** Lines strictly after `id`, or null when `id` is not in the file. */
function linesAfter(rawLines: string[], id: string): { lines: string[]; lastId: string } | null {
  const events = hiveLines(rawLines);
  const index = events.findIndex((event) => event.id === id);
  if (index === -1) return null;
  const tail = events.slice(index + 1);
  return { lines: tail.map((event) => event.line), lastId: tail[tail.length - 1]?.id ?? id };
}

function splitCompleteBuffers(buffer: Buffer): { lines: string[]; rest: Buffer } {
  const newline = buffer.lastIndexOf(0x0a);
  if (newline === -1) return { lines: [], rest: buffer };
  const text = buffer.subarray(0, newline + 1).toString("utf8");
  const parts = text.split("\n");
  parts.pop();
  return { lines: parts, rest: Buffer.from(buffer.subarray(newline + 1)) };
}

async function readRange(path: string, start: number, end: number): Promise<Buffer> {
  const length = end - start;
  if (length <= 0) return Buffer.alloc(0);
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await handle.read(buf, filled, length - filled, start + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return filled === length ? buf : buf.subarray(0, filled);
  } finally {
    await handle.close();
  }
}

function errno(err: unknown): string | undefined {
  if (err === null || typeof err !== "object" || !("code" in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

type AssertAssignable<Target, Source extends Target> = Source;
type _NodeRequestFits = AssertAssignable<SseRequest, IncomingMessage>;
type _NodeResponseFits = AssertAssignable<SseResponse, ServerResponse>;
