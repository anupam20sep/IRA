/**
 * Forge-facing pattern index (FR-010, OD-016).
 *
 * Importing this module does not load the native binding. `openPatternIndex`
 * returns `index: null` and `indexAvailable: false` when `better-sqlite3`
 * cannot load or the database cannot be opened, and logs
 * `PATTERNS_INDEX_UNAVAILABLE`. It does not throw.
 */
export {
  openPatternIndex,
  upsertPattern,
  searchPatterns,
  reindexFromMarkdown,
  type OpenedPatternIndex,
  type PatternIndex,
  type PatternIndexPaths,
  type PatternSearchHit,
  type PatternSearchQuery,
  type ReindexReport,
  type UnavailableReason,
} from "./index-sqlite.js";
