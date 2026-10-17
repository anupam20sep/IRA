import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { judgePatterns } from "../../src/learning-memory/judge.js";
import { DEFAULT_LEARNING_CONFIG, type LearningConfig } from "../../src/learning-memory/config.js";
import { openPatternIndex, upsertPattern } from "../../src/learning-memory/pattern-index.js";
import { writePatternAtomic } from "../../src/learning-memory/pattern-io.js";
import { scanMarkdownCandidates } from "../../src/learning-memory/markdown-scan.js";
import { retrievePatterns, type RetrieveStore } from "../../src/learning-memory/retrieve.js";
import type { RetrieveContext } from "../../src/learning-memory/types.js";

function defaultConfig(): LearningConfig {
  return {
    ...DEFAULT_LEARNING_CONFIG,
    features: { ...DEFAULT_LEARNING_CONFIG.features },
  };
}

function testConfig(overrides: Partial<LearningConfig> = {}): LearningConfig {
  return {
    enabled: true,
    retrieve: true,
    distillEnabled: true,
    maxInjectionBytes: 50,
    maxSummaryBytes: 1024,
    judgeMinScore: 0.9,
    distill: { mode: "heuristic" },
    features: {},
    ...overrides,
  };
}

function testCtx(overrides: Partial<RetrieveContext> = {}): RetrieveContext {
  return {
    featureId: "003-ira-learning-memory",
    taskId: "T001",
    implementsFr: ["FR-003"],
    kind: "code",
    complexity: "moderate",
    capabilityTags: [],
    ...overrides,
  };
}

describe("judgePatterns", () => {
  it("drops candidates below min score and enforces byte cap", () => {
    const summary = judgePatterns(
      [
        { id: "pat_a", score: 0.2, summary: "noise" },
        { id: "pat_b", score: 0.95, summary: "Short high-value hint." },
      ],
      testCtx(),
      testConfig(),
    );
    expect(summary?.patternIds).toEqual(["pat_b"]);
    expect(Buffer.byteLength(summary!.text, "utf8")).toBeLessThanOrEqual(50);
  });

  it("returns null when every candidate is below threshold", () => {
    const summary = judgePatterns(
      [{ id: "pat_a", score: 0.1, summary: "low relevance" }],
      testCtx(),
      testConfig(),
    );
    expect(summary).toBeNull();
  });

  it("accumulates highest-scored patterns until byte cap is reached", () => {
    const summary = judgePatterns(
      [
        { id: "pat_a", score: 0.99, summary: "First hint." },
        { id: "pat_b", score: 0.98, summary: "Second hint that is longer." },
        { id: "pat_c", score: 0.97, summary: "Third." },
      ],
      testCtx(),
      testConfig({ maxInjectionBytes: 40, judgeMinScore: 0.5 }),
    );
    expect(summary?.patternIds.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(summary!.text, "utf8")).toBeLessThanOrEqual(40);
    expect(summary?.patternIds[0]).toBe("pat_a");
  });
});

describe("retrievePatterns", () => {
  it("returns null when store empty without error", async () => {
    const store = await emptyIndexFixture();
    try {
      const summary = await retrievePatterns(
        store,
        testCtx({ taskId: "T009", implementsFr: ["FR-999"], kind: "code" }),
        defaultConfig(),
      );
      expect(summary).toBeNull();
    } finally {
      store.close();
    }
  });

  it("returns a judged summary from FTS when the index has a matching active pattern", async () => {
    const store = await emptyIndexFixture();
    try {
      upsertPattern(store.index!, patternRecord("pat_fts1", ["FR-003"], "active", "Prefer FTS when the index loads."));
      const summary = await retrievePatterns(
        store,
        testCtx({ taskId: "T009", implementsFr: ["FR-003"], kind: "code" }),
        defaultConfig(),
      );
      expect(summary?.patternIds).toEqual(["pat_fts1"]);
      expect(summary?.text).toContain("Prefer FTS when the index loads.");
      expect(Buffer.byteLength(summary!.text, "utf8")).toBeLessThanOrEqual(defaultConfig().maxInjectionBytes);
    } finally {
      store.close();
    }
  });

  it("excludes archived patterns by default", async () => {
    const store = await emptyIndexFixture();
    try {
      upsertPattern(store.index!, patternRecord("pat_old", ["FR-003"], "archived", "Archived lesson must stay out."));
      const summary = await retrievePatterns(
        store,
        testCtx({ taskId: "T009", implementsFr: ["FR-003"], kind: "code" }),
        defaultConfig(),
      );
      expect(summary).toBeNull();
    } finally {
      store.close();
    }
  });
});

describe("retrievePatterns markdown fallback", () => {
  it("returns judged summary from md files when index unavailable", async () => {
    const repo = await seedMarkdownOnlyStore({ frTag: "FR-012" });
    const summary = await retrievePatterns(
      { index: null, indexAvailable: false, patternsDir: repo.patternsDir },
      testCtx({ taskId: "T009", implementsFr: ["FR-012"], kind: "code" }),
      defaultConfig(),
    );
    expect(summary?.patternIds.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(summary!.text, "utf8")).toBeLessThanOrEqual(defaultConfig().maxInjectionBytes);
  });

  it("does not throw when SQLite is absent and skips archived markdown", async () => {
    const repo = await seedMarkdownOnlyStore({ frTag: "FR-012", status: "archived" });
    await expect(
      retrievePatterns(
        { index: null, indexAvailable: false, patternsDir: repo.patternsDir },
        testCtx({ taskId: "T009", implementsFr: ["FR-012"], kind: "code" }),
        defaultConfig(),
      ),
    ).resolves.toBeNull();
  });
});

describe("scanMarkdownCandidates", () => {
  it("stops after the file budget and skips invalid markdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "lm-scan-"));
    const patternsDir = join(root, "patterns");
    await writePatternAtomic(
      patternsDir,
      patternRecord("pat_a", ["FR-001"], "active", "First file."),
    );
    await writeFile(join(patternsDir, "pat_bad.md"), "not a pattern\n", "utf8");
    await writePatternAtomic(
      patternsDir,
      patternRecord("pat_b", ["FR-012"], "active", "Second file matches."),
    );

    const ctx = testCtx({ taskId: "T009", implementsFr: ["FR-012"], kind: "code" });
    const capped = await scanMarkdownCandidates(patternsDir, ctx, { maxFiles: 1 });
    expect(capped).toEqual([]);

    const scanned = await scanMarkdownCandidates(patternsDir, ctx, { maxFiles: 200 });
    expect(scanned.map((candidate) => candidate.id)).toEqual(["pat_b"]);
  });
});

async function emptyIndexFixture(): Promise<RetrieveStore & { close(): void }> {
  const root = await mkdtemp(join(tmpdir(), "lm-retrieve-"));
  const opened = openPatternIndex({
    indexPath: join(root, "index.sqlite"),
    lockPath: join(root, ".index.lock"),
  });
  if (!opened.index || !opened.indexAvailable) {
    opened.close();
    throw new Error("expected an empty SQLite pattern index");
  }
  return {
    index: opened.index,
    indexAvailable: true,
    patternsDir: join(root, "patterns"),
    close: () => opened.close(),
  };
}

async function seedMarkdownOnlyStore(options: {
  frTag: string;
  status?: "active" | "archived";
}): Promise<{ patternsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "lm-md-"));
  const patternsDir = join(root, "patterns");
  await writePatternAtomic(
    patternsDir,
    patternRecord("pat_md1", [options.frTag], options.status ?? "active", "Scan markdown when the index is unavailable."),
  );
  return { patternsDir };
}

function patternRecord(
  id: string,
  frTags: string[],
  status: "active" | "archived",
  summary: string,
) {
  return {
    frontmatter: {
      id,
      kind: "success" as const,
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
      signals: { frTags, taskKind: "code" as const },
      evidenceRefs: ["task:T009"],
      useCount: 0,
      status,
    },
    summary,
  };
}
