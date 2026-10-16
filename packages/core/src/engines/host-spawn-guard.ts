import { basename } from "node:path";

export const HOST_SPAWN_FORBIDDEN = "HOST_SPAWN_FORBIDDEN" as const;

const HOST_ENGINE_IDS = new Set(["claude", "codex", "cursor-agent"]);
const HOST_ARGV0 = new Set(["claude", "codex", "cursor-agent", "agent"]);

export type HostSpawnGuardContext = {
  delegateToHost?: "claude" | "codex" | "cursor-agent" | null;
  awayPidMatches?: boolean;
  hooksInstalled?: boolean;
  argv0?: string;
};

export function canonicalEngineId(engineId: string): string {
  return engineId === "cursor" ? "cursor-agent" : engineId;
}

export function isHostEngineId(engineId: string): boolean {
  return HOST_ENGINE_IDS.has(canonicalEngineId(engineId));
}

function argv0Name(argv0: string): string {
  return basename(argv0).replace(/\.(exe|cmd)$/i, "");
}

/**
 * OD-009: Ira must not parent `claude`, `codex`, `cursor-agent`, or `agent`.
 * `delegateToHost: null`, an away pid match, and `engines hooks install` do not authorize it.
 */
export function guardHostSpawn(
  engineId: string,
  ctx: HostSpawnGuardContext = {},
): { ok: true } | { ok: false; code: typeof HOST_SPAWN_FORBIDDEN } {
  if (ctx.argv0 && HOST_ARGV0.has(argv0Name(ctx.argv0))) {
    return { ok: false, code: HOST_SPAWN_FORBIDDEN };
  }
  if (isHostEngineId(engineId)) {
    return { ok: false, code: HOST_SPAWN_FORBIDDEN };
  }
  return { ok: true };
}
