import { execFile as nodeExecFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LEDGER_LOCK_WAIT_MS, withLock, writeJsonAtomic } from "../command-plane/store.js";
import { listBuiltinPresets } from "./catalog.js";
import { detectInstalled, type DetectInstalledRow } from "./detect.js";
import { ensureEnginesLayout } from "./paths.js";
import { EngineHealthSchema, LocalPackProfileSchema } from "./schema.js";
import { enginesLockPath, hiveInitialized } from "./store.js";
import {
  LOCAL_CONTEXT_FLOOR,
  type AuthMode,
  type EngineHealth,
  type EngineHealthStatus,
  type EnginePreset,
} from "./types.js";

const STATUS_TIMEOUT_MS = 5000;
const VERSION_TIMEOUT_MS = 1500;

export type AuthHealthSignals = {
  installed: boolean;
  byokEnvPresent?: boolean;
  statusProbe?: "ok" | "auth_failure" | "unknown_subcommand" | "none";
  localPack?: { active: boolean; contextGateOk: boolean };
  sessionReasonClass?: string | null;
};

export type AuthHealthResult = {
  authMode: AuthMode;
  health: EngineHealthStatus;
  reasonClass: string | null;
};

export type HealthCacheFile = Record<string, EngineHealth>;

export type RefreshHealthDeps = {
  envPath?: string;
  env?: NodeJS.ProcessEnv;
  execFile?: typeof nodeExecFile;
  detectRows?: DetectInstalledRow[];
  now?: () => Date;
};

type ExecFileFn = typeof nodeExecFile;

function isoNow(now: () => Date): string {
  return now().toISOString();
}

export function authModeFromSignals(signals: AuthHealthSignals): AuthHealthResult {
  if (!signals.installed) {
    return { authMode: "unknown", health: "missing", reasonClass: null };
  }

  let authMode: AuthMode = "unknown";
  let health: EngineHealthStatus = "ok";
  let reasonClass: string | null = null;

  const local = signals.localPack;
  if (local?.active) {
    authMode = "local";
    if (local.contextGateOk) {
      health = "ok";
    } else {
      health = "degraded";
      reasonClass = "context_below_floor";
    }
  } else if (signals.statusProbe === "ok") {
    authMode = "subscription";
    health = "ok";
  } else if (signals.byokEnvPresent) {
    authMode = "byok";
    health = "ok";
  }

  if (signals.statusProbe === "auth_failure") {
    health = "unauthorized";
    reasonClass = "unauthorized";
  }

  const session = signals.sessionReasonClass;
  if (session === "unauthorized") {
    health = "unauthorized";
    reasonClass = "unauthorized";
  } else if (session === "rate_limited" || session === "quota_exhausted") {
    health = "degraded";
    reasonClass = session;
  }

  return { authMode, health, reasonClass };
}

function envVarPresent(name: string, env: NodeJS.ProcessEnv): boolean {
  const value = env[name];
  return typeof value === "string" && value.length > 0;
}

function byokEnvPresentForPreset(preset: EnginePreset, env: NodeJS.ProcessEnv): boolean {
  const names = new Set<string>();
  if (preset.authEnv) names.add(preset.authEnv);
  for (const n of preset.byokEnvAllowlist) names.add(n);
  for (const name of names) {
    if (envVarPresent(name, env)) return true;
  }
  return false;
}

function classifyStatusProbe(err: Error | null, stderr: string): AuthHealthSignals["statusProbe"] {
  if (!err) return "ok";
  const text = stderr.toLowerCase();
  if (text.includes("unknown command") || text.includes("unknown subcommand")) {
    return "unknown_subcommand";
  }
  return "auth_failure";
}

function probeStatus(
  execFile: ExecFileFn,
  binary: string,
  statusArgs: readonly string[],
): Promise<AuthHealthSignals["statusProbe"]> {
  if (statusArgs.length === 0) return Promise.resolve("none");
  return new Promise((resolve) => {
    execFile(
      binary,
      [...statusArgs],
      { timeout: STATUS_TIMEOUT_MS, shell: false },
      (err, _stdout, stderr) => {
        const kind = classifyStatusProbe(err, `${stderr}`);
        if (kind === "unknown_subcommand") resolve("none");
        else resolve(kind);
      },
    );
  });
}

function probeVersion(execFile: ExecFileFn, binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ["--version"],
      { timeout: VERSION_TIMEOUT_MS, shell: false },
      (err, stdout, stderr) => {
        if (err) {
          resolve(null);
          return;
        }
        const text = `${stdout}${stderr}`.trim();
        resolve(text.length > 0 ? text.slice(0, 200) : null);
      },
    );
  });
}

type LocalPackState = { active: boolean; contextGateOk: boolean };

async function readLocalPackState(
  hiveRoot: string,
  engineId: string,
): Promise<LocalPackState | undefined> {
  let text: string;
  try {
    text = await readFile(join(hiveRoot, "engines", "local-pack.json"), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Object.keys(parsed as object).length === 0) {
    return undefined;
  }
  const profile = LocalPackProfileSchema.safeParse(parsed);
  if (!profile.success || profile.data.engineId !== engineId) {
    return undefined;
  }
  const backend = profile.data.backend;
  if (backend === "byok") {
    return undefined;
  }
  const ctx = profile.data.advertisedContext;
  if (ctx === null) {
    return { active: true, contextGateOk: false };
  }
  return { active: true, contextGateOk: ctx >= LOCAL_CONTEXT_FLOOR };
}

function healthFilePath(hiveRoot: string): string {
  return join(hiveRoot, "engines", "health.json");
}

async function readHealthFile(hiveRoot: string): Promise<HealthCacheFile> {
  try {
    const text = await readFile(healthFilePath(hiveRoot), "utf8");
    const raw = JSON.parse(text) as Record<string, unknown>;
    const out: HealthCacheFile = {};
    for (const [key, value] of Object.entries(raw)) {
      const row = EngineHealthSchema.safeParse(value);
      if (row.success) out[key] = row.data;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeHealthFile(hiveRoot: string, cache: HealthCacheFile): Promise<void> {
  const locked = await withLock(enginesLockPath(hiveRoot), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    await writeJsonAtomic(healthFilePath(hiveRoot), cache);
  });
  if (!locked.ok) {
    throw new Error("LEDGER_BUSY");
  }
}

async function buildRowForPreset(
  hiveRoot: string,
  preset: ReturnType<typeof listBuiltinPresets>[number],
  detect: DetectInstalledRow,
  env: NodeJS.ProcessEnv,
  execFile: ExecFileFn,
  sessionReasonClass: string | null,
  now: () => Date,
): Promise<EngineHealth> {
  const installed = detect.installed && detect.binary !== null;
  let statusProbe: AuthHealthSignals["statusProbe"] = "none";
  let binaryVersion: string | null = null;

  if (installed && detect.binary) {
    binaryVersion = await probeVersion(execFile, detect.binary);
    statusProbe = await probeStatus(execFile, detect.binary, preset.statusArgs);
  }

  const localPack = await readLocalPackState(hiveRoot, preset.engineId);
  const mapped = authModeFromSignals({
    installed,
    byokEnvPresent: byokEnvPresentForPreset(preset, env),
    statusProbe,
    localPack,
    sessionReasonClass,
  });

  return {
    engineId: preset.engineId,
    authMode: mapped.authMode,
    health: mapped.health,
    reasonClass: mapped.reasonClass,
    binaryVersion,
    checkedAt: isoNow(now),
  };
}

export async function refreshEngineHealth(
  hiveRoot: string,
  deps: RefreshHealthDeps = {},
): Promise<EngineHealth[]> {
  if (!(await hiveInitialized(hiveRoot))) {
    throw new Error("HIVE_NOT_INITIALIZED");
  }
  const layout = await ensureEnginesLayout(hiveRoot);
  if (!layout.ok) {
    throw new Error(layout.error);
  }

  const execFile = deps.execFile ?? nodeExecFile;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const detectRows =
    deps.detectRows ??
    (await detectInstalled({
      envPath: deps.envPath ?? env.PATH ?? "",
      execFile,
    }));
  const detectById = new Map(detectRows.map((r) => [r.engineId, r]));
  const previous = await readHealthFile(hiveRoot);

  const presets = listBuiltinPresets();
  const rows: EngineHealth[] = [];
  const cache: HealthCacheFile = { ...previous };

  for (const preset of presets) {
    const detect = detectById.get(preset.engineId) ?? {
      engineId: preset.engineId,
      installed: false,
      binary: null,
    };
    const prior = previous[preset.engineId];
    const sessionReasonClass =
      prior?.reasonClass &&
      (prior.reasonClass === "rate_limited" ||
        prior.reasonClass === "quota_exhausted" ||
        prior.reasonClass === "unauthorized")
        ? prior.reasonClass
        : null;

    const row = await buildRowForPreset(
      hiveRoot,
      preset,
      detect,
      env,
      execFile,
      sessionReasonClass,
      now,
    );
    rows.push(row);
    cache[preset.engineId] = row;
  }

  await writeHealthFile(hiveRoot, cache);
  return rows;
}

export async function getCachedHealth(
  hiveRoot: string,
  engineId: string,
): Promise<EngineHealth | undefined> {
  const cache = await readHealthFile(hiveRoot);
  return cache[engineId];
}

export async function applyEngineSessionError(
  hiveRoot: string,
  engineId: string,
  reasonClass: string,
): Promise<void> {
  if (!(await hiveInitialized(hiveRoot))) {
    throw new Error("HIVE_NOT_INITIALIZED");
  }
  const cache = await readHealthFile(hiveRoot);
  const base: EngineHealth = cache[engineId] ?? {
    engineId,
    authMode: "unknown",
    health: "ok",
    reasonClass: null,
    binaryVersion: null,
    checkedAt: new Date().toISOString(),
  };

  const overlay = authModeFromSignals({
    installed: base.health !== "missing",
    statusProbe: base.authMode === "subscription" ? "ok" : "none",
    byokEnvPresent: base.authMode === "byok",
    localPack:
      base.authMode === "local"
        ? { active: true, contextGateOk: base.reasonClass !== "context_below_floor" }
        : undefined,
    sessionReasonClass: reasonClass,
  });

  cache[engineId] = {
    ...base,
    authMode: base.authMode,
    health: overlay.health,
    reasonClass: overlay.reasonClass,
    checkedAt: new Date().toISOString(),
  };
  await writeHealthFile(hiveRoot, cache);
}
