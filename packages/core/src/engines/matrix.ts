import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { execFile as nodeExecFile } from "node:child_process";
import { listBuiltinPresets } from "./catalog.js";
import { detectInstalled, type DetectInstalledRow } from "./detect.js";
import { getCachedHealth } from "./health.js";
import { CustomEnginesFileSchema } from "./schema.js";
import { hiveInitialized } from "./store.js";
import {
  ENGINE_CATALOG_VERSION,
  type AuthMode,
  type CredentialMatrixRow,
  type CustomEngine,
  type EngineHealthStatus,
  type LadderRung,
} from "./types.js";

const VERSION_TIMEOUT_MS = 1500;

export type BuildCredentialMatrixDeps = {
  envPath?: string;
  execFile?: typeof nodeExecFile;
  detectRows?: DetectInstalledRow[];
  isCustomInstalled?: (command: readonly string[]) => Promise<boolean>;
};

function defaultHealthWhenMissing(installed: boolean): {
  authMode: AuthMode;
  health: EngineHealthStatus;
} {
  if (!installed) {
    return { authMode: "unknown", health: "missing" };
  }
  return { authMode: "unknown", health: "ok" };
}

async function loadCustomEngines(hiveRoot: string): Promise<CustomEngine[]> {
  try {
    const text = await readFile(join(hiveRoot, "engines", "custom.json"), "utf8");
    const parsed = CustomEnginesFileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return [];
    return parsed.data.engines;
  } catch {
    return [];
  }
}

function probeArgv0(
  execFile: typeof nodeExecFile,
  argv0: string,
  envPath: string,
): Promise<boolean> {
  const tryBinary = (binaryPath: string): Promise<boolean> =>
    new Promise((done) => {
      execFile(
        binaryPath,
        ["--version"],
        { timeout: VERSION_TIMEOUT_MS, shell: false },
        (err) => done(!err),
      );
    });

  if (isAbsolute(argv0)) {
    return tryBinary(argv0);
  }
  const separator = process.platform === "win32" ? ";" : ":";
  const dirs = envPath.split(separator).filter(Boolean);
  return (async () => {
    for (const dir of dirs) {
      if (await tryBinary(join(dir, argv0))) return true;
    }
    return false;
  })();
}

async function customInstalled(
  command: readonly string[],
  deps: BuildCredentialMatrixDeps,
): Promise<boolean> {
  if (deps.isCustomInstalled) {
    return deps.isCustomInstalled(command);
  }
  const argv0 = command[0];
  if (!argv0) return false;
  const execFile = deps.execFile ?? nodeExecFile;
  const envPath = deps.envPath ?? process.env.PATH ?? "";
  return probeArgv0(execFile, argv0, envPath);
}

function customAuthHealth(
  installed: boolean,
  rung: CustomEngine["rung"],
): { authMode: AuthMode; health: EngineHealthStatus } {
  if (!installed) {
    return { authMode: "unknown", health: "missing" };
  }
  if (rung === "local") {
    return { authMode: "local", health: "ok" };
  }
  return { authMode: "unknown", health: "ok" };
}

async function rowForBuiltin(
  hiveRoot: string,
  detect: DetectInstalledRow | undefined,
  preset: ReturnType<typeof listBuiltinPresets>[number],
): Promise<CredentialMatrixRow> {
  const installed = detect?.installed === true && detect.binary !== null;
  const cached = await getCachedHealth(hiveRoot, preset.engineId);
  const fallback = defaultHealthWhenMissing(installed);
  return {
    engineId: preset.engineId,
    displayName: preset.displayName,
    installed,
    authMode: cached?.authMode ?? fallback.authMode,
    health: cached?.health ?? fallback.health,
    rung: preset.rung,
    binary: installed && detect?.binary ? basename(detect.binary) : null,
  };
}

async function rowForCustom(
  hiveRoot: string,
  engine: CustomEngine,
  deps: BuildCredentialMatrixDeps,
): Promise<CredentialMatrixRow> {
  const engineId = `custom:${engine.instanceId}`;
  const installed = await customInstalled(engine.command, deps);
  const cached = await getCachedHealth(hiveRoot, engineId);
  const rung: LadderRung = engine.rung ?? "byok";
  const fallback = customAuthHealth(installed, engine.rung ?? "byok");
  return {
    engineId,
    displayName: engine.displayName,
    installed,
    authMode: cached?.authMode ?? fallback.authMode,
    health: cached?.health ?? fallback.health,
    rung,
    binary: installed && engine.command[0] ? basename(engine.command[0]) : null,
  };
}

export async function buildCredentialMatrix(
  hiveRoot: string,
  deps: BuildCredentialMatrixDeps = {},
): Promise<{ catalogVersion: number; rows: CredentialMatrixRow[] }> {
  if (!(await hiveInitialized(hiveRoot))) {
    throw new Error("HIVE_NOT_INITIALIZED");
  }

  const detectRows =
    deps.detectRows ??
    (await detectInstalled({
      envPath: deps.envPath ?? process.env.PATH ?? "",
      execFile: deps.execFile,
    }));
  const detectById = new Map(detectRows.map((row) => [row.engineId, row]));

  const rows: CredentialMatrixRow[] = [];
  for (const preset of listBuiltinPresets()) {
    rows.push(await rowForBuiltin(hiveRoot, detectById.get(preset.engineId), preset));
  }

  const customEngines = await loadCustomEngines(hiveRoot);
  for (const engine of customEngines) {
    rows.push(await rowForCustom(hiveRoot, engine, deps));
  }

  return { catalogVersion: ENGINE_CATALOG_VERSION, rows };
}
