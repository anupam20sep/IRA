import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonlLine } from "../command-plane/store.js";
import { tokenRoot } from "./paths.js";
import { CompactionRecordSchema, TokenSettingsSchema } from "./schema.js";
import { guardSideEffectWrite } from "./slice-a.js";
import type { CompactionRecord, CompactionStrategy } from "./types.js";

/** Conversational scratch passed through the cheap-to-expensive tier. */
export type CompactionScratch = {
  residualTokens?: number;
};

/**
 * Engine session adapter (P-006). When absent, the chain is record-only and
 * finishes as `compact-skipped` — task completion still succeeds.
 */
export type CompactionEngineAdapter = {
  dropToolNoise?: (scratch: CompactionScratch) => Promise<CompactionScratch>;
  dedupeReads?: (scratch: CompactionScratch) => Promise<CompactionScratch>;
  summarize?: (scratch: CompactionScratch) => Promise<CompactionScratch>;
  clear?: () => Promise<boolean>;
};

export type CompactionContext = {
  featureId: string;
  taskId: string;
  passed: boolean;
  agentId: string;
  sessionId: string;
  /** Estimated residual conversational tokens. Unknown skips summarize. */
  residualTokens?: number;
  engine?: CompactionEngineAdapter;
  /** When set, skips doctor lookup (tests and callers that already resolved hive state). */
  sliceAActive?: boolean;
};

type StrategyDecision = {
  strategy: CompactionStrategy;
  strategiesAttempted: string[];
};

type CheapTier = "drop-tool-noise" | "dedupe-reads";

/**
 * Compact or clear one worker's conversational context at a forge `record-result`
 * boundary. Slice A returns a synthetic `compact-skipped` record and does not
 * append `compaction.jsonl`. Spend, budgets, breakers, and pattern files are
 * never written.
 */
export async function runCompaction(hiveRoot: string, ctx: CompactionContext): Promise<CompactionRecord> {
  const guarded = await guardSideEffectWrite(
    hiveRoot,
    async () => {
      const record = await buildRecord(hiveRoot, ctx);
      await appendJsonlLine(join(tokenRoot(hiveRoot), "compaction.jsonl"), record);
      return record;
    },
    ctx.sliceAActive === undefined ? undefined : { sliceAActive: ctx.sliceAActive },
  );
  if (isSliceAOnly(guarded)) return syntheticSkipped(ctx);
  return guarded;
}

function isSliceAOnly(
  value: CompactionRecord | { ok: false; code: "SLICE_A_ONLY" },
): value is { ok: false; code: "SLICE_A_ONLY" } {
  return "code" in value && value.code === "SLICE_A_ONLY";
}

function syntheticSkipped(ctx: CompactionContext): CompactionRecord {
  return parseRecord(ctx, {
    strategy: "compact-skipped",
    strategiesAttempted: ["compact-skipped"],
  });
}

async function buildRecord(hiveRoot: string, ctx: CompactionContext): Promise<CompactionRecord> {
  const threshold = await readSummarizeThreshold(hiveRoot);
  const decision = await runStrategyChain(ctx, threshold);
  return parseRecord(ctx, decision);
}

function parseRecord(ctx: CompactionContext, decision: StrategyDecision): CompactionRecord {
  return CompactionRecordSchema.parse({
    id: `cmp_${randomUUID()}`,
    ts: new Date().toISOString(),
    featureId: ctx.featureId,
    taskId: ctx.taskId,
    agentId: ctx.agentId,
    sessionId: ctx.sessionId,
    passed: ctx.passed,
    strategy: decision.strategy,
    strategiesAttempted: decision.strategiesAttempted,
  });
}

async function readSummarizeThreshold(hiveRoot: string): Promise<number> {
  const fallback = TokenSettingsSchema.parse({ schemaVersion: 1 }).compactionSummarizeThresholdTokens;
  try {
    const raw = await readFile(join(tokenRoot(hiveRoot), "settings.json"), "utf8");
    return TokenSettingsSchema.parse(JSON.parse(raw)).compactionSummarizeThresholdTokens;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

/**
 * Cheap tiers first. Summarize only while residual still exceeds the bound.
 * Stop when an applied step brings residual under the bound. Clear is the
 * engine fallback. No adapter and no successful clear → `compact-skipped`.
 */
async function runStrategyChain(ctx: CompactionContext, threshold: number): Promise<StrategyDecision> {
  const attempted: string[] = [];
  const engine = ctx.engine;

  const drop = await applyCheapTier(
    attempted,
    "drop-tool-noise",
    ctx.residualTokens,
    threshold,
    engine?.dropToolNoise,
  );
  if (drop.satisfied) return decision("drop-tool-noise", attempted);

  const dedupe = await applyCheapTier(attempted, "dedupe-reads", drop.residual, threshold, engine?.dedupeReads);
  if (dedupe.satisfied) return decision("dedupe-reads", attempted);

  let residual = dedupe.residual;
  if (residual !== undefined && residual > threshold) {
    attempted.push("summarize");
    if (engine?.summarize) {
      residual = takeResidual(await engine.summarize({ residualTokens: residual }), residual);
      if (underBound(residual, threshold)) return decision("summarize", attempted);
    }
  }

  if (engine?.clear) {
    attempted.push("clear");
    if (await engine.clear()) return decision("clear", attempted);
  }

  attempted.push("compact-skipped");
  return decision("compact-skipped", attempted);
}

async function applyCheapTier(
  attempted: string[],
  name: CheapTier,
  residual: number | undefined,
  threshold: number,
  apply: ((scratch: CompactionScratch) => Promise<CompactionScratch>) | undefined,
): Promise<{ residual: number | undefined; satisfied: boolean }> {
  attempted.push(name);
  if (!apply) return { residual, satisfied: false };
  const next = takeResidual(await apply({ residualTokens: residual }), residual);
  return { residual: next, satisfied: underBound(next, threshold) };
}

function decision(strategy: CompactionStrategy, strategiesAttempted: string[]): StrategyDecision {
  return { strategy, strategiesAttempted };
}

function takeResidual(next: CompactionScratch, previous: number | undefined): number | undefined {
  return next.residualTokens !== undefined ? next.residualTokens : previous;
}

function underBound(residual: number | undefined, threshold: number): boolean {
  return residual !== undefined && residual <= threshold;
}
