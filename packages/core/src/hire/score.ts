import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { IraEventSchema } from "../command-plane/schema.js";
import {
  EVENT_LOCK_WAIT_MS,
  LEDGER_LOCK_WAIT_MS,
  appendJsonlLine,
  withLock,
  writeJsonAtomic,
} from "../command-plane/store.js";
import type { DistillContext } from "../command-plane/hooks.js";
import { HireScoreSchema } from "./schema.js";
import type { HireScore } from "./types.js";

export const DEFAULT_DEMOTION_THRESHOLD = 40;

const SCORE_LOCK_NAME = "ledger-hire-scores.lock";

export type HireScoreComputeInput = {
  passRate: number;
  reviewFailures: number;
  spendUsd?: number;
  spendTokens?: number;
  budgetUsd?: number | null;
  budgetTokens?: number | null;
  tasksCompleted?: number;
  demotionThreshold?: number;
};

/** Incremental updates may omit passRate/reviewFailures when taskOutcome is provided. */
export type HireScoreSignals = Partial<HireScoreComputeInput> & {
  taskOutcome?: { passed: boolean; reviewFailures?: number };
};

type StoredHireScore = HireScore & {
  tasksCompleted?: number;
  tasksPassed?: number;
};

export function computeHireScore(input: HireScoreComputeInput): Omit<HireScore, "agentId" | "updatedAt"> {
  const passRate = clamp01(input.passRate);
  const reviewFailures = Math.max(0, input.reviewFailures);
  const spendUsd = Math.max(0, input.spendUsd ?? 0);
  const spendTokens = Math.max(0, input.spendTokens ?? 0);
  const tasksCompleted = Math.max(1, input.tasksCompleted ?? Math.max(reviewFailures, 1));
  const reviewFailureRate = Math.min(1, reviewFailures / tasksCompleted);
  const penaltyOverBudget = budgetPenalty(spendUsd, input.budgetUsd) + budgetPenalty(spendTokens, input.budgetTokens);
  const rawScore = 100 * passRate - 10 * reviewFailureRate - penaltyOverBudget;
  const score = clampScore(rawScore);
  const threshold = input.demotionThreshold ?? DEFAULT_DEMOTION_THRESHOLD;
  const demotionReasons = demotionReasonsFor({
    score,
    threshold,
    passRate,
    reviewFailureRate,
    spendUsd,
    spendTokens,
    budgetUsd: input.budgetUsd,
    budgetTokens: input.budgetTokens,
  });

  return {
    passRate,
    reviewFailures,
    spendUsd,
    spendTokens,
    score,
    demotionHint: score < threshold,
    demotionReasons,
  };
}

export async function loadHireScore(hiveRoot: string, agentId: string): Promise<HireScore | null> {
  const stored = await readStored(hiveRoot, agentId);
  if (!stored) return null;
  return stripRollingFields(stored);
}

export async function updateHireScore(
  hiveRoot: string,
  agentId: string,
  signals: HireScoreSignals,
): Promise<HireScore> {
  await ensureScoreDirs(hiveRoot);
  const lockPath = scoreLockPath(hiveRoot);
  const result = await withLock(lockPath, { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    const prior = await readStored(hiveRoot, agentId);
    const merged = mergeSignals(prior, signals);
    const computed = computeHireScore(merged);
    const stored: StoredHireScore = {
      agentId,
      ...computed,
      updatedAt: new Date().toISOString(),
      tasksCompleted: merged.tasksCompleted,
      tasksPassed: merged.tasksPassed,
    };
    await writeJsonAtomic(scoreFile(hiveRoot, agentId), stored);
    await appendScoreUpdatedEvent(hiveRoot, stored);
    return stripRollingFields(stored);
  });
  if (!result.ok) {
    throw new Error(`Hire score store busy (${result.code}).`);
  }
  return result.value;
}

/** Optional hook body for P-001 `onRecordResult` wiring (hints only; no roster writes). */
export async function onHireScoreRecordResult(
  hiveRoot: string,
  ctx: DistillContext & { agentId: string | null; spendUsd?: number; budgetUsd?: number | null },
): Promise<HireScore | null> {
  if (!ctx.agentId) return null;
  return updateHireScore(hiveRoot, ctx.agentId, {
    taskOutcome: { passed: ctx.passed, reviewFailures: ctx.reviewFailures },
    spendUsd: ctx.spendUsd,
    budgetUsd: ctx.budgetUsd,
  });
}

/** Tail hive events for `task.completed` / `task.failed` assignee updates (read-only). */
export async function syncHireScoresFromTaskEvents(
  hiveRoot: string,
  events: readonly { type: string; data?: Record<string, unknown> }[],
): Promise<HireScore[]> {
  const updated: HireScore[] = [];
  for (const event of events) {
    if (event.type !== "task.completed" && event.type !== "task.failed") continue;
    const agentId = typeof event.data?.assigneeAgentId === "string" ? event.data.assigneeAgentId : null;
    if (!agentId) continue;
    const passed = event.type === "task.completed";
    const reviewFailures =
      typeof event.data?.reviewFailures === "number" && Number.isFinite(event.data.reviewFailures)
        ? event.data.reviewFailures
        : 0;
    const spendUsd =
      typeof event.data?.spendUsd === "number" && Number.isFinite(event.data.spendUsd)
        ? event.data.spendUsd
        : undefined;
    const budgetUsd =
      typeof event.data?.budgetUsd === "number" && Number.isFinite(event.data.budgetUsd)
        ? event.data.budgetUsd
        : null;
    updated.push(
      await updateHireScore(hiveRoot, agentId, {
        taskOutcome: { passed, reviewFailures },
        spendUsd,
        budgetUsd,
      }),
    );
  }
  return updated;
}

function mergeSignals(prior: StoredHireScore | null, signals: HireScoreSignals): HireScoreComputeInput & {
  tasksCompleted: number;
  tasksPassed: number;
} {
  let tasksCompleted = prior?.tasksCompleted ?? 0;
  let tasksPassed = prior?.tasksPassed ?? 0;
  let reviewFailures = signals.reviewFailures ?? prior?.reviewFailures ?? 0;
  let spendUsd = signals.spendUsd ?? prior?.spendUsd ?? 0;
  let spendTokens = signals.spendTokens ?? prior?.spendTokens ?? 0;

  if (signals.taskOutcome) {
    tasksCompleted += 1;
    if (signals.taskOutcome.passed) tasksPassed += 1;
    if (typeof signals.taskOutcome.reviewFailures === "number") {
      reviewFailures = Math.max(reviewFailures, signals.taskOutcome.reviewFailures);
    }
  } else if (typeof signals.tasksCompleted === "number") {
    tasksCompleted = signals.tasksCompleted;
    tasksPassed = Math.round(clamp01(signals.passRate ?? prior?.passRate ?? 0) * tasksCompleted);
  } else if (typeof signals.passRate === "number" && prior) {
    tasksCompleted = Math.max(tasksCompleted, 1);
    tasksPassed = Math.round(clamp01(signals.passRate) * tasksCompleted);
  }

  if (tasksCompleted === 0 && prior) {
    tasksCompleted = prior.tasksCompleted ?? 1;
    tasksPassed = prior.tasksPassed ?? Math.round(prior.passRate * tasksCompleted);
  }

  const passRate =
    typeof signals.passRate === "number" && !signals.taskOutcome
      ? clamp01(signals.passRate)
      : tasksCompleted > 0
        ? tasksPassed / tasksCompleted
        : clamp01(signals.passRate ?? prior?.passRate ?? 0);

  return {
    passRate,
    reviewFailures,
    spendUsd,
    spendTokens,
    budgetUsd: signals.budgetUsd ?? null,
    budgetTokens: signals.budgetTokens ?? null,
    tasksCompleted: Math.max(tasksCompleted, 1),
    tasksPassed,
    demotionThreshold: signals.demotionThreshold,
  };
}

function budgetPenalty(spend: number, budget: number | null | undefined): number {
  if (budget == null || budget <= 0 || spend <= budget) return 0;
  const overRatio = (spend - budget) / budget;
  return Math.min(30, overRatio * 20);
}

function demotionReasonsFor(input: {
  score: number;
  threshold: number;
  passRate: number;
  reviewFailureRate: number;
  spendUsd: number;
  spendTokens: number;
  budgetUsd: number | null | undefined;
  budgetTokens: number | null | undefined;
}): string[] {
  if (input.score >= input.threshold) return [];
  const reasons: string[] = [];
  if (input.passRate < 0.5) reasons.push("Pass rate is below 50%.");
  if (input.reviewFailureRate > 0.2) reasons.push("Review failure rate is elevated.");
  if (budgetPenalty(input.spendUsd, input.budgetUsd) > 0) reasons.push("Spend exceeds USD budget.");
  if (budgetPenalty(input.spendTokens, input.budgetTokens) > 0) reasons.push("Spend exceeds token budget.");
  if (reasons.length === 0) reasons.push("Overall hire score is below the demotion threshold.");
  return reasons;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function stripRollingFields(stored: StoredHireScore): HireScore {
  return HireScoreSchema.parse(stored);
}

async function readStored(hiveRoot: string, agentId: string): Promise<StoredHireScore | null> {
  try {
    const text = await readFile(scoreFile(hiveRoot, agentId), "utf8");
    const raw = JSON.parse(text) as Record<string, unknown>;
    const score = HireScoreSchema.parse(raw);
    return {
      ...score,
      tasksCompleted: typeof raw.tasksCompleted === "number" ? raw.tasksCompleted : undefined,
      tasksPassed: typeof raw.tasksPassed === "number" ? raw.tasksPassed : undefined,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function ensureScoreDirs(hiveRoot: string): Promise<void> {
  await mkdir(join(hiveRoot, "locks"), { recursive: true, mode: 0o700 });
  await mkdir(join(hiveRoot, "hire", "scores"), { recursive: true, mode: 0o700 });
}

function scoreLockPath(hiveRoot: string): string {
  return join(hiveRoot, "locks", SCORE_LOCK_NAME);
}

function scoreFile(hiveRoot: string, agentId: string): string {
  return join(hiveRoot, "hire", "scores", `${agentId}.json`);
}

async function appendScoreUpdatedEvent(hiveRoot: string, score: HireScore): Promise<void> {
  const eventsPath = join(hiveRoot, "events", "events.jsonl");
  try {
    await mkdir(join(hiveRoot, "events"), { recursive: true, mode: 0o700 });
  } catch {
    return;
  }

  const parsed = IraEventSchema.safeParse({
    id: `evt_${randomUUID()}`,
    type: "hire.score_updated",
    version: 1,
    ts: score.updatedAt,
    featureId: null,
    actor: { kind: "ira", id: "ira" },
    data: {
      agentId: score.agentId,
      score: String(score.score),
      demotionHint: String(score.demotionHint),
    },
  });
  if (!parsed.success) return;

  const lockPath = join(hiveRoot, "locks", "events.lock");
  await withLock(lockPath, { waitMs: EVENT_LOCK_WAIT_MS }, async () => {
    await appendJsonlLine(eventsPath, parsed.data);
  });
}
