import { randomUUID } from "node:crypto";
import { chmod, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { forgeStatus, initState, loadState, nextTask } from "../forge-loop.js";
import { parsePlan } from "../plan-parser.js";
import { listAskMe } from "./ask-me.js";
import { evaluateCiGate, type CiState } from "./blackboard.js";
import { dispatchTask } from "./dispatch.js";
import type { DispatchIntent } from "./hooks.js";
import { AutonomySettingsSchema, HiveLedgerSchema, IraEventSchema } from "./schema.js";
import { EVENT_LOCK_WAIT_MS, appendJsonlLine, withLock, writeJsonAtomic } from "./store.js";
import type { AutonomySettings, HiveLedger } from "./types.js";

const MIN_POLL_INTERVAL_MS = 10_000;

export const AWAY_SKIP_REASONS = [
  "heartbeat_failed",
  "ci_absent",
  "ci_not_green",
  "away_off",
  "autonomy_supervised",
  "autonomy_observe",
  "ask_me_open",
  "no_ready_task",
  "hive_corrupt",
  "dispatch_held",
] as const;

export type AwaySkipReason = (typeof AWAY_SKIP_REASONS)[number];

export type AwayTickEntry = {
  featureId: string | null;
  dispatched: boolean;
  reason: AwaySkipReason | null;
  intent: DispatchIntent | null;
};

export type AwayTickResult = { ok: true; ticks: AwayTickEntry[] };

export type AwayTickInput = {
  hiveRoot: string;
  cwd?: string;
  featureId?: string;
  pid?: number;
};

export type AwaySetInput = {
  hiveRoot: string;
  awayMode: boolean;
  pollIntervalMs?: number;
  allowAbsentCi?: boolean;
  cwd?: string;
};

export type AwaySetResult =
  | {
      ok: true;
      settings: AutonomySettings;
      poller: { running: boolean; pid: number | null };
    }
  | {
      ok: false;
      error: "AWAY_ALREADY_RUNNING" | "INVALID_INPUT" | "HIVE_CORRUPT";
      message: string;
    };

type Decision =
  | { featureId: string | null; action: "skip"; reason: AwaySkipReason }
  | { featureId: string; action: "dispatch"; taskId: string };

type Poller = { timer: ReturnType<typeof setInterval>; busy: boolean };

type PidRead = { kind: "missing" } | { kind: "unreadable" } | { kind: "pid"; pid: number | null };

const pollers = new Map<string, Poller>();

/** Fixed phase order. Heartbeat is written and fsynced before gates or dispatch-task. */
export function awayTickOrder(): ["heartbeat", "gates", "dispatch-task"] {
  return ["heartbeat", "gates", "dispatch-task"];
}

/**
 * Write `<hiveRoot>/away.heartbeat` as `{ pid, at }`, mode 0600, fsynced before return.
 * A failed write is `heartbeat_failed` and must skip dispatch.
 */
export async function writeAwayHeartbeat(input: {
  hiveRoot: string;
  pid?: number;
  at?: string;
}): Promise<{ ok: true } | { ok: false; reason: "heartbeat_failed" }> {
  const path = join(input.hiveRoot, "away.heartbeat");
  try {
    await writeJsonAtomic(path, {
      pid: input.pid ?? process.pid,
      at: input.at ?? new Date().toISOString(),
    });
    await chmod(path, 0o600);
    return { ok: true };
  } catch {
    return { ok: false, reason: "heartbeat_failed" };
  }
}

/**
 * Persist away settings and start or stop the in-process forge-status poll.
 * The poll calls `awayTick` only. Auto-dispatch stays inside that tick, and only for autonomous mode.
 */
export async function awaySet(input: AwaySetInput): Promise<AwaySetResult> {
  const invalid = validateAwaySet(input);
  if (invalid) return invalid;

  const hiveRoot = input.hiveRoot;
  if (input.awayMode && (pollerRunning(hiveRoot) || (await otherLivePoller(hiveRoot)))) {
    return { ok: false, error: "AWAY_ALREADY_RUNNING", message: "Away poller is already running." };
  }

  const current = await readSettings(hiveRoot);
  if (!current) return { ok: false, error: "HIVE_CORRUPT", message: "Settings are unreadable." };

  const next = AutonomySettingsSchema.safeParse({
    ...current,
    awayMode: input.awayMode,
    allowAbsentCi: input.allowAbsentCi ?? current.allowAbsentCi,
    pollIntervalMs: input.pollIntervalMs ?? current.pollIntervalMs,
    updatedAt: new Date().toISOString(),
  });
  if (!next.success) return { ok: false, error: "INVALID_INPUT", message: "Away settings are invalid." };

  try {
    await writeJsonAtomic(join(hiveRoot, "settings.json"), next.data);
  } catch {
    return { ok: false, error: "HIVE_CORRUPT", message: "Settings could not be written." };
  }

  if (current.awayMode !== next.data.awayMode) {
    await appendHiveEvent(
      hiveRoot,
      null,
      "away.changed",
      { awayMode: next.data.awayMode },
      { kind: "operator", id: "operator" },
    );
  }

  if (!next.data.awayMode) {
    await stopPoller(hiveRoot);
    return { ok: true, settings: next.data, poller: { running: false, pid: null } };
  }

  try {
    await writeAwayPid(hiveRoot);
  } catch {
    return { ok: false, error: "HIVE_CORRUPT", message: "Away pid could not be written." };
  }

  startPoller(hiveRoot, input.cwd ?? (await repositoryRootOf(hiveRoot)), next.data.pollIntervalMs);
  return { ok: true, settings: next.data, poller: { running: true, pid: process.pid } };
}

/** One forge-status iteration. Does not sleep. Does not spawn a steer process. */
export async function awayTick(input: AwayTickInput): Promise<AwayTickResult> {
  let decisions: Decision[] | null = null;
  const ticks: AwayTickEntry[] = [];

  for (const phase of awayTickOrder()) {
    if (phase === "heartbeat") {
      const beat = await writeAwayHeartbeat({ hiveRoot: input.hiveRoot, pid: input.pid });
      if (!beat.ok) {
        const tick = entry(null, false, "heartbeat_failed", null);
        await recordTick(input.hiveRoot, tick);
        return { ok: true, ticks: [tick] };
      }
    } else if (phase === "gates") {
      decisions = await evaluateGates(input);
    } else {
      for (const decision of decisions ?? []) {
        ticks.push(await applyDecision(input, decision));
      }
    }
  }

  return { ok: true, ticks };
}

function validateAwaySet(input: AwaySetInput): AwaySetResult | null {
  if (input.pollIntervalMs !== undefined) {
    if (!Number.isInteger(input.pollIntervalMs) || input.pollIntervalMs < MIN_POLL_INTERVAL_MS) {
      return {
        ok: false,
        error: "INVALID_INPUT",
        message: "pollIntervalMs must be an integer greater than or equal to 10000.",
      };
    }
  }
  if (input.allowAbsentCi !== undefined && typeof input.allowAbsentCi !== "boolean") {
    return { ok: false, error: "INVALID_INPUT", message: "allowAbsentCi must be a boolean." };
  }
  if (typeof input.awayMode !== "boolean") {
    return { ok: false, error: "INVALID_INPUT", message: "awayMode must be a boolean." };
  }
  return null;
}

async function evaluateGates(input: AwayTickInput): Promise<Decision[]> {
  const settings = await readSettings(input.hiveRoot);
  if (!settings) return [{ featureId: null, action: "skip", reason: "hive_corrupt" }];

  let ids = await featuresWithBriefAndLedger(input.hiveRoot);
  if (input.featureId !== undefined) ids = ids.filter((id) => id === input.featureId);
  if (ids.length === 0) {
    return input.featureId ? [{ featureId: input.featureId, action: "skip", reason: "no_ready_task" }] : [];
  }

  const repositoryRoot = await repositoryRootOf(input.hiveRoot, input.cwd);
  const decisions: Decision[] = [];
  for (const featureId of ids) {
    decisions.push(await gateFeature(input.hiveRoot, featureId, settings, repositoryRoot));
  }
  return decisions;
}

async function gateFeature(
  hiveRoot: string,
  featureId: string,
  settings: AutonomySettings,
  repositoryRoot: string,
): Promise<Decision> {
  if (!settings.awayMode) return skip(featureId, "away_off");

  const autonomy = autonomyBlock(settings.autonomy);
  if (autonomy) return skip(featureId, autonomy);

  const asking = await criticalAskMeOpen(hiveRoot, featureId);
  if (asking === "error") return skip(featureId, "hive_corrupt");
  if (asking) return skip(featureId, "ask_me_open");

  if (await hiveNotReady(hiveRoot)) return skip(featureId, "hive_corrupt");

  const ledger = await readLedger(hiveRoot, featureId);
  if (ledger === "corrupt") return skip(featureId, "hive_corrupt");

  const selected = await selectReadyTask(repositoryRoot, ledger);
  if (!selected.ok) return skip(featureId, selected.reason);

  const ci = await readCiState(hiveRoot, featureId);
  if (ci === "corrupt") return skip(featureId, "hive_corrupt");
  const gate = evaluateCiGate({ ci, allowAbsentCi: settings.allowAbsentCi === true });
  if (!gate.pass) return skip(featureId, gate.reason);

  return { featureId, action: "dispatch", taskId: selected.taskId };
}

/** Autonomous is the only mode that auto-dispatches from the away poll. */
function autonomyBlock(autonomy: AutonomySettings["autonomy"]): AwaySkipReason | null {
  if (autonomy === "autonomous") return null;
  if (autonomy === "observe") return "autonomy_observe";
  return "autonomy_supervised";
}

async function applyDecision(input: AwayTickInput, decision: Decision): Promise<AwayTickEntry> {
  if (decision.action === "skip") {
    const tick = entry(decision.featureId, false, decision.reason, null);
    await recordTick(input.hiveRoot, tick);
    return tick;
  }

  const cwd = input.cwd ?? (await repositoryRootOf(input.hiveRoot));
  try {
    const result = await dispatchTask({
      featureId: decision.featureId,
      taskId: decision.taskId,
      cwd,
      internal: true,
      freshSubagent: true,
    });
    const tick = result.ok
      ? entry(decision.featureId, true, null, result.intent)
      : entry(decision.featureId, false, mapDispatchFailure(result.code), null);
    await recordTick(input.hiveRoot, tick);
    return tick;
  } catch {
    const tick = entry(decision.featureId, false, "hive_corrupt", null);
    await recordTick(input.hiveRoot, tick);
    return tick;
  }
}

function mapDispatchFailure(code: string): AwaySkipReason {
  if (code === "ci_not_green" || code === "ci_absent" || code === "heartbeat_failed") return code;
  if (code === "DISPATCH_HELD") return "dispatch_held";
  if (code === "ASK_ME_OPEN") return "ask_me_open";
  if (code === "NOT_DAG_READY" || code === "FEATURE_NOT_FOUND") return "no_ready_task";
  return "hive_corrupt";
}

/**
 * Open Ask-Me rows are the critical inbox. An item with no feature blocks every feature.
 */
async function criticalAskMeOpen(hiveRoot: string, featureId: string): Promise<boolean | "error"> {
  const listed = await listAskMe({ hiveRoot, state: "open" });
  if (!listed.ok) return "error";
  return listed.items.some((item) => item.featureId === featureId || item.featureId === null);
}

async function hiveNotReady(hiveRoot: string): Promise<boolean> {
  if (!(await manifestOk(hiveRoot))) return true;
  return pidIsStale(await readPidFile(hiveRoot));
}

async function manifestOk(hiveRoot: string): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8"));
    return Boolean(value && typeof value === "object" && (value as { schemaVersion?: unknown }).schemaVersion === 1);
  } catch {
    return false;
  }
}

async function selectReadyTask(
  repositoryRoot: string,
  ledger: HiveLedger,
): Promise<{ ok: true; taskId: string } | { ok: false; reason: "no_ready_task" | "dispatch_held" | "hive_corrupt" }> {
  const specDir = resolveInside(repositoryRoot, ledger.specDir);
  const planPath = resolveInside(repositoryRoot, ledger.planPath);
  if (!specDir || !planPath) return { ok: false, reason: "hive_corrupt" };

  let tasks;
  try {
    tasks = parsePlan(await readFile(planPath, "utf8"));
  } catch {
    return { ok: false, reason: "no_ready_task" };
  }

  const state = (await loadState(specDir)) ?? initState(tasks);
  const status = forgeStatus(state);
  if (status.total === 0) return { ok: false, reason: "no_ready_task" };
  const next = nextTask(tasks, state);
  if (!next) return { ok: false, reason: "no_ready_task" };
  const row = ledger.tasks.find((task) => task.id === next.id);
  if (!row) return { ok: false, reason: "no_ready_task" };
  if (row.hold === true) return { ok: false, reason: "dispatch_held" };
  return { ok: true, taskId: next.id };
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

async function readLedger(hiveRoot: string, featureId: string): Promise<HiveLedger | "corrupt"> {
  try {
    const parsed = HiveLedgerSchema.safeParse(
      JSON.parse(await readFile(join(hiveRoot, "ledger", `${featureId}.json`), "utf8")),
    );
    return parsed.success ? parsed.data : "corrupt";
  } catch {
    return "corrupt";
  }
}

async function featuresWithBriefAndLedger(hiveRoot: string): Promise<string[]> {
  const briefs = new Set(await jsonIds(join(hiveRoot, "briefs")));
  const ledgers = await jsonIds(join(hiveRoot, "ledger"));
  return ledgers.filter((id) => briefs.has(id)).sort();
}

async function jsonIds(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length));
  } catch {
    return [];
  }
}

function startPoller(hiveRoot: string, cwd: string, intervalMs: number): void {
  const key = resolve(hiveRoot);
  const timer = setInterval(() => runPoll(key, hiveRoot, cwd), intervalMs);
  if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
  pollers.set(key, { timer, busy: false });
}

async function runPoll(key: string, hiveRoot: string, cwd: string): Promise<void> {
  const state = pollers.get(key);
  if (!state || state.busy) return;
  state.busy = true;
  try {
    await awayTick({ hiveRoot, cwd });
  } finally {
    state.busy = false;
  }
}

async function stopPoller(hiveRoot: string): Promise<void> {
  const key = resolve(hiveRoot);
  const existing = pollers.get(key);
  if (existing) {
    clearInterval(existing.timer);
    pollers.delete(key);
  }
  const pid = await readPidFile(hiveRoot);
  const dead = pid.kind === "pid" && !pidAlive(pid.pid);
  if (existing || (pid.kind === "pid" && pid.pid === process.pid) || dead) {
    await unlink(join(hiveRoot, "away.pid")).catch(() => undefined);
  }
}

function pollerRunning(hiveRoot: string): boolean {
  return pollers.has(resolve(hiveRoot));
}

async function otherLivePoller(hiveRoot: string): Promise<boolean> {
  const pid = await readPidFile(hiveRoot);
  return pid.kind === "pid" && typeof pid.pid === "number" && pid.pid !== process.pid && pidAlive(pid.pid);
}

async function writeAwayPid(hiveRoot: string): Promise<void> {
  const path = join(hiveRoot, "away.pid");
  await writeFile(path, `${process.pid}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

function pidIsStale(pid: PidRead): boolean {
  if (pid.kind === "missing") return false;
  if (pid.kind === "unreadable") return true;
  return !pidAlive(pid.pid);
}

async function readPidFile(hiveRoot: string): Promise<PidRead> {
  try {
    const text = await readFile(join(hiveRoot, "away.pid"), "utf8");
    return { kind: "pid", pid: parsePid(text) };
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
  if (pid === null || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readSettings(hiveRoot: string): Promise<AutonomySettings | null> {
  try {
    const parsed = AutonomySettingsSchema.safeParse(
      JSON.parse(await readFile(join(hiveRoot, "settings.json"), "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function repositoryRootOf(hiveRoot: string, cwd?: string): Promise<string> {
  try {
    const value: unknown = JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8"));
    const root = value && typeof value === "object" ? (value as { repositoryRoot?: unknown }).repositoryRoot : undefined;
    if (typeof root === "string" && root.length > 0) return root;
  } catch {
    // Fall through to the caller cwd or the hive's parent layout.
  }
  if (cwd) return resolve(cwd);
  return resolve(hiveRoot, "..", "..");
}

async function recordTick(hiveRoot: string, tick: AwayTickEntry): Promise<void> {
  await appendHiveEvent(hiveRoot, tick.featureId, "away.tick", {
    dispatched: tick.dispatched,
    reason: tick.reason,
  });
}

async function appendHiveEvent(
  hiveRoot: string,
  featureId: string | null,
  type: string,
  data: Record<string, unknown>,
  actor: { kind: "ira" | "operator"; id: string } = { kind: "ira", id: "ira" },
): Promise<void> {
  try {
    const event = IraEventSchema.safeParse({
      id: `evt_${randomUUID()}`,
      type,
      version: 1,
      ts: new Date().toISOString(),
      featureId,
      actor,
      data,
    });
    if (!event.success) return;
    await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
      appendJsonlLine(join(hiveRoot, "events", "events.jsonl"), event.data),
    );
  } catch {
    return;
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

function skip(featureId: string, reason: AwaySkipReason): Decision {
  return { featureId, action: "skip", reason };
}

function entry(
  featureId: string | null,
  dispatched: boolean,
  reason: AwaySkipReason | null,
  intent: DispatchIntent | null,
): AwayTickEntry {
  return { featureId, dispatched, reason, intent };
}
