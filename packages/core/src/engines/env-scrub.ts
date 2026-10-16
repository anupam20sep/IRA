import type { LadderRung } from "./types.js";

/** OD-019 base names. Anything else is copied only from the BYOK allowlist. */
export const SUPERVISOR_ENV_BASE_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "SHELL",
  "SUPERSPEC_ROOT",
  "SUPERSPEC_ENGINE_SESSION",
  "SUPERSPEC_HIVE_ROOT",
] as const;

const BASE_NAMES = new Set<string>(SUPERVISOR_ENV_BASE_ALLOWLIST);

export interface EnvScrubInput {
  rung: LadderRung;
  processEnv: Readonly<Record<string, string | undefined>>;
  byokAllowlist: readonly string[];
}

function copyIfString(env: Record<string, string>, name: string, value: string | undefined): void {
  if (typeof value === "string") env[name] = value;
}

/**
 * Build a new supervisor env (OD-019 / FR-026).
 * Copies the base allowlist, plus `byokAllowlist` names only when `rung` is `byok`.
 * Does not spread `process.env`. Names matching KEY, TOKEN, SECRET, PASSWORD, or
 * CREDENTIAL are omitted unless that name is on the BYOK allowlist at rung `byok`.
 */
export function buildSupervisorEnv(input: EnvScrubInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of SUPERVISOR_ENV_BASE_ALLOWLIST) {
    copyIfString(env, name, input.processEnv[name]);
  }
  if (input.rung !== "byok") return env;

  for (const name of input.byokAllowlist) {
    if (!name || BASE_NAMES.has(name)) continue;
    copyIfString(env, name, input.processEnv[name]);
  }
  return env;
}
