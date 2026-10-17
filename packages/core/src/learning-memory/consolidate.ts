import type { PatternIndex } from "./index-sqlite.js";
import {
  listPatternMarkdownFiles,
  readPatternFile,
  writePatternAtomic,
  type PatternRecord,
} from "./pattern-io.js";
import { upsertPattern } from "./pattern-index.js";
import type { PatternSignalsSchema } from "./schema.js";
import { resolvePatternWriteGate } from "./slice-gate.js";
import type { z } from "zod";

const JACCARD_MERGE_THRESHOLD = 0.8;

export type ConsolidateCandidate = {
  id: string;
  summary: string;
  signalsKey: string;
  useCount?: number;
};

export type ConsolidateResult = {
  canonicalId: string;
  archivedIds: string[];
  mergedUseCount: number;
};

export type ConsolidateSkipped = {
  skipped: true;
  code: "SLICE_A_ONLY";
};

export type ConsolidateAfterDistillStore = {
  patternsDir: string;
  index: PatternIndex | null;
  sliceAValidated: boolean;
};

type PatternSignals = z.infer<typeof PatternSignalsSchema>;

/** Stable key for the signal bucket used in CONSOLIDATE (sorted FR tags + task kind). */
export function buildSignalsKey(signals: Pick<PatternSignals, "frTags" | "taskKind">): string {
  const tags = [...signals.frTags].sort().join("|");
  return `${tags}|${signals.taskKind}`;
}

function tokenizeSummary(summary: string): Set<string> {
  const tokens = summary
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return new Set(tokens);
}

/** Token-set Jaccard similarity between two summaries (0–1). */
export function summaryTokenJaccard(a: string, b: string): number {
  const setA = tokenizeSummary(a);
  const setB = tokenizeSummary(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Merge near-duplicates within one signal bucket; `canonicalId` wins ties. */
export function consolidateBucket(
  candidates: ConsolidateCandidate[],
  canonicalId: string,
): ConsolidateResult {
  const canonical = candidates.find((c) => c.id === canonicalId);
  if (!canonical) {
    return { canonicalId, archivedIds: [], mergedUseCount: 0 };
  }

  const archivedIds: string[] = [];
  for (const candidate of candidates) {
    if (candidate.id === canonicalId) continue;
    if (candidate.signalsKey !== canonical.signalsKey) continue;
    if (summaryTokenJaccard(candidate.summary, canonical.summary) >= JACCARD_MERGE_THRESHOLD) {
      archivedIds.push(candidate.id);
    }
  }

  const mergedUseCount = candidates
    .filter((c) => c.id === canonicalId || archivedIds.includes(c.id))
    .reduce((sum, c) => sum + (c.useCount ?? 0), 0);

  return { canonicalId, archivedIds, mergedUseCount };
}

function toCandidate(record: PatternRecord): ConsolidateCandidate {
  return {
    id: record.frontmatter.id,
    summary: record.summary,
    signalsKey: buildSignalsKey(record.frontmatter.signals),
    useCount: record.frontmatter.useCount,
  };
}

async function loadActiveCandidates(
  patternsDir: string,
  signalsKey: string,
): Promise<ConsolidateCandidate[]> {
  const paths = await listPatternMarkdownFiles(patternsDir);
  const candidates: ConsolidateCandidate[] = [];
  for (const path of paths) {
    const record = await readPatternFile(path);
    if (record.frontmatter.status !== "active") continue;
    const key = buildSignalsKey(record.frontmatter.signals);
    if (key !== signalsKey) continue;
    candidates.push(toCandidate(record));
  }
  return candidates;
}

/**
 * CONSOLIDATE after DISTILL: archive near-duplicates in the same bucket and merge use counts.
 * Pattern file writes are gated until Slice A doctor validation passes (OD-020).
 */
export async function consolidateAfterDistill(
  store: ConsolidateAfterDistillStore,
  newId: string,
): Promise<ConsolidateResult | ConsolidateSkipped> {
  const gate = resolvePatternWriteGate({ sliceAValidated: store.sliceAValidated });
  if (!gate.allowed) {
    return { skipped: true, code: gate.code };
  }

  const newPath = (await listPatternMarkdownFiles(store.patternsDir)).find((p) =>
    p.endsWith(`/${newId}.md`),
  );
  if (!newPath) {
    return { canonicalId: newId, archivedIds: [], mergedUseCount: 0 };
  }

  const newRecord = await readPatternFile(newPath);
  const signalsKey = buildSignalsKey(newRecord.frontmatter.signals);
  const bucket = await loadActiveCandidates(store.patternsDir, signalsKey);
  const merge = consolidateBucket(bucket, newId);

  const now = new Date().toISOString();
  const canonicalRecord: PatternRecord = {
    ...newRecord,
    frontmatter: {
      ...newRecord.frontmatter,
      useCount: merge.mergedUseCount,
      updatedAt: now,
      status: "active",
    },
  };
  await writePatternAtomic(store.patternsDir, canonicalRecord);
  if (store.index) {
    upsertPattern(store.index, canonicalRecord);
  }

  for (const archivedId of merge.archivedIds) {
    const archivedPath = (await listPatternMarkdownFiles(store.patternsDir)).find((p) =>
      p.endsWith(`/${archivedId}.md`),
    );
    if (!archivedPath) continue;
    const record = await readPatternFile(archivedPath);
    const archivedRecord: PatternRecord = {
      ...record,
      frontmatter: {
        ...record.frontmatter,
        status: "archived",
        updatedAt: now,
      },
    };
    await writePatternAtomic(store.patternsDir, archivedRecord);
    if (store.index) {
      upsertPattern(store.index, archivedRecord);
    }
  }

  return merge;
}
