import type { Complexity, TaskKind } from "./types.js";

/** Capability tier for implementer/reviewer dispatch — not latency or a vendor model id. */
export type ModelTier = "economy" | "standard" | "frontier";

/** @deprecated Prefer ModelTier. Kept for MCP shim: economy→fast; standard|frontier→strong */
export type ModelClass = "strong" | "fast";

export type RouteRole = "implementer" | "reviewer";

export interface RouteModelInput {
  complexity: Complexity;
  role?: RouteRole;
  /** 1-based attempt; reviewFailures+1 on retry. Default 1. */
  attempt?: number;
  kind?: TaskKind;
}

export interface RouteModelResult {
  tier: ModelTier;
  role: RouteRole;
  attempt: number;
  /** Compatibility shim for older skills that read `.model`. */
  model: ModelClass;
  meaning: string;
  rule: string;
  /** Single-line JUDGE hint. Omitted when route-model has no task context or no match. */
  patternHint?: string;
  /** Ids included in `patternHint`. Omitted together with `patternHint`. */
  patternIds?: string[];
}

const MEANING =
  "Abstract capability tier for implementer/reviewer — not latency, schedule priority, or a vendor model id.";

const RULE =
  "implementer attempt1: mechanical→economy; moderate→standard; complex→frontier. " +
  "attempt2 floor standard; attempt3+ frontier. reviewer ≥ implementer tier. " +
  "kind: verify/doc-sync cap ≤standard; signoff reviewer floor ≥standard. " +
  "shim: economy→fast; standard|frontier→strong.";

function tierToShim(tier: ModelTier): ModelClass {
  return tier === "economy" ? "fast" : "strong";
}

function baseTier(complexity: Complexity): ModelTier {
  if (complexity === "complex") return "frontier";
  if (complexity === "moderate") return "standard";
  return "economy";
}

function applyAttemptFloor(tier: ModelTier, attempt: number): ModelTier {
  if (attempt >= 3) return "frontier";
  if (attempt >= 2) {
    if (tier === "economy") return "standard";
    return tier;
  }
  return tier;
}

function applyKindBias(
  tier: ModelTier,
  role: RouteRole,
  kind: TaskKind | undefined,
): ModelTier {
  if (!kind) return tier;
  if (role === "implementer" && (kind === "verify" || kind === "doc-sync")) {
    if (tier === "frontier") return "standard";
  }
  if (role === "reviewer" && kind === "signoff") {
    if (tier === "economy") return "standard";
  }
  return tier;
}

function maxTier(a: ModelTier, b: ModelTier): ModelTier {
  const order: ModelTier[] = ["economy", "standard", "frontier"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))]!;
}

/**
 * Recommend an abstract model tier from task complexity, role, and attempt.
 * Thinking intensity is harness-owned (see mapHarnessModel).
 */
export function routeModel(input: RouteModelInput | Pick<{ complexity: Complexity }, "complexity">): RouteModelResult {
  const complexity = input.complexity;
  const role: RouteRole = "role" in input && input.role ? input.role : "implementer";
  const attempt = Math.max(1, "attempt" in input && input.attempt ? Number(input.attempt) : 1);
  const kind = "kind" in input ? input.kind : undefined;

  let tier = baseTier(complexity);
  tier = applyAttemptFloor(tier, attempt);
  tier = applyKindBias(tier, role, kind);

  if (role === "reviewer") {
    // Reviewer never below implementer floor for this attempt; for attempt 1
    // implementer and reviewer share the same base map (economy/standard/frontier).
    const implementerFloor = applyKindBias(
      applyAttemptFloor(baseTier(complexity), attempt),
      "implementer",
      kind,
    );
    tier = maxTier(tier, implementerFloor);
  }

  return {
    tier,
    role,
    attempt,
    model: tierToShim(tier),
    meaning: MEANING,
    rule: RULE,
  };
}

/** @deprecated Use routeModel(...).tier; kept for call sites that expect ModelClass. */
export function routeModelClass(task: Pick<{ complexity: Complexity }, "complexity">): ModelClass {
  return routeModel(task).model;
}

/**
 * Attach a JUDGE hint without changing tier selection.
 * A null hint leaves the route object unchanged so existing consumers see no new keys.
 */
export function applyPatternHint(
  routed: RouteModelResult,
  hint: { patternHint: string; patternIds: string[] } | null,
): RouteModelResult {
  if (!hint || hint.patternIds.length === 0 || hint.patternHint.trim().length === 0) return routed;
  return {
    ...routed,
    patternHint: hint.patternHint,
    patternIds: hint.patternIds,
  };
}
