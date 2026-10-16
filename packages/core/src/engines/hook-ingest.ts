import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";
import { EVENT_LOCK_WAIT_MS, appendJsonlLine, withLock } from "../command-plane/store.js";
import { resolveHiveRoot } from "./store.js";
import { normalizeEngineEvent } from "./normalize.js";

export type EngineSessionRecord = {
  agentId: string;
  engineId: string;
  taskId: string;
  featureId?: string | null;
};

export function parseHookStdin(buffer: Buffer): Record<string, unknown> {
  const text = buffer.toString("utf8").trim();
  if (!text) throw new Error("HOOK_STDIN_EMPTY");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("HOOK_STDIN_INVALID");
  }
  return parsed as Record<string, unknown>;
}

function sessionDir(hiveRoot: string, sessionId: string): string {
  return join(hiveRoot, "engines", "sessions", sessionId);
}

async function readSessionRecord(hiveRoot: string, sessionId: string): Promise<EngineSessionRecord> {
  try {
    const text = await readFile(join(sessionDir(hiveRoot, sessionId), "session.json"), "utf8");
    const raw = JSON.parse(text) as EngineSessionRecord;
    return {
      agentId: typeof raw.agentId === "string" && raw.agentId.length > 0 ? raw.agentId : "worker",
      engineId: typeof raw.engineId === "string" && raw.engineId.length > 0 ? raw.engineId : "claude",
      taskId: typeof raw.taskId === "string" && raw.taskId.length > 0 ? raw.taskId : "T000",
      featureId: typeof raw.featureId === "string" ? raw.featureId : null,
    };
  } catch {
    return { agentId: "worker", engineId: "claude", taskId: "T000", featureId: null };
  }
}

async function startAlreadyRecorded(hiveRoot: string, sessionId: string): Promise<boolean> {
  try {
    await access(join(sessionDir(hiveRoot, sessionId), "started"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function markStartRecorded(hiveRoot: string, sessionId: string): Promise<void> {
  const dir = sessionDir(hiveRoot, sessionId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "started"), "1\n", { mode: 0o600 });
}

async function appendEngineEvent(hiveRoot: string, event: NonNullable<ReturnType<typeof normalizeEngineEvent>>): Promise<void> {
  try {
    await access(join(hiveRoot, "events"), constants.W_OK);
  } catch {
    return;
  }
  await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
    appendJsonlLine(join(hiveRoot, "events", "events.jsonl"), event),
  );
}

async function resolveHiveForIngest(): Promise<string | null> {
  const fromEnv = process.env.SUPERSPEC_HIVE_ROOT?.trim();
  if (fromEnv) {
    try {
      await access(join(fromEnv, "hive.json"), constants.R_OK);
      return fromEnv;
    } catch {
      return null;
    }
  }
  const resolved = await resolveHiveRoot(process.cwd());
  return resolved.ok ? resolved.hiveRoot : null;
}

/** Read vendor hook JSON, normalize, append to hive events; exit-friendly `{ ok: true }`. */
export async function runHookIngest(stdinJson: string, sessionId: string): Promise<{ ok: true }> {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("SESSION_ID_REQUIRED");
  }

  const hiveRoot = await resolveHiveForIngest();
  if (!hiveRoot) return { ok: true };

  const raw = parseHookStdin(Buffer.from(stdinJson));
  const session = await readSessionRecord(hiveRoot, sessionId);

  if (await startAlreadyRecorded(hiveRoot, sessionId)) {
    const resolved = normalizeEngineEvent(raw, { ...session, sessionId });
    if (resolved?.type === "engine.start") {
      return { ok: true };
    }
  }

  const event = normalizeEngineEvent(raw, { ...session, sessionId });
  if (!event) return { ok: true };

  await appendEngineEvent(hiveRoot, event);

  if (event.type === "engine.start") {
    await markStartRecorded(hiveRoot, sessionId);
  }

  if (event.type === "engine.stop" || event.type === "engine.error") {
    await rm(sessionDir(hiveRoot, sessionId), { recursive: true, force: true });
  }

  return { ok: true };
}
