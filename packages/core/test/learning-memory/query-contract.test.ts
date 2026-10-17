import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listPatterns } from "../../src/learning-memory/query.js";
import { writePatternAtomic } from "../../src/learning-memory/pattern-io.js";
import { reindexFromMarkdown } from "../../src/learning-memory/pattern-index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function seedRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lm-query-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# program\n");
  const patternsDir = join(root, ".superspec", "patterns");
  await writePatternAtomic(patternsDir, {
    frontmatter: {
      id: "pat_query1",
      kind: "failure",
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-16T12:00:00.000Z",
      signals: {
        frTags: ["FR-012"],
        taskKind: "code",
        featureId: "003-ira-learning-memory",
      },
      evidenceRefs: ["task:T004"],
      useCount: 2,
      status: "active",
    },
    summary: "Always lint plan before route.",
  });
  await writePatternAtomic(patternsDir, {
    frontmatter: {
      id: "pat_query2",
      kind: "success",
      createdAt: "2026-10-14T12:00:00.000Z",
      updatedAt: "2026-10-14T12:00:00.000Z",
      signals: {
        frTags: ["FR-005"],
        taskKind: "code",
        featureId: "003-ira-learning-memory",
      },
      evidenceRefs: ["task:T003"],
      useCount: 0,
      status: "active",
    },
    summary: "Unrelated tag pattern.",
  });
  reindexFromMarkdown(
    patternsDir,
    join(patternsDir, "index.sqlite"),
    join(patternsDir, ".index.lock"),
  );
  return root;
}

describe("listPatterns", () => {
  it("filters by featureId and frTag", async () => {
    const seededRepo = await seedRepo();
    const res = await listPatterns({
      projectRoot: seededRepo,
      featureId: "003-ira-learning-memory",
      frTag: "FR-012",
      limit: 20,
    });
    expect(res.patterns.length).toBeGreaterThan(0);
    expect(res.patterns.every((p) => p.signals.frTags.includes("FR-012"))).toBe(true);
    expect(res.patterns.every((p) => p.signals.featureId === "003-ira-learning-memory")).toBe(true);
  });

  it("truncates summaryPreview to 240 characters", async () => {
    const root = await mkdtemp(join(tmpdir(), "lm-query-"));
    roots.push(root);
    await writeFile(join(root, "program.md"), "# program\n");
    const patternsDir = join(root, ".superspec", "patterns");
    const longSummary = "x".repeat(300);
    await writePatternAtomic(patternsDir, {
      frontmatter: {
        id: "pat_long1",
        kind: "failure",
        createdAt: "2026-10-15T12:00:00.000Z",
        updatedAt: "2026-10-15T12:00:00.000Z",
        signals: { frTags: ["FR-012"], taskKind: "code" },
        evidenceRefs: ["task:T001"],
        useCount: 0,
        status: "active",
      },
      summary: longSummary,
    });
    reindexFromMarkdown(
      patternsDir,
      join(patternsDir, "index.sqlite"),
      join(patternsDir, ".index.lock"),
    );
    const res = await listPatterns({ projectRoot: root, frTag: "FR-012", limit: 5 });
    expect(res.patterns[0]?.summaryPreview).toHaveLength(240);
    expect(res.patterns[0]?.summaryPreview).toBe(longSummary.slice(0, 240));
  });

  it("falls back to markdown when the index is corrupt", async () => {
    const seededRepo = await seedRepo();
    const patternsDir = join(seededRepo, ".superspec", "patterns");
    writeFileSync(join(patternsDir, "index.sqlite"), "not a database");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await listPatterns({
        projectRoot: seededRepo,
        frTag: "FR-012",
        limit: 20,
      });
      expect(res.warnings).toContain("PATTERNS_STORE_UNREADABLE");
      expect(res.patterns.some((p) => p.id === "pat_query1")).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("paginates with cursor", async () => {
    const seededRepo = await seedRepo();
    const first = await listPatterns({ projectRoot: seededRepo, limit: 1 });
    expect(first.patterns).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = await listPatterns({
      projectRoot: seededRepo,
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.patterns).toHaveLength(1);
    expect(second.patterns[0]?.id).not.toBe(first.patterns[0]?.id);
  });
});
