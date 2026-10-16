import { randomBytes } from "node:crypto";
import { appendFile, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { CommandPlaneErrorCode } from "./types.js";

export const SCRIBE_BUSY = "SCRIBE_BUSY" as const;
export const LEDGER_BUSY = "LEDGER_BUSY" as const;
export const MAILBOX_BUSY = "MAILBOX_BUSY" as const;
export const EVENT_BUSY = "EVENT_BUSY" as const;
export const ROSTER_BUSY = "ROSTER_BUSY" as const;

export type LockBusyCode = Extract<
  CommandPlaneErrorCode,
  typeof SCRIBE_BUSY | typeof LEDGER_BUSY | typeof MAILBOX_BUSY | typeof EVENT_BUSY | typeof ROSTER_BUSY
>;

/** Blackboard scribe does not wait. Other hive locks wait up to two seconds. */
export const BLACKBOARD_LOCK_WAIT_MS = 0;
export const LEDGER_LOCK_WAIT_MS = 2000;
export const MAILBOX_LOCK_WAIT_MS = 2000;
export const EVENT_LOCK_WAIT_MS = 2000;

const POLL_MS = 20;

export type LockHolder = { nonce: string };

export type WithLockResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: LockBusyCode };

type LockBody = { pid: number; nonce: string };

type LockRead = { kind: "missing" } | { kind: "malformed" } | { kind: "held"; body: LockBody };

/**
 * OD-012 steal predicate. `ageMs` is part of the call shape so callers can pass
 * lock age, and it is intentionally unused: a live pid is never stolen.
 */
export function shouldStealLock(input: {
  pidAlive: boolean;
  nonceStable: boolean;
  ageMs: number;
}): boolean {
  void input.ageMs;
  return input.pidAlive === false && input.nonceStable === true;
}

export function busyCodeForLock(lockPath: string): LockBusyCode {
  const base = basename(lockPath);
  if (base === "blackboard.lock") return SCRIBE_BUSY;
  if (base === "events.lock") return EVENT_BUSY;
  if (base === "roster.lock") return ROSTER_BUSY;
  if (/^ledger-.+\.lock$/.test(base)) return LEDGER_BUSY;
  if (/^mailbox-.+-outbox\.lock$/.test(base)) return MAILBOX_BUSY;
  throw new Error(`unknown hive lock path: ${base}`);
}

export function lockWaitMs(lockPath: string): number {
  switch (busyCodeForLock(lockPath)) {
    case SCRIBE_BUSY:
      return BLACKBOARD_LOCK_WAIT_MS;
    case LEDGER_BUSY:
      return LEDGER_LOCK_WAIT_MS;
    case MAILBOX_BUSY:
      return MAILBOX_LOCK_WAIT_MS;
    case EVENT_BUSY:
      return EVENT_LOCK_WAIT_MS;
    case ROSTER_BUSY:
      return LEDGER_LOCK_WAIT_MS;
  }
}

/**
 * Exclusive hive lock. Creates `{ pid, nonce }` with flag `wx`.
 * Steal unlinks only when the holder pid is dead and a re-read shows the same nonce.
 * Release unlinks only when the file nonce is still the caller's nonce.
 */
export async function withLock<T>(
  lockPath: string,
  options: { waitMs: number },
  fn: (holder: LockHolder) => T | Promise<T>,
): Promise<WithLockResult<T>> {
  const code = busyCodeForLock(lockPath);
  const deadline = Date.now() + finiteWaitMs(options.waitMs);
  let malformedStrikes = 0;

  // Backstop if a lock path disappears between create and read. Live holders exit via deadline.
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const created = await tryCreateLock(lockPath);
    if (created) {
      try {
        const value = await fn({ nonce: created.nonce });
        return { ok: true, value };
      } finally {
        await releaseIfNonceMatches(lockPath, created.nonce);
      }
    }

    const seen = await readLock(lockPath);
    if (seen.kind === "missing") continue;

    if (seen.kind === "malformed") {
      malformedStrikes += 1;
      if (malformedStrikes > 1) return { ok: false, code };
      await unlinkIfPresent(lockPath);
      continue;
    }

    // Live pid: wait out waitMs. Never unlink, regardless of acquiredAt.
    if (isPidAlive(seen.body.pid)) {
      if (Date.now() >= deadline) return { ok: false, code };
      await sleep(Math.min(POLL_MS, deadline - Date.now()));
      continue;
    }

    const again = await readLock(lockPath);
    const nonceStable = again.kind === "held" && again.body.nonce === seen.body.nonce;
    // ageMs is a constant: acquiredAt is not an input to the steal decision.
    if (shouldStealLock({ pidAlive: false, nonceStable, ageMs: 0 })) {
      await unlinkIfPresent(lockPath);
      continue;
    }

    if (Date.now() >= deadline) return { ok: false, code };
    await sleep(Math.min(POLL_MS, Math.max(deadline - Date.now(), 0)));
  }

  return { ok: false, code };
}

/** Temp file in the same directory, then `rename` over the destination. */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value);
  if (typeof payload !== "string") throw new TypeError("value is not JSON-serializable");

  const tmp = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const handle = await open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } catch (err) {
    await handle.close();
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  await handle.close();
  try {
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** One JSON value plus a trailing newline. Caller holds the file's lock. */
export async function appendJsonlLine(filePath: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value);
  if (typeof payload !== "string") throw new TypeError("value is not JSON-serializable");
  await appendFile(filePath, `${payload}\n`, { encoding: "utf8", mode: 0o600 });
}

async function tryCreateLock(lockPath: string): Promise<LockHolder | null> {
  const nonce = randomBytes(16).toString("hex");
  const body = {
    pid: process.pid,
    nonce,
    acquiredAt: new Date().toISOString(),
  };
  try {
    await writeFile(lockPath, `${JSON.stringify(body)}\n`, { flag: "wx", mode: 0o600 });
    return { nonce };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // A directory at the lock path also reports EEXIST on macOS. Permission errors propagate.
    if (code === "EEXIST") return null;
    throw err;
  }
}

async function readLock(lockPath: string): Promise<LockRead> {
  try {
    const text = await readFile(lockPath, "utf8");
    return parseLock(text);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    return { kind: "malformed" };
  }
}

/** Parses `{ pid, nonce }` only. `acquiredAt` is stored for logs and is not read here. */
function parseLock(text: string): LockRead {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return { kind: "malformed" };
    const pid = (value as { pid?: unknown }).pid;
    const nonce = (value as { nonce?: unknown }).nonce;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return { kind: "malformed" };
    if (typeof nonce !== "string" || nonce.length === 0) return { kind: "malformed" };
    return { kind: "held", body: { pid, nonce } };
  } catch {
    return { kind: "malformed" };
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the pid exists, but this user cannot signal it.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function releaseIfNonceMatches(lockPath: string, nonce: string): Promise<void> {
  const seen = await readLock(lockPath);
  if (seen.kind === "held" && seen.body.nonce === nonce) {
    await unlinkIfPresent(lockPath);
  }
}

async function unlinkIfPresent(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR" || code === "EPERM") return;
    throw err;
  }
}

function finiteWaitMs(waitMs: number): number {
  if (!Number.isFinite(waitMs) || waitMs <= 0) return 0;
  return waitMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
