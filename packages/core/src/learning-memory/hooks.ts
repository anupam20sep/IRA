import type {
  DistillContext as CommandPlaneDistillContext,
  LearningHooks,
  RetrieveContext as CommandPlaneRetrieveContext,
} from "../command-plane/hooks.js";
import {
  openLearningStore,
  runRetrieveForTask,
  scheduleLearningAfterRecordResult,
} from "./pipeline.js";
import type { DistillContext, RetrieveContext } from "./types.js";

function toRetrieveContext(ctx: CommandPlaneRetrieveContext): RetrieveContext {
  return ctx as RetrieveContext;
}

function toDistillContext(ctx: CommandPlaneDistillContext): DistillContext {
  const extra = ctx as CommandPlaneDistillContext & Partial<DistillContext>;
  return {
    featureId: ctx.featureId,
    taskId: ctx.taskId,
    passed: ctx.passed,
    reviewFailures: ctx.reviewFailures,
    kind: extra.kind ?? "code",
    implementsFr: extra.implementsFr ?? [],
    implementerReport: extra.implementerReport,
    reviewerReport: extra.reviewerReport,
    engine: extra.engine,
  };
}

/** P-001 `LearningHooks` adapter: RETRIEVE on brief paths; schedule DISTILL after record-result. */
export function createLearningHooks(projectRoot: string): LearningHooks {
  return {
    async retrieve(ctx: CommandPlaneRetrieveContext) {
      const store = await openLearningStore(projectRoot);
      if (!store) return null;
      try {
        return await runRetrieveForTask(store, toRetrieveContext(ctx));
      } finally {
        store.close?.();
      }
    },
    async distill(ctx: CommandPlaneDistillContext) {
      scheduleLearningAfterRecordResult(projectRoot, toDistillContext(ctx));
    },
  };
}
