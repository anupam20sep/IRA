import { basename, join, resolve } from "node:path";
import { featureIdSchema } from "../command-plane/schema.js";
import { parsePlan } from "../plan-parser.js";
import { applyPatternHint, routeModel, type RouteModelResult, type RouteRole } from "../model-router.js";
import { resolveDispatchModel } from "../models-config.js";
import type { HarnessId } from "../harness-model-map.js";
import type { Complexity, Task, TaskKind } from "../types.js";
import { loadLearningConfig } from "./config.js";
import { installLearningMemory } from "./install.js";
import { resolvePatternStoreRoot } from "./paths.js";
import {
  openLearningStore,
  runRetrieveForTask,
  scheduleLearningAfterRecordResult,
  type LearningStore,
} from "./pipeline.js";
import { resolvePatternWriteGate } from "./slice-gate.js";
import type { DistillContext, InjectionSummary, RetrieveContext } from "./types.js";

export type RouteModelLearningInput = {
  complexity: Complexity;
  role?: RouteRole;
  attempt?: number;
  kind?: TaskKind;
  harness?: HarnessId;
  projectRoot?: string;
  taskId?: string;
  planText?: string;
  implementsFr?: string[];
  featureId?: string;
};

export async function priorPatternsForTask(input: {
  specDir: string;
  task: Task;
}): Promise<InjectionSummary | null> {
  try {
    const paths = resolvePatternStoreRoot(input.specDir);
    if (!paths.ok) return null;
    installLearningMemory({ projectRoot: paths.repositoryRoot });
    const store = await openLearningStore(paths.repositoryRoot);
    if (!store) return null;
    try {
      return await runRetrieveForTask(store, retrieveContext(input.specDir, input.task));
    } finally {
      store.close?.();
    }
  } catch (err) {
    console.error(`learning.phase=retrieve error=${errorMessage(err)}`);
    return null;
  }
}

/**
 * Schedule DISTILL after forge state is saved. Returns immediately.
 * A throw from the scheduler is logged and does not escape to record-result (OD-016).
 */
export function scheduleRecordResultLearning(input: {
  specDir: string;
  task?: Task;
  taskId: string;
  passed: boolean;
  reviewFailures: number;
  implementerReport?: string;
  reviewerReport?: string;
}): boolean {
  try {
    const paths = resolvePatternStoreRoot(input.specDir);
    if (!paths.ok) return false;
    installLearningMemory({ projectRoot: paths.repositoryRoot });
    const ctx: DistillContext = {
      featureId: featureIdFromSpecDir(input.specDir),
      taskId: input.taskId,
      passed: input.passed,
      reviewFailures: input.reviewFailures,
      kind: input.task?.kind ?? "code",
      implementsFr: input.task?.frRefs ?? [],
      implementerReport: input.implementerReport,
      reviewerReport: input.reviewerReport,
    };
    scheduleLearningAfterRecordResult(paths.repositoryRoot, ctx, {
      openStore: openStoreForRecordResult,
    });
    return true;
  } catch (err) {
    console.error(`learning.phase=distill error=${errorMessage(err)}`);
    return false;
  }
}

/** route-model JSON plus optional pattern fields. Missing task context leaves the route unchanged. */
export async function routeModelWithLearning(
  input: RouteModelLearningInput,
): Promise<RouteModelResult & Record<string, unknown>> {
  const routed = applyPatternHint(
    routeModel({
      complexity: input.complexity,
      role: input.role,
      attempt: input.attempt,
      kind: input.kind,
    }),
    await patternHintForRoute(input),
  );
  const resolved = await resolveDispatchModel({
    tier: routed.tier,
    role: routed.role,
    kind: input.kind,
    attempt: routed.attempt,
    harness: input.harness,
    projectRoot: input.projectRoot,
  });
  return {
    ...routed,
    harness: resolved.harness,
    slug: resolved.slug,
    thinkingHint: resolved.thinkingHint,
    examples: resolved.examples,
    source: resolved.source,
    configPath: resolved.configPath,
  };
}

/**
 * Read the Slice A gate before opening the pattern index.
 * A closed gate must not create `.superspec/patterns/` (OD-020); that write raced forge test cleanup.
 */
async function openStoreForRecordResult(root: string): Promise<LearningStore | null> {
  const paths = resolvePatternStoreRoot(root);
  if (!paths.ok) return null;
  let sliceAValidated = false;
  try {
    const { readSliceAValidated } = await import("../engines/dispatch.js");
    sliceAValidated = await readSliceAValidated(join(paths.repositoryRoot, ".superspec", "hive"));
  } catch (err) {
    console.error(`learning.phase=distill error=${errorMessage(err)}`);
  }
  const config = await loadLearningConfig(paths.repositoryRoot);
  if (!resolvePatternWriteGate({ sliceAValidated }).allowed) {
    return {
      repositoryRoot: paths.repositoryRoot,
      sliceAValidated: false,
      index: null,
      indexAvailable: false,
      config,
    };
  }
  return openLearningStore(paths.repositoryRoot);
}

export function featureIdFromSpecDir(specDir: string): string {
  return acceptedFeatureId(basename(resolve(specDir)));
}

async function patternHintForRoute(
  input: RouteModelLearningInput,
): Promise<{ patternHint: string; patternIds: string[] } | null> {
  if (!hasRouteTaskContext(input)) return null;
  try {
    const paths = resolvePatternStoreRoot(input.projectRoot?.trim() || process.cwd());
    if (!paths.ok) return null;
    installLearningMemory({ projectRoot: paths.repositoryRoot });
    const task = taskFromPlan(input.planText, input.taskId);
    const store = await openLearningStore(paths.repositoryRoot);
    if (!store) return null;
    try {
      const summary = await runRetrieveForTask(store, {
        featureId: acceptedFeatureId(input.featureId),
        taskId: input.taskId?.trim() || task?.id || "",
        implementsFr: task?.frRefs ?? input.implementsFr ?? [],
        kind: task?.kind ?? input.kind ?? "code",
        complexity: task?.complexity ?? input.complexity,
        capabilityTags: [],
      });
      if (!summary || summary.patternIds.length === 0) return null;
      const patternHint = singleLineHint(summary.text);
      if (patternHint.length === 0) return null;
      return { patternHint, patternIds: summary.patternIds };
    } finally {
      store.close?.();
    }
  } catch (err) {
    console.error(`learning.phase=retrieve error=${errorMessage(err)}`);
    return null;
  }
}

function retrieveContext(specDir: string, task: Task): RetrieveContext {
  return {
    featureId: featureIdFromSpecDir(specDir),
    taskId: task.id,
    implementsFr: task.frRefs,
    kind: task.kind,
    complexity: task.complexity,
    capabilityTags: [],
  };
}

function hasRouteTaskContext(input: RouteModelLearningInput): boolean {
  if (input.taskId && input.taskId.trim().length > 0) return true;
  if (input.planText && input.planText.trim().length > 0) return true;
  if (input.implementsFr && input.implementsFr.length > 0) return true;
  if (input.featureId && input.featureId.trim().length > 0) return true;
  return false;
}

function taskFromPlan(planText: string | undefined, taskId: string | undefined): Task | undefined {
  if (!planText || !taskId) return undefined;
  try {
    return parsePlan(planText).find((task) => task.id === taskId);
  } catch (err) {
    console.error(`learning.phase=retrieve error=${errorMessage(err)}`);
    return undefined;
  }
}

function acceptedFeatureId(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  return featureIdSchema.safeParse(trimmed).success ? trimmed : "";
}

function singleLineHint(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return "";
  return line.replace(/^-+\s*/, "");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
