export { installLearningMemory, type LearningMemoryInstallOpts } from "./install.js";
export { createLearningHooks } from "./hooks.js";
export { listPatterns } from "./query.js";
export { reindexFromMarkdown } from "./pattern-index.js";
export {
  DEFAULT_DISTILL_TIMEOUT_MS,
  runConsolidateAfterDistill,
  runDistillAfterResult,
  runRetrieveForTask,
  scheduleLearningAfterRecordResult,
  type DistillPipelineOptions,
  type LearningStore,
  type ScheduleLearningDeps,
} from "./pipeline.js";
