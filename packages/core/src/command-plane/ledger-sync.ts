import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync, type Stats } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Task } from "../types.js";
import type { TaskStatus } from "../forge-loop.js";
import { parsePlan } from "../plan-parser.js";
import {
  AskMeItemSchema,
  AutonomySettingsSchema,
  HiveLedgerSchema,
  IraEventSchema,
  featureIdSchema,
} from "./schema.js";
import { EVENT_LOCK_WAIT_MS, LEDGER_LOCK_WAIT_MS, appendJsonlLine, withLock, writeJsonAtomic } from "./store.js";
import type { CommandPlaneErrorCode, HiveLedger, HiveTask, HiveTaskStatus, IraEvent, TaskDrift } from "./types.js";

/**
 * Mirror forge status and reviewFailures into the hive ledger.
 * Plan fields (including implementsFr) are copied from plan.md.
 * This module reads specs/<feature>/.superspec/state.json and never writes it.
 */

const FORGE_STATUSES = new Set<TaskStatus>(["pending", "in_progress", "done", "blocked"]);

export type SyncHiveFromForgeInput = {
  featureId: string;
  repositoryRoot: string;
  specDir: string;
  planPath: string;
};

export type LedgerDriftRow = {
  taskId: string;
  drift: Exclude<TaskDrift, "ok">;
};

export type LedgerReconcile = {
  taskId: string;
  field: "status" | "reviewFailures";
  forgeValue: string | number;
  hiveValue: string | number;
};

export type SyncHiveFromForgeResult =
  | {
      ok: true;
      featureId: string;
      upserted: string[];
      drift: LedgerDriftRow[];
      reconciled: LedgerReconcile[];
    }
  | {
      ok: false;
      error: CommandPlaneErrorCode;
      message: string;
      syncFailedRecorded: boolean;
    };

type ForgeTasks = Record<string, { status: TaskStatus; reviewFailures: number }>;

type Prepared = {
  featureId: string;
  hiveRoot: string;
  ledgerPath: string;
  ledgerLock: string;
  planTasks: Task[];
  forgeTasks: ForgeTasks;
  ceiling: number;
  planPath: string;
  specDir: string;
};

type ApplyOk = {
  ok: true;
  upserted: string[];
  drift: LedgerDriftRow[];
  reconciled: LedgerReconcile[];
  askOpened: Array<{ askMeId: string; taskId: string }>;
};

type ApplyFail = { ok: false; error: CommandPlaneErrorCode; message: string };

/** Forge vocabulary to hive vocabulary. Hive never writes the reverse into state.json. */
export function mapForgeStatusToHive(status: TaskStatus): HiveTaskStatus {
  switch (status) {
    case "pending":
      return "todo";
    case "in_progress":
      return "doing";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    default: {
      const unexpected: never = status;
      throw new Error(`Unknown forge status: ${String(unexpected)}`);
    }
  }
}

export async function syncHiveFromForge(input: SyncHiveFromForgeInput): Promise<SyncHiveFromForgeResult> {
  const prepared = await prepare(input);
  if (!prepared.ok) {
    return recordFailure(prepared.hiveRoot, prepared.featureId, prepared.error, prepared.message);
  }

  try {
    const locked = await withLock(prepared.value.ledgerLock, { waitMs: LEDGER_LOCK_WAIT_MS }, () =>
      applySync(prepared.value),
    );
    if (!locked.ok) {
      return recordFailure(prepared.value.hiveRoot, prepared.value.featureId, locked.code, "Ledger lock is busy.");
    }
    if (!locked.value.ok) {
      return recordFailure(prepared.value.hiveRoot, prepared.value.featureId, locked.value.error, locked.value.message);
    }
    await appendOutcomeEvents(prepared.value.hiveRoot, prepared.value.featureId, locked.value);
    return {
      ok: true,
      featureId: prepared.value.featureId,
      upserted: locked.value.upserted,
      drift: locked.value.drift,
      reconciled: locked.value.reconciled,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hive sync failed.";
    return recordFailure(prepared.value.hiveRoot, prepared.value.featureId, "HIVE_CORRUPT", message);
  }
}

async function prepare(
  input: SyncHiveFromForgeInput,
): Promise<{ ok: true; value: Prepared } | { ok: false; error: CommandPlaneErrorCode; message: string; hiveRoot: string | null; featureId: string | null }> {
  const featureOk = featureIdSchema.safeParse(input.featureId).success;
  const hiveRoot = hiveRootFor(input.repositoryRoot);
  if (!featureOk) {
    return { ok: false, error: "INVALID_INPUT", message: "Invalid featureId.", hiveRoot, featureId: null };
  }
  if (!hiveRoot) {
    return { ok: false, error: "INVALID_INPUT", message: "Invalid repository root.", hiveRoot: null, featureId: input.featureId };
  }

  const repositoryRoot = resolve(input.repositoryRoot);
  const specDir = resolveInside(repositoryRoot, input.specDir);
  const planPath = resolveInside(repositoryRoot, input.planPath);
  if (!specDir || !planPath) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: "Path escapes the repository root.",
      hiveRoot,
      featureId: input.featureId,
    };
  }

  const hive = await readHive(hiveRoot);
  if (!hive.ok) return { ...hive, hiveRoot, featureId: input.featureId };

  const ceiling = await readCeiling(hiveRoot, input.featureId);
  if (!ceiling.ok) {
    return { ok: false, error: "HIVE_CORRUPT", message: ceiling.message, hiveRoot, featureId: input.featureId };
  }

  const forgeTasks = await readForgeTasks(specDir);
  if (!forgeTasks.ok) {
    return { ok: false, error: "HIVE_CORRUPT", message: forgeTasks.message, hiveRoot, featureId: input.featureId };
  }

  let planText: string;
  try {
    planText = await readFile(planPath, "utf8");
  } catch {
    return { ok: false, error: "INVALID_INPUT", message: "Plan file is unreadable.", hiveRoot, featureId: input.featureId };
  }

  const planTasks = dedupePlan(parsePlan(planText));
  if (planTasks.some((task) => task.title.trim().length === 0)) {
    return { ok: false, error: "INVALID_INPUT", message: "Plan task title is empty.", hiveRoot, featureId: input.featureId };
  }

  return {
    ok: true,
    value: {
      featureId: input.featureId,
      hiveRoot,
      ledgerPath: join(hiveRoot, "ledger", `${input.featureId}.json`),
      ledgerLock: join(hiveRoot, "locks", `ledger-${input.featureId}.lock`),
      planTasks,
      forgeTasks: forgeTasks.tasks,
      ceiling: ceiling.ceiling,
      planPath: repoRelative(repositoryRoot, planPath),
      specDir: repoRelative(repositoryRoot, specDir),
    },
  };
}

async function applySync(ctx: Prepared): Promise<ApplyOk | ApplyFail> {
  const existing = await readLedger(ctx.ledgerPath, ctx.featureId);
  if (existing.kind === "corrupt") {
    return { ok: false, error: "HIVE_CORRUPT", message: "Ledger JSON is unreadable." };
  }

  const now = new Date().toISOString();
  const built = buildLedger(ctx, existing.ledger, now);
  const parsed = HiveLedgerSchema.safeParse(built.ledger);
  if (!parsed.success) {
    return { ok: false, error: "HIVE_CORRUPT", message: "Ledger sync produced an invalid ledger." };
  }
  // Ask-Me first so a notification failure leaves the previous ledger in place.
  const askOpened = await openRemovedTaskAskMe(ctx.hiveRoot, ctx.featureId, built.askTaskIds, now);
  await writeJsonAtomic(ctx.ledgerPath, parsed.data);
  return { ok: true, ...built, askOpened };
}

function buildLedger(
  ctx: Prepared,
  existing: HiveLedger | null,
  now: string,
): { ledger: HiveLedger; upserted: string[]; drift: LedgerDriftRow[]; reconciled: LedgerReconcile[]; askTaskIds: string[] } {
  const previous = new Map((existing?.tasks ?? []).map((task) => [task.id, task]));
  const planIds = new Set(ctx.planTasks.map((task) => task.id));
  const tasks: HiveTask[] = [];
  const drift: LedgerDriftRow[] = [];
  const reconciled: LedgerReconcile[] = [];
  const upserted: string[] = [];
  const askTaskIds: string[] = [];

  for (const planTask of ctx.planTasks) {
    const prior = previous.get(planTask.id);
    const mirrored = mirrorForge(prior, ctx.forgeTasks[planTask.id], reconciled);
    const driftKind = planDrift(prior, planTask);
    tasks.push(taskFromPlan(ctx, planTask, prior, mirrored, driftKind, now));
    if (driftKind !== "ok") {
      drift.push({ taskId: planTask.id, drift: driftKind });
      upserted.push(planTask.id);
    }
  }

  for (const prior of existing?.tasks ?? []) {
    if (planIds.has(prior.id)) continue;
    const mirrored = mirrorForge(prior, ctx.forgeTasks[prior.id], reconciled);
    tasks.push({
      ...prior,
      featureId: ctx.featureId,
      status: mirrored.status,
      reviewFailures: mirrored.reviewFailures,
      drift: "removed",
      ceiling: ctx.ceiling,
      updatedAt: now,
      implementsFr: [...prior.implementsFr],
      dependsOn: [...prior.dependsOn],
      capabilityTags: [...prior.capabilityTags],
    });
    drift.push({ taskId: prior.id, drift: "removed" });
    if (mirrored.status === "todo" || mirrored.status === "doing") askTaskIds.push(prior.id);
  }

  return {
    ledger: {
      featureId: ctx.featureId,
      planPath: ctx.planPath,
      specDir: ctx.specDir,
      maxReviewFailures: ctx.ceiling,
      updatedAt: now,
      tasks,
    },
    upserted,
    drift,
    reconciled,
    askTaskIds,
  };
}

function mirrorForge(
  prior: HiveTask | undefined,
  forge: { status: TaskStatus; reviewFailures: number } | undefined,
  reconciled: LedgerReconcile[],
): { status: HiveTaskStatus; reviewFailures: number } {
  if (!forge) {
    return { status: prior?.status ?? "todo", reviewFailures: prior?.reviewFailures ?? 0 };
  }
  const status = mapForgeStatusToHive(forge.status);
  if (prior && prior.status !== status) {
    reconciled.push({
      taskId: prior.id,
      field: "status",
      forgeValue: forge.status,
      hiveValue: prior.status,
    });
  }
  if (prior && prior.reviewFailures !== forge.reviewFailures) {
    reconciled.push({
      taskId: prior.id,
      field: "reviewFailures",
      forgeValue: forge.reviewFailures,
      hiveValue: prior.reviewFailures,
    });
  }
  return { status, reviewFailures: forge.reviewFailures };
}

function taskFromPlan(
  ctx: Prepared,
  planTask: Task,
  prior: HiveTask | undefined,
  mirrored: { status: HiveTaskStatus; reviewFailures: number },
  drift: TaskDrift,
  now: string,
): HiveTask {
  return {
    id: planTask.id,
    featureId: ctx.featureId,
    title: planTask.title,
    implementsFr: [...planTask.frRefs],
    dependsOn: [...planTask.dependsOn],
    assigneeAgentId: prior?.assigneeAgentId ?? null,
    status: mirrored.status,
    kind: planTask.kind,
    complexity: planTask.complexity,
    reviewFailures: mirrored.reviewFailures,
    hold: prior?.hold ?? false,
    abortReason: prior?.abortReason,
    ceiling: ctx.ceiling,
    resultRef: prior?.resultRef,
    blockedByAskMeId: prior?.blockedByAskMeId,
    drift,
    replan: prior?.replan,
    capabilityTags: prior ? [...prior.capabilityTags] : [],
    humanQA: prior?.humanQA,
    updatedAt: now,
  };
}

function planDrift(prior: HiveTask | undefined, planTask: Task): TaskDrift {
  if (!prior) return "added";
  const changed =
    prior.title !== planTask.title ||
    prior.kind !== planTask.kind ||
    prior.complexity !== planTask.complexity ||
    !sameList(prior.implementsFr, planTask.frRefs) ||
    !sameList(prior.dependsOn, planTask.dependsOn);
  return changed ? "changed" : "ok";
}

async function openRemovedTaskAskMe(
  hiveRoot: string,
  featureId: string,
  taskIds: string[],
  now: string,
): Promise<Array<{ askMeId: string; taskId: string }>> {
  if (taskIds.length === 0) return [];
  const dir = join(hiveRoot, "ask-me");
  const openFor = await openDriftTaskIds(dir, featureId);
  const opened: Array<{ askMeId: string; taskId: string }> = [];
  for (const taskId of taskIds) {
    if (openFor.has(taskId)) continue;
    const item = AskMeItemSchema.parse({
      id: `ask_${randomUUID()}`,
      featureId,
      taskId,
      agentId: null,
      reasonClass: "ambiguous_requirement",
      question: `Plan drift removed open task ${taskId}.`,
      answer: null,
      action: null,
      state: "open",
      createdAt: now,
      resolvedAt: null,
    });
    try {
      await writeFile(join(dir, `${item.id}.json`), `${JSON.stringify(item)}\n`, { flag: "wx", mode: 0o600 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    opened.push({ askMeId: item.id, taskId });
  }
  return opened;
}

async function openDriftTaskIds(dir: string, featureId: string): Promise<Set<string>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw err;
  }
  const ids = new Set<string>();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = AskMeItemSchema.safeParse(JSON.parse(await readFile(join(dir, name), "utf8")));
      if (!parsed.success) continue;
      const item = parsed.data;
      if (item.state !== "open" || item.reasonClass !== "ambiguous_requirement") continue;
      if (item.featureId !== featureId || item.taskId === null) continue;
      ids.add(item.taskId);
    } catch {
      // Unreadable ask-me files are doctor's concern. Sync still opens a new item.
    }
  }
  return ids;
}

async function readLedger(ledgerPath: string, featureId: string): Promise<{ kind: "missing"; ledger: null } | { kind: "ok"; ledger: HiveLedger } | { kind: "corrupt"; ledger: null }> {
  try {
    const text = await readFile(ledgerPath, "utf8");
    const parsed = HiveLedgerSchema.safeParse(JSON.parse(text));
    if (!parsed.success || parsed.data.featureId !== featureId) return { kind: "corrupt", ledger: null };
    return { kind: "ok", ledger: parsed.data };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing", ledger: null };
    return { kind: "corrupt", ledger: null };
  }
}

async function readHive(hiveRoot: string): Promise<{ ok: true } | { ok: false; error: CommandPlaneErrorCode; message: string }> {
  try {
    const text = await readFile(join(hiveRoot, "hive.json"), "utf8");
    const value: unknown = JSON.parse(text);
    const version = value && typeof value === "object" ? (value as { schemaVersion?: unknown }).schemaVersion : undefined;
    if (version === 1) return { ok: true };
    if (typeof version === "number") {
      return { ok: false, error: "HIVE_SCHEMA_MISMATCH", message: "Hive schema version is not supported." };
    }
    return { ok: false, error: "HIVE_CORRUPT", message: "Hive manifest is unreadable." };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: "HIVE_NOT_INITIALIZED", message: "Hive is not initialized." };
    }
    return { ok: false, error: "HIVE_CORRUPT", message: "Hive manifest is unreadable." };
  }
}

async function readCeiling(
  hiveRoot: string,
  featureId: string,
): Promise<{ ok: true; ceiling: number } | { ok: false; message: string }> {
  try {
    const text = await readFile(join(hiveRoot, "settings.json"), "utf8");
    const parsed = AutonomySettingsSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return { ok: false, message: "Settings JSON is unreadable." };
    return { ok: true, ceiling: parsed.data.featureCeilings[featureId] ?? parsed.data.maxReviewFailures };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, ceiling: 3 };
    return { ok: false, message: "Settings JSON is unreadable." };
  }
}

/** Read forge state. Missing file means no rows. Invalid JSON fails the sync. Never writes the file. */
async function readForgeTasks(specDir: string): Promise<{ ok: true; tasks: ForgeTasks } | { ok: false; message: string }> {
  const path = join(specDir, ".superspec", "state.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, tasks: {} };
    return { ok: false, message: "Forge state is unreadable." };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: "Forge state is not valid JSON." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Forge state is missing tasks." };
  }
  const raw = (value as { tasks?: unknown }).tasks;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Forge state is missing tasks." };
  }
  const tasks: ForgeTasks = {};
  for (const [id, row] of Object.entries(raw)) {
    if (!row || typeof row !== "object") return { ok: false, message: `Forge task ${id} is invalid.` };
    const status = (row as { status?: unknown }).status;
    const reviewFailures = (row as { reviewFailures?: unknown }).reviewFailures;
    if (!isForgeStatus(status)) return { ok: false, message: `Forge task ${id} has an unknown status.` };
    if (typeof reviewFailures !== "number" || !Number.isInteger(reviewFailures) || reviewFailures < 0) {
      return { ok: false, message: `Forge task ${id} has invalid reviewFailures.` };
    }
    tasks[id] = { status, reviewFailures };
  }
  return { ok: true, tasks };
}

async function appendOutcomeEvents(hiveRoot: string, featureId: string, outcome: ApplyOk): Promise<void> {
  for (const row of outcome.drift) {
    await appendEvent(hiveRoot, featureId, "task.upserted", { taskId: row.taskId, drift: row.drift });
  }
  for (const row of outcome.reconciled) {
    await appendEvent(hiveRoot, featureId, "hive.reconciled", {
      taskId: row.taskId,
      field: row.field,
      forgeValue: row.forgeValue,
      hiveValue: row.hiveValue,
    });
  }
  for (const opened of outcome.askOpened) {
    await appendEvent(hiveRoot, featureId, "ask_me.opened", {
      askMeId: opened.askMeId,
      reasonClass: "ambiguous_requirement",
      taskId: opened.taskId,
    });
  }
}

async function recordFailure(
  hiveRoot: string | null,
  featureId: string | null,
  error: CommandPlaneErrorCode,
  message: string,
): Promise<Extract<SyncHiveFromForgeResult, { ok: false }>> {
  const syncFailedRecorded = hiveRoot ? await appendEvent(hiveRoot, featureId, "hive.sync_failed", { message }) : false;
  return { ok: false, error, message, syncFailedRecorded };
}

async function appendEvent(
  hiveRoot: string,
  featureId: string | null,
  type: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    const file = writableEventLog(hiveRoot);
    if (!file) return false;
    const event: IraEvent = {
      id: `evt_${randomUUID()}`,
      type,
      version: 1,
      ts: new Date().toISOString(),
      featureId: featureIdSchema.safeParse(featureId).success ? featureId : null,
      actor: { kind: "ira", id: "ira" },
      data,
    };
    const parsed = IraEventSchema.safeParse(event);
    if (!parsed.success) return false;
    const locked = await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
      appendJsonlLine(file, parsed.data),
    );
    return locked.ok;
  } catch {
    return false;
  }
}

function writableEventLog(hiveRoot: string): string | null {
  const dir = join(hiveRoot, "events");
  const file = join(dir, "events.jsonl");
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    return null;
  }
  const existing = statFile(file);
  if (existing === "missing") return file;
  if (existing === "error" || !existing.isFile()) return null;
  try {
    accessSync(file, constants.W_OK);
    return file;
  } catch {
    return null;
  }
}

function statFile(path: string): Stats | "missing" | "error" {
  try {
    return statSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "error";
  }
}

function hiveRootFor(repositoryRoot: string): string | null {
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim().length === 0) return null;
  return join(resolve(repositoryRoot), ".superspec", "hive");
}

function resolveInside(root: string, candidate: string): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  const absRoot = resolve(root);
  const abs = isAbsolute(candidate) ? resolve(candidate) : resolve(absRoot, candidate);
  const rel = relative(absRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

function repoRelative(root: string, absPath: string): string {
  return relative(resolve(root), absPath).split(sep).join("/");
}

function dedupePlan(tasks: Task[]): Task[] {
  const seen = new Set<string>();
  const unique: Task[] = [];
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    unique.push(task);
  }
  return unique;
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isForgeStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && FORGE_STATUSES.has(value as TaskStatus);
}
