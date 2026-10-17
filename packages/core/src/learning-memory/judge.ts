import type { LearningConfig } from "./config.js";
import type { InjectionSummary, RetrieveContext } from "./types.js";

/** Ranked retrieval candidate passed into JUDGE (FTS hit or markdown scan row). */
export type JudgeCandidate = {
  id: string;
  summary: string;
  score?: number;
  rank?: number;
  frTags?: string[];
};

function frTagOverlapScore(candidateTags: string[], implementsFr: string[]): number {
  if (implementsFr.length === 0 || candidateTags.length === 0) {
    return 0;
  }
  const target = new Set(implementsFr.map((tag) => tag.toUpperCase()));
  let matches = 0;
  for (const tag of candidateTags) {
    if (target.has(tag.toUpperCase())) {
      matches += 1;
    }
  }
  return matches / implementsFr.length;
}

function rankScore(rank: number | undefined): number {
  if (rank === undefined || !Number.isFinite(rank)) {
    return 0;
  }
  // FTS5 bm25 ranks are negative; lower magnitude after inversion ≈ better match.
  const normalized = 1 / (1 + Math.max(0, -rank));
  return Math.min(1, normalized);
}

function effectiveScore(candidate: JudgeCandidate, ctx: RetrieveContext): number {
  if (candidate.score !== undefined) {
    return candidate.score;
  }
  const overlap = frTagOverlapScore(candidate.frTags ?? [], ctx.implementsFr);
  const fts = rankScore(candidate.rank);
  if (overlap === 0 && fts === 0) {
    return 0;
  }
  return overlap * 0.6 + fts * 0.4;
}

function formatLine(summary: string): string {
  const trimmed = summary.trim();
  return trimmed.length > 0 ? `- ${trimmed}` : "";
}

/**
 * Score and filter retrieval candidates; enforce combined injection byte cap (FR-008).
 */
export function judgePatterns(
  candidates: JudgeCandidate[],
  ctx: RetrieveContext,
  config: LearningConfig,
): InjectionSummary | null {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: effectiveScore(candidate, ctx),
    }))
    .filter(({ score }) => score >= config.judgeMinScore)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return null;
  }

  const patternIds: string[] = [];
  const lines: string[] = [];
  let usedBytes = 0;
  const cap = config.maxInjectionBytes;

  for (const { candidate } of scored) {
    const line = formatLine(candidate.summary);
    if (line.length === 0) {
      continue;
    }
    const separator = lines.length > 0 ? "\n" : "";
    const addedBytes = Buffer.byteLength(separator + line, "utf8");
    if (usedBytes + addedBytes > cap) {
      continue;
    }
    lines.push(line);
    patternIds.push(candidate.id);
    usedBytes += addedBytes;
  }

  if (patternIds.length === 0) {
    return null;
  }

  return { text: lines.join("\n"), patternIds };
}
