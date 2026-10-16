import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { loadState, saveState, type TaskStatus } from "../forge-loop.js";
import { HiveLedgerSchema, IraEventSchema, RosterAgentSchema, agentIdSchema, featureIdSchema } from "./schema.js";
import { EVENT_LOCK_WAIT_MS, LEDGER_LOCK_WAIT_MS, appendJsonlLine, withLock, writeJsonAtomic } from "./store.js";
import type { CommandPlaneErrorCode, HiveLedger, HiveTask, RosterAgent } from "./types.js";

const isoTimestamp = z.string().datetime({ offset: true });
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

type ControlFailure = { ok: false; error: CommandPlaneErrorCode; message: string };

export type TaskHoldResult =
  | { ok: true; task: Pick<HiveTask, "id" | "hold" | "reviewFailures" | "status"> }
  | ControlFailure;

export type TaskAbortResult =
  | {
      ok: true;
      task: Pick<HiveTask, "id" | "hold" | "reviewFailures" | "status" | "abortReason">;
    }
  | ControlFailure;

export type TaskReassignResult =
  | {
      ok: true;
      task: Pick<HiveTask, "id" | "assigneeAgentId" | "status" | "reviewFailures" | "updatedAt">;
    }
  | ControlFailure;

/** Pure guard: missing confirm must not write ledger, forge, or events. */
export function abortWithoutConfirmWritesNothing(input: { confirm: boolean }): { writes: boolean } {
  return { writes: input.confirm === true };
}

/**
 * Abort cannot use forge `recordResult(false)` — the only path that increments
 * `reviewFailures`. Completed forge rows have no safe abort transition.
 */
export function abortBlockedByForgeStatus(
  status: TaskStatus,
): { blocked: true; code: "ABORT_UNSUPPORTED" } | { blocked: false } {
  if (status === "done") return { blocked: true, code: "ABORT_UNSUPPORTED" };
  return { blocked: false };
}

/**
 * Hive-only pause (OD-011). Does not touch forge `state.json` or `reviewFailures`.
 */
export async function taskHold(input: {
  hiveRoot: string;
  featureId: string;
  taskId: string;
  hold: boolean;
  now?: string;
}): Promise<TaskHoldResult> {
  const hive = await requireHive(input.hiveRoot);
  if (!hive.ok) return hive;
  if (!featureIdSchema.safeParse(input.featureId).success) {
    return fail("INVALID_INPUT", "Feature id is invalid.");
  }
  if (!TASK_ID.test(input.taskId)) return fail("INVALID_INPUT", "Task id is invalid.");
  if (typeof input.hold !== "boolean") return fail("INVALID_INPUT", "Hold flag is invalid.");
  const stamped = timestamp(input.now);
  if (!stamped.ok) return stamped;

  const locked = await withLock(
    ledgerLock(input.hiveRoot, input.featureId),
    { waitMs: LEDGER_LOCK_WAIT_MS },
    async () => {
      const loaded = await readLedger(ledgerFile(input.hiveRoot, input.featureId));
      if (loaded === "missing") return fail("FEATURE_NOT_FOUND", "Feature ledger is missing.");
      if (loaded === "corrupt") return fail("HIVE_CORRUPT", "Ledger is unreadable.");
      const index = loaded.ledger.tasks.findIndex((task) => task.id === input.taskId);
      if (index < 0) return fail("INVALID_INPUT", "Task id is not in the ledger.");

      const tasks = loaded.ledger.tasks.map((task, taskIndex) =>
        taskIndex === index ? { ...task, hold: input.hold, updatedAt: stamped.value } : task,
      );
      const next = HiveLedgerSchema.parse({ ...loaded.ledger, updatedAt: stamped.value, tasks });
      await writeJsonAtomic(ledgerFile(input.hiveRoot, input.featureId), next);
      const updated = next.tasks[index];
      return { ok: true as const, task: updated, eventType: input.hold ? ("task.held" as const) : ("task.resumed" as const) };
    },
  );
  if (!locked.ok) return fail("LEDGER_BUSY", "Ledger is busy.");
  if (!locked.value.ok) return locked.value;

  await appendEvent(input.hiveRoot, input.featureId, locked.value.eventType, { taskId: input.taskId }, stamped.value);
  const task = locked.value.task;
  return {
    ok: true,
    task: { id: task.id, hold: task.hold, reviewFailures: task.reviewFailures, status: task.status },
  };
}

/**
 * Operator abort (OD-011). Requires `confirm: true`. Never calls `record-result`.
 */
export async function taskAbort(input: {
  hiveRoot: string;
  featureId: string;
  taskId: string;
  confirm: boolean;
  abortReason: string;
  now?: string;
}): Promise<TaskAbortResult> {
  if (!abortWithoutConfirmWritesNothing({ confirm: input.confirm }).writes) {
    return fail("INVALID_INPUT", "Abort requires confirm: true.");
  }
  const reason = typeof input.abortReason === "string" ? input.abortReason.trim() : "";
  if (reason.length === 0) return fail("INVALID_INPUT", "Abort reason is empty.");

  const hive = await requireHive(input.hiveRoot);
  if (!hive.ok) return hive;
  if (!featureIdSchema.safeParse(input.featureId).success) {
    return fail("INVALID_INPUT", "Feature id is invalid.");
  }
  if (!TASK_ID.test(input.taskId)) return fail("INVALID_INPUT", "Task id is invalid.");
  const stamped = timestamp(input.now);
  if (!stamped.ok) return stamped;

  const ledgerPath = ledgerFile(input.hiveRoot, input.featureId);
  const preview = await readLedger(ledgerPath);
  if (preview === "missing") return fail("FEATURE_NOT_FOUND", "Feature ledger is missing.");
  if (preview === "corrupt") return fail("HIVE_CORRUPT", "Ledger is unreadable.");
  if (!preview.ledger.tasks.some((task) => task.id === input.taskId)) {
    return fail("INVALID_INPUT", "Task id is not in the ledger.");
  }

  const forged = await applyForgeAbort(input.hiveRoot, preview.ledger, input.taskId);
  if (!forged.ok) return forged;

  const locked = await withLock(ledgerLock(input.hiveRoot, input.featureId), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    const loaded = await readLedger(ledgerPath);
    if (loaded === "missing") return fail("FEATURE_NOT_FOUND", "Feature ledger is missing.");
    if (loaded === "corrupt") return fail("HIVE_CORRUPT", "Ledger is unreadable.");
    const index = loaded.ledger.tasks.findIndex((task) => task.id === input.taskId);
    if (index < 0) return fail("INVALID_INPUT", "Task id is not in the ledger.");

    const tasks = loaded.ledger.tasks.map((task, taskIndex) =>
      taskIndex === index
        ? {
            ...task,
            status: "blocked" as const,
            hold: false,
            abortReason: reason,
            updatedAt: stamped.value,
          }
        : task,
    );
    const next = HiveLedgerSchema.parse({ ...loaded.ledger, updatedAt: stamped.value, tasks });
    await writeJsonAtomic(ledgerPath, next);
    return { ok: true as const, task: next.tasks[index] };
  });
  if (!locked.ok) return fail("LEDGER_BUSY", "Ledger is busy.");
  if (!locked.value.ok) return locked.value;

  await appendEvent(
    input.hiveRoot,
    input.featureId,
    "task.aborted",
    { taskId: input.taskId, abortReason: reason },
    stamped.value,
  );
  const task = locked.value.task;
  return {
    ok: true,
    task: {
      id: task.id,
      hold: task.hold,
      reviewFailures: task.reviewFailures,
      status: task.status,
      abortReason: task.abortReason ?? reason,
    },
  };
}

/**
 * Operator reassign (OD-012). Updates `assigneeAgentId` and `updatedAt` under `withLock`.
 * Does not call `record-result` and does not change forge state.
 */
export async function taskReassign(input: {
  hiveRoot: string;
  featureId: string;
  taskId: string;
  agentId: string;
  now?: string;
}): Promise<TaskReassignResult> {
  const hive = await requireHive(input.hiveRoot);
  if (!hive.ok) return hive;
  if (!featureIdSchema.safeParse(input.featureId).success) {
    return fail("INVALID_INPUT", "Feature id is invalid.");
  }
  if (!TASK_ID.test(input.taskId)) return fail("INVALID_INPUT", "Task id is invalid.");
  if (!agentIdSchema.safeParse(input.agentId).success) {
    return fail("INVALID_INPUT", "Agent id is invalid.");
  }
  const stamped = timestamp(input.now);
  if (!stamped.ok) return stamped;

  const roster = await readRoster(input.hiveRoot);
  if (roster === "corrupt") return fail("HIVE_CORRUPT", "Roster is unreadable.");
  const agent = roster.find((row) => row.id === input.agentId);
  if (!agent) return fail("INVALID_INPUT", "Agent is not on the roster.");
  if (agent.status === "offline") return fail("INVALID_INPUT", "Agent is offline.");

  const locked = await withLock(
    ledgerLock(input.hiveRoot, input.featureId),
    { waitMs: LEDGER_LOCK_WAIT_MS },
    async () => {
      const loaded = await readLedger(ledgerFile(input.hiveRoot, input.featureId));
      if (loaded === "missing") return fail("FEATURE_NOT_FOUND", "Feature ledger is missing.");
      if (loaded === "corrupt") return fail("HIVE_CORRUPT", "Ledger is unreadable.");
      const index = loaded.ledger.tasks.findIndex((task) => task.id === input.taskId);
      if (index < 0) return fail("INVALID_INPUT", "Task id is not in the ledger.");

      const fromAgentId = loaded.ledger.tasks[index]?.assigneeAgentId ?? null;
      const tasks = loaded.ledger.tasks.map((task, taskIndex) =>
        taskIndex === index ? { ...task, assigneeAgentId: input.agentId, updatedAt: stamped.value } : task,
      );
      const next = HiveLedgerSchema.parse({ ...loaded.ledger, updatedAt: stamped.value, tasks });
      await writeJsonAtomic(ledgerFile(input.hiveRoot, input.featureId), next);
      const updated = next.tasks[index];
      if (!updated) return fail("INVALID_INPUT", "Task id is not in the ledger.");
      return { ok: true as const, task: updated, fromAgentId };
    },
  );
  if (!locked.ok) return fail("LEDGER_BUSY", "Ledger is busy.");
  if (!locked.value.ok) return locked.value;

  await appendEvent(
    input.hiveRoot,
    input.featureId,
    "task.reassigned",
    { taskId: input.taskId, agentId: input.agentId, fromAgentId: locked.value.fromAgentId },
    stamped.value,
  );
  const task = locked.value.task;
  return {
    ok: true,
    task: {
      id: task.id,
      assigneeAgentId: task.assigneeAgentId,
      status: task.status,
      reviewFailures: task.reviewFailures,
      updatedAt: task.updatedAt,
    },
  };
}

async function applyForgeAbort(
  hiveRoot: string,
  ledger: HiveLedger,
  taskId: string,
): Promise<{ ok: true } | ControlFailure> {
  const root = await readRepositoryRoot(hiveRoot);
  if (!root.ok) return root;
  const specDirAbs = resolveInside(root.repositoryRoot, ledger.specDir);
  if (!specDirAbs) return fail("HIVE_CORRUPT", "Spec directory is outside the repository.");
  const state = await loadState(specDirAbs);
  if (!state) return fail("HIVE_CORRUPT", "Forge state is missing.");
  const row = state.tasks[taskId];
  if (!row) return fail("INVALID_INPUT", "Task id is not in forge state.");
  const blocked = abortBlockedByForgeStatus(row.status);
  if (blocked.blocked) return fail(blocked.code, "Abort is not supported for a completed task.");
  if (row.status === "blocked") return { ok: true };
  state.tasks[taskId] = { status: "blocked", reviewFailures: row.reviewFailures };
  await saveState(specDirAbs, state);
  return { ok: true };
}

function fail(error: CommandPlaneErrorCode, message: string): ControlFailure {
  return { ok: false, error, message };
}

function timestamp(now: string | undefined): { ok: true; value: string } | ControlFailure {
  const value = now ?? new Date().toISOString();
  if (!isoTimestamp.safeParse(value).success) return fail("INVALID_INPUT", "Timestamp is invalid.");
  return { ok: true, value };
}

function ledgerFile(hiveRoot: string, featureId: string): string {
  return join(hiveRoot, "ledger", `${featureId}.json`);
}

function ledgerLock(hiveRoot: string, featureId: string): string {
  return join(hiveRoot, "locks", `ledger-${featureId}.lock`);
}

async function readRoster(hiveRoot: string): Promise<RosterAgent[] | "corrupt"> {
  try {
    const parsed = RosterAgentSchema.array().safeParse(
      JSON.parse(await readFile(join(hiveRoot, "roster.json"), "utf8")),
    );
    if (!parsed.success) return "corrupt";
    return parsed.data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    return "corrupt";
  }
}

async function requireHive(hiveRoot: string): Promise<{ ok: true } | ControlFailure> {
  if (typeof hiveRoot !== "string" || hiveRoot.trim().length === 0) {
    return fail("INVALID_INPUT", "Hive root is missing.");
  }
  try {
    const value: unknown = JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8"));
    const version = value && typeof value === "object" ? (value as { schemaVersion?: unknown }).schemaVersion : undefined;
    if (version === 1) return { ok: true };
    if (typeof version === "number") return fail("HIVE_SCHEMA_MISMATCH", "Hive schema version is not supported.");
    return fail("HIVE_CORRUPT", "Hive manifest is unreadable.");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fail("HIVE_NOT_INITIALIZED", "Hive is not initialized.");
    return fail("HIVE_CORRUPT", "Hive manifest is unreadable.");
  }
}

async function readRepositoryRoot(hiveRoot: string): Promise<{ ok: true; repositoryRoot: string } | ControlFailure> {
  try {
    const value: unknown = JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8"));
    const repositoryRoot =
      value && typeof value === "object" ? (value as { repositoryRoot?: unknown }).repositoryRoot : undefined;
    if (typeof repositoryRoot !== "string" || repositoryRoot.trim().length === 0) {
      return fail("HIVE_CORRUPT", "Hive manifest is unreadable.");
    }
    return { ok: true, repositoryRoot };
  } catch {
    return fail("HIVE_CORRUPT", "Hive manifest is unreadable.");
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

async function readLedger(
  ledgerPath: string,
): Promise<{ ledger: HiveLedger } | "missing" | "corrupt"> {
  try {
    const parsed = HiveLedgerSchema.safeParse(JSON.parse(await readFile(ledgerPath, "utf8")));
    if (!parsed.success) return "corrupt";
    return { ledger: parsed.data };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "corrupt";
  }
}

async function appendEvent(
  hiveRoot: string,
  featureId: string,
  type: string,
  data: Record<string, unknown>,
  ts: string,
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
    ts,
    featureId: featureIdSchema.safeParse(featureId).success ? featureId : null,
    actor: { kind: "ira", id: "ira" },
    data,
  });
  if (!event.success) return;
  await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
    appendJsonlLine(join(hiveRoot, "events", "events.jsonl"), event.data),
  );
}
