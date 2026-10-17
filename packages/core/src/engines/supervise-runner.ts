/**
 * Detached supervisor spawn (MCP side) and the `engines supervise` child (OD-015).
 * MCP calls `spawnDetachedSupervisor` only. Observation runs in that child.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DispatchIntent } from "../command-plane/hooks.js";
import type { IraEvent } from "../command-plane/types.js";
import { EVENT_LOCK_WAIT_MS, appendJsonlLine, withLock, writeJsonAtomic } from "../command-plane/store.js";
import { getBuiltinPreset, parseCustomEngineId } from "./catalog.js";
import { persistDispatchIntent } from "./dispatch-queue.js";
import { buildSupervisorEnv } from "./env-scrub.js";
import { canonicalEngineId, isHostEngineId } from "./host-spawn-guard.js";
import { normalizeEngineEvent, type NormalizeEngineContext } from "./normalize.js";
import { CustomEnginesFileSchema } from "./schema.js";
import {
  assertSupervisorNotInMcp,
  buildDetachedSupervisorSpawnSpec,
  recordSupervisorChildCrash,
  type DetachedSupervisorStdio,
} from "./supervisor.js";
import type { CustomEngine, EngineStrategy, LadderRung } from "./types.js";

const SUPERVISOR_IDS = new Set(["opencode", "crush", "aider", "custom"]);

export type DetachedSpawnChild = {
  pid?: number;
  unref?: () => void;
};

export type DetachedSpawnOptions = {
  detached: true;
  shell: false;
  stdio: DetachedSupervisorStdio;
  env: Record<string, string>;
};

export type DetachedSpawnFn = (
  command: string,
  args: readonly string[],
  options: DetachedSpawnOptions,
) => DetachedSpawnChild;

export type EngineSpawnOptions = {
  shell: false;
  cwd?: string;
  env: Record<string, string>;
  stdio: ["pipe", "pipe", "pipe"];
};

export type EngineChild = {
  pid?: number;
  stdout?: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
};

export type EngineSpawnFn = (
  command: string,
  args: readonly string[],
  options: EngineSpawnOptions,
) => EngineChild;

export type SuperviseResult = { ok: true; pid: number } | { ok: false; code: string };

type SuperviseIntent = DispatchIntent & { engineId: string };

type EngineLaunch = {
  command: string;
  args: string[];
  cwd?: string;
  strategy: Extract<EngineStrategy, "acp" | "pty">;
  eventMode: "sparse" | "jsonl";
  rung: LadderRung;
  byokAllowlist: readonly string[];
};

/**
 * Start `superspec engines supervise <intentPath>` detached from the MCP process.
 * Does not run observation in this process.
 */
export async function spawnDetachedSupervisor(input: {
  intentPath: string;
  spawnFn?: DetachedSpawnFn;
  env?: Record<string, string>;
}): Promise<SuperviseResult> {
  const env =
    input.env ??
    buildSupervisorEnv({ rung: "local", processEnv: process.env, byokAllowlist: [] });
  const spec = buildDetachedSupervisorSpawnSpec(input.intentPath, env);
  const spawnFn = input.spawnFn ?? defaultDetachedSpawn;
  try {
    const child = spawnFn(spec.argv[0], spec.argv.slice(1), {
      detached: true,
      shell: false,
      stdio: spec.stdio,
      env: spec.env,
    });
    try {
      const observed = child as DetachedSpawnChild & {
        on?: (event: "error", listener: (error: Error) => void) => void;
      };
      observed.on?.("error", () => {
        // A missing supervisor binary must not surface as an unhandled MCP exception.
      });
      child.unref?.();
    } catch {
      // Detach failure must not escape to the MCP request.
    }
    if (typeof child.pid !== "number") return { ok: false, code: "spawn_failed" };
    return { ok: true, pid: child.pid };
  } catch {
    return { ok: false, code: "spawn_failed" };
  }
}

/** Persist the intent the detached child reads, including the effective engine id. */
export async function writeSupervisorIntent(intent: DispatchIntent, engineId: string): Promise<string> {
  const path = await persistDispatchIntent(intent);
  await writeJsonAtomic(path, { ...intent, engineId });
  await chmod(path, 0o600);
  return path;
}

/** Map one ACP JSON-RPC notification. Unknown shapes are ignored. */
export function mapAcpNotification(notification: unknown, ctx: NormalizeEngineContext): IraEvent | null {
  if (!isAcpNotification(notification)) return null;
  return normalizeEngineEvent(notification, ctx);
}

/**
 * Body of `superspec engines supervise`. Spawns the engine child, observes ACP or
 * PTY-class output, and records a crash without throwing.
 */
export async function runSuperviseIntent(
  intentPath: string,
  options: { spawnFn?: EngineSpawnFn } = {},
): Promise<SuperviseResult> {
  assertSupervisorNotInMcp("cli-supervise");
  let loaded: SuperviseIntent;
  try {
    loaded = await readSuperviseIntent(intentPath);
  } catch {
    return { ok: false, code: "INTENT_UNREADABLE" };
  }
  if (loaded.freshSubagent !== true) return { ok: false, code: "INVALID_INPUT" };
  if (isHostEngineId(loaded.engineId)) return { ok: false, code: "HOST_SPAWN_FORBIDDEN" };
  if (!isAllowlisted(loaded.engineId)) return { ok: false, code: "ENGINE_NOT_SUPERVISED" };

  let launch: EngineLaunch | null;
  try {
    launch = await engineLaunch(loaded);
  } catch {
    return { ok: false, code: "spawn_failed" };
  }
  if (!launch) return { ok: false, code: "spawn_failed" };

  const env = buildSupervisorEnv({
    rung: launch.rung,
    processEnv: process.env,
    byokAllowlist: launch.byokAllowlist,
  });
  const spawnFn = options.spawnFn ?? defaultEngineSpawn;
  let child: EngineChild;
  try {
    child = spawnFn(launch.command, launch.args, {
      shell: false,
      cwd: launch.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return { ok: false, code: "spawn_failed" };
  }
  if (typeof child.pid !== "number") return { ok: false, code: "spawn_failed" };

  const ctx: NormalizeEngineContext = {
    agentId: loaded.agentId,
    engineId: loaded.engineId,
    taskId: loaded.taskId,
    sessionId: `ses_${loaded.taskId}_${loaded.attempt}`,
    featureId: loaded.featureId,
  };
  const terminal = { closed: false };
  let openGate = () => {};
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  const stdout = watchStdout(child, async (line) => {
    await gate;
    await observeLine(loaded.hiveRoot, launch, line, ctx, terminal);
  });
  const finished = waitForChild(child);
  try {
    if (launch.strategy === "pty") {
      await appendObservation(loaded.hiveRoot, normalizeEngineEvent({ type: "start" }, ctx), terminal);
    }
    openGate();
    const outcome = await finished;
    await stdout.flush();
    if (outcome.kind === "error" || outcome.code !== 0) {
      await recordSupervisorChildCrash({
        hiveRoot: loaded.hiveRoot,
        agentId: loaded.agentId,
        engineId: loaded.engineId,
        taskId: loaded.taskId,
        featureId: loaded.featureId,
        sessionId: ctx.sessionId,
        message: outcome.kind === "error" ? outcome.error.message : `engine child exited ${outcome.code ?? "null"}`,
        writeEvent: !terminal.closed,
      });
      return { ok: false, code: "adapter_crash" };
    }
    await appendObservation(
      loaded.hiveRoot,
      normalizeEngineEvent({ type: "exit", exitCode: outcome.code ?? 0 }, ctx),
      terminal,
    );
    return { ok: true, pid: child.pid };
  } catch {
    openGate();
    return { ok: false, code: "adapter_crash" };
  }
}

function defaultDetachedSpawn(
  command: string,
  args: readonly string[],
  options: DetachedSpawnOptions,
): DetachedSpawnChild {
  return nodeSpawn(command, [...args], options);
}

function defaultEngineSpawn(command: string, args: readonly string[], options: EngineSpawnOptions): EngineChild {
  return nodeSpawn(command, [...args], options) as EngineChild;
}

function isAllowlisted(engineId: string): boolean {
  const id = canonicalEngineId(engineId);
  if (SUPERVISOR_IDS.has(id)) return true;
  return parseCustomEngineId(id)?.kind === "custom";
}

function isAcpNotification(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.jsonrpc === "2.0" || typeof record.method === "string") return true;
  const params = asRecord(record.params);
  const update = asRecord(params?.update);
  return typeof update?.sessionUpdate === "string";
}

async function readSuperviseIntent(intentPath: string): Promise<SuperviseIntent> {
  const raw = JSON.parse(await readFile(intentPath, "utf8")) as unknown;
  const record = asRecord(raw);
  if (!record) throw new Error("INTENT_UNREADABLE");
  const engineId =
    typeof record.engineId === "string" && record.engineId.length > 0
      ? record.engineId
      : await engineIdFromRoster(record);
  if (!engineId) throw new Error("INTENT_UNREADABLE");
  const parsed = asSuperviseIntent(record, engineId);
  if (!parsed) throw new Error("INTENT_UNREADABLE");
  return parsed;
}

function asSuperviseIntent(raw: Record<string, unknown>, engineId: string): SuperviseIntent | null {
  const strings = ["featureId", "taskId", "agentId", "hiveRoot", "specDir", "tier"] as const;
  for (const key of strings) {
    if (typeof raw[key] !== "string" || raw[key].length === 0) return null;
  }
  if (raw.freshSubagent !== true || typeof raw.attempt !== "number") return null;
  const workspace = raw.workspace === null || typeof raw.workspace === "string" ? raw.workspace : null;
  const personaPath = raw.personaPath === null || typeof raw.personaPath === "string" ? raw.personaPath : null;
  return {
    featureId: raw.featureId as string,
    taskId: raw.taskId as string,
    agentId: raw.agentId as string,
    personaPath,
    workspace,
    hiveRoot: raw.hiveRoot as string,
    specDir: raw.specDir as string,
    attempt: raw.attempt as number,
    tier: raw.tier as string,
    freshSubagent: true,
    engineId,
  };
}

async function engineIdFromRoster(raw: Record<string, unknown>): Promise<string | null> {
  if (typeof raw.hiveRoot !== "string" || typeof raw.agentId !== "string") return null;
  try {
    const roster = JSON.parse(await readFile(join(raw.hiveRoot, "roster.json"), "utf8")) as Array<{
      id?: string;
      engine?: string | null;
    }>;
    const row = roster.find((agent) => agent.id === raw.agentId);
    return typeof row?.engine === "string" && row.engine.length > 0 ? row.engine : null;
  } catch {
    return null;
  }
}

async function engineLaunch(intent: SuperviseIntent): Promise<EngineLaunch | null> {
  const parsed = parseCustomEngineId(canonicalEngineId(intent.engineId));
  if (parsed?.kind === "custom") {
    const row = await readCustomEngine(intent.hiveRoot, parsed.instanceId);
    const command = row?.command[0];
    if (!row || !command) return null;
    return {
      command,
      args: row.command.slice(1),
      cwd: intent.workspace ?? undefined,
      strategy: "pty",
      eventMode: row.eventMode,
      rung: row.rung ?? "byok",
      byokAllowlist: [],
    };
  }
  if (!parsed || parsed.kind !== "builtin" || !SUPERVISOR_IDS.has(parsed.id) || parsed.id === "custom") {
    return null;
  }
  const preset = getBuiltinPreset(parsed.id);
  const command = preset?.binaries[0];
  if (!preset || !command) return null;
  const args = [...preset.spawnArgs];
  if (parsed.id === "aider") {
    const messageFile = await writeAiderMessage(intent);
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "<file>") args[index] = messageFile;
    }
  }
  return {
    command,
    args,
    cwd: intent.workspace ?? undefined,
    strategy: preset.strategy === "acp" ? "acp" : "pty",
    eventMode: "sparse",
    rung: preset.rung,
    byokAllowlist: preset.byokEnvAllowlist,
  };
}

async function writeAiderMessage(intent: SuperviseIntent): Promise<string> {
  const dir = join(intent.hiveRoot, "engines", "sessions", `ses_${intent.taskId}_${intent.attempt}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "message.txt");
  await writeFile(path, `${intent.taskId}\n`, { mode: 0o600 });
  return path;
}

async function readCustomEngine(hiveRoot: string, instanceId: string): Promise<CustomEngine | null> {
  try {
    const parsed = CustomEnginesFileSchema.safeParse(
      JSON.parse(await readFile(join(hiveRoot, "engines", "custom.json"), "utf8")),
    );
    if (!parsed.success) return null;
    return parsed.data.engines.find((row) => row.instanceId === instanceId) ?? null;
  } catch {
    return null;
  }
}

function watchStdout(child: EngineChild, onLine: (line: string) => Promise<void>): { flush: () => Promise<void> } {
  let buffer = "";
  let chain = Promise.resolve();
  const enqueue = (line: string) => {
    if (line.length === 0) return;
    chain = chain.then(() => onLine(line)).then(
      () => undefined,
      () => undefined,
    );
  };
  child.stdout?.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) enqueue(part);
  });
  return {
    flush: async () => {
      if (buffer.trim().length > 0) enqueue(buffer);
      buffer = "";
      await chain;
    },
  };
}

function waitForChild(
  child: EngineChild,
): Promise<{ kind: "exit"; code: number | null } | { kind: "error"; error: Error }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { kind: "exit"; code: number | null } | { kind: "error"; error: Error }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on("exit", (code) => finish({ kind: "exit", code }));
    child.on("error", (error) => finish({ kind: "error", error }));
  });
}

async function observeLine(
  hiveRoot: string,
  launch: EngineLaunch,
  line: string,
  ctx: NormalizeEngineContext,
  terminal: { closed: boolean },
): Promise<void> {
  if (launch.strategy === "acp") {
    try {
      await appendObservation(hiveRoot, mapAcpNotification(JSON.parse(line), ctx), terminal);
    } catch {
      // Non-JSON stdout is not an ACP notification.
    }
    return;
  }
  if (launch.eventMode === "jsonl") {
    try {
      const event = normalizeEngineEvent(JSON.parse(line) as unknown, ctx);
      if (event) {
        await appendObservation(hiveRoot, event, terminal);
        return;
      }
    } catch {
      // Not JSON. A PTY token line may still match.
    }
  }
  await appendObservation(hiveRoot, normalizeEngineEvent({ line }, ctx), terminal);
}

async function appendObservation(
  hiveRoot: string,
  event: IraEvent | null,
  terminal: { closed: boolean },
): Promise<void> {
  if (!event) return;
  if (event.type === "engine.stop" || event.type === "engine.error") {
    if (terminal.closed) return;
    terminal.closed = true;
  }
  try {
    await mkdir(join(hiveRoot, "events"), { recursive: true, mode: 0o700 });
    await mkdir(join(hiveRoot, "locks"), { recursive: true, mode: 0o700 });
    await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
      appendJsonlLine(join(hiveRoot, "events", "events.jsonl"), event),
    );
  } catch {
    // A hive write miss must not take the supervisor down.
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
