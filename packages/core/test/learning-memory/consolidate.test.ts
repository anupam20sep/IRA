import { describe, it, expect, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  consolidateBucket,
  consolidateAfterDistill,
  buildSignalsKey,
  summaryTokenJaccard,
} from "../../src/learning-memory/consolidate.js";
import { writePatternAtomic, readPatternFile } from "../../src/learning-memory/pattern-io.js";

describe("summaryTokenJaccard", () => {
  it("returns 1 for identical token sets", () => {
    const a = "Use vitest for core unit tests always";
    expect(summaryTokenJaccard(a, a)).toBe(1);
  });

  it("returns high overlap for near-duplicate summaries", () => {
    const a = "Use vitest for core unit tests always";
    const b = "Use vitest for core unit tests always!";
    expect(summaryTokenJaccard(a, b)).toBeGreaterThanOrEqual(0.8);
  });
});

describe("buildSignalsKey", () => {
  it("joins sorted fr tags and task kind", () => {
    expect(
      buildSignalsKey({ frTags: ["FR-001", "FR-002"], taskKind: "code" }),
    ).toBe("FR-001|FR-002|code");
  });
});

describe("consolidateBucket", () => {
  it("merges summaries with >=80% token overlap", () => {
    const result = consolidateBucket(
      [
        {
          id: "pat_old",
          summary: "Use vitest for core unit tests always",
          signalsKey: "FR-001|code",
          useCount: 2,
        },
        {
          id: "pat_new",
          summary: "Use vitest for core unit tests always!",
          signalsKey: "FR-001|code",
          useCount: 1,
        },
      ],
      "pat_new",
    );
    expect(result.canonicalId).toBe("pat_new");
    expect(result.archivedIds).toContain("pat_old");
    expect(result.mergedUseCount).toBe(3);
  });

  it("does not archive when overlap is below threshold", () => {
    const result = consolidateBucket(
      [
        {
          id: "pat_a",
          summary: "Completely different lesson about eslint",
          signalsKey: "FR-001|code",
        },
        {
          id: "pat_b",
          summary: "Use vitest for core unit tests always",
          signalsKey: "FR-001|code",
        },
      ],
      "pat_b",
    );
    expect(result.archivedIds).toEqual([]);
  });

  it("does not merge across different signal buckets", () => {
    const result = consolidateBucket(
      [
        {
          id: "pat_old",
          summary: "Use vitest for core unit tests always",
          signalsKey: "FR-002|code",
        },
        {
          id: "pat_new",
          summary: "Use vitest for core unit tests always!",
          signalsKey: "FR-001|code",
        },
      ],
      "pat_new",
    );
    expect(result.archivedIds).toEqual([]);
  });
});

describe("consolidateAfterDistill", () => {
  const sampleRecord = (id: string, summary: string, useCount = 0) => ({
    frontmatter: {
      id,
      kind: "success" as const,
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
      signals: { frTags: ["FR-001"], taskKind: "code" as const },
      evidenceRefs: ["task:T010"],
      useCount,
      status: "active" as const,
    },
    summary,
  });

  it("returns SLICE_A_ONLY without writing when gate denies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lm-cons-"));
    await writePatternAtomic(dir, sampleRecord("pat_new", "Use vitest always"));
    const result = await consolidateAfterDistill(
      {
        patternsDir: dir,
        index: null,
        sliceAValidated: false,
      },
      "pat_new",
    );
    expect(result).toEqual({ skipped: true, code: "SLICE_A_ONLY" });
    const round = await readPatternFile(join(dir, "pat_new.md"));
    expect(round.frontmatter.status).toBe("active");
  });

  it("archives near-duplicate and merges useCount when gate allows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lm-cons-"));
    await writePatternAtomic(
      dir,
      sampleRecord("pat_old", "Use vitest for core unit tests always", 4),
    );
    await writePatternAtomic(
      dir,
      sampleRecord("pat_new", "Use vitest for core unit tests always!", 1),
    );

    const upsert = vi.fn();
    const result = await consolidateAfterDistill(
      {
        patternsDir: dir,
        index: { upsert, search: vi.fn(), close: vi.fn() },
        sliceAValidated: true,
      },
      "pat_new",
    );

    expect(result.skipped).toBeUndefined();
    if ("skipped" in result && result.skipped) throw new Error("unexpected skip");
    expect(result.archivedIds).toContain("pat_old");
    expect(result.canonicalId).toBe("pat_new");

    const archived = await readPatternFile(join(dir, "pat_old.md"));
    expect(archived.frontmatter.status).toBe("archived");

    const canonical = await readPatternFile(join(dir, "pat_new.md"));
    expect(canonical.frontmatter.useCount).toBe(5);

    expect(upsert).toHaveBeenCalled();
    const upsertArchived = upsert.mock.calls.find(
      (c) => c[0].frontmatter.id === "pat_old",
    );
    expect(upsertArchived?.[0].frontmatter.status).toBe("archived");
  });
});
