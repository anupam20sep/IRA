import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SSE_HEARTBEAT_MS,
  SSE_POLL_MS,
  eventTriggersRefetch,
  handleSseRequest,
  parseEventLine,
  parseEventLog,
  type SseRequest,
  type SseResponse,
  type SseWatch,
} from "../src/server/sse.js";

const roots: string[] = [];
const closers: Array<() => void> = [];
let fakeBin: string | undefined;
let previousBin: string | undefined;

type Frame = {
  event?: string;
  id?: string;
  data?: string;
  comments: string[];
};

function eventLine(id: string, type: string): string {
  return JSON.stringify({
    id,
    type,
    version: 1,
    ts: "2026-10-16T12:00:00.000Z",
    featureId: "002-ira-command-center",
    actor: { kind: "ira", id: "ira" },
    data: { taskId: "T010" },
  });
}

function parseSse(text: string): Frame[] {
  const frames: Frame[] = [];
  for (const chunk of text.split("\n\n")) {
    if (chunk.length === 0) continue;
    const frame: Frame = { comments: [] };
    const data: string[] = [];
    for (const line of chunk.split("\n")) {
      if (line.startsWith(":")) {
        frame.comments.push(line.slice(1).replace(/^ /, ""));
        continue;
      }
      if (line.startsWith("event:")) {
        frame.event = line.slice("event:".length).trim();
        continue;
      }
      if (line.startsWith("id:")) {
        frame.id = line.slice("id:".length).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        let value = line.slice("data:".length);
        if (value.startsWith(" ")) value = value.slice(1);
        data.push(value);
      }
    }
    if (data.length > 0) frame.data = data.join("\n");
    frames.push(frame);
  }
  return frames;
}

function hiveFrames(text: string): Frame[] {
  return parseSse(text).filter((frame) => frame.event === "hive");
}

function snapshotFrames(text: string): Frame[] {
  return parseSse(text).filter((frame) => frame.event === "snapshot");
}

function heartbeatCount(text: string): number {
  return parseSse(text).filter((frame) => frame.comments.includes("heartbeat")).length;
}

type MockReq = SseRequest & { emit(event: "close" | "aborted"): void };

function createReq(headers: Record<string, string> = {}): MockReq {
  const listeners = new Map<string, Array<() => void>>();
  return {
    headers,
    on(event: string, listener: () => void) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    emit(event: "close" | "aborted") {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

type MockRes = SseResponse & { status: number; headers: Record<string, string>; text: string };

function createRes(): MockRes {
  const res: MockRes = {
    status: 0,
    headers: {},
    text: "",
    writeHead(statusCode: number, headers?: Record<string, string | readonly string[]>) {
      res.status = statusCode;
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers ?? {})) {
        next[key] = Array.isArray(value) ? value.join(", ") : String(value);
      }
      res.headers = next;
    },
    write(chunk: string) {
      res.text += chunk;
      return true;
    },
  };
  return res;
}

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

async function setupLog(lines: string[], trailing = ""): Promise<{ repo: string; hive: string; eventsPath: string }> {
  const root = await makeTemp("cc-sse-");
  const repo = join(root, "repo");
  const hive = join(root, "hive");
  const eventsDir = join(hive, "events");
  await mkdir(eventsDir, { recursive: true });
  await mkdir(repo, { recursive: true });
  const eventsPath = join(eventsDir, "events.jsonl");
  const body = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  await writeFile(eventsPath, body + trailing);
  return { repo, hive, eventsPath };
}

function start(
  repo: string,
  hive: string,
  headers?: Record<string, string>,
  watch?: SseWatch,
): { req: MockReq; res: MockRes } {
  const req = createReq(headers);
  const res = createRes();
  closers.push(() => req.emit("close"));
  handleSseRequest(req, res, {
    repositoryRoot: repo,
    hiveRoot: hive,
    ...(watch ? { watch } : {}),
  });
  return { req, res };
}

async function untilSnapshot(res: MockRes): Promise<void> {
  await vi.waitFor(
    () => {
      expect(snapshotFrames(res.text).length).toBeGreaterThan(0);
    },
    { timeout: 5000 },
  );
}

describe("parseEventLine / parseEventLog", () => {
  it("extracts id and type from a complete JSONL line, including unknown types", () => {
    const line = eventLine("evt_a", "custom.future");
    expect(parseEventLine(line)).toEqual({ id: "evt_a", type: "custom.future" });
  });

  it("returns null for a partial line and leaves that fragment unparsed", () => {
    const complete = eventLine("evt_a", "task.started");
    const partial = '{"id":"evt_b","type":"doctor.ran"';
    expect(parseEventLine(partial)).toBeNull();
    expect(parseEventLog(`${complete}\n${partial}`)).toEqual({
      events: [{ id: "evt_a", type: "task.started", line: complete }],
      rest: partial,
    });
    expect(parseEventLog(`${complete}\n`)).toEqual({
      events: [{ id: "evt_a", type: "task.started", line: complete }],
      rest: "",
    });
  });

  it("skips blank and non-JSON complete lines without dropping the next event", () => {
    const second = eventLine("evt_b", "note.kept");
    const parsed = parseEventLog(`\nnot-json\n${second}\n`);
    expect(parsed.events).toEqual([{ id: "evt_b", type: "note.kept", line: second }]);
    expect(parsed.rest).toBe("");
  });
});

describe("eventTriggersRefetch", () => {
  it("is true for design.md prefixes and doctor.ran only", () => {
    for (const type of [
      "task.started",
      "ask_me.opened",
      "brief.submitted",
      "away.entered",
      "autonomy.changed",
      "hive.ready",
      "doctor.ran",
    ]) {
      expect(eventTriggersRefetch(type)).toBe(true);
    }
    for (const type of ["engine.tokens", "note.kept", "custom.future", "doctor.rant", "task", "ask-me.opened"]) {
      expect(eventTriggersRefetch(type)).toBe(false);
    }
  });
});

describe("handleSseRequest", () => {
  beforeEach(async () => {
    previousBin = process.env.SUPERSPEC_BIN;
    const dir = await makeTemp("cc-sse-bin-");
    fakeBin = join(dir, "fake-superspec.mjs");
    await writeFile(fakeBin, 'process.stdout.write(\'{"ok":false}\\n\');\n');
    process.env.SUPERSPEC_BIN = fakeBin;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(async () => {
    for (const close of closers) close();
    closers.length = 0;
    vi.useRealTimers();
    if (previousBin === undefined) delete process.env.SUPERSPEC_BIN;
    else process.env.SUPERSPEC_BIN = previousBin;
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("sends text/event-stream, a snapshot frame first, and a heartbeat each second", async () => {
    expect(SSE_HEARTBEAT_MS).toBe(1000);
    const { repo, hive } = await setupLog([eventLine("evt_a", "note.kept")]);
    const { res } = start(repo, hive);
    await untilSnapshot(res);

    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    const frames = parseSse(res.text);
    expect(frames[0]?.event).toBe("snapshot");
    const snapshot = JSON.parse(frames[0]?.data ?? "null") as { ok?: boolean; hiveRoot?: string };
    expect(snapshot.ok).toBe(true);
    expect(snapshot.hiveRoot).toBe(hive);
    expect(hiveFrames(res.text)).toEqual([]);
    expect(heartbeatCount(res.text)).toBe(0);

    await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS);
    expect(heartbeatCount(res.text)).toBe(1);
    await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS);
    expect(heartbeatCount(res.text)).toBe(2);
  });

  it("tails new complete lines by size every 500ms when fs.watch does not fire", async () => {
    expect(SSE_POLL_MS).toBe(500);
    let watched = 0;
    const watch: SseWatch = () => {
      watched += 1;
      return { close() {} };
    };
    const { repo, hive, eventsPath } = await setupLog([eventLine("evt_a", "note.kept")]);
    const before = await readFile(eventsPath);
    await chmod(eventsPath, 0o444);
    const { res } = start(repo, hive, undefined, watch);
    await untilSnapshot(res);
    expect(watched).toBeGreaterThan(0);

    const line = eventLine("evt_new", "custom.future");
    await chmod(eventsPath, 0o644);
    await appendFile(eventsPath, `${line}\n`);
    const afterAppend = await readFile(eventsPath);
    expect(afterAppend.equals(before)).toBe(false);
    await vi.advanceTimersByTimeAsync(SSE_POLL_MS - 1);
    expect(hiveFrames(res.text).map((frame) => frame.id)).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(hiveFrames(res.text)).toEqual([
        expect.objectContaining({ event: "hive", id: "evt_new", data: line }),
      ]);
    });

    const source = await readFile(new URL("../src/server/sse.ts", import.meta.url), "utf8");
    expect(source).not.toContain("appendFile");
    expect(source).not.toContain("writeFile");
    expect((await readFile(eventsPath)).equals(afterAppend)).toBe(true);
  });

  it("emits an appended line from fs.watch before the size poll is due", async () => {
    const { repo, hive, eventsPath } = await setupLog([]);
    const { res } = start(repo, hive);
    await untilSnapshot(res);
    const line = eventLine("evt_watch", "task.started");
    const started = Date.now();
    await appendFile(eventsPath, `${line}\n`);
    await vi.waitFor(
      () => {
        expect(hiveFrames(res.text).map((frame) => frame.id)).toContain("evt_watch");
      },
      { timeout: 450 },
    );
    expect(Date.now() - started).toBeLessThan(450);
    expect(heartbeatCount(res.text)).toBe(0);
    const watched = hiveFrames(res.text).filter((frame) => frame.id === "evt_watch");
    expect(watched).toHaveLength(1);
    expect(watched[0]?.data).toBe(line);
  });

  it("replays lines after Last-Event-ID and resumes at EOF when that id is gone", async () => {
    const lineA = eventLine("evt_a", "note.kept");
    const lineB = eventLine("evt_b", "task.done");
    const lineC = eventLine("evt_c", "engine.tokens");
    const partial = '{"id":"evt_partial","type":"ask_me.opened"';
    const { repo, hive, eventsPath } = await setupLog([lineA, lineB, lineC], partial);

    const found = start(repo, hive, { "Last-Event-ID": "evt_a" });
    await untilSnapshot(found.res);
    expect(hiveFrames(found.res.text).map((frame) => ({ id: frame.id, data: frame.data }))).toEqual([
      { id: "evt_b", data: lineB },
      { id: "evt_c", data: lineC },
    ]);

    await chmod(eventsPath, 0o644);
    await appendFile(eventsPath, '}\n');
    await vi.advanceTimersByTimeAsync(SSE_POLL_MS);
    await vi.waitFor(() => {
      expect(hiveFrames(found.res.text).map((frame) => frame.id)).toContain("evt_partial");
    });
    const partialFrame = hiveFrames(found.res.text).find((frame) => frame.id === "evt_partial");
    expect(partialFrame?.data).toBe(`${partial}}`);
    expect(eventTriggersRefetch("ask_me.opened")).toBe(true);

    const missing = start(repo, hive, { "last-event-id": "evt_gone" });
    await untilSnapshot(missing.res);
    expect(snapshotFrames(missing.res.text)).toHaveLength(1);
    expect(hiveFrames(missing.res.text)).toEqual([]);

    const lineD = eventLine("evt_d", "hive.updated");
    await appendFile(eventsPath, `${lineD}\n`);
    await vi.advanceTimersByTimeAsync(SSE_POLL_MS);
    await vi.waitFor(() => {
      expect(hiveFrames(missing.res.text).map((frame) => frame.id)).toEqual(["evt_d"]);
    });
  });

  it("sends a fresh snapshot and does not replay when the log shrinks and the last id is gone", async () => {
    const lineA = eventLine("evt_a", "note.kept");
    const lineB = eventLine("evt_b", "brief.submitted");
    const { repo, hive, eventsPath } = await setupLog([lineA, lineB]);
    const { res } = start(repo, hive, { "last-event-id": "evt_a" });
    await untilSnapshot(res);
    expect(hiveFrames(res.text).map((frame) => frame.id)).toEqual(["evt_b"]);

    const lineZ = eventLine("evt_z", "note.replaced");
    await writeFile(eventsPath, `${lineZ}\n`);
    await vi.advanceTimersByTimeAsync(SSE_POLL_MS);
    await vi.waitFor(() => {
      expect(snapshotFrames(res.text).length).toBeGreaterThanOrEqual(2);
    });
    expect(hiveFrames(res.text).map((frame) => frame.id)).toEqual(["evt_b"]);

    const lineY = eventLine("evt_y", "task.aborted");
    await appendFile(eventsPath, `${lineY}\n`);
    await vi.advanceTimersByTimeAsync(SSE_POLL_MS);
    await vi.waitFor(() => {
      expect(hiveFrames(res.text).map((frame) => frame.id)).toEqual(["evt_b", "evt_y"]);
    });
  });

  it("stops heartbeats after the request closes", async () => {
    const { repo, hive } = await setupLog([]);
    const { req, res } = start(repo, hive);
    await untilSnapshot(res);
    req.emit("close");
    await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS * 2);
    expect(heartbeatCount(res.text)).toBe(0);
  });
});
