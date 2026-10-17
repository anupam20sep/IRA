import type { DispatchContext, DispatchGate } from "../command-plane/hooks.js";
import { getBuiltinPreset, parseCustomEngineId } from "../engines/catalog.js";

export type SignalRung = {
  engineId: string;
  emitsTokenSignals: boolean;
};

export type SignalRungContext = {
  numericBudgetCapSet: boolean;
};

export type SignalRungSelection =
  | { rung: SignalRung }
  | { accepted: false; reason: "budget_unmetered_rung" };

/**
 * When a numeric budget cap is set, keep only rungs that emit token signals.
 * An unset cap leaves the ladder unfiltered.
 */
export function selectSignalCapableRung(
  candidates: readonly SignalRung[],
  ctx: SignalRungContext,
): SignalRungSelection {
  const eligible = ctx.numericBudgetCapSet
    ? candidates.filter((rung) => rung.emitsTokenSignals)
    : candidates;
  const rung = eligible[0];
  if (!rung) return { accepted: false, reason: "budget_unmetered_rung" };
  return { rung };
}

export type ReGateContext = DispatchContext & {
  estimatedUsd?: number;
  estimatedTokens?: number;
  sliceAActive?: boolean;
  engineRung?: "host" | "byok" | "local";
};

/**
 * Re-invoke the token gate on the engine and model a failover rung just selected.
 * Called by EngineHooks.dispatch before spawn or `{ accepted: true }`.
 */
export async function reGateBeforeSpawn(
  effectiveEngine: string,
  effectiveModel: string | null,
  ctx: ReGateContext,
): Promise<DispatchGate> {
  // hooks-impl loads slice-a, which loads dispatch, which loads this module.
  const [{ tokenHooksImpl }, { invokeTokenBeforeDispatchSafely }] = await Promise.all([
    import("./hooks-impl.js"),
    import("../command-plane/hooks.js"),
  ]);
  return invokeTokenBeforeDispatchSafely(() =>
    tokenHooksImpl.beforeDispatch!({
      ...ctx,
      engine: effectiveEngine,
      model: effectiveModel,
    } as DispatchContext & { engine: string; model: string | null }),
  );
}

/** P-006 catalog: builtin presets that list `tokens` in `emits`. Custom shells do not. */
export function catalogEmitsTokenSignals(engineId: string): boolean {
  const parsed = parseCustomEngineId(engineId);
  if (!parsed || parsed.kind === "custom") return false;
  return getBuiltinPreset(parsed.id)?.emits.includes("tokens") ?? false;
}
