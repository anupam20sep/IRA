import type { DoctorFinding } from "../command-plane/doctor.js";

export type PatternWriteGateSnapshot = {
  sliceAValidated: boolean;
};

export type PatternWriteGateResult =
  | { allowed: true }
  | { allowed: false; code: "SLICE_A_ONLY" };

/** Gates distill/consolidate pattern writes until Slice A doctor checks pass (OD-020). */
export function resolvePatternWriteGate(
  snapshot: PatternWriteGateSnapshot,
): PatternWriteGateResult {
  if (snapshot.sliceAValidated) return { allowed: true };
  return { allowed: false, code: "SLICE_A_ONLY" };
}

export type PatternsDoctorInstallCtx = {
  indexAvailable: boolean;
  pushFinding: (finding: DoctorFinding) => void;
};

const PATTERNS_INDEX_UNAVAILABLE: DoctorFinding = {
  code: "PATTERNS_INDEX_UNAVAILABLE",
  severity: "warning",
  message: "Pattern FTS index is unavailable; RETRIEVE uses capped markdown scan.",
  remedy: "Install better-sqlite3 or run superspec patterns reindex when SQLite is available.",
};

/** Registers optional doctor warnings when the pattern index cannot load (OD-016 stub). */
export function registerPatternsDoctorProbes(installCtx: PatternsDoctorInstallCtx): void {
  if (installCtx.indexAvailable) return;
  installCtx.pushFinding(PATTERNS_INDEX_UNAVAILABLE);
}
