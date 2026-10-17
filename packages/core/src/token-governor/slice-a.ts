import { readSliceAValidated } from "../engines/dispatch.js";

/** Slice A denial shape used by token governor before full DispatchGate mapping (OD-020). */
export type SliceADispatchGate =
  | { allow: true }
  | { allow: false; reason: "SLICE_A_ONLY" };

export type SliceAGuardContext = {
  engineRung: "host" | "byok" | "local";
  /** When set, skips doctor lookup (tests and callers that already resolved hive state). */
  sliceAActive?: boolean;
};

export type SliceAGuardOptions = {
  sliceAActive?: boolean;
};

/** True while doctor has not yet reported sliceAValidated for this hive. */
export async function isSliceAActive(hiveRoot: string): Promise<boolean> {
  return !(await readSliceAValidated(hiveRoot));
}

/**
 * Live beforeDispatch gate during Slice A: host allow without ledger IO;
 * deny byok/local supervisor rungs with SLICE_A_ONLY.
 */
export function sliceABeforeDispatchGate(ctx: SliceAGuardContext): SliceADispatchGate {
  if (!ctx.sliceAActive) return { allow: true };
  if (ctx.engineRung === "host") return { allow: true };
  return { allow: false, reason: "SLICE_A_ONLY" };
}

/** Short-circuits spend, breaker, and compaction writes while Slice A is active. */
export async function guardSideEffectWrite<T>(
  hiveRoot: string,
  writeFn: () => Promise<T>,
  options?: SliceAGuardOptions,
): Promise<T | { ok: false; code: "SLICE_A_ONLY" }> {
  const active = options?.sliceAActive ?? (await isSliceAActive(hiveRoot));
  if (active) return { ok: false, code: "SLICE_A_ONLY" };
  return writeFn();
}
