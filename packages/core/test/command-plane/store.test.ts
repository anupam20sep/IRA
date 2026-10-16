import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BLACKBOARD_LOCK_WAIT_MS,
  EVENT_BUSY,
  EVENT_LOCK_WAIT_MS,
  LEDGER_BUSY,
  LEDGER_LOCK_WAIT_MS,
  MAILBOX_BUSY,
  MAILBOX_LOCK_WAIT_MS,
  SCRIBE_BUSY,
  appendJsonlLine,
  busyCodeForLock,
  lockWaitMs,
  shouldStealLock,
  withLock,
  writeJsonAtomic,
} from "../../src/command-plane/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cp-store-"));
  roots.push(root);
  return root;
}

function deadPid(): number {
  for (let pid = 1_000_000; pid < 1_002_000; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") return pid;
    }
  }
  throw new Error("no unused pid");
}

async function waitForLock(lockPath: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await stat(lockPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`lock did not appear: ${lockPath}`);
}

describe("shouldStealLock (OD-012)", () => {
  it("never steals when holder pid is alive regardless of lock age", () => {
    expect(shouldStealLock({ pidAlive: true, nonceStable: true, ageMs: 120_000 })).toBe(false);
    expect(shouldStealLock({ pidAlive: true, nonceStable: false, ageMs: 0 })).toBe(false);
    expect(shouldStealLock({ pidAlive: true, nonceStable: true, ageMs: 0 })).toBe(false);
  });

  it("steals only when pid dead and nonce stable on re-read", () => {
    expect(shouldStealLock({ pidAlive: false, nonceStable: true, ageMs: 120_000 })).toBe(true);
    expect(shouldStealLock({ pidAlive: false, nonceStable: false, ageMs: 120_000 })).toBe(false);
    expect(shouldStealLock({ pidAlive: false, nonceStable: true, ageMs: 0 })).toBe(true);
    expect(shouldStealLock({ pidAlive: false, nonceStable: false, ageMs: 0 })).toBe(false);
  });
});

describe("lock wait bounds and busy codes", () => {
  it("uses blackboard 0 ms and ledger, mailbox, and events 2000 ms", () => {
    const dir = "/hive/locks";
    expect(lockWaitMs(join(dir, "blackboard.lock"))).toBe(0);
    expect(lockWaitMs(join(dir, "blackboard.lock"))).toBe(BLACKBOARD_LOCK_WAIT_MS);
    expect(lockWaitMs(join(dir, "ledger-001-ira.lock"))).toBe(2000);
    expect(lockWaitMs(join(dir, "ledger-001-ira.lock"))).toBe(LEDGER_LOCK_WAIT_MS);
    expect(lockWaitMs(join(dir, "mailbox-ira-outbox.lock"))).toBe(2000);
    expect(lockWaitMs(join(dir, "mailbox-ira-outbox.lock"))).toBe(MAILBOX_LOCK_WAIT_MS);
    expect(lockWaitMs(join(dir, "events.lock"))).toBe(2000);
    expect(lockWaitMs(join(dir, "events.lock"))).toBe(EVENT_LOCK_WAIT_MS);
  });

  it("maps lock filenames to busy codes", () => {
    const dir = "/hive/locks";
    expect(busyCodeForLock(join(dir, "blackboard.lock"))).toBe(SCRIBE_BUSY);
    expect(busyCodeForLock(join(dir, "ledger-feat.lock"))).toBe(LEDGER_BUSY);
    expect(busyCodeForLock(join(dir, "mailbox-worker-outbox.lock"))).toBe(MAILBOX_BUSY);
    expect(busyCodeForLock(join(dir, "events.lock"))).toBe(EVENT_BUSY);
  });
});

describe("withLock", () => {
  it("creates { pid, nonce } with wx and releases only when the nonce matches", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, "blackboard.lock");

    const held = await withLock(lockPath, { waitMs: 0 }, async ({ nonce }) => {
      const raw = JSON.parse(await readFile(lockPath, "utf8")) as {
        pid: number;
        nonce: string;
        acquiredAt?: string;
      };
      expect(raw.pid).toBe(process.pid);
      expect(raw.nonce).toBe(nonce);
      expect(typeof raw.nonce).toBe("string");
      expect(raw.nonce.length).toBeGreaterThan(0);
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, nonce: "replaced" }));
      return "held";
    });

    expect(held).toEqual({ ok: true, value: "held" });
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual({
      pid: process.pid,
      nonce: "replaced",
    });
  });

  it("removes the lock after the critical section when the nonce is unchanged", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, "events.lock");

    const result = await withLock(lockPath, { waitMs: 0 }, async () => "done");

    expect(result).toEqual({ ok: true, value: "done" });
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns SCRIBE_BUSY immediately for a live blackboard holder", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, "blackboard.lock");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withLock(lockPath, { waitMs: 0 }, async () => {
      await gate;
      return "first";
    });
    await waitForLock(lockPath);

    const started = Date.now();
    const second = await withLock(lockPath, { waitMs: 0 }, async () => "second");
    expect(Date.now() - started).toBeLessThan(200);
    expect(second).toEqual({ ok: false, code: SCRIBE_BUSY });

    release();
    expect(await first).toEqual({ ok: true, value: "first" });
  });

  it("does not steal a live pid when acquiredAt is older than 30 seconds", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, "ledger-feat.lock");
    const body = {
      pid: process.pid,
      nonce: "live-old",
      acquiredAt: new Date(Date.now() - 120_000).toISOString(),
    };
    await writeFile(lockPath, JSON.stringify(body));

    const result = await withLock(lockPath, { waitMs: 0 }, async () => "stolen");

    expect(result).toEqual({ ok: false, code: LEDGER_BUSY });
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(body);
  });

  it("steals a dead pid when the nonce is unchanged on re-read", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, "events.lock");
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: deadPid(),
        nonce: "dead-stable",
        acquiredAt: new Date(Date.now() - 120_000).toISOString(),
      }),
    );

    const result = await withLock(lockPath, { waitMs: 0 }, async ({ nonce }) => {
      const raw = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number; nonce: string };
      expect(raw.pid).toBe(process.pid);
      expect(raw.nonce).toBe(nonce);
      expect(raw.nonce).not.toBe("dead-stable");
      return "stolen";
    });

    expect(result).toEqual({ ok: true, value: "stolen" });
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("waits up to waitMs for a live ledger lock, then returns LEDGER_BUSY", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, "ledger-feat.lock");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withLock(lockPath, { waitMs: 0 }, () => gate);
    await waitForLock(lockPath);

    const started = Date.now();
    const second = await withLock(lockPath, { waitMs: 150 }, async () => "late");
    const elapsed = Date.now() - started;

    expect(second).toEqual({ ok: false, code: LEDGER_BUSY });
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(1000);

    release();
    await first;
  });

  it("acquires a ledger lock released before the wait elapses", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, "ledger-feat.lock");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withLock(lockPath, { waitMs: 0 }, () => gate);
    await waitForLock(lockPath);

    const second = withLock(lockPath, { waitMs: LEDGER_LOCK_WAIT_MS }, async () => "next");
    setTimeout(release, 40);

    expect(await second).toEqual({ ok: true, value: "next" });
    await first;
  });

  it("returns MAILBOX_BUSY and EVENT_BUSY for those lock names", async () => {
    const dir = await tempDir();
    const mailbox = join(dir, "mailbox-worker-outbox.lock");
    const events = join(dir, "events.lock");
    await writeFile(mailbox, JSON.stringify({ pid: process.pid, nonce: "m" }));
    await writeFile(events, JSON.stringify({ pid: process.pid, nonce: "e" }));

    expect(await withLock(mailbox, { waitMs: 0 }, async () => "no")).toEqual({
      ok: false,
      code: MAILBOX_BUSY,
    });
    expect(await withLock(events, { waitMs: 0 }, async () => "no")).toEqual({
      ok: false,
      code: EVENT_BUSY,
    });
  });

  it("replaces one malformed lock and runs the critical section", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, "blackboard.lock");
    await writeFile(lockPath, "{not-json");

    const result = await withLock(lockPath, { waitMs: 0 }, async () => "recovered");

    expect(result).toEqual({ ok: true, value: "recovered" });
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns the busy code when a malformed lock is still unreadable on the retry", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, "blackboard.lock");
    await mkdir(lockPath);

    const result = await withLock(lockPath, { waitMs: 0 }, async () => "no");

    expect(result).toEqual({ ok: false, code: SCRIBE_BUSY });
    expect((await stat(lockPath)).isDirectory()).toBe(true);
  });

  it("releases the lock when the critical section throws", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, "events.lock");

    await expect(
      withLock(lockPath, { waitMs: 0 }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("writeJsonAtomic", () => {
  it("replaces a JSON document via temp file and rename", async () => {
    const dir = await tempDir();
    const file = join(dir, "ledger.json");
    await writeFile(file, '{"stale":true}');

    await writeJsonAtomic(file, { schemaVersion: 1, tasks: [] });

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ schemaVersion: 1, tasks: [] });
    const names = await readdir(dir);
    expect(names.filter((name) => name.includes(".tmp"))).toEqual([]);
    expect(names).toEqual(["ledger.json"]);
  });
});

describe("appendJsonlLine", () => {
  it("appends one JSON line without rewriting earlier lines", async () => {
    const dir = await tempDir();
    const file = join(dir, "events.jsonl");

    await appendJsonlLine(file, { id: "1", type: "task.held" });
    await appendJsonlLine(file, { id: "2", type: "task.resumed" });

    const lines = (await readFile(file, "utf8")).split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toEqual({ id: "1", type: "task.held" });
    expect(JSON.parse(lines[1] ?? "")).toEqual({ id: "2", type: "task.resumed" });
  });

  it("refuses a second mailbox append while the outbox lock is held", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, "mailbox-worker-outbox.lock");
    const outbox = join(dir, "outbox.jsonl");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withLock(lockPath, { waitMs: 0 }, async () => {
      await appendJsonlLine(outbox, { n: 1 });
      await gate;
    });
    await waitForLock(lockPath);

    const second = await withLock(lockPath, { waitMs: 0 }, async () => {
      await appendJsonlLine(outbox, { n: 2 });
    });
    expect(second).toEqual({ ok: false, code: MAILBOX_BUSY });

    release();
    expect(await first).toEqual({ ok: true, value: undefined });
    expect(await readFile(outbox, "utf8")).toBe(`${JSON.stringify({ n: 1 })}\n`);
  });
});
