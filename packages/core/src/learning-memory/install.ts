import { registerPatternsDoctorProbes, type PatternsDoctorInstallCtx } from "./slice-gate.js";

export type LearningMemoryInstallOpts = {
  /** When set, registers pattern-store doctor probes (full hive wiring in T013). */
  doctor?: PatternsDoctorInstallCtx;
};

/** Stub install entry: doctor probe registration until hooks pipeline lands (T013). */
export function installLearningMemory(opts: LearningMemoryInstallOpts): void {
  if (opts.doctor) {
    registerPatternsDoctorProbes(opts.doctor);
  }
}
