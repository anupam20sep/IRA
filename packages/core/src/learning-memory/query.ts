import { join } from "node:path";
import { z } from "zod";
import { listPatternMarkdownFiles, readPatternFile, type PatternRecord } from "./pattern-io.js";
import { assertSafePatternId, resolvePatternStoreRoot } from "./paths.js";
import { openPatternIndex, searchPatterns, type PatternIndex } from "./pattern-index.js";
import { MARKDOWN_SCAN_MAX_FILES } from "./retrieve.js";
import {
  PatternFrontmatterSchema,
  PatternRecordSchema,
  PatternsListQuerySchema,
  PatternsListResponseSchema,
} from "./schema.js";
import type { z } from "zod";

export const SUMMARY_PREVIEW_MAX_CHARS = 240;
export const PATTERNS_STORE_UNREADABLE = "PATTERNS_STORE_UNREADABLE";

type PatternsListQuery = z.infer<typeof PatternsListQuerySchema>;
type PatternsListResponse = z.infer<typeof PatternsListResponseSchema>;
type PatternListItem = PatternsListResponse["patterns"][number];

/**
 * Read-only list/search for MCP and CLI (FR-012). Uses SQLite when available;
 * otherwise a capped markdown scan. Never throws for an empty or unreadable store.
 */
const PatternsShowQuerySchema = z.object({
  projectRoot: z.string().min(1),
  id: PatternFrontmatterSchema.shape.id,
});

export type PatternsShowResponse = {
  pattern: z.infer<typeof PatternRecordSchema> | null;
  warnings?: string[];
};

export async function showPattern(rawQuery: unknown): Promise<PatternsShowResponse> {
  const query = PatternsShowQuerySchema.parse(rawQuery);
  const store = resolvePatternStoreRoot(query.projectRoot);
  if (!store.ok) {
    return { pattern: null, warnings: [store.code] };
  }
  assertSafePatternId(query.id);
  try {
    const record = await readPatternFile(join(store.patternsDir, `${query.id}.md`));
    return { pattern: PatternRecordSchema.parse(record) };
  } catch {
    return { pattern: null };
  }
}

export async function listPatterns(rawQuery: unknown): Promise<PatternsListResponse> {
  const query = PatternsListQuerySchema.parse(rawQuery);
  const store = resolvePatternStoreRoot(query.projectRoot);
  if (!store.ok) {
    return { patterns: [], nextCursor: null, warnings: [store.code] };
  }

  const opened = openPatternIndex({
    indexPath: store.indexPath,
    lockPath: store.lockPath,
  });
  const warnings: string[] = [];

  try {
    if (opened.indexAvailable && opened.index) {
      try {
        const fromIndex = await listFromIndex(opened.index, store.patternsDir, query);
        return paginate(fromIndex, query);
      } catch {
        warnings.push(PATTERNS_STORE_UNREADABLE);
      }
    } else if (opened.unavailableReason === "OPEN_FAILED") {
      warnings.push(PATTERNS_STORE_UNREADABLE);
    }

    const fromMarkdown = await listFromMarkdown(store.patternsDir, query);
    const response = paginate(fromMarkdown, query);
    if (warnings.length > 0) response.warnings = warnings;
    return response;
  } finally {
    opened.close();
  }
}

async function listFromIndex(
  index: PatternIndex,
  patternsDir: string,
  query: PatternsListQuery,
): Promise<PatternListItem[]> {
  const hits = searchPatterns(index, {
    frTag: query.frTag,
    kind: query.kind,
    featureId: query.featureId,
    includeArchived: false,
    limit: 500,
  });
  const items: PatternListItem[] = [];
  for (const hit of hits) {
    const item = await loadListItem(patternsDir, hit.id);
    if (!item) continue;
    if (query.featureId && item.signals.featureId !== query.featureId) continue;
    if (query.frTag && !item.signals.frTags.includes(query.frTag)) continue;
    if (query.kind && item.kind !== query.kind) continue;
    items.push(item);
  }
  return sortByUpdatedAt(items);
}

async function listFromMarkdown(
  patternsDir: string,
  query: PatternsListQuery,
): Promise<PatternListItem[]> {
  const files = await listPatternMarkdownFiles(patternsDir);
  const budget = Math.min(files.length, MARKDOWN_SCAN_MAX_FILES);
  const items: PatternListItem[] = [];

  for (const file of files.slice(0, budget)) {
    let record;
    try {
      record = await readPatternFile(file);
    } catch {
      continue;
    }
    const fm = record.frontmatter;
    if (fm.status === "archived") continue;
    if (query.featureId && fm.signals.featureId !== query.featureId) continue;
    if (query.frTag && !fm.signals.frTags.includes(query.frTag)) continue;
    if (query.kind && fm.kind !== query.kind) continue;
    items.push(toListItem(record));
  }

  return sortByUpdatedAt(items);
}

async function loadListItem(
  patternsDir: string,
  id: string,
): Promise<PatternListItem | null> {
  const file = join(patternsDir, `${id}.md`);
  try {
    return toListItem(await readPatternFile(file));
  } catch {
    return null;
  }
}

function toListItem(record: PatternRecord): PatternListItem {
  const fm = record.frontmatter;
  return {
    id: fm.id,
    kind: fm.kind,
    signals: {
      frTags: fm.signals.frTags,
      taskKind: fm.signals.taskKind,
      ...(fm.signals.featureId ? { featureId: fm.signals.featureId } : {}),
    },
    summaryPreview: previewSummary(record.summary),
    evidenceRefs: fm.evidenceRefs,
    useCount: fm.useCount,
    updatedAt: fm.updatedAt,
  };
}

function previewSummary(summary: string): string {
  if (summary.length <= SUMMARY_PREVIEW_MAX_CHARS) return summary;
  return summary.slice(0, SUMMARY_PREVIEW_MAX_CHARS);
}

function sortByUpdatedAt(items: PatternListItem[]): PatternListItem[] {
  return [...items].sort((a, b) => {
    const byTime = b.updatedAt.localeCompare(a.updatedAt);
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
}

function paginate(sorted: PatternListItem[], query: PatternsListQuery): PatternsListResponse {
  const limit = query.limit;
  let start = 0;
  if (query.cursor) {
    const idx = sorted.findIndex((item) => item.id === query.cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const slice = sorted.slice(start, start + limit + 1);
  const hasMore = slice.length > limit;
  const patterns = hasMore ? slice.slice(0, limit) : slice;
  const nextCursor = hasMore ? (patterns[patterns.length - 1]?.id ?? null) : null;
  return { patterns, nextCursor };
}
