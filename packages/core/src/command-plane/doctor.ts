import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants, statSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { answerAskMe, listAskMe, openAskMeItem } from "./ask-me.js";
import { assertBeginTaskAllowed } from "./dispatch-guard.js";
import {
  dispatchTask,
  isHostEngine,
  queueHostDispatchIntent,
  sliceABeforeDispatch,
} from "./dispatch.js";
import type { DispatchIntent } from "./hooks.js";
import { buildToolDefinitions } from "../mcp-server.js";
import { resolveRepositoryRoot } from "./paths.js";
import { personaField, type IraPersonaField } from "./persona.js";
import { AutonomySettingsSchema } from "./schema.js";
import { withLock } from "./store.js";
import type { AutonomySettings } from "./types.js";

const GITIGNORE_LINE = ".superspec/hive/";
const REQUIRED_MCP_TOOLS = ["hive-init", "dispatch-task", "doctor"] as const;
const CLAIM_FILES = ["slice-a.json", "slice-a-validated.json"] as const;
const PROBE_FEATURE = "001-doctor-probe";

const HIVE_BLOCKING = new Set([
  "LEDGER_UNREADABLE",
  "PROGRAM_MD_MISSING",
  "HIVE_NOT_WRITABLE",
  "HIVE_NOT_GITIGNORED",
  "HIVE_SCHEMA_MISMATCH",
  "HIVE_CORRUPT",
  "HIVE_NOT_INITIALIZED",
  "MCP_TOOL_MISSING",
  "AWAY_PID_STALE",
  "TOKEN_FILE_MODE",
  "LOCK_MODULE_MISSING",
]);

const ENGINE_BLOCKING = new Set([
  "ENGINE_SPAWN_UNSUPPORTED",
  "ENGINE_NONE_HEALTHY",
  "LOCAL_CONTEXT_BELOW_FLOOR",
  "LOCAL_CONTEXT_UNKNOWN",
]);

export type DoctorSeverity = "error" | "warning";

export type DoctorFinding = {
  code: string;
  severity: DoctorSeverity;
  message: string;
  remedy: string;
};

export type SliceAChecks = {
  hiveReady: boolean;
  hostDispatchQueuesIntent: boolean;
  boardDispatchInvokesDispatchTask: boolean;
  askMeRoundTrip: boolean;
};

export type DoctorReport = {
  ok: true;
  hiveReady: boolean;
  engineRungReady: boolean;
  sliceAValidated: boolean;
  ready: boolean;
  repositoryRoot: string | null;
  hiveRoot: string | null;
  cwd: string;
  hivePresent: boolean;
  writable: boolean;
  gitignore: boolean;
  worktreeKind: "main" | "linked";
  sandboxed: boolean;
  superspecRootOverride: string | null;
  mcpTools: string[];
  findings: DoctorFinding[];
  nextSteps: string[];
  telemetry: "off" | "opt-in";
  persona: IraPersonaField;
  checks: SliceAChecks;
};

export type RunDoctorInput = {
  cwd?: string;
  now?: number;
  mcpToolNames?: readonly string[];
  engineFindings?: readonly DoctorFinding[];
};

type SandboxSource = "os-wrapper" | "worktreeKind" | "workspace" | "worktreePolicy" | "none";

/**
 * Coordination-store health. Engine findings never clear this flag.
 * A legacy `ready` value must copy the result, not AND it with engine health.
 */
export function computeHiveReady(input: {
  hiveFindings: readonly { code: string }[];
  engineFindings: readonly { code: string }[];
}): boolean {
  void input.engineFindings;
  return !input.hiveFindings.some((item) => HIVE_BLOCKING.has(item.code));
}

export function computeEngineRungReady(input: {
  engineFindings: readonly { code: string }[];
  hostDelegateAvailable: boolean;
}): boolean {
  if (!input.hostDelegateAvailable) return false;
  return !input.engineFindings.some((item) => ENGINE_BLOCKING.has(item.code));
}

/** True only when the four OD-020 checks passed on this same run. */
export function computeSliceAValidated(checks: SliceAChecks): boolean {
  return (
    checks.hiveReady &&
    checks.hostDispatchQueuesIntent &&
    checks.boardDispatchInvokesDispatchTask &&
    checks.askMeRoundTrip
  );
}

/**
 * Slice A has no OS sandbox wrapper, so `sandboxed` is false.
 * A flag derived from worktree kind, workspace, or worktree policy is corrected to false.
 */
export function resolveReportedSandbox(input: {
  proposedSandboxed: boolean;
  proposedFrom: SandboxSource;
  sliceA?: boolean;
}): { sandboxed: boolean; finding: DoctorFinding | null } {
  const derived =
    input.proposedFrom === "worktreeKind" ||
    input.proposedFrom === "workspace" ||
    input.proposedFrom === "worktreePolicy";
  if (derived) {
    return {
      sandboxed: false,
      finding: finding(
        "WORKTREE_IS_NOT_SANDBOX",
        "error",
        "worktreeKind, workspace, and worktreePolicy are not an OS sandbox.",
        "Set sandboxed true only when that child was started under an OS sandbox wrapper.",
      ),
    };
  }
  if (input.sliceA !== false) return { sandboxed: false, finding: null };
  return {
    sandboxed: input.proposedSandboxed === true && input.proposedFrom === "os-wrapper",
    finding: null,
  };
}

/** Recompute hive, engine, and Slice A readiness. Claim files are not consulted. */
export async function runDoctor(input: RunDoctorInput = {}): Promise<DoctorReport> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const now = input.now ?? Date.now();
  const worktreeKind = detectWorktreeKind(cwd);
  const sandbox = resolveReportedSandbox({ proposedSandboxed: false, proposedFrom: "none", sliceA: true });
  const resolved = resolveRepositoryRoot(cwd);
  const repositoryRoot = resolved.ok ? resolved.repositoryRoot : null;
  const hiveRoot = resolved.ok ? resolved.hiveRoot : null;

  const hiveFindings: DoctorFinding[] = [];
  const warnings: DoctorFinding[] = [];
  if (sandbox.finding) warnings.push(sandbox.finding);

  let hivePresent = false;
  let writable = false;
  let gitignore = false;
  let telemetry: "off" | "opt-in" = "off";
  let autonomy = "supervised";

  if (!repositoryRoot || !hiveRoot) {
    hiveFindings.push(
      finding(
        "PROGRAM_MD_MISSING",
        "error",
        "program.md is missing, so the hive root cannot be resolved.",
        "Add program.md at the SuperSpec repository root, then run superspec hive init.",
      ),
    );
  } else {
    const inspected = await inspectHive(repositoryRoot, hiveRoot, now);
    hiveFindings.push(...inspected.hiveFindings);
    warnings.push(...inspected.warnings);
    hivePresent = inspected.hivePresent;
    writable = inspected.writable;
    gitignore = inspected.gitignore;
    telemetry = inspected.telemetry;
    autonomy = inspected.autonomy;
  }

  const mcpTools = input.mcpToolNames
    ? [...input.mcpToolNames]
    : buildToolDefinitions().map((tool) => tool.name);
  const missingTools = REQUIRED_MCP_TOOLS.filter((name) => !mcpTools.includes(name));
  if (missingTools.length > 0) {
    hiveFindings.push(
      finding(
        "MCP_TOOL_MISSING",
        "error",
        `Command-plane MCP tools missing from buildToolDefinitions(): ${missingTools.join(", ")}.`,
        "Register hive-init, dispatch-task, and doctor on the MCP server.",
      ),
    );
  }

  const engineFindings = (input.engineFindings ?? []).map((item) => ({ ...item }));
  const [hostDispatchQueuesIntent, askMeRoundTrip] = await Promise.all([
    probeHostDispatch(),
    probeAskMeRoundTrip(),
  ]);
  const boardDispatchInvokesDispatchTask = boardDispatchCheck();
  if (!hostDispatchQueuesIntent && !engineFindings.some((item) => item.code === "ENGINE_NONE_HEALTHY")) {
    engineFindings.push(
      finding(
        "ENGINE_NONE_HEALTHY",
        "error",
        "No host delegate queued a DispatchIntent.",
        "Repair host dispatch so a host engine queues DispatchIntent and starts no host CLI.",
      ),
    );
  }

  const hiveReady = computeHiveReady({ hiveFindings, engineFindings });
  const engineRungReady = computeEngineRungReady({
    engineFindings,
    hostDelegateAvailable: hostDispatchQueuesIntent,
  });
  const checks: SliceAChecks = {
    hiveReady,
    hostDispatchQueuesIntent,
    boardDispatchInvokesDispatchTask,
    askMeRoundTrip,
  };
  await discardSliceClaimFiles(hiveRoot, repositoryRoot);
  const sliceAValidated = computeSliceAValidated(checks);
  const cli = await detectSuperspecCli();

  return {
    ok: true,
    hiveReady,
    engineRungReady,
    sliceAValidated,
    ready: hiveReady,
    repositoryRoot,
    hiveRoot,
    cwd,
    hivePresent,
    writable,
    gitignore,
    worktreeKind,
    sandboxed: sandbox.sandboxed,
    superspecRootOverride: readSuperspecRootOverride(cwd),
    mcpTools,
    findings: [...hiveFindings, ...engineFindings, ...warnings],
    nextSteps: buildNextSteps({ cli, hiveRoot, autonomy }),
    telemetry,
    persona: personaField(),
    checks,
  };
}

function finding(code: string, severity: DoctorSeverity, message: string, remedy: string): DoctorFinding {
  return { code, severity, message, remedy };
}

function buildNextSteps(input: { cli: string | null; hiveRoot: string | null; autonomy: string }): string[] {
  return [
    input.cli
      ? `superspec CLI detected at ${input.cli}.`
      : "Install the superspec CLI and put it on PATH.",
    input.hiveRoot
      ? `Hive path: ${input.hiveRoot}.`
      : "Add program.md at the repository root, then run superspec hive init.",
    `Autonomy default is ${input.autonomy}.`,
  ];
}

async function inspectHive(
  repositoryRoot: string,
  hiveRoot: string,
  now: number,
): Promise<{
  hiveFindings: DoctorFinding[];
  warnings: DoctorFinding[];
  hivePresent: boolean;
  writable: boolean;
  gitignore: boolean;
  telemetry: "off" | "opt-in";
  autonomy: string;
}> {
  const hiveFindings: DoctorFinding[] = [];
  const warnings: DoctorFinding[] = [];
  const gitignore = await gitignoreHasHive(repositoryRoot);
  if (!gitignore) {
    hiveFindings.push(
      finding(
        "HIVE_NOT_GITIGNORED",
        "error",
        "The repository .gitignore does not ignore .superspec/hive/.",
        "Add the line .superspec/hive/ to the repository .gitignore.",
      ),
    );
  }

  if (!(await isFile(join(repositoryRoot, "program.md")))) {
    hiveFindings.push(
      finding(
        "PROGRAM_MD_MISSING",
        "error",
        "program.md is missing at the repository root.",
        "Add program.md at the SuperSpec repository root.",
      ),
    );
  }

  const hiveDir = await isDirectory(hiveRoot);
  const writable = hiveDir && (await isWritable(hiveRoot));
  if (hiveDir && !writable) {
    hiveFindings.push(
      finding(
        "HIVE_NOT_WRITABLE",
        "error",
        "The hive directory is not writable.",
        "Grant the Operator write access to the hive directory.",
      ),
    );
  }

  const manifest = hiveDir ? await readManifest(hiveRoot) : "missing";
  const hivePresent = await isFile(join(hiveRoot, "hive.json"));
  if (manifest === "missing") {
    hiveFindings.push(
      finding(
        "HIVE_NOT_INITIALIZED",
        "error",
        "The hive manifest is missing.",
        "Run superspec hive init.",
      ),
    );
  } else if (manifest === "mismatch") {
    hiveFindings.push(
      finding(
        "HIVE_SCHEMA_MISMATCH",
        "error",
        "hive.json schemaVersion is not 1.",
        "Keep schemaVersion at 1. Do not point doctor at a newer hive schema.",
      ),
    );
  } else if (manifest === "corrupt") {
    hiveFindings.push(
      finding(
        "HIVE_CORRUPT",
        "error",
        "hive.json is unreadable.",
        "Restore hive.json as schemaVersion 1 JSON, or quarantine the hive and run superspec hive init --repair.",
      ),
    );
  }

  let telemetry: "off" | "opt-in" = "off";
  let autonomy = "supervised";
  let awayMode = false;
  let pollIntervalMs = 60_000;
  if (hiveDir && manifest === "ok") {
    const settings = await readSettings(hiveRoot);
    if (settings === "missing" || settings === "corrupt") {
      hiveFindings.push(
        finding(
          "HIVE_CORRUPT",
          "error",
          "settings.json is missing or unreadable.",
          "Restore settings.json or run superspec hive init.",
        ),
      );
    } else {
      awayMode = settings.awayMode;
      pollIntervalMs = settings.pollIntervalMs;
      autonomy = settings.autonomy;
      telemetry = settings.telemetry;
    }
  }

  if (hiveDir) {
    if (!(await isDirectory(join(hiveRoot, "locks"))) || typeof withLock !== "function") {
      hiveFindings.push(
        finding(
          "LOCK_MODULE_MISSING",
          "error",
          "The hive lock directory or withLock module is missing.",
          "Restore the hive locks directory. Only withLock may create and remove lock files.",
        ),
      );
    }
    if (!(await ledgersParse(hiveRoot))) {
      hiveFindings.push(
        finding(
          "LEDGER_UNREADABLE",
          "error",
          "A hive ledger file is missing or is not parseable JSON.",
          "Replace the unreadable file under the hive ledger directory.",
        ),
      );
    }
    const away = await awayPidStale(hiveRoot, awayMode, pollIntervalMs, now);
    if (away) hiveFindings.push(away);
    const token = await tokenFileMode(hiveRoot);
    if (token) hiveFindings.push(token);
    const budget = await budgetUnmetered(hiveRoot);
    if (budget) warnings.push(budget);
  }

  const constitution = await constitutionDrift(repositoryRoot);
  if (constitution) warnings.push(constitution);
  const templates = await templateDrift(repositoryRoot);
  if (templates) warnings.push(templates);

  return { hiveFindings, warnings, hivePresent, writable, gitignore, telemetry, autonomy };
}

/** Read-only. Does not delete or rewrite away.pid. */
async function awayPidStale(
  hiveRoot: string,
  awayMode: boolean,
  pollIntervalMs: number,
  now: number,
): Promise<DoctorFinding | null> {
  const pid = await readPidFile(join(hiveRoot, "away.pid"));
  const pidStale = pid.kind === "unreadable" || (pid.kind === "pid" && !pidAlive(pid.pid));
  const heartbeatStale = awayMode && !(await heartbeatFresh(hiveRoot, pollIntervalMs, now));
  if (!pidStale && !heartbeatStale) return null;
  return finding(
    "AWAY_PID_STALE",
    "error",
    "away.pid is dead, or away mode has a missing or stale heartbeat.",
    "Run superspec away off to clear the stale away poller.",
  );
}

async function heartbeatFresh(hiveRoot: string, pollIntervalMs: number, now: number): Promise<boolean> {
  const text = await readText(join(hiveRoot, "away.heartbeat"));
  if (typeof text !== "string") return false;
  try {
    const value: unknown = JSON.parse(text);
    const at = value && typeof value === "object" ? (value as { at?: unknown }).at : undefined;
    if (typeof at !== "string") return false;
    const stamped = Date.parse(at);
    if (!Number.isFinite(stamped)) return false;
    return now - stamped <= 2 * pollIntervalMs;
  } catch {
    return false;
  }
}

type PidRead = { kind: "missing" } | { kind: "unreadable" } | { kind: "pid"; pid: number | null };

async function readPidFile(path: string): Promise<PidRead> {
  try {
    return { kind: "pid", pid: parsePid(await readFile(path, "utf8")) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    return { kind: "unreadable" };
  }
}

function parsePid(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    const pid = Number(trimmed);
    return Number.isSafeInteger(pid) ? pid : null;
  }
  try {
    const value: unknown = JSON.parse(trimmed);
    const pid = value && typeof value === "object" ? (value as { pid?: unknown }).pid : undefined;
    if (typeof pid === "number" && Number.isSafeInteger(pid)) return pid;
  } catch {
    return null;
  }
  return null;
}

function pidAlive(pid: number | null): boolean {
  if (pid === null || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function tokenFileMode(hiveRoot: string): Promise<DoctorFinding | null> {
  const dir = join(hiveRoot, "auth");
  const file = join(dir, "loopback.token");
  const fileStat = await statOrNull(file);
  if (!fileStat) return null;
  const dirStat = await statOrNull(dir);
  const fileMode = fileStat.mode & 0o777;
  const dirMode = dirStat ? dirStat.mode & 0o777 : 0;
  if (fileMode === 0o600 && dirMode === 0o700) return null;
  return finding(
    "TOKEN_FILE_MODE",
    "error",
    "auth/loopback.token must be mode 0600 and the auth directory must be mode 0700.",
    "Set the auth directory to mode 0700 and auth/loopback.token to mode 0600.",
  );
}

async function ledgersParse(hiveRoot: string): Promise<boolean> {
  let names: string[];
  try {
    names = await readdir(join(hiveRoot, "ledger"));
  } catch {
    return false;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      JSON.parse(await readFile(join(hiveRoot, "ledger", name), "utf8"));
    } catch {
      return false;
    }
  }
  return true;
}

async function budgetUnmetered(hiveRoot: string): Promise<DoctorFinding | null> {
  let names: string[];
  try {
    names = await readdir(join(hiveRoot, "briefs"));
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const value: unknown = JSON.parse(await readFile(join(hiveRoot, "briefs", name), "utf8"));
      if (!value || typeof value !== "object") continue;
      const brief = value as { budgetTokens?: unknown; budgetUsd?: unknown };
      if (typeof brief.budgetTokens === "number" || typeof brief.budgetUsd === "number") {
        return finding(
          "budget_unmetered",
          "warning",
          "A brief has a numeric budget and TokenHooks.beforeDispatch is not registered in this package.",
          "Register TokenHooks.beforeDispatch before enforcing that budget.",
        );
      }
    } catch {
      // A brief that is not JSON is not a numeric budget.
    }
  }
  return null;
}

async function constitutionDrift(repositoryRoot: string): Promise<DoctorFinding | null> {
  const text = await readText(join(repositoryRoot, "constitution.md"));
  if (typeof text === "string" && text.includes("Test-First") && text.includes("Traceability Spine")) {
    return null;
  }
  return finding(
    "CONSTITUTION_DRIFT",
    "warning",
    "constitution.md is missing Principle 1 (Test-First) or Principle 2 (Traceability Spine).",
    "Restore those principles from the SuperSpec constitution template. This warning does not clear hiveReady.",
  );
}

async function templateDrift(repositoryRoot: string): Promise<DoctorFinding | null> {
  try {
    const names = await readdir(join(repositoryRoot, ".superspec", "templates"));
    if (names.length > 0) return null;
  } catch {
    // missing templates directory
  }
  return finding(
    "TEMPLATE_DRIFT",
    "warning",
    "Project templates under .superspec/templates are missing.",
    "Run superspec init so the template set is present. This warning does not clear hiveReady.",
  );
}

async function gitignoreHasHive(repositoryRoot: string): Promise<boolean> {
  const text = await readText(join(repositoryRoot, ".gitignore"));
  if (typeof text !== "string") return false;
  return text.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_LINE);
}

async function readManifest(hiveRoot: string): Promise<"missing" | "ok" | "mismatch" | "corrupt"> {
  try {
    const value: unknown = JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8"));
    if (!value || typeof value !== "object") return "corrupt";
    const version = (value as { schemaVersion?: unknown }).schemaVersion;
    if (version === 1) return "ok";
    if (typeof version === "number") return "mismatch";
    return "corrupt";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "corrupt";
  }
}

async function readSettings(hiveRoot: string): Promise<AutonomySettings | "missing" | "corrupt"> {
  try {
    const parsed = AutonomySettingsSchema.safeParse(
      JSON.parse(await readFile(join(hiveRoot, "settings.json"), "utf8")),
    );
    return parsed.success ? parsed.data : "corrupt";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "corrupt";
  }
}

/**
 * P-001 has no board process. The board contract is `dispatchTask`, and an
 * external begin-task is refused while the hive exists. This check does not call begin-task.
 */
function boardDispatchCheck(): boolean {
  if (typeof dispatchTask !== "function") return false;
  const external = assertBeginTaskAllowed({ hiveExists: true, internalFromDispatch: false });
  const internal = assertBeginTaskAllowed({ hiveExists: true, internalFromDispatch: true });
  return !external.ok && external.code === "DISPATCH_PATH_REQUIRED" && internal.ok;
}

/** Queue one host DispatchIntent in a scratch hive. Starts no host CLI. */
async function probeHostDispatch(): Promise<boolean> {
  const scratch = await mkdtemp(join(tmpdir(), "doctor-host-"));
  try {
    if (!isHostEngine("claude") || !isHostEngine("codex") || !isHostEngine("cursor-agent") || !isHostEngine("cursor")) {
      return false;
    }
    const gate = sliceABeforeDispatch("claude");
    if (!gate.allow) return false;
    const intent: DispatchIntent = {
      featureId: PROBE_FEATURE,
      taskId: "T001",
      agentId: "agent-host",
      personaPath: null,
      workspace: null,
      hiveRoot: scratch,
      specDir: scratch,
      attempt: 1,
      tier: "economy",
      freshSubagent: true,
    };
    const path = await queueHostDispatchIntent({ hiveRoot: scratch, intent });
    const saved: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!saved || typeof saved !== "object") return false;
    const row = saved as Partial<DispatchIntent>;
    return row.featureId === PROBE_FEATURE && row.taskId === "T001" && row.freshSubagent === true;
  } catch {
    return false;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Create, list, and answer one critical Ask-Me item in a scratch hive. Spawns no worker. */
async function probeAskMeRoundTrip(): Promise<boolean> {
  const scratch = await mkdtemp(join(tmpdir(), "doctor-ask-"));
  try {
    await writeFile(join(scratch, "hive.json"), `${JSON.stringify({ schemaVersion: 1 })}\n`, { mode: 0o600 });
    const opened = await openAskMeItem({
      hiveRoot: scratch,
      featureId: null,
      taskId: null,
      agentId: null,
      reasonClass: "budget_exceed",
      question: "Slice A doctor probe",
    });
    if (!opened.ok) return false;
    const listed = await listAskMe({ hiveRoot: scratch, state: "open" });
    if (!listed.ok || !listed.items.some((item) => item.id === opened.item.id)) return false;
    const answered = await answerAskMe({
      hiveRoot: scratch,
      id: opened.item.id,
      text: "acknowledged",
      action: "acknowledge",
    });
    return answered.ok && answered.item.state === "resolved";
  } catch {
    return false;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Read claim files so a stale `validated: true` cannot be missed, then drop the value.
 * sliceAValidated is computed only from this run's four checks.
 */
async function discardSliceClaimFiles(hiveRoot: string | null, repositoryRoot: string | null): Promise<void> {
  const paths: string[] = [];
  if (hiveRoot) {
    for (const name of CLAIM_FILES) paths.push(join(hiveRoot, name));
  }
  if (repositoryRoot) paths.push(join(repositoryRoot, ".superspec", "slice-a.json"));
  for (const path of paths) {
    let claimed: unknown;
    try {
      claimed = JSON.parse(await readFile(path, "utf8"));
    } catch {
      claimed = undefined;
    }
    void claimed;
  }
}

async function detectSuperspecCli(): Promise<string | null> {
  const names = process.platform === "win32" ? ["superspec.cmd", "superspec.exe", "superspec"] : ["superspec"];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // next PATH entry
      }
    }
  }
  return null;
}

function readSuperspecRootOverride(cwd: string): string | null {
  const raw = process.env.SUPERSPEC_ROOT?.trim();
  if (!raw) return null;
  return isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw);
}

function detectWorktreeKind(cwd: string): "main" | "linked" {
  let dir = cwd;
  for (;;) {
    const gitPath = join(dir, ".git");
    const info = statSyncOrNull(gitPath);
    if (info?.isDirectory()) return "main";
    if (info?.isFile()) return "linked";
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "main";
}

function statSyncOrNull(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

async function readText(path: string): Promise<string | null | "unreadable"> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "unreadable";
  }
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  const info = await statOrNull(path);
  return info?.isDirectory() ?? false;
}

async function isFile(path: string): Promise<boolean> {
  const info = await statOrNull(path);
  return info?.isFile() ?? false;
}

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}
