import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonlLine } from "../command-plane/store.js";
import { routeModel, type ModelTier, type RouteModelInput } from "../model-router.js";
import { TierOverrideSchema, TokenSettingsSchema } from "./schema.js";
import type { RoutingHint, TierOverride, TokenSettings } from "./types.js";

export type BuildRouteModelResponseArgs = RouteModelInput & {
  quotaRemainingPercent?: number;
  settings?: Pick<TokenSettings, "lowQuotaPercent">;
  operatorOverrideTier?: ModelTier;
};

export type BuildRouteModelResponseResult = {
  tier: ModelTier;
  routingHint?: RoutingHint;
  quotaApplied: boolean;
  overrideApplied: boolean;
};

export type RecordTierOverrideInput = {
  agentId: string;
  featureId?: string | null;
  requestedTier: ModelTier;
  reason: string;
} & Pick<RouteModelInput, "complexity" | "attempt" | "role" | "kind">;

function tierOverridesPath(hiveRoot: string): string {
  return join(hiveRoot, "token", "tier-overrides.jsonl");
}

function lowQuotaThreshold(settings?: Pick<TokenSettings, "lowQuotaPercent">): number {
  if (settings?.lowQuotaPercent !== undefined) return settings.lowQuotaPercent;
  return TokenSettingsSchema.parse({ schemaVersion: 1 }).lowQuotaPercent;
}

function isLowQuota(remainingPercent: number, threshold: number): boolean {
  return remainingPercent <= threshold;
}

/**
 * Wraps unchanged `routeModel()` with optional quota hints and operator tier override.
 * Never emits a tier outside economy | standard | frontier.
 */
export function buildRouteModelResponse(args: BuildRouteModelResponseArgs): BuildRouteModelResponseResult {
  const { quotaRemainingPercent, settings, operatorOverrideTier, ...routeInput } = args;
  const routed = routeModel(routeInput);

  let routingHint: RoutingHint | undefined;
  let quotaApplied = false;
  let overrideApplied = false;
  let tier = routed.tier;

  if (operatorOverrideTier !== undefined) {
    tier = operatorOverrideTier;
    overrideApplied = true;
    routingHint = {
      preferredTier: operatorOverrideTier,
      preferLocalEngine: false,
      reason: "operator_override",
    };
  }

  if (quotaRemainingPercent !== undefined) {
    const threshold = lowQuotaThreshold(settings);
    if (isLowQuota(quotaRemainingPercent, threshold)) {
      quotaApplied = true;
      if (!overrideApplied) {
        routingHint = {
          preferredTier: "economy",
          preferLocalEngine: false,
          reason: "low_quota",
        };
      }
    }
  }

  return { tier, routingHint, quotaApplied, overrideApplied };
}

/** Append-only audit log when Command Plane assigns a tier different from route-model. */
export async function recordTierOverride(
  hiveRoot: string,
  input: RecordTierOverrideInput,
): Promise<TierOverride> {
  const { agentId, featureId, requestedTier, reason, ...routeInput } = input;
  const routeModelTier = routeModel(routeInput).tier;
  const record = TierOverrideSchema.parse({
    id: `ovr_${randomUUID()}`,
    ts: new Date().toISOString(),
    agentId,
    featureId: featureId ?? null,
    requestedTier,
    routeModelTier,
    reason,
    actor: "operator" as const,
  });
  await mkdir(join(hiveRoot, "token"), { recursive: true });
  await appendJsonlLine(tierOverridesPath(hiveRoot), record);
  return record;
}
