/**
 * Dispatch-boundary failover: subscription → BYOK → local.
 * Does not rewrite the stored roster preference and does not spawn.
 */

import type { AskMeReasonClass } from "../command-plane/types.js";
import { getBuiltinPreset, listBuiltinPresets, parseCustomEngineId } from "./catalog.js";
import type { AuthMode, EngineHealthStatus, HitlReasonClass, LadderRung } from "./types.js";

const DEFAULT_HITL: readonly HitlReasonClass[] = ["budget_exceed", "destructive_git"];

const FAILOVER_REASONS = [
  "rate_limited",
  "quota_exhausted",
  "missing",
  "unauthorized",
  "context_below_floor",
  "model_rejected",
  "spawn_failed",
  "adapter_crash",
  "unknown",
] as const;

const BLOCKING_REASONS = new Set<string>([
  "rate_limited",
  "quota_exhausted",
  "missing",
  "unauthorized",
  "context_below_floor",
]);

export type FailoverReasonClass = (typeof FAILOVER_REASONS)[number];

export type FailoverHealthSnap = {
  health: EngineHealthStatus;
  authMode: AuthMode;
  reasonClass?: string | null;
};

export type FailoverBeforeDispatchInput = {
  engineId: string;
  model: string | null;
  budgetTokens: number | null;
  budgetUsd: number | null;
};

export type FailoverBeforeDispatch = (
  input: FailoverBeforeDispatchInput,
) => { allow: true } | { allow: false; reasonClass: AskMeReasonClass; detail?: string };

export type FailoverContext = {
  preferredEngineId: string;
  health: Record<string, FailoverHealthSnap>;
  policy: {
    failoverEnabled: boolean;
    ladder: readonly LadderRung[];
    hitl?: readonly HitlReasonClass[];
    quotaGroups?: readonly (readonly string[])[];
  };
  localGateOk: boolean;
  budgetTokens?: number | null;
  budgetUsd?: number | null;
  model?: string | null;
  tier?: string;
  agentId?: string;
  taskId?: string;
  /** Omitted means this call is a fresh dispatch. `false` is mid-turn and is refused. */
  freshSubagent?: boolean;
  criticalClass?: HitlReasonClass;
  beforeDispatch?: FailoverBeforeDispatch;
};

export type FailoverEvent = {
  type: "engine.failover";
  data: {
    agentId: string | null;
    taskId: string | null;
    fromEngine: string;
    toEngine: string;
    reasonClass: FailoverReasonClass;
    rung: LadderRung;
  };
};

export type FailoverDecision = {
  accepted: boolean;
  engineId?: string;
  model?: string | null;
  tier?: string;
  failoverEvent?: FailoverEvent;
  askMe?: { reasonClass: AskMeReasonClass; question: string };
  doctorCode?: "ENGINE_NONE_HEALTHY";
  reason?: "budget_unmetered_rung" | "INVALID_INPUT" | "HOOK_FAILED_CLOSED";
};

export function selectEffectiveEngine(ctx: FailoverContext): FailoverDecision {
  if (ctx.freshSubagent === false) {
    return { accepted: false, reason: "INVALID_INPUT" };
  }

  const preferred = ctx.health[ctx.preferredEngineId];
  if (isUsablePreference(preferred, ctx.localGateOk)) {
    return { accepted: true, engineId: ctx.preferredEngineId, ...routeFields(ctx) };
  }

  if (!ctx.policy.failoverEnabled) {
    return noneHealthy(ctx);
  }

  const laterRungs = rungsAfter(ctx.policy.ladder, preferredRung(ctx.preferredEngineId, preferred));
  const numericBudget = hasNumericBudget(ctx);
  const hitl = ctx.policy.hitl ?? DEFAULT_HITL;
  let sawUnmetered = false;

  for (const rung of laterRungs) {
    for (const engineId of enginesOnRung(rung, ctx.health)) {
      if (engineId === ctx.preferredEngineId) continue;
      const row = ctx.health[engineId];
      if (!isAutoCandidate(row, rung, ctx.localGateOk)) continue;
      if (sharesExhaustedQuota(engineId, ctx.health, ctx.policy.quotaGroups ?? [])) continue;
      if (numericBudget && !emitsTokens(engineId)) {
        sawUnmetered = true;
        continue;
      }
      if (ctx.criticalClass && hitl.includes(ctx.criticalClass)) {
        return {
          accepted: false,
          askMe: {
            reasonClass: ctx.criticalClass,
            question: `Failover would enter ${ctx.criticalClass} and was not applied.`,
          },
        };
      }
      return acceptFailover(ctx, engineId, rung, reasonForLeaving(preferred));
    }
  }

  if (sawUnmetered) {
    return { accepted: false, reason: "budget_unmetered_rung" };
  }
  return noneHealthy(ctx);
}

function acceptFailover(
  ctx: FailoverContext,
  engineId: string,
  rung: LadderRung,
  reasonClass: FailoverReasonClass,
): FailoverDecision {
  const input: FailoverBeforeDispatchInput = {
    engineId,
    model: ctx.model ?? null,
    budgetTokens: ctx.budgetTokens ?? null,
    budgetUsd: ctx.budgetUsd ?? null,
  };

  if (ctx.beforeDispatch) {
    let gate: ReturnType<FailoverBeforeDispatch>;
    try {
      gate = ctx.beforeDispatch(input);
    } catch {
      return {
        accepted: false,
        reason: "HOOK_FAILED_CLOSED",
        askMe: {
          reasonClass: "budget_exceed",
          question: "Failover needs confirmation (budget_exceed). HOOK_FAILED_CLOSED",
        },
      };
    }
    if (!gate.allow) {
      return {
        accepted: false,
        askMe: {
          reasonClass: gate.reasonClass,
          question: `Failover needs confirmation (${gate.reasonClass}).${gate.detail ? ` ${gate.detail}` : ""}`,
        },
      };
    }
  }

  return {
    accepted: true,
    engineId,
    ...routeFields(ctx),
    failoverEvent: {
      type: "engine.failover",
      data: {
        agentId: ctx.agentId ?? null,
        taskId: ctx.taskId ?? null,
        fromEngine: ctx.preferredEngineId,
        toEngine: engineId,
        reasonClass,
        rung,
      },
    },
  };
}

function noneHealthy(ctx: FailoverContext): FailoverDecision {
  const rungs = ctx.policy.ladder.join(", ");
  return {
    accepted: false,
    doctorCode: "ENGINE_NONE_HEALTHY",
    askMe: {
      reasonClass: "ambiguous_requirement",
      question: `No healthy engine on ${rungs}. Install a CLI, log in, or choose a model.`,
    },
  };
}

function routeFields(ctx: FailoverContext): { model?: string | null; tier?: string } {
  const fields: { model?: string | null; tier?: string } = {};
  if ("model" in ctx) fields.model = ctx.model ?? null;
  if ("tier" in ctx) fields.tier = ctx.tier;
  return fields;
}

function hasNumericBudget(ctx: FailoverContext): boolean {
  return typeof ctx.budgetTokens === "number" || typeof ctx.budgetUsd === "number";
}

function isLadderRung(mode: AuthMode | undefined): mode is LadderRung {
  return mode === "subscription" || mode === "byok" || mode === "local";
}

function preferredRung(engineId: string, row: FailoverHealthSnap | undefined): LadderRung | null {
  if (row && isLadderRung(row.authMode)) return row.authMode;
  const parsed = parseCustomEngineId(engineId);
  if (!parsed) return null;
  if (parsed.kind === "custom") return "byok";
  return getBuiltinPreset(parsed.id)?.rung ?? null;
}

/** Rungs strictly below the preferred rung. Same-rung peers are not a ladder move. */
function rungsAfter(ladder: readonly LadderRung[], rung: LadderRung | null): LadderRung[] {
  if (!rung) return [...ladder];
  const index = ladder.indexOf(rung);
  if (index < 0) return [...ladder];
  return ladder.slice(index + 1);
}

function enginesOnRung(rung: LadderRung, health: Record<string, FailoverHealthSnap>): string[] {
  const ordered: string[] = [];
  for (const preset of listBuiltinPresets()) {
    if (health[preset.engineId]?.authMode === rung) ordered.push(preset.engineId);
  }
  const seen = new Set(ordered);
  const customIds = Object.keys(health)
    .filter((id) => !seen.has(id) && parseCustomEngineId(id)?.kind === "custom")
    .sort();
  for (const id of customIds) {
    if (health[id]?.authMode === rung) ordered.push(id);
  }
  return ordered;
}

function isUsablePreference(row: FailoverHealthSnap | undefined, localGateOk: boolean): boolean {
  if (!row || row.health !== "ok") return false;
  if (row.reasonClass && BLOCKING_REASONS.has(row.reasonClass)) return false;
  if (row.authMode === "local" && !localGateOk) return false;
  return true;
}

function isAutoCandidate(
  row: FailoverHealthSnap | undefined,
  rung: LadderRung,
  localGateOk: boolean,
): boolean {
  if (!row || row.health !== "ok") return false;
  if (row.authMode !== rung) return false;
  if (row.reasonClass && BLOCKING_REASONS.has(row.reasonClass)) return false;
  if (rung === "local" && !localGateOk) return false;
  return true;
}

function sharesExhaustedQuota(
  engineId: string,
  health: Record<string, FailoverHealthSnap>,
  groups: readonly (readonly string[])[],
): boolean {
  for (const group of groups) {
    if (group.length < 2 || !group.includes(engineId)) continue;
    for (const member of group) {
      const reason = health[member]?.reasonClass;
      if (reason === "rate_limited" || reason === "quota_exhausted") return true;
    }
  }
  return false;
}

function emitsTokens(engineId: string): boolean {
  const parsed = parseCustomEngineId(engineId);
  if (!parsed || parsed.kind === "custom") return false;
  return getBuiltinPreset(parsed.id)?.emits.includes("tokens") ?? false;
}

function reasonForLeaving(row: FailoverHealthSnap | undefined): FailoverReasonClass {
  if (row?.reasonClass && isFailoverReason(row.reasonClass)) return row.reasonClass;
  if (!row || row.health === "missing") return "missing";
  if (row.health === "unauthorized") return "unauthorized";
  if (row.authMode === "local") return "context_below_floor";
  return "unknown";
}

function isFailoverReason(value: string): value is FailoverReasonClass {
  return (FAILOVER_REASONS as readonly string[]).includes(value);
}
