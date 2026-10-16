import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parsePlan } from "../plan-parser.js";
import { routeModel } from "../model-router.js";
import { loadState, markInProgress, reconcileState, saveState } from "../forge-loop.js";
import { listAskMe, openAskMeItem } from "./ask-me.js";
import { evaluateCiGate, type CiState } from "./blackboard.js";
import {
  assertBeginTaskAllowed,
  hiveSyncTarget,
  maybeSyncHive,
  resolveHiveAnchor,
} from "./dispatch-guard.js";
import {
  HOOK_FAILED_CLOSED,
  safeBeforeDispatch,
  safeEngineDispatch,
  safeMatchCapabilities,
  type DispatchIntent,
} from "./hooks.js";
import { resolveRepositoryRoot } from "./paths.js";
import {
  AutonomySettingsSchema,
  BriefSchema,
  HiveLedgerSchema,
  IraEventSchema,
  RosterAgentSchema,
  agentIdSchema,
  featureIdSchema,
} from "./schema.js";
import { EVENT_LOCK_WAIT_MS, LEDGER_LOCK_WAIT_MS, appendJsonlLine, withLock, writeJsonAtomic } from "./store.js";
import type { AskMeReasonClass, AutonomySettings, HiveLedger, HiveTask, RosterAgent } from "./types.js";

const HOST_ENGINES = new Set(["claude", "codex", "cursor-agent"]);
const GITIGNORE_LINE = ".superspec/hive/";
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export type DispatchTaskInput = {
  featureId: string;
  taskId: string;
  cwd?: string;
  /** Idle wake and away tick pass true. Both still use this steer path. */
  internal?: boolean;
  /** v1 builds `true`. A false value is INVALID_INPUT and starts no work. */
  freshSubagent?: boolean;
};

export type DispatchTaskResult =
  | {
      ok: true;
      accepted: null;
      began: true;
      intent: DispatchIntent;
      hiveStatus: string;
    }
  | {
      ok: false;
      code: string;
      began: false;
      reason?: string;
      message?: string;
      accepted?: false;
    };

type Stopped = Extract<DispatchTaskResult, { ok: false }>;

/**
 * Held tasks are not a forge failure.
 * `hold: true` is DISPATCH_HELD. Any other value continues.
 */
export function dispatchRefusalForHold(input: {
  hold: boolean;
}): { ok: false; code: "DISPATCH_HELD" } | null {
  if (input.hold === true) return { ok: false, code: "DISPATCH_HELD" };
  return null;
}

export type AutonomyWakeMode = "observe" | "supervised" | "autonomous";

/**
 * Supervised and autonomous idle wake steer through dispatch-task.
 * Observe recommends and does not.
 */
export function idleWakeUsesDispatchTask(autonomy: AutonomyWakeMode): boolean {
  return autonomy === "supervised" || autonomy === "autonomous";
}

export type IdleWakeContext = {
  hiveExists: boolean;
  hiveRoot?: string;
  featureId?: string;
  cwd?: string;
  completedTaskId: string;
  passed: boolean;
};

export type IdleWakeResult =
  | {
      woke: false;
      reason: "not_passed" | "no_hive" | "no_ready_task" | "settings" | "unassigned" | "error";
    }
  | { woke: true; mode: "recommended"; taskId: string; agentId: string | null }
  | { woke: true; mode: "dispatched"; taskId: string; via: "dispatch-task"; began: boolean };

/**
 * After a passing record-result, assign the next DAG-ready task.
 * Supervised and autonomous call dispatchTask. Observe emits task.recommended only.
 * This function does not argv begin-task.
 */
export async function idleWakeAfterPass(ctx: IdleWakeContext): Promise<IdleWakeResult> {
  try {
    if (!ctx.passed) return { woke: false, reason: "not_passed" };
    if (!ctx.hiveExists || !ctx.hiveRoot || !ctx.featureId) return { woke: false, reason: "no_hive" };
    if (!featureIdSchema.safeParse(ctx.featureId).success) return { woke: false, reason: "no_hive" };

    const settings = await readSettings(ctx.hiveRoot);
    if (!settings) return { woke: false, reason: "settings" };

    const loaded = await readLedger(ctx.hiveRoot, ctx.featureId);
    if (loaded === "missing" || loaded === "corrupt") return { woke: false, reason: "no_ready_task" };

    const next = nextWakeTask(loaded.ledger.tasks, ctx.completedTaskId);
    if (!next) return { woke: false, reason: "no_ready_task" };

    const roster = await readRoster(ctx.hiveRoot);
    if (roster === "corrupt") return { woke: false, reason: "settings" };
    const finished =
      loaded.ledger.tasks.find((task) => task.id === ctx.completedTaskId)?.assigneeAgentId ?? null;
    const chosen = await chooseWakeAssignee(roster ?? [], next, finished);
    const agentId = next.assigneeAgentId ?? chosen?.id ?? null;

    if (!idleWakeUsesDispatchTask(settings.autonomy)) {
      await appendWakeEvent(ctx.hiveRoot, ctx.featureId, "task.recommended", {
        taskId: next.id,
        agentId,
      });
      return { woke: true, mode: "recommended", taskId: next.id, agentId };
    }

    if (!agentId) {
      await appendWakeEvent(ctx.hiveRoot, ctx.featureId, "task.unassigned", {
        taskId: next.id,
        reason: "no_idle_match",
      });
      return { woke: false, reason: "unassigned" };
    }

    if (next.assigneeAgentId === null && chosen && agentIdSchema.safeParse(chosen.id).success) {
      const wrote = await writeAssignee(ctx.hiveRoot, ctx.featureId, next.id, chosen.id);
      if (wrote) {
        await appendWakeEvent(ctx.hiveRoot, ctx.featureId, "task.assigned", {
          taskId: next.id,
          agentId: chosen.id,
        });
      }
    }

    const dispatched = await dispatchTask({
      featureId: ctx.featureId,
      taskId: next.id,
      cwd: ctx.cwd,
      internal: true,
      freshSubagent: true,
    });
    return {
      woke: true,
      mode: "dispatched",
      taskId: next.id,
      via: "dispatch-task",
      began: dispatched.began,
    };
  } catch {
    return { woke: false, reason: "error" };
  }
}

/** A false fresh-subagent flag is invalid and must not reach a process start. */
export function rejectUnfreshSubagent(
  freshSubagent: boolean,
): { ok: false; code: "INVALID_INPUT" } | null {
  if (freshSubagent === false) return { ok: false, code: "INVALID_INPUT" };
  return null;
}

/**
 * Slice A token gate. Host engines (`claude`, `codex`, `cursor-agent`, alias `cursor`)
 * and a null engine (the attached host) are allowed. This function writes no spend.
 * Every other id, including byok, local, and unknown strings, is denied before hooks.
 */
export function sliceABeforeDispatch(
  engine: string | null,
): { allow: true } | { allow: false; reason: "SLICE_A_ONLY" } {
  if (isHostEngine(engine)) return { allow: true };
  return { allow: false, reason: "SLICE_A_ONLY" };
}

export function isHostEngine(engine: string | null): boolean {
  if (engine === null) return true;
  return HOST_ENGINES.has(engine === "cursor" ? "cursor-agent" : engine);
}

/** Host handoff file. Mode 0600. Does not start a process. */
export async function queueHostDispatchIntent(input: {
  hiveRoot: string;
  intent: DispatchIntent;
}): Promise<string> {
  if (input.intent.freshSubagent !== true) throw new Error("INVALID_INPUT");
  const featureId = featureIdSchema.parse(input.intent.featureId);
  if (!TASK_ID.test(input.intent.taskId)) throw new Error("INVALID_INPUT");
  const path = join(input.hiveRoot, "dispatch-queue", featureId, `${input.intent.taskId}.json`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeJsonAtomic(path, input.intent);
  await chmod(path, 0o600);
  return path;
}

/**
 * FR-029 steer path. Order is fixed:
 * hiveReady, DAG/hold/Ask-Me/CI/traceability, fresh subagent,
 * TokenHooks.beforeDispatch, EngineHooks.dispatch, internal begin-task, hive sync.
 */
export async function dispatchTask(input: DispatchTaskInput): Promise<DispatchTaskResult> {
  const unfresh = rejectUnfreshSubagent(input.freshSubagent ?? true);
  if (unfresh) return { ...unfresh, began: false };
  if (!featureIdSchema.safeParse(input.featureId).success || !TASK_ID.test(input.taskId)) {
    return stop("INVALID_INPUT");
  }

  const cwd = input.cwd ?? process.cwd();
  const anchored = await resolveReadyHive(cwd);
  if (!anchored.ok) return stop("HIVE_NOT_READY");

  const loaded = await readLedger(anchored.hiveRoot, input.featureId);
  if (loaded === "missing") return stop("FEATURE_NOT_FOUND");
  if (loaded === "corrupt") return stop("HIVE_NOT_READY");

  const task = loaded.ledger.tasks.find((row) => row.id === input.taskId);
  if (!task || !isDagReady(task, loaded.ledger.tasks)) return stop("NOT_DAG_READY");

  const held = dispatchRefusalForHold({ hold: task.hold === true });
  if (held) return { ...held, began: false };

  const open = await listAskMe({
    hiveRoot: anchored.hiveRoot,
    state: "open",
    featureId: input.featureId,
  });
  if (!open.ok) return stop(open.error);
  if (open.items.length > 0) return stop("ASK_ME_OPEN");

  const ci = await readCiState(anchored.hiveRoot, input.featureId);
  if (ci === "corrupt") return stop("HIVE_CORRUPT");
  const ciGate = evaluateCiGate({ ci, allowAbsentCi: anchored.settings.allowAbsentCi });
  if (!ciGate.pass) return stop(ciGate.reason);

  if (task.kind === "code" && task.implementsFr.length === 0) return stop("TRACEABILITY_GAP");

  const specDir = resolveInside(anchored.repositoryRoot, loaded.ledger.specDir);
  const planPath = resolveInside(anchored.repositoryRoot, loaded.ledger.planPath);
  if (!specDir || !planPath) return stop("INVALID_INPUT");

  const roster = await readRoster(anchored.hiveRoot);
  if (roster === "corrupt") return stop("HIVE_NOT_READY");
  const assignee = pickAssignee(roster, task);
  const engine = assignee?.engine ?? null;
  const intent = buildIntent({
    task,
    featureId: input.featureId,
    hiveRoot: anchored.hiveRoot,
    specDir,
    assignee,
  });

  const sliceGate = sliceABeforeDispatch(engine);
  if (!sliceGate.allow) return stop(sliceGate.reason);

  const brief = await readBriefBudgets(anchored.hiveRoot, input.featureId);
  const tokenGate = await safeBeforeDispatch({ intent, brief });
  if (!tokenGate.allow) {
    if ("reason" in tokenGate && tokenGate.reason === HOOK_FAILED_CLOSED) {
      return stop("HOOK_FAILED_CLOSED");
    }
    if ("reasonClass" in tokenGate) {
      await openCriticalAskMe(anchored.hiveRoot, input.featureId, input.taskId, intent.agentId, tokenGate);
      return stop(tokenGate.reasonClass, { reason: tokenGate.detail });
    }
    return stop("HOOK_FAILED_CLOSED");
  }

  const dispatched = await safeEngineDispatch(intent);
  if (dispatched?.accepted === false) {
    if (dispatched.reason === HOOK_FAILED_CLOSED) return stop("HOOK_FAILED_CLOSED");
    return stop("ENGINE_REJECTED", { accepted: false });
  }
  if (dispatched?.accepted === true) {
    const again = sliceABeforeDispatch(engine);
    if (!again.allow) return stop(again.reason, { accepted: false });
    if (isHostEngine(engine)) return stop("HOST_SPAWN_FORBIDDEN");
    return stop("SLICE_A_ONLY", { accepted: false });
  }
  if (!isHostEngine(engine)) return stop("ENGINE_REJECTED", { accepted: false });

  const queuePath = await queueHostDispatchIntent({ hiveRoot: anchored.hiveRoot, intent });
  const began = await internalBeginTask({ specDir, planPath, taskId: input.taskId });
  if (!began.ok) {
    await unlink(queuePath).catch(() => undefined);
    return stop("BEGIN_TASK_FAILED", { message: began.message });
  }

  const synced = await readLedger(anchored.hiveRoot, input.featureId);
  const hiveStatus =
    synced !== "missing" && synced !== "corrupt"
      ? (synced.ledger.tasks.find((row) => row.id === input.taskId)?.status ?? "doing")
      : "doing";
  await appendDispatched(anchored.hiveRoot, input.featureId, intent, input.internal === true);
  return { ok: true, accepted: null, began: true, intent, hiveStatus };
}

function stop(code: string, extra: Omit<Partial<Stopped>, "ok" | "code" | "began"> = {}): Stopped {
  return { ok: false, code, began: false, ...extra };
}

function isDagReady(task: HiveTask, tasks: HiveTask[]): boolean {
  if (task.status !== "todo") return false;
  const byId = new Map(tasks.map((row) => [row.id, row]));
  return task.dependsOn.every((id) => byId.get(id)?.status === "done");
}

function nextWakeTask(tasks: HiveTask[], completedTaskId: string): HiveTask | null {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    if (task.id === completedTaskId) continue;
    if (task.status !== "todo" || task.hold === true || task.drift === "removed") continue;
    if (task.kind === "code" && task.implementsFr.length === 0) continue;
    if (!task.dependsOn.every((id) => byId.get(id)?.status === "done")) continue;
    return task;
  }
  return null;
}

async function chooseWakeAssignee(
  roster: RosterAgent[],
  task: HiveTask,
  finishedAgentId: string | null,
): Promise<RosterAgent | null> {
  const pool = roster.filter((agent) => {
    if (agent.status === "offline" || agent.status === "blocked") return false;
    if (agent.status === "idle") return true;
    return agent.id === finishedAgentId;
  });
  if (pool.length === 0) return null;

  const hooked = await safeMatchCapabilities({ capabilityTags: task.capabilityTags }, pool, {});
  if (hooked && pool.some((agent) => agent.id === hooked.id)) return hooked;

  const tags = task.capabilityTags;
  const matches = (agent: RosterAgent) =>
    tags.length === 0 || agent.capabilityTags.some((tag) => tags.includes(tag));
  if (finishedAgentId) {
    const finisher = pool.find((agent) => agent.id === finishedAgentId);
    if (finisher && matches(finisher)) return finisher;
  }
  return pool.find(matches) ?? null;
}

async function writeAssignee(
  hiveRoot: string,
  featureId: string,
  taskId: string,
  agentId: string,
): Promise<boolean> {
  const locked = await withLock(
    join(hiveRoot, "locks", `ledger-${featureId}.lock`),
    { waitMs: LEDGER_LOCK_WAIT_MS },
    async () => {
      const loaded = await readLedger(hiveRoot, featureId);
      if (loaded === "missing" || loaded === "corrupt") return false;
      const now = new Date().toISOString();
      let changed = false;
      const tasks = loaded.ledger.tasks.map((row) => {
        if (row.id !== taskId || row.assigneeAgentId !== null) return row;
        changed = true;
        return { ...row, assigneeAgentId: agentId, updatedAt: now };
      });
      if (!changed) return false;
      const parsed = HiveLedgerSchema.safeParse({ ...loaded.ledger, updatedAt: now, tasks });
      if (!parsed.success) return false;
      await writeJsonAtomic(join(hiveRoot, "ledger", `${featureId}.json`), parsed.data);
      return true;
    },
  );
  return locked.ok && locked.value === true;
}

async function appendWakeEvent(
  hiveRoot: string,
  featureId: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await access(join(hiveRoot, "events"), constants.W_OK);
  } catch {
    return;
  }
  const event = IraEventSchema.safeParse({
    id: `evt_${randomUUID()}`,
    type,
    version: 1,
    ts: new Date().toISOString(),
    featureId,
    actor: { kind: "ira", id: "ira" },
    data,
  });
  if (!event.success) return;
  await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
    appendJsonlLine(join(hiveRoot, "events", "events.jsonl"), event.data),
  );
}

function pickAssignee(roster: RosterAgent[] | null, task: HiveTask): RosterAgent | null {
  if (!roster) return null;
  if (task.assigneeAgentId) {
    const assigned = roster.find((agent) => agent.id === task.assigneeAgentId);
    if (assigned) return assigned;
  }
  return roster.find((agent) => agent.id === "agent-host") ?? null;
}

function buildIntent(input: {
  task: HiveTask;
  featureId: string;
  hiveRoot: string;
  specDir: string;
  assignee: RosterAgent | null;
}): DispatchIntent {
  const attempt = input.task.reviewFailures + 1;
  const routed = routeModel({
    complexity: input.task.complexity,
    kind: input.task.kind,
    attempt,
    role: "implementer",
  });
  return {
    featureId: input.featureId,
    taskId: input.task.id,
    agentId: input.assignee?.id ?? "agent-host",
    personaPath: input.assignee?.personaPath ?? null,
    workspace: input.assignee?.workspace ?? null,
    hiveRoot: input.hiveRoot,
    specDir: input.specDir,
    attempt,
    tier: routed.tier,
    freshSubagent: true,
  };
}

async function internalBeginTask(input: {
  specDir: string;
  planPath: string;
  taskId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const anchor = resolveHiveAnchor(input.specDir);
  const gate = assertBeginTaskAllowed({
    hiveExists: anchor.hiveExists,
    internalFromDispatch: true,
  });
  if (!gate.ok) return { ok: false, message: gate.code };
  try {
    const tasks = parsePlan(await readFile(input.planPath, "utf8"));
    const state = reconcileState(tasks, await loadState(input.specDir));
    markInProgress(state, input.taskId);
    await saveState(input.specDir, state);
    await maybeSyncHive(hiveSyncTarget(anchor, input.specDir, input.planPath));
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "begin-task failed" };
  }
}

async function openCriticalAskMe(
  hiveRoot: string,
  featureId: string,
  taskId: string,
  agentId: string,
  gate: { reasonClass: AskMeReasonClass; detail: string },
): Promise<void> {
  try {
    const question = gate.detail.trim().slice(0, 4000);
    await openAskMeItem({
      hiveRoot,
      featureId,
      taskId,
      agentId,
      reasonClass: gate.reasonClass,
      question: question.length > 0 ? question : gate.reasonClass,
    });
  } catch {
    // The deny stands even when the inbox write fails.
  }
}

type ReadyHive =
  | { ok: true; repositoryRoot: string; hiveRoot: string; settings: AutonomySettings }
  | { ok: false };

/**
 * hiveReady for steer: schema, parseable ledgers, gitignore, writability,
 * lock module, and a live away pid. A stale away.pid is only read.
 */
async function resolveReadyHive(cwd: string): Promise<ReadyHive> {
  const resolved = resolveRepositoryRoot(cwd);
  if (!resolved.ok) return { ok: false };
  const { repositoryRoot, hiveRoot } = resolved;
  if (!(await isFile(join(repositoryRoot, "program.md")))) return { ok: false };
  if (!(await manifestOk(hiveRoot))) return { ok: false };
  if (!(await isWritable(hiveRoot))) return { ok: false };
  if (!(await gitignoreOk(repositoryRoot))) return { ok: false };
  if (typeof withLock !== "function") return { ok: false };
  if (!(await isDir(join(hiveRoot, "locks")))) return { ok: false };
  if (!(await ledgersParse(hiveRoot))) return { ok: false };
  const settings = await readSettings(hiveRoot);
  if (!settings) return { ok: false };
  if (await awayIsStale(hiveRoot, settings)) return { ok: false };
  return { ok: true, repositoryRoot, hiveRoot, settings };
}

async function manifestOk(hiveRoot: string): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8"));
    return Boolean(value && typeof value === "object" && (value as { schemaVersion?: unknown }).schemaVersion === 1);
  } catch {
    return false;
  }
}

async function gitignoreOk(repositoryRoot: string): Promise<boolean> {
  try {
    const text = await readFile(join(repositoryRoot, ".gitignore"), "utf8");
    return text.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_LINE);
  } catch {
    return false;
  }
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

async function awayIsStale(hiveRoot: string, settings: AutonomySettings): Promise<boolean> {
  const pidText = await readText(join(hiveRoot, "away.pid"));
  if (pidText === "unreadable") return true;
  if (typeof pidText === "string" && !pidAlive(parsePid(pidText))) return true;
  if (!settings.awayMode) return false;
  return !(await heartbeatFresh(hiveRoot, settings.pollIntervalMs));
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
  } catch {
    return false;
  }
}

async function heartbeatFresh(hiveRoot: string, pollIntervalMs: number): Promise<boolean> {
  const text = await readText(join(hiveRoot, "away.heartbeat"));
  if (typeof text !== "string") return false;
  try {
    const value: unknown = JSON.parse(text);
    const at = value && typeof value === "object" ? (value as { at?: unknown }).at : undefined;
    if (typeof at !== "string") return false;
    const stamped = Date.parse(at);
    if (!Number.isFinite(stamped)) return false;
    return Date.now() - stamped <= 2 * pollIntervalMs;
  } catch {
    return false;
  }
}

async function readSettings(hiveRoot: string): Promise<AutonomySettings | null> {
  try {
    const parsed = AutonomySettingsSchema.safeParse(JSON.parse(await readFile(join(hiveRoot, "settings.json"), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readCiState(hiveRoot: string, featureId: string): Promise<CiState | null | "corrupt"> {
  try {
    const value: unknown = JSON.parse(await readFile(join(hiveRoot, "blackboard.json"), "utf8"));
    if (!value || typeof value !== "object") return "corrupt";
    const features = (value as { features?: unknown }).features;
    if (!features || typeof features !== "object") return null;
    const entry = (features as Record<string, { ci?: { state?: unknown } | null } | undefined>)[featureId];
    const state = entry?.ci?.state;
    if (state === "green" || state === "red" || state === "absent") return state;
    if (state === undefined || state === null) return null;
    return "corrupt";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "corrupt";
  }
}

async function readLedger(hiveRoot: string, featureId: string): Promise<{ ledger: HiveLedger } | "missing" | "corrupt"> {
  try {
    const parsed = HiveLedgerSchema.safeParse(
      JSON.parse(await readFile(join(hiveRoot, "ledger", `${featureId}.json`), "utf8")),
    );
    if (!parsed.success) return "corrupt";
    return { ledger: parsed.data };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "corrupt";
  }
}

async function readRoster(hiveRoot: string): Promise<RosterAgent[] | null | "corrupt"> {
  try {
    const parsed = RosterAgentSchema.array().safeParse(
      JSON.parse(await readFile(join(hiveRoot, "roster.json"), "utf8")),
    );
    if (!parsed.success) return "corrupt";
    return parsed.data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "corrupt";
  }
}

async function readBriefBudgets(
  hiveRoot: string,
  featureId: string,
): Promise<{ budgetTokens: number | null; budgetUsd: number | null }> {
  try {
    const parsed = BriefSchema.safeParse(
      JSON.parse(await readFile(join(hiveRoot, "briefs", `${featureId}.json`), "utf8")),
    );
    if (!parsed.success) return { budgetTokens: null, budgetUsd: null };
    return { budgetTokens: parsed.data.budgetTokens, budgetUsd: parsed.data.budgetUsd };
  } catch {
    return { budgetTokens: null, budgetUsd: null };
  }
}

async function appendDispatched(
  hiveRoot: string,
  featureId: string,
  intent: DispatchIntent,
  internal: boolean,
): Promise<void> {
  await appendWakeEvent(hiveRoot, featureId, "task.dispatched", { intent, internal, accepted: null });
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

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function resolveInside(root: string, candidate: string): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  const absRoot = resolve(root);
  const abs = isAbsolute(candidate) ? resolve(candidate) : resolve(absRoot, candidate);
  const rel = relative(absRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}
