import { registerCommandPlaneHooks } from "../command-plane/hooks.js";
import { createLearningHooks } from "./hooks.js";
import { registerPatternsDoctorProbes, type PatternsDoctorInstallCtx } from "./slice-gate.js";

export type LearningMemoryInstallOpts = {
  projectRoot?: string;
  /** When set, registers pattern-store doctor probes (OD-016). */
  doctor?: PatternsDoctorInstallCtx;
};

/** Register P-001 learning hooks and optional pattern-store doctor probes. */
export function installLearningMemory(opts: LearningMemoryInstallOpts): void {
  if (opts.projectRoot) {
    registerCommandPlaneHooks({ learning: createLearningHooks(opts.projectRoot) });
  }
  if (opts.doctor) {
    registerPatternsDoctorProbes(opts.doctor);
  }
}
