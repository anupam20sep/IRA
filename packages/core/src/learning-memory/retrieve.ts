import type { LearningConfig } from "./config.js";
import { judgePatterns, type JudgeCandidate } from "./judge.js";
import { scanMarkdownCandidates } from "./markdown-scan.js";
import { searchPatterns, type PatternIndex, type PatternSearchHit } from "./pattern-index.js";
import type { InjectionSummary, RetrieveContext } from "./types.js";

/** Capped markdown scan used when the SQLite index cannot load (OD-016). */
export const MARKDOWN_SCAN_MAX_FILES = 200;

/** Index handle plus canonical markdown directory for RETRIEVE. */
export type RetrieveStore = {
  index: PatternIndex | null;
  indexAvailable: boolean;
  patternsDir: string;
};

/**
 * RETRIEVE then JUDGE. Uses FTS and FR-tag prefilter when the index loaded;
 * otherwise a capped markdown scan. Does not throw when SQLite is absent.
 */
export async function retrievePatterns(
  store: RetrieveStore,
  ctx: RetrieveContext,
  config: LearningConfig,
): Promise<InjectionSummary | null> {
  const candidates = await loadCandidates(store, ctx);
  return judgePatterns(candidates, ctx, config);
}

async function loadCandidates(
  store: RetrieveStore,
  ctx: RetrieveContext,
): Promise<JudgeCandidate[]> {
  if (store.indexAvailable && store.index) {
    return searchIndexCandidates(store.index, ctx);
  }
  return scanMarkdownCandidates(store.patternsDir, ctx, { maxFiles: MARKDOWN_SCAN_MAX_FILES });
}

function searchIndexCandidates(index: PatternIndex, ctx: RetrieveContext): JudgeCandidate[] {
  const tags = uniqueTags(ctx.implementsFr);
  const byId = new Map<string, JudgeCandidate>();
  const signalTags = tags.length > 0 ? tags : [undefined];

  for (const frTag of signalTags) {
    const hits = searchPatterns(index, {
      frTag,
      taskKind: ctx.kind,
      includeArchived: false,
      limit: 20,
    });
    for (const hit of hits) remember(byId, hit);
  }

  for (const frTag of tags) {
    const ranked = searchPatterns(index, {
      text: frTag,
      taskKind: ctx.kind,
      includeArchived: false,
      limit: 20,
    });
    for (const hit of ranked) {
      if (!tagOverlaps(hit.frTags, tags)) continue;
      const existing = byId.get(hit.id);
      if (existing) {
        existing.rank = betterRank(existing.rank, hit.rank);
        continue;
      }
      remember(byId, hit);
    }
  }

  return [...byId.values()];
}

function remember(byId: Map<string, JudgeCandidate>, hit: PatternSearchHit): void {
  if (hit.status === "archived") return;
  if (byId.has(hit.id)) return;
  byId.set(hit.id, {
    id: hit.id,
    summary: hit.summary,
    frTags: hit.frTags,
    rank: hit.rank,
  });
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

function tagOverlaps(candidateTags: string[], wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  const target = new Set(wanted.map((tag) => tag.toUpperCase()));
  return candidateTags.some((tag) => target.has(tag.toUpperCase()));
}

function betterRank(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current;
  if (current === undefined) return next;
  return next < current ? next : current;
}
