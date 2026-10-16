import type { DispatchIntent } from "../command-plane/hooks.js";
import type { RosterAgent } from "../command-plane/types.js";
import { mapHarnessModel, type HarnessId } from "../harness-model-map.js";
import type { ModelTier } from "../model-router.js";
import { getBuiltinPreset, parseCustomEngineId } from "./catalog.js";
import type { CustomEngine, EngineId, LocalPackProfile } from "./types.js";

const TIERS: readonly ModelTier[] = ["economy", "standard", "frontier"];

export type ResolveDispatchModelOptions = {
  localPack?: LocalPackProfile | null;
  customEngine?: CustomEngine | null;
};

export type ResolveDispatchModelResult =
  | { ok: true; tier: ModelTier; vendorModel: string }
  | { ok: false; error: "MODEL_REJECTED"; acceptable: string[] };

function isTier(value: string): value is ModelTier {
  return (TIERS as readonly string[]).includes(value);
}

function parseTier(value: string | null | undefined): ModelTier | null {
  if (value && isTier(value)) return value;
  return null;
}

function normalizeEngineId(engineId: string): string {
  const parsed = parseCustomEngineId(engineId);
  if (parsed?.kind === "builtin") return parsed.id;
  return engineId;
}

function harnessForEngine(engineId: string): HarnessId | null {
  const id = normalizeEngineId(engineId);
  if (id === "claude") return "claude";
  if (id === "codex") return "codex";
  if (id === "cursor-agent") return "cursor";
  return null;
}

function isLocalPackEngine(engineId: string): boolean {
  const id = normalizeEngineId(engineId);
  return id === "opencode" || id === "crush" || id === "aider";
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function acceptableModels(
  engineId: string,
  options: ResolveDispatchModelOptions,
): string[] {
  const parsed = parseCustomEngineId(engineId);
  if (parsed?.kind === "custom") {
    const extras = options.customEngine?.model ? [options.customEngine.model] : [];
    return unique([...TIERS, ...extras]);
  }

  const builtinId = normalizeEngineId(engineId);
  const preset = getBuiltinPreset(builtinId as EngineId);
  const presetModels = preset?.models ?? [];
  const extras: string[] = [];

  const localPack = options.localPack;
  if (
    localPack &&
    (builtinId === "opencode" || builtinId === "crush") &&
    localPack.engineId === builtinId
  ) {
    extras.push(localPack.model);
    if (localPack.tiers) {
      extras.push(localPack.tiers.economy, localPack.tiers.standard, localPack.tiers.frontier);
    }
  }

  return unique([...TIERS, ...presetModels, ...extras]);
}

function resolveTier(intent: Pick<DispatchIntent, "tier">, rosterModel: string | null): ModelTier {
  const rosterTier = parseTier(rosterModel);
  if (rosterTier) return rosterTier;
  return parseTier(intent.tier) ?? "standard";
}

function vendorFromLocalPack(tier: ModelTier, localPack: LocalPackProfile): string {
  return localPack.tiers?.[tier] ?? localPack.model;
}

export function resolveDispatchModel(
  intent: Pick<DispatchIntent, "tier">,
  rosterRow: Pick<RosterAgent, "model">,
  effectiveEngineId: string,
  options: ResolveDispatchModelOptions = {},
): ResolveDispatchModelResult {
  const rosterModel = rosterRow.model ?? null;
  const tier = resolveTier(intent, rosterModel);

  if (rosterModel && !isTier(rosterModel)) {
    const acceptable = acceptableModels(effectiveEngineId, options);
    if (!acceptable.includes(rosterModel)) {
      return { ok: false, error: "MODEL_REJECTED", acceptable };
    }
    return { ok: true, tier, vendorModel: rosterModel };
  }

  const harness = harnessForEngine(effectiveEngineId);
  if (harness) {
    return { ok: true, tier, vendorModel: mapHarnessModel(tier, harness).slug };
  }

  if (isLocalPackEngine(effectiveEngineId)) {
    const builtinId = normalizeEngineId(effectiveEngineId);
    const localPack = options.localPack;
    if (
      localPack &&
      (builtinId === "opencode" || builtinId === "crush") &&
      localPack.engineId === builtinId
    ) {
      return { ok: true, tier, vendorModel: vendorFromLocalPack(tier, localPack) };
    }
    return { ok: true, tier, vendorModel: tier };
  }

  const parsed = parseCustomEngineId(effectiveEngineId);
  if (parsed?.kind === "custom") {
    const explicit = options.customEngine?.model?.trim();
    if (explicit) return { ok: true, tier, vendorModel: explicit };
    return { ok: true, tier, vendorModel: tier };
  }

  return { ok: true, tier, vendorModel: tier };
}
