import { describe, it, expect } from "vitest";
import { judgePatterns } from "../../src/learning-memory/judge.js";
import type { LearningConfig } from "../../src/learning-memory/config.js";
import type { RetrieveContext } from "../../src/learning-memory/types.js";

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
