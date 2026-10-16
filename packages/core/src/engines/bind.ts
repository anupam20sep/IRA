import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { agentIdSchema, RosterAgentSchema } from "../command-plane/schema.js";
import { LEDGER_LOCK_WAIT_MS, withLock, writeJsonAtomic } from "../command-plane/store.js";
import type { RosterAgent } from "../command-plane/types.js";
import { discoverPersonas } from "../persona-discovery.js";
import { getBuiltinPreset, parseCustomEngineId } from "./catalog.js";
import { detectInstalled, type DetectInstalledOptions } from "./detect.js";
import { CustomEnginesFileSchema, LocalPackProfileSchema } from "./schema.js";
import { hiveInitialized } from "./store.js";
import type { CustomEngine, EngineId, EnginePreset } from "./types.js";

const TIERS = ["economy", "standard", "frontier"] as const;
const VERSION_TIMEOUT_MS = 1500;

export type BindInput = {
  agentId: string;
  personaPath: string;
  engine: string;
  model?: string | null;
  budgetUsd?: number | null;
  budgetTokens?: number | null;
  workspace?: string | null;
  worktreePolicy?: "isolated" | "shared";
};

export type BindErrorCode =
  | "ENGINE_NOT_FOUND"
  | "ENGINE_MISSING"
  | "MODEL_REJECTED"
  | "ROSTER_BUSY"
  | "INVALID_INPUT"
  | "HIVE_NOT_INITIALIZED";

export type BindResult =
  | {
      ok: true;
      agent: {
        id: string;
        engine: string;
        model: string | null;
        workspace: string | null;
        worktreePolicy: "isolated" | "shared";
      };
    }
  | {
      ok: false;
      error: BindErrorCode;
      message: string;
      acceptable?: string[];
    };

export type BindInputCheck = { ok: true } | { ok: false; error: "INVALID_INPUT"; message: string };

export type BindDeps = Pick<DetectInstalledOptions, "execFile" | "envPath">;

type ExecFileFn = typeof nodeExecFile;

type ResolvedEngine =
  | { kind: "builtin"; id: EngineId; preset: EnginePreset }
  | { kind: "custom"; id: string; row: CustomEngine };

export function validateBindInput(input: BindInput, hiveRoot?: string): BindInputCheck {
  const agent = agentIdSchema.safeParse(input.agentId);
  if (!agent.success) return invalid("agentId is invalid.");

  if (typeof input.personaPath !== "string" || input.personaPath.length === 0) {
    return invalid("personaPath is required.");
  }
  if (!isAbsolute(input.personaPath)) return invalid("personaPath must be an absolute path.");
  const ext = extname(input.personaPath);
  if (ext !== ".md" && ext !== ".toml") {
    return invalid("personaPath must be a .md or .toml file.");
  }

  if (typeof input.engine !== "string" || input.engine.trim() === "") {
    return invalid("engine is required.");
  }

  if (input.model !== undefined && input.model !== null) {
    if (typeof input.model !== "string" || input.model.trim() === "") {
      return invalid("model must be a non-empty string or null.");
    }
  }

  const budgetUsd = budgetProblem(input.budgetUsd, "budgetUsd");
  if (budgetUsd) return invalid(budgetUsd);
  const budgetTokens = budgetProblem(input.budgetTokens, "budgetTokens");
  if (budgetTokens) return invalid(budgetTokens);

  if (
    input.worktreePolicy !== undefined &&
    input.worktreePolicy !== "isolated" &&
    input.worktreePolicy !== "shared"
  ) {
    return invalid("worktreePolicy must be isolated or shared.");
  }

  if (input.workspace !== undefined && input.workspace !== null) {
    if (typeof input.workspace !== "string" || !isAbsolute(input.workspace)) {
      return invalid("workspace must be an absolute path or null.");
    }
    if (workspaceInsideHive(input.workspace, hiveRoot)) {
      return invalid("workspace must not be the hive root or inside .superspec/hive.");
    }
  }

  return { ok: true };
}

export async function bindRosterEngine(
  hiveRoot: string,
  input: BindInput,
  deps: BindDeps = {},
): Promise<BindResult> {
  if (!(await hiveInitialized(hiveRoot))) {
    return fail("HIVE_NOT_INITIALIZED", "Hive is not initialized.");
  }

  const validated = validateBindInput(input, hiveRoot);
  if (!validated.ok) return validated;

  const resolved = await resolveEngine(hiveRoot, input.engine);
  if (!resolved) return fail("ENGINE_NOT_FOUND", `Unknown engine "${input.engine}".`);

  if (!(await personaAllowed(input.personaPath, hiveRoot))) {
    return fail(
      "INVALID_INPUT",
      "personaPath must be a discovered persona or an existing .md or .toml file.",
    );
  }

  if (!(await engineInstalled(resolved, deps))) {
    return fail("ENGINE_MISSING", `${resolved.id} is not installed.`);
  }

  const acceptable = await acceptableModels(hiveRoot, resolved);
  if (typeof input.model === "string" && !acceptable.includes(input.model)) {
    return {
      ok: false,
      error: "MODEL_REJECTED",
      message: `${resolved.id} does not offer model "${input.model}".`,
      acceptable,
    };
  }

  await mkdir(join(hiveRoot, "locks"), { recursive: true, mode: 0o700 });
  const locked = await withLock(
    join(hiveRoot, "locks", "roster.lock"),
    { waitMs: LEDGER_LOCK_WAIT_MS },
    () => writeBinding(hiveRoot, input, resolved.id),
  );
  if (!locked.ok) return fail("ROSTER_BUSY", "Roster lock is busy.");
  return locked.value;
}

function invalid(message: string): BindInputCheck {
  return { ok: false, error: "INVALID_INPUT", message };
}

function fail(error: BindErrorCode, message: string): Extract<BindResult, { ok: false }> {
  return { ok: false, error, message };
}

function budgetProblem(value: number | null | undefined, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return `${name} must be a non-negative number or null.`;
  }
  return null;
}

function workspaceInsideHive(workspace: string, hiveRoot?: string): boolean {
  const target = resolve(workspace);
  if (isSuperspecHivePath(target)) return true;
  if (hiveRoot === undefined) return false;
  const root = resolve(hiveRoot);
  return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function isSuperspecHivePath(resolved: string): boolean {
  const parts = resolved.split(sep);
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i] === ".superspec" && parts[i + 1] === "hive") return true;
  }
  return false;
}

function projectRootForHive(hiveRoot: string): string {
  const resolved = resolve(hiveRoot);
  const parent = dirname(resolved);
  if (basename(resolved) === "hive" && basename(parent) === ".superspec") return dirname(parent);
  return resolved;
}

async function isPersonaFile(personaPath: string): Promise<boolean> {
  const ext = extname(personaPath);
  if (ext !== ".md" && ext !== ".toml") return false;
  try {
    const info = await stat(personaPath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function personaAllowed(personaPath: string, hiveRoot: string): Promise<boolean> {
  if (await isPersonaFile(personaPath)) return true;
  const projectRoot = projectRootForHive(hiveRoot);
  const found = await discoverPersonas({
    projectRoot,
    cwd: projectRoot,
    includeDefaults: true,
    includeHome: false,
  });
  const target = resolve(personaPath);
  return found.some((persona) => resolve(persona.path) === target);
}

async function resolveEngine(hiveRoot: string, engine: string): Promise<ResolvedEngine | null> {
  const parsed = parseCustomEngineId(engine);
  if (!parsed) return null;
  if (parsed.kind === "builtin") {
    const preset = getBuiltinPreset(parsed.id);
    return preset ? { kind: "builtin", id: parsed.id, preset } : null;
  }
  const row = await loadCustom(hiveRoot, parsed.instanceId);
  return row ? { kind: "custom", id: `custom:${parsed.instanceId}`, row } : null;
}

async function loadCustom(hiveRoot: string, instanceId: string): Promise<CustomEngine | null> {
  try {
    const text = await readFile(join(hiveRoot, "engines", "custom.json"), "utf8");
    const parsed = CustomEnginesFileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    return parsed.data.engines.find((row) => row.instanceId === instanceId) ?? null;
  } catch {
    return null;
  }
}

async function engineInstalled(engine: ResolvedEngine, deps: BindDeps): Promise<boolean> {
  if (engine.kind === "builtin") {
    const rows = await detectInstalled({ execFile: deps.execFile, envPath: deps.envPath });
    return rows.some((row) => row.engineId === engine.id && row.installed);
  }
  return probeArgv0(engine.row.command[0], deps);
}

async function probeArgv0(argv0: string, deps: BindDeps): Promise<boolean> {
  const execFile = deps.execFile ?? nodeExecFile;
  if (isAbsolute(argv0)) return probe(execFile, argv0);
  const envPath = deps.envPath ?? process.env.PATH ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  for (const dir of envPath.split(separator).filter(Boolean)) {
    if (await probe(execFile, join(dir, argv0))) return true;
  }
  return false;
}

function probe(execFile: ExecFileFn, binaryPath: string): Promise<boolean> {
  return new Promise((done) => {
    try {
      execFile(
        binaryPath,
        ["--version"],
        { timeout: VERSION_TIMEOUT_MS, shell: false },
        (err) => {
          done(!err);
        },
      );
    } catch {
      done(false);
    }
  });
}

async function acceptableModels(hiveRoot: string, engine: ResolvedEngine): Promise<string[]> {
  const presetModels = engine.kind === "builtin" ? engine.preset.models : [];
  const extras: string[] = [];
  if (engine.kind === "custom" && engine.row.model) extras.push(engine.row.model);
  if (engine.kind === "builtin" && (engine.id === "opencode" || engine.id === "crush")) {
    extras.push(...(await localPackModels(hiveRoot, engine.id)));
  }
  return unique([...TIERS, ...presetModels, ...extras]);
}

async function localPackModels(hiveRoot: string, engineId: "opencode" | "crush"): Promise<string[]> {
  try {
    const text = await readFile(join(hiveRoot, "engines", "local-pack.json"), "utf8");
    const parsed = LocalPackProfileSchema.safeParse(JSON.parse(text));
    if (!parsed.success || parsed.data.engineId !== engineId) return [];
    const models = [parsed.data.model];
    if (parsed.data.tiers) {
      models.push(parsed.data.tiers.economy, parsed.data.tiers.standard, parsed.data.tiers.frontier);
    }
    return models;
  } catch {
    return [];
  }
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

async function writeBinding(hiveRoot: string, input: BindInput, engine: string): Promise<BindResult> {
  const roster = await readRoster(hiveRoot);
  if (!roster.ok) return roster;

  const index = roster.agents.findIndex((row) => row.id === input.agentId);
  if (index < 0) return fail("INVALID_INPUT", `Roster has no agent "${input.agentId}".`);

  const current = roster.agents[index];
  const next = roster.agents.slice();
  next[index] = {
    ...current,
    personaPath: input.personaPath,
    engine,
    model: input.model === undefined ? current.model : input.model,
    budgetUsd: input.budgetUsd === undefined ? current.budgetUsd : input.budgetUsd,
    budgetTokens: input.budgetTokens === undefined ? current.budgetTokens : input.budgetTokens,
    workspace: input.workspace === undefined ? current.workspace : input.workspace,
    worktreePolicy: input.worktreePolicy ?? "isolated",
  };

  const parsed = RosterAgentSchema.array().safeParse(next);
  if (!parsed.success) return fail("INVALID_INPUT", "Roster row is invalid.");

  await writeJsonAtomic(join(hiveRoot, "roster.json"), parsed.data);
  const saved = parsed.data[index];
  return {
    ok: true,
    agent: {
      id: saved.id,
      engine: saved.engine ?? engine,
      model: saved.model ?? null,
      workspace: saved.workspace,
      worktreePolicy: saved.worktreePolicy,
    },
  };
}

type RosterRead =
  | { ok: true; agents: RosterAgent[] }
  | { ok: false; error: "INVALID_INPUT"; message: string };

function rosterInvalid(message: string): Extract<RosterRead, { ok: false }> {
  return { ok: false, error: "INVALID_INPUT", message };
}

async function readRoster(hiveRoot: string): Promise<RosterRead> {
  try {
    const text = await readFile(join(hiveRoot, "roster.json"), "utf8");
    const parsed = RosterAgentSchema.array().safeParse(JSON.parse(text));
    if (!parsed.success) return rosterInvalid("roster.json is invalid.");
    return { ok: true, agents: parsed.data };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return rosterInvalid("roster.json is missing.");
    }
    return rosterInvalid("roster.json is invalid.");
  }
}
