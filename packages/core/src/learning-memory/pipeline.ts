import { join } from "node:path";
import {
  DEFAULT_LEARNING_CONFIG,
  isFeatureDistillEnabled,
  loadLearningConfig,
  type LearningConfig,
} from "./config.js";
import { consolidateAfterDistill } from "./consolidate.js";
import { distillPattern } from "./distill.js";
import type { PatternIndex } from "./pattern-index.js";
import { openPatternIndex } from "./pattern-index.js";
import { resolvePatternStoreRoot } from "./paths.js";
import { retrievePatterns } from "./retrieve.js";
import { resolvePatternWriteGate } from "./slice-gate.js";
import type { DistillContext, InjectionSummary, RetrieveContext } from "./types.js";

/** Background DISTILL hard timeout (FR-001a). Abandon with a log; never fail forge. */
export const DEFAULT_DISTILL_TIMEOUT_MS = 30_000;

/**
 * Store handle for RETRIEVE / DISTILL / CONSOLIDATE.
 * Phase methods are optional injections; otherwise the pipeline calls the phase modules.
 */
export type LearningStore = {
  repositoryRoot?: string;
  patternsDir?: string;
  index?: PatternIndex | null;
  indexAvailable?: boolean;
  /** Doctor snapshot. Missing or false keeps pattern writes closed (OD-020). */
  sliceAValidated?: boolean;
  config?: LearningConfig;
  distill?: (ctx: DistillContext) => Promise<unknown> | unknown;
  retrieve?: (ctx: RetrieveContext) => Promise<InjectionSummary | null>;
  consolidate?: (patternId: string) => Promise<unknown> | unknown;
  close?: () => void;
};

export type DistillPipelineOptions = {
  timeoutMs?: number;
};

/** Optional phase injection so tests can observe the off-stack chain without a forge handler. */
export type ScheduleLearningDeps = {
  runDistill?: (root: string, ctx: DistillContext) => unknown;
  runConsolidate?: (patternId: string) => unknown;
  distillTimeoutMs?: number;
  openStore?: (root: string) => Promise<LearningStore | null>;
};

const writeTail = new Map<string, Promise<void>>();

class DistillTimeoutError extends Error {
  constructor() {
    super("DISTILL_TIMEOUT");
    this.name = "DistillTimeoutError";
  }
}

/**
 * RETRIEVE → JUDGE. Failures log `learning.phase=retrieve` and return null (FR-004, FR-011).
 */
export async function runRetrieveForTask(
  store: LearningStore,
  ctx: RetrieveContext,
): Promise<InjectionSummary | null> {
  try {
    const config = store.config ?? (await configFromRoot(store));
    if (!isRetrieveActive(config, ctx.featureId)) {
      console.error("learning.phase=retrieve skip=disabled");
      return null;
    }
    console.error("learning.phase=retrieve");
    if (typeof store.retrieve === "function") {
      return await store.retrieve(ctx);
    }
    if (!store.patternsDir) return null;
    return await retrievePatterns(
      {
        index: store.index ?? null,
        indexAvailable: store.indexAvailable === true,
        patternsDir: store.patternsDir,
      },
      ctx,
      config,
    );
  } catch (err) {
    console.error(`learning.phase=retrieve error=${errorMessage(err)}`);
    return null;
  }
}

/**
 * Background DISTILL. Logs failures and timeouts; never throws to forge (FR-001a).
 */
export async function runDistillAfterResult(
  store: LearningStore,
  ctx: DistillContext,
  options: DistillPipelineOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISTILL_TIMEOUT_MS;
  // The lock stays with the in-flight write. Timeout only abandons the waiter.
  const locked = withRepositoryWriteLock(lockKey(store), () => distillUnlocked(store, ctx));
  try {
    await withTimeout(locked, timeoutMs);
  } catch (err) {
    logDistillFailure(err);
  }
}

/**
 * CONSOLIDATE after a finished DISTILL. Off the record-result stack; never throws (FR-011a).
 */
export async function runConsolidateAfterDistill(
  store: LearningStore,
  patternId: string,
): Promise<void> {
  await withRepositoryWriteLock(lockKey(store), () => consolidateUnlocked(store, patternId));
}

/**
 * Schedule DISTILL → CONSOLIDATE on the next tick. Returns void so record-result cannot await it (OD-016).
 */
export function scheduleLearningAfterRecordResult(
  root: string,
  ctx: DistillContext,
  deps?: ScheduleLearningDeps,
): void {
  setImmediate(() => {
    void runScheduled(root, ctx, deps);
  });
}

async function runScheduled(
  root: string,
  ctx: DistillContext,
  deps: ScheduleLearningDeps | undefined,
): Promise<void> {
  const timeoutMs = deps?.distillTimeoutMs ?? DEFAULT_DISTILL_TIMEOUT_MS;
  try {
    if (deps?.runDistill) {
      await withRepositoryWriteLock(root, async () => {
        try {
          console.error("learning.phase=distill");
          const result = await withTimeout(Promise.resolve(deps.runDistill(root, ctx)), timeoutMs);
          const patternId = patternIdFrom(result);
          if (!patternId || !deps.runConsolidate) return;
          await consolidateInjected(deps.runConsolidate, patternId);
        } catch (err) {
          logDistillFailure(err);
        }
      });
      return;
    }

    const store = deps?.openStore ? await deps.openStore(root) : await openLearningStore(root);
    if (!store) {
      console.error("learning.phase=distill skip=PATTERNS_ROOT_UNRESOLVED");
      return;
    }
    await runStoreChain(store, ctx, timeoutMs);
  } catch (err) {
    logDistillFailure(err);
  }
}

/**
 * DISTILL then CONSOLIDATE under the repository write lock.
 * A hard timeout abandons the waiter and skips CONSOLIDATE; the write keeps the lock until it settles.
 */
async function runStoreChain(
  store: LearningStore,
  ctx: DistillContext,
  timeoutMs: number,
): Promise<void> {
  let abandoned = false;
  const pending = withRepositoryWriteLock(lockKey(store), async () => {
    try {
      const patternId = await distillUnlocked(store, ctx);
      if (abandoned || !patternId) return;
      await consolidateUnlocked(store, patternId);
    } finally {
      store.close?.();
    }
  });
  try {
    await withTimeout(pending, timeoutMs);
  } catch (err) {
    abandoned = true;
    logDistillFailure(err);
  }
}

async function distillUnlocked(store: LearningStore, ctx: DistillContext): Promise<string | undefined> {
  try {
    const config = store.config ?? (await configFromRoot(store));
    if (!isDistillActive(config, ctx.featureId)) {
      console.error("learning.phase=distill skip=disabled");
      return undefined;
    }
    if (typeof store.distill === "function") {
      console.error("learning.phase=distill");
      const result = await store.distill(ctx);
      return patternIdFrom(result);
    }
    const gate = resolvePatternWriteGate({ sliceAValidated: store.sliceAValidated === true });
    if (!gate.allowed) {
      console.error(`learning.phase=distill skip=${gate.code}`);
      return undefined;
    }
    if (!store.patternsDir) {
      console.error("learning.phase=distill error=missing patternsDir");
      return undefined;
    }
    console.error("learning.phase=distill");
    const result = await distillPattern(
      ctx,
      {
        patternsDir: store.patternsDir,
        index: store.index ?? null,
        indexAvailable: store.indexAvailable === true,
        sliceAValidated: store.sliceAValidated === true,
      },
      config,
    );
    if (!result.written) {
      if (result.skipReason) console.error(`learning.phase=distill skip=${result.skipReason}`);
      return undefined;
    }
    return result.patternId;
  } catch (err) {
    logDistillFailure(err);
    return undefined;
  }
}

async function consolidateUnlocked(store: LearningStore, patternId: string): Promise<void> {
  if (patternId.length === 0) return;
  try {
    console.error("learning.phase=consolidate");
    if (typeof store.consolidate === "function") {
      await store.consolidate(patternId);
      return;
    }
    const gate = resolvePatternWriteGate({ sliceAValidated: store.sliceAValidated === true });
    if (!gate.allowed) {
      console.error(`learning.phase=consolidate skip=${gate.code}`);
      return;
    }
    if (!store.patternsDir) {
      console.error("learning.phase=consolidate error=missing patternsDir");
      return;
    }
    await consolidateAfterDistill(
      {
        patternsDir: store.patternsDir,
        index: store.index ?? null,
        sliceAValidated: store.sliceAValidated === true,
      },
      patternId,
    );
  } catch (err) {
    console.error(`learning.phase=consolidate error=${errorMessage(err)}`);
  }
}

async function consolidateInjected(
  runConsolidate: (patternId: string) => unknown,
  patternId: string,
): Promise<void> {
  try {
    console.error("learning.phase=consolidate");
    await runConsolidate(patternId);
  } catch (err) {
    console.error(`learning.phase=consolidate error=${errorMessage(err)}`);
  }
}

async function openLearningStore(root: string): Promise<LearningStore | null> {
  const paths = resolvePatternStoreRoot(root);
  if (!paths.ok) return null;
  const opened = openPatternIndex({
    indexPath: paths.indexPath,
    lockPath: paths.lockPath,
  });
  const config = await loadLearningConfig(paths.repositoryRoot);
  let sliceAValidated = false;
  try {
    const { readSliceAValidated } = await import("../engines/dispatch.js");
    const hiveRoot = join(paths.repositoryRoot, ".superspec", "hive");
    sliceAValidated = await readSliceAValidated(hiveRoot);
  } catch (err) {
    console.error(`learning.phase=distill error=${errorMessage(err)}`);
  }
  return {
    repositoryRoot: paths.repositoryRoot,
    patternsDir: paths.patternsDir,
    index: opened.index,
    indexAvailable: opened.indexAvailable,
    sliceAValidated,
    config,
    close: () => {
      opened.close();
    },
  };
}

async function configFromRoot(store: LearningStore): Promise<LearningConfig> {
  if (store.repositoryRoot) return loadLearningConfig(store.repositoryRoot);
  return defaultConfig();
}

function defaultConfig(): LearningConfig {
  return { ...DEFAULT_LEARNING_CONFIG, features: { ...DEFAULT_LEARNING_CONFIG.features } };
}

function isDistillActive(config: LearningConfig, featureId: string): boolean {
  if (!config.enabled) return false;
  const override = config.features[featureId];
  if (override?.enabled === false) return false;
  return isFeatureDistillEnabled(config, featureId);
}

function isRetrieveActive(config: LearningConfig, featureId: string): boolean {
  if (!config.enabled || !config.retrieve) return false;
  const override = config.features[featureId];
  if (override?.enabled === false || override?.retrieve === false) return false;
  return true;
}

function patternIdFrom(result: unknown): string | undefined {
  if (typeof result === "string" && result.length > 0) return result;
  if (!result || typeof result !== "object") return undefined;
  const record = result as { written?: unknown; patternId?: unknown };
  if (record.written === false) return undefined;
  if (typeof record.patternId === "string" && record.patternId.length > 0) return record.patternId;
  return undefined;
}

function lockKey(store: LearningStore): string {
  if (store.repositoryRoot && store.repositoryRoot.length > 0) return store.repositoryRoot;
  if (store.patternsDir && store.patternsDir.length > 0) return store.patternsDir;
  return "learning-memory";
}

/** In-process mutex so pattern writes for one repository cannot overlap. */
function withRepositoryWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeTail.get(key) ?? Promise.resolve();
  const run = prev.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  writeTail.set(key, tail);
  void tail.then(() => {
    if (writeTail.get(key) === tail) writeTail.delete(key);
  });
  return run;
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return Promise.reject(new DistillTimeoutError());
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DistillTimeoutError());
    }, timeoutMs);
    timer.unref?.();
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function logDistillFailure(err: unknown): void {
  if (err instanceof DistillTimeoutError) {
    console.error("learning.phase=distill timeout");
    return;
  }
  console.error(`learning.phase=distill error=${errorMessage(err)}`);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
