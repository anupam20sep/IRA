import { basename } from "node:path";
import type { EngineHealthStatus } from "./types.js";

export type EngineStartRecord = {
  engineId: string;
  personaPath: string;
  at: string;
};

export type CrossEngineReviewContext = {
  crossEngineReview: boolean;
  personaPath: string;
  proposedEngineId: string;
  taskId: string;
  engineStarts: EngineStartRecord[];
  busyNonReviewerEngineId?: string | null;
  healthByEngineId: Record<string, { health: EngineHealthStatus }>;
};

export type CrossEngineReviewResult = {
  engineId: string;
  policyDegraded?: { reason: "single_healthy_engine" };
};

const REVIEW_ENGINE_ORDER = [
  "claude",
  "codex",
  "cursor-agent",
  "opencode",
  "crush",
  "aider",
] as const;

export function isReviewerPersona(personaPath: string): boolean {
  const base = basename(personaPath).replace(/\.md$/i, "");
  return base.includes("reviewer");
}

function isHealthyForReview(health: EngineHealthStatus | undefined): boolean {
  return health === "ok" || health === "degraded";
}

function latestImplementerEngineId(ctx: CrossEngineReviewContext): string | null {
  for (let i = ctx.engineStarts.length - 1; i >= 0; i--) {
    const start = ctx.engineStarts[i];
    if (!isReviewerPersona(start.personaPath)) {
      return start.engineId;
    }
  }
  return ctx.busyNonReviewerEngineId ?? null;
}

function listHealthyEngineIds(healthByEngineId: CrossEngineReviewContext["healthByEngineId"]): string[] {
  const known = new Set(Object.keys(healthByEngineId));
  const ordered: string[] = [];
  for (const id of REVIEW_ENGINE_ORDER) {
    if (known.has(id) && isHealthyForReview(healthByEngineId[id]?.health)) {
      ordered.push(id);
    }
  }
  for (const id of [...known].sort()) {
    if (ordered.includes(id)) continue;
    if (isHealthyForReview(healthByEngineId[id]?.health)) {
      ordered.push(id);
    }
  }
  return ordered;
}

function pickAlternateEngine(
  implementerEngineId: string,
  healthByEngineId: CrossEngineReviewContext["healthByEngineId"],
): string | null {
  const healthy = listHealthyEngineIds(healthByEngineId);
  return healthy.find((id) => id !== implementerEngineId) ?? null;
}

export function applyCrossEngineReview(ctx: CrossEngineReviewContext): CrossEngineReviewResult {
  const { proposedEngineId } = ctx;
  if (!ctx.crossEngineReview || !isReviewerPersona(ctx.personaPath)) {
    return { engineId: proposedEngineId };
  }

  const implementerEngineId = latestImplementerEngineId(ctx);
  if (implementerEngineId === null) {
    return { engineId: proposedEngineId };
  }

  if (proposedEngineId !== implementerEngineId) {
    return { engineId: proposedEngineId };
  }

  const alternate = pickAlternateEngine(implementerEngineId, ctx.healthByEngineId);
  if (alternate) {
    return { engineId: alternate };
  }

  return {
    engineId: proposedEngineId,
    policyDegraded: { reason: "single_healthy_engine" },
  };
}
