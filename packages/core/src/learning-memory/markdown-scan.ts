import type { JudgeCandidate } from "./judge.js";
import { listPatternMarkdownFiles, readPatternFile } from "./pattern-io.js";
import type { RetrieveContext } from "./types.js";

export type MarkdownScanOptions = {
  maxFiles: number;
};

/**
 * Signal-filtered read of canonical pattern markdown when SQLite FTS is unavailable.
 * Stops after `maxFiles` paths. Invalid files are skipped. Never throws for a missing directory.
 */
export async function scanMarkdownCandidates(
  patternsDir: string,
  ctx: RetrieveContext,
  options: MarkdownScanOptions,
): Promise<JudgeCandidate[]> {
  const files = await listPatternMarkdownFiles(patternsDir);
  const budget = normalizeBudget(options.maxFiles);
  const wanted = wantedTags(ctx.implementsFr);
  const candidates: JudgeCandidate[] = [];

  for (const file of files.slice(0, budget)) {
    let record;
    try {
      record = await readPatternFile(file);
    } catch {
      continue;
    }
    const frontmatter = record.frontmatter;
    if (frontmatter.status === "archived") continue;
    if (frontmatter.signals.taskKind !== ctx.kind) continue;
    const frTags = frontmatter.signals.frTags;
    if (wanted.size > 0 && !frTags.some((tag) => wanted.has(tag.toUpperCase()))) continue;
    if (record.summary.trim().length === 0) continue;
    candidates.push({
      id: frontmatter.id,
      summary: record.summary,
      frTags,
    });
  }

  return candidates;
}

function wantedTags(tags: string[]): Set<string> {
  const wanted = new Set<string>();
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length > 0) wanted.add(trimmed.toUpperCase());
  }
  return wanted;
}

function normalizeBudget(maxFiles: number): number {
  if (!Number.isFinite(maxFiles) || maxFiles <= 0) return 0;
  return Math.floor(maxFiles);
}
