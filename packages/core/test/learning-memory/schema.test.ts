import { describe, it, expect } from "vitest";
import {
  PatternFrontmatterSchema,
  PatternRecordSchema,
  PatternsListQuerySchema,
  PatternsListResponseSchema,
} from "../../src/learning-memory/schema.js";

describe("PatternFrontmatterSchema", () => {
  it("parses active failure pattern with evidence refs", () => {
    const parsed = PatternFrontmatterSchema.parse({
      id: "pat_01JABC",
      kind: "failure",
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
      signals: { frTags: ["FR-012"], taskKind: "code", featureId: "003-ira-learning-memory" },
      evidenceRefs: ["task:T004"],
      useCount: 0,
      status: "active",
    });
    expect(parsed.kind).toBe("failure");
    expect(parsed.signals.frTags).toEqual(["FR-012"]);
  });
});

describe("PatternRecordSchema", () => {
  it("parses frontmatter and summary body", () => {
    const parsed = PatternRecordSchema.parse({
      frontmatter: {
        id: "pat_rec1",
        kind: "success",
        createdAt: "2026-10-15T12:00:00.000Z",
        updatedAt: "2026-10-15T12:00:00.000Z",
        signals: { frTags: ["FR-005"], taskKind: "code" },
        evidenceRefs: ["task:T003"],
        useCount: 1,
        status: "active",
      },
      summary: "Bounded lesson markdown.",
    });
    expect(parsed.summary).toBe("Bounded lesson markdown.");
  });
});

describe("PatternsListQuerySchema", () => {
  it("parses MCP patterns-list request shape", () => {
    const parsed = PatternsListQuerySchema.parse({
      projectRoot: "/abs/repo",
      featureId: "003-ira-learning-memory",
      frTag: "FR-012",
      kind: "failure",
      limit: 20,
      cursor: null,
    });
    expect(parsed.limit).toBe(20);
    expect(parsed.cursor).toBeNull();
  });
});

describe("PatternsListResponseSchema", () => {
  it("parses patterns-list response with nextCursor", () => {
    const parsed = PatternsListResponseSchema.parse({
      patterns: [
        {
          id: "pat_list1",
          kind: "failure",
          signals: { frTags: ["FR-012"], taskKind: "code" },
          summaryPreview: "First 240 chars...",
          evidenceRefs: ["task:T004"],
          useCount: 2,
          updatedAt: "2026-10-15T12:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    expect(parsed.patterns).toHaveLength(1);
    expect(parsed.patterns[0]?.summaryPreview).toContain("240");
  });
});
