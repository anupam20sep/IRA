import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { TaskStatus } from "../forge-loop.js";
import { routeModel, type ModelTier } from "../model-router.js";
import { openAskMeItem } from "./ask-me.js";
import {
  HiveLedgerSchema,
  IraEventSchema,
  RosterAgentSchema,
  featureIdSchema,
} from "./schema.js";
import { EVENT_LOCK_WAIT_MS, LEDGER_LOCK_WAIT_MS, appendJsonlLine, withLock, writeJsonAtomic } from "./store.js";
import type { CommandPlaneErrorCode, HiveLedger, ReplanKind, RosterAgent } from "./types.js";

const isoTimestamp = z.string().datetime({ offset: true });

export type ReplanSource = "record-result" | "pause" | "abort";

export type ReplanForgeStatus = "pending" | "in_progress" | "done" | "blocked";

type ReplanFailure = { ok: false; error: CommandPlaneErrorCode; message: string; reviewFailuresDelta: 0 };

export type ApplyReplanResult =
  | {
      ok: true;
      applied: false;
      reason: "pause" | "abort" | "passed" | "not_a_review_failure" | "ledger_missing" | "task_missing";
      reviewFailuresDelta: 0;
    }
  | {
      ok: true;
      applied: true;
      action: "replan";
      kind: ReplanKind;
      reviewFailures: number;
      ceiling: number;
      attempt: number;
      tier: ModelTier | null;
      fromAgentId: string | null;
      toAgentId: string | null;
      reviewFailuresDelta: 0;
      scopeAskMeId: string | null;
    }
  | {
      ok: true;
      applied: true;
      action: "ask_me";
      reasonClass: "repeated_review_failure";
      askMeId: string;
      created: boolean;
      reviewFailures: number;
      reviewFailuresDelta: 0;
    }
  | ReplanFailure;

type KindInput = {
  forgeStatus: ReplanForgeStatus;
  reviewFailures: number;
  ceiling: number;
  assigneeAgentId: string | null;
  idleAgentIds: readonly string[];
  substeps?: readonly string[];
};

/**
 * OD-011: pause is hive `hold` and is not a review failure.
 * `reviewFailures` increments only inside forge `recordResult` on `passed: false`.
 */
export function pauseIncrementsReviewFailures(): boolean {
  return false;
}

/** Below-ceiling kind after a real review failure. Null means do not silently replan. */
export function replanKindForFailure(input: KindInput): ReplanKind | null {
  if (!Number.isInteger(input.reviewFailures) || input.reviewFailures < 1) return null;
  if (!Number.isInteger(input.ceiling) || input.ceiling < 1) return null;
  if (input.reviewFailures >= input.ceiling) return null;
  if (input.forgeStatus !== "pending") return null;
  if (cleanSubsteps(input.substeps).length > 0) return "split";
  if (input.reviewFailures === 2 && otherIdle(input.idleAgentIds, input.assigneeAgentId)) return "reassign";
  return "retry_tier";
}

/**
 * Apply replan policy for one outcome.
 * Pause, abort, and `passed: true` write nothing and do not change `reviewFailures`.
 * A real `record-result` with `passed: false` replans below the ceiling, or opens
 * Ask-Me `repeated_review_failure` at the ceiling.
 */
export async function applyReplanAfterFailure(input: {
  hiveRoot: string;
  featureId: string;
  taskId: string;
  source: ReplanSource;
  passed?: boolean;
  forgeStatus?: ReplanForgeStatus;
  reviewFailures?: number;
  ceiling?: number;
  substeps?: readonly string[];
  addsTaskOrFr?: boolean;
  now?: string;
}): Promise<ApplyReplanResult> {
  if (input.source === "pause") return skipped("pause");
  if (input.source === "abort") return skipped("abort");
  if (input.passed === true) return skipped("passed");
  if (input.passed !== false) return fail("INVALID_INPUT", "record-result passed must be false to replan.");

  const counts = failureCounts(input);
  if (!counts.ok) return counts;
  if (!counts.failure) return skipped("not_a_review_failure");

  const hive = await requireHive(input.hiveRoot);
  if (!hive.ok) return hive;
  if (!featureIdSchema.safeParse(input.featureId).success) {
    return fail("INVALID_INPUT", "Feature id is invalid.");
  }
  if (typeof input.taskId !== "string" || input.taskId.trim().length === 0) {
    return fail("INVALID_INPUT", "Task id is invalid.");
  }
  const stamped = timestamp(input.now);
  if (!stamped.ok) return stamped;

  const substeps = input.addsTaskOrFr ? [] : cleanSubsteps(input.substeps);
  if (counts.atCeiling) {
    return openCeilingAsk(input, counts.reviewFailures, counts.ceiling, stamped.value);
  }

  const planned = await writeReplan(input, counts.reviewFailures, counts.ceiling, substeps, stamped.value);
  if (!planned.ok || !planned.applied || planned.action !== "replan") return planned;

  if (input.addsTaskOrFr) {
    const opened = await openAskMeItem({
      hiveRoot: input.hiveRoot,
      featureId: input.featureId,
      taskId: input.taskId,
      agentId: planned.fromAgentId,
      reasonClass: "spec_scope_change",
      question: `A worker asked to add a task or FR while replanning ${input.taskId}. The plan was not changed.`,
      now: stamped.value,
    });
    if (!opened.ok) return fail(opened.error, opened.message);
    return { ...planned, scopeAskMeId: opened.item.id };
  }
  return planned;
}

/**
 * Hook for forge `record-result` after hive sync.
 * Runs only for `passed: false`. Failure here does not change the forge result.
 */
export async function maybeReplanAfterRecordResult(input: {
  hiveExists: boolean;
  hiveRoot?: string;
  featureId?: string;
  taskId: string;
  passed: boolean;
  forgeStatus: TaskStatus;
  reviewFailures: number;
  ceiling: number;
}): Promise<void> {
  try {
    if (!input.hiveExists || !input.hiveRoot || !input.featureId) return;
    if (input.passed) return;
    await applyReplanAfterFailure({
      hiveRoot: input.hiveRoot,
      featureId: input.featureId,
      taskId: input.taskId,
      source: "record-result",
      passed: false,
      forgeStatus: input.forgeStatus,
      reviewFailures: input.reviewFailures,
      ceiling: input.ceiling,
    });
  } catch {
    // A replan error must not roll back state.json or fail record-result.
  }
}

function skipped(
  reason: "pause" | "abort" | "passed" | "not_a_review_failure" | "ledger_missing" | "task_missing",
): ApplyReplanResult {
  return { ok: true, applied: false, reason, reviewFailuresDelta: 0 };
}

function fail(error: CommandPlaneErrorCode, message: string): ReplanFailure {
  return { ok: false, error, message, reviewFailuresDelta: 0 };
}

function failureCounts(input: {
  forgeStatus?: ReplanForgeStatus;
  reviewFailures?: number;
  ceiling?: number;
}):
  | { ok: true; failure: false }
  | { ok: true; failure: true; atCeiling: boolean; reviewFailures: number; ceiling: number }
  | ReplanFailure {
  const { forgeStatus, reviewFailures, ceiling } = input;
  if (forgeStatus !== "pending" && forgeStatus !== "in_progress" && forgeStatus !== "done" && forgeStatus !== "blocked") {
    return fail("INVALID_INPUT", "Forge status is missing.");
  }
  if (!Number.isInteger(reviewFailures) || reviewFailures === undefined || reviewFailures < 0) {
    return fail("INVALID_INPUT", "reviewFailures is invalid.");
  }
  if (!Number.isInteger(ceiling) || ceiling === undefined || ceiling < 1) {
    return fail("INVALID_INPUT", "Review ceiling is invalid.");
  }
  if (reviewFailures < 1 || forgeStatus === "done" || forgeStatus === "in_progress") {
    return { ok: true, failure: false };
  }
  if (forgeStatus === "blocked" && reviewFailures < ceiling) return { ok: true, failure: false };
  return { ok: true, failure: true, atCeiling: reviewFailures >= ceiling, reviewFailures, ceiling };
}

function cleanSubsteps(substeps: readonly string[] | undefined): string[] {
  if (!substeps) return [];
  return substeps.map((step) => step.trim()).filter((step) => step.length > 0);
}

function otherIdle(idleAgentIds: readonly string[], assigneeAgentId: string | null): string | null {
  return idleAgentIds.find((id) => id !== assigneeAgentId) ?? null;
}

async function openCeilingAsk(
  input: { hiveRoot: string; featureId: string; taskId: string },
  reviewFailures: number,
  ceiling: number,
  now: string,
): Promise<ApplyReplanResult> {
  const opened = await openAskMeItem({
    hiveRoot: input.hiveRoot,
    featureId: input.featureId,
    taskId: input.taskId,
    agentId: null,
    reasonClass: "repeated_review_failure",
    question: `Task ${input.taskId} reached ${reviewFailures} review failures at ceiling ${ceiling}.`,
    now,
  });
  if (!opened.ok) return fail(opened.error, opened.message);
  await appendEvent(input.hiveRoot, input.featureId, "task.failed", {
    taskId: input.taskId,
    reviewFailures,
    ceiling,
  }, now);
  await appendEvent(input.hiveRoot, input.featureId, "task.blocked", {
    taskId: input.taskId,
    askMeId: opened.item.id,
  }, now);
  return {
    ok: true,
    applied: true,
    action: "ask_me",
    reasonClass: "repeated_review_failure",
    askMeId: opened.item.id,
    created: opened.created,
    reviewFailures,
    reviewFailuresDelta: 0,
  };
}

async function writeReplan(
  input: { hiveRoot: string; featureId: string; taskId: string },
  reviewFailures: number,
  ceiling: number,
  substeps: string[],
  now: string,
): Promise<ApplyReplanResult> {
  const roster = await readRoster(input.hiveRoot);
  const ledgerPath = join(input.hiveRoot, "ledger", `${input.featureId}.json`);
  const locked = await withLock(
    join(input.hiveRoot, "locks", `ledger-${input.featureId}.lock`),
    { waitMs: LEDGER_LOCK_WAIT_MS },
    async () => planLocked(input, ledgerPath, roster, reviewFailures, ceiling, substeps, now),
  );
  if (!locked.ok) return fail(locked.code, "Ledger lock is busy.");
  const planned = locked.value;
  if (planned.ok && planned.applied && planned.action === "replan") {
    await appendEvent(input.hiveRoot, input.featureId, "task.failed", {
      taskId: input.taskId,
      reviewFailures,
      ceiling,
    }, now);
    await appendEvent(input.hiveRoot, input.featureId, "task.replanned", {
      taskId: input.taskId,
      kind: planned.kind,
      reviewFailures,
      ceiling,
      attempt: planned.attempt,
      fromAgentId: planned.fromAgentId,
      toAgentId: planned.toAgentId,
    }, now);
  }
  return planned;
}

async function planLocked(
  input: { hiveRoot: string; featureId: string; taskId: string },
  ledgerPath: string,
  roster: RosterAgent[],
  reviewFailures: number,
  ceiling: number,
  substeps: string[],
  now: string,
): Promise<ApplyReplanResult> {
  const loaded = await readLedger(ledgerPath);
  if (loaded === "missing") return skipped("ledger_missing");
  if (loaded === "corrupt") return fail("HIVE_CORRUPT", "Ledger is unreadable.");
  if (loaded.ledger.featureId !== input.featureId) return fail("FEATURE_NOT_FOUND", "Ledger feature does not match.");

  const index = loaded.ledger.tasks.findIndex((task) => task.id === input.taskId);
  if (index < 0) return skipped("task_missing");
  const task = loaded.ledger.tasks[index];
  if (!task) return skipped("task_missing");

  const idleAgentIds = roster.filter((agent) => agent.status === "idle").map((agent) => agent.id);
  const kind = replanKindForFailure({
    forgeStatus: "pending",
    reviewFailures,
    ceiling,
    assigneeAgentId: task.assigneeAgentId,
    idleAgentIds,
    substeps,
  });
  if (!kind) return skipped("not_a_review_failure");

  const fromAgentId = task.assigneeAgentId;
  const toAgentId = kind === "reassign" ? otherIdle(idleAgentIds, fromAgentId) : fromAgentId;
  if (kind === "reassign" && !toAgentId) return skipped("not_a_review_failure");

  const attempt = reviewFailures + 1;
  const routed = routeModel({
    complexity: task.complexity,
    role: "implementer",
    attempt,
    kind: task.kind,
  });
  const replan = {
    kind,
    ...(kind === "split" ? { substeps } : {}),
    reviewFailures,
    ceiling,
    attempt,
    fromAgentId,
    toAgentId,
  };
  const tasks = loaded.ledger.tasks.map((row, rowIndex) =>
    rowIndex === index
      ? {
          ...row,
          assigneeAgentId: kind === "reassign" && toAgentId ? toAgentId : row.assigneeAgentId,
          replan,
          updatedAt: now,
        }
      : row,
  );
  const parsed = HiveLedgerSchema.safeParse({ ...loaded.ledger, updatedAt: now, tasks });
  if (!parsed.success) return fail("HIVE_CORRUPT", "Replan ledger update is invalid.");
  await writeJsonAtomic(ledgerPath, parsed.data);

  return {
    ok: true,
    applied: true,
    action: "replan",
    kind,
    reviewFailures,
    ceiling,
    attempt,
    tier: routed.tier,
    fromAgentId,
    toAgentId,
    reviewFailuresDelta: 0,
    scopeAskMeId: null,
  };
}

async function readLedger(ledgerPath: string): Promise<{ ledger: HiveLedger } | "missing" | "corrupt"> {
  try {
    const parsed = HiveLedgerSchema.safeParse(JSON.parse(await readFile(ledgerPath, "utf8")));
    if (!parsed.success) return "corrupt";
    return { ledger: parsed.data };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "corrupt";
  }
}

async function readRoster(hiveRoot: string): Promise<RosterAgent[]> {
  try {
    const parsed = RosterAgentSchema.array().safeParse(JSON.parse(await readFile(join(hiveRoot, "roster.json"), "utf8")));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

async function requireHive(hiveRoot: string): Promise<{ ok: true } | ReplanFailure> {
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

function timestamp(now: string | undefined): { ok: true; value: string } | ReplanFailure {
  const value = now ?? new Date().toISOString();
  if (!isoTimestamp.safeParse(value).success) return fail("INVALID_INPUT", "Timestamp is invalid.");
  return { ok: true, value };
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
