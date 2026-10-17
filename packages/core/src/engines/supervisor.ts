import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";
import { RosterAgentSchema } from "../command-plane/schema.js";
import { EVENT_LOCK_WAIT_MS, LEDGER_LOCK_WAIT_MS, appendJsonlLine, withLock, writeJsonAtomic } from "../command-plane/store.js";
import { normalizeEngineEvent } from "./normalize.js";

export { buildSupervisorEnv, type EnvScrubInput } from "./env-scrub.js";

export const SUPERVISOR_IN_MCP_FORBIDDEN = "SUPERVISOR_IN_MCP_FORBIDDEN";

export type SupervisorCaller = "mcp-handler" | "cli-supervise";

/** OD-015 stdio: ignore, or a pipe pair that is not the MCP stdin/stdout. */
export type DetachedSupervisorStdio = "ignore" | ["pipe", "pipe"];

export interface DetachedSupervisorSpawnSpec {
  argv: [string, string, string, string];
  detached: true;
  shell: false;
  stdio: DetachedSupervisorStdio;
  env: Record<string, string>;
}

function copyEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Detached supervisor spawn contract (OD-015 / FR-025).
 * Returns the argv and options only. The supervise runner starts the child.
 * `stdio` is `ignore`, so the spec cannot attach the MCP server's stdin or stdout.
 */
export function buildDetachedSupervisorSpawnSpec(
  intentPath: string,
  env: Record<string, string>,
): DetachedSupervisorSpawnSpec {
  return {
    argv: ["superspec", "engines", "supervise", intentPath],
    detached: true,
    shell: false,
    stdio: "ignore",
    env: copyEnv(env),
  };
}

/** In-process supervisor from the MCP request handler is forbidden (OD-015). */
export function assertSupervisorNotInMcp(caller: SupervisorCaller): void {
  if (caller === "mcp-handler") {
    throw new Error(SUPERVISOR_IN_MCP_FORBIDDEN);
  }
}

export type SupervisorCrashInput = {
  hiveRoot: string;
  agentId: string;
  engineId: string;
  taskId: string;
  featureId: string | null;
  sessionId: string;
  message: string;
  /** When false, only the roster row is marked offline. A terminal event already exists. */
  writeEvent?: boolean;
};

/**
 * Unexpected engine-child exit inside the detached supervisor.
 * Marks that roster row offline and appends `engine.error` / `adapter_crash`.
 * Swallows I/O failures so the supervisor process, and the MCP parent, stay up.
 */
export async function recordSupervisorChildCrash(input: SupervisorCrashInput): Promise<void> {
  assertSupervisorNotInMcp("cli-supervise");
  try {
    await markAgentOffline(input.hiveRoot, input.agentId);
  } catch {
    // A roster miss must not take the supervisor down.
  }
  if (input.writeEvent === false) return;
  try {
    await appendAdapterCrash(input);
  } catch {
    // An event-log miss must not take the supervisor down.
  }
}

async function markAgentOffline(hiveRoot: string, agentId: string): Promise<void> {
  const rosterPath = join(hiveRoot, "roster.json");
  try {
    await access(rosterPath, constants.R_OK);
  } catch {
    return;
  }
  await mkdir(join(hiveRoot, "locks"), { recursive: true, mode: 0o700 });
  await withLock(join(hiveRoot, "locks", "roster.lock"), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    const parsed = RosterAgentSchema.array().safeParse(JSON.parse(await readFile(rosterPath, "utf8")));
    if (!parsed.success) return;
    let changed = false;
    const next = parsed.data.map((agent) => {
      if (agent.id !== agentId || agent.status === "offline") return agent;
      changed = true;
      return { ...agent, status: "offline" as const };
    });
    if (changed) await writeJsonAtomic(rosterPath, next);
  });
}

async function appendAdapterCrash(input: SupervisorCrashInput): Promise<void> {
  const event = normalizeEngineEvent(
    { type: "error", reasonClass: "adapter_crash", message: input.message },
    {
      agentId: input.agentId,
      engineId: input.engineId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      featureId: input.featureId,
    },
  );
  if (!event) return;
  const eventsDir = join(input.hiveRoot, "events");
  try {
    await access(eventsDir, constants.R_OK);
  } catch {
    return;
  }
  await mkdir(join(input.hiveRoot, "locks"), { recursive: true, mode: 0o700 });
  await withLock(join(input.hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
    appendJsonlLine(join(eventsDir, "events.jsonl"), event),
  );
}

