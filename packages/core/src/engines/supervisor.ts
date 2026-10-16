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
 * Returns the argv and options only — this task does not start a child.
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
