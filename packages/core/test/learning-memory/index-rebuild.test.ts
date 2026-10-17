import { describe, it, expect, vi } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openPatternIndexWithLoader } from "../../src/learning-memory/index-sqlite.js";
import {
  openPatternIndex,
  reindexFromMarkdown,
  searchPatterns,
  upsertPattern,
} from "../../src/learning-memory/pattern-index.js";
import { writePatternAtomic } from "../../src/learning-memory/pattern-io.js";

describe("reindexFromMarkdown", () => {
  it("rebuilds FTS rows from canonical md files", async () => {
    const root = await mkdtemp(join(tmpdir(), "lm-idx-"));
    const patternsDir = join(root, "patterns");
    await writePatternAtomic(patternsDir, {
      frontmatter: {
        id: "pat_idx1",
        kind: "failure",
        createdAt: "2026-10-15T12:00:00.000Z",
        updatedAt: "2026-10-15T12:00:00.000Z",
        signals: { frTags: ["FR-012"], taskKind: "code" },
        evidenceRefs: ["task:T002"],
        useCount: 0,
        status: "active",
      },
      summary: "Always lint plan before route.",
    });
    const indexPath = join(root, "index.sqlite");
    const lockPath = join(root, ".index.lock");
    const report = reindexFromMarkdown(patternsDir, indexPath, lockPath);
    expect(report.indexed).toBe(1);
    const db = openPatternIndex({ indexPath, lockPath });
    expect(db.indexAvailable).toBe(true);
    expect(db.index).not.toBeNull();
    const hits = db.search({ frTag: "FR-012", limit: 5 });
    expect(hits.some((h) => h.id === "pat_idx1")).toBe(true);
    const byText = db.search({ text: "lint plan", limit: 5 });
    expect(byText.some((h) => h.id === "pat_idx1")).toBe(true);
    db.close();
  });

  it("replaces the previous index instead of duplicating rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "lm-idx-"));
    const patternsDir = join(root, "patterns");
    await writePatternAtomic(patternsDir, sample("pat_idx1", ["FR-012"], "Always lint plan before route."));
    await writeFile(join(patternsDir, "notes.md"), "not a pattern\n", "utf8");
    const indexPath = join(root, "index.sqlite");
    const lockPath = join(root, ".index.lock");
    const first = reindexFromMarkdown(patternsDir, indexPath, lockPath);
    const second = reindexFromMarkdown(patternsDir, indexPath, lockPath);
    expect(first).toEqual({ indexed: 1, skipped: 1 });
    expect(second).toEqual({ indexed: 1, skipped: 1 });
    const db = openPatternIndex({ indexPath, lockPath });
    const hits = db.search({ frTag: "FR-012", limit: 5 });
    expect(hits).toHaveLength(1);
    expect(existsSync(lockPath)).toBe(true);
    db.close();
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe("openPatternIndex degrade", () => {
  it("returns indexAvailable false when binding cannot load", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const opened = openPatternIndexWithLoader({ indexPath: "/tmp/x.sqlite", lockPath: "/tmp/.lock" }, () => {
        throw new Error("dlopen failed");
      });
      expect(opened.indexAvailable).toBe(false);
      expect(opened.index).toBeNull();
      expect(opened.unavailableReason).toBe("BINDING_MISSING");
      expect(opened.search({ frTag: "FR-012" })).toEqual([]);
      expect(spy.mock.calls.flat().join(" ")).toContain("PATTERNS_INDEX_UNAVAILABLE");
      opened.close();
    } finally {
      spy.mockRestore();
    }
  });

  it("returns index null when the database cannot be opened", async () => {
    const root = await mkdtemp(join(tmpdir(), "lm-idx-"));
    const indexPath = join(root, "index.sqlite");
    const lockPath = join(root, ".index.lock");
    writeFileSync(indexPath, "not a database");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const opened = openPatternIndex({ indexPath, lockPath });
      expect(opened.indexAvailable).toBe(false);
      expect(opened.index).toBeNull();
      expect(opened.unavailableReason).toBe("OPEN_FAILED");
      expect(spy.mock.calls.flat().join(" ")).toContain("PATTERNS_INDEX_UNAVAILABLE");
      expect(existsSync(lockPath)).toBe(false);
      opened.close();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("upsertPattern", () => {
  it("indexes FR-005 signals and replaces the FTS row", async () => {
    const root = await mkdtemp(join(tmpdir(), "lm-idx-"));
    const opened = openPatternIndex({
      indexPath: join(root, "index.sqlite"),
      lockPath: join(root, ".index.lock"),
    });
    const index = opened.index;
    if (!index) throw new Error("expected sqlite index");
    upsertPattern(index, {
      frontmatter: {
        id: "pat_up1",
        kind: "failure",
        createdAt: "2026-10-15T12:00:00.000Z",
        updatedAt: "2026-10-15T12:00:00.000Z",
        signals: {
          frTags: ["FR-005", "FR-010"],
          taskKind: "code",
          stack: ["typescript"],
          engine: "cursor",
          errorClass: "lint",
          featureId: "003-ira-learning-memory",
        },
        evidenceRefs: ["task:T007"],
        useCount: 0,
        status: "active",
      },
      summary: "Key patterns by signal.",
    });
    const hits = searchPatterns(index, {
      frTag: "FR-005",
      taskKind: "code",
      stack: "typescript",
      engine: "cursor",
      errorClass: "lint",
      featureId: "003-ira-learning-memory",
      text: "signal",
      limit: 5,
    });
    expect(hits.map((hit) => hit.id)).toEqual(["pat_up1"]);
    expect(hits[0]?.frTags).toEqual(["FR-005", "FR-010"]);

    upsertPattern(index, {
      frontmatter: {
        id: "pat_up1",
        kind: "failure",
        createdAt: "2026-10-15T12:00:00.000Z",
        updatedAt: "2026-10-16T12:00:00.000Z",
        signals: { frTags: ["FR-005"], taskKind: "code" },
        evidenceRefs: ["task:T007"],
        useCount: 1,
        status: "archived",
      },
      summary: "Archived lesson.",
    });
    expect(searchPatterns(index, { frTag: "FR-005", limit: 5 })).toEqual([]);
    expect(searchPatterns(index, { frTag: "FR-005", includeArchived: true, limit: 5 })).toHaveLength(1);
    opened.close();
  });
});

function sample(id: string, frTags: string[], summary: string) {
  return {
    frontmatter: {
      id,
      kind: "failure" as const,
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
      signals: { frTags, taskKind: "code" as const },
      evidenceRefs: ["task:T002"],
      useCount: 0,
      status: "active" as const,
    },
    summary,
  };
}
