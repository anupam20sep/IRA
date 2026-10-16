import { describe, it, expect } from "vitest";
import {
  applyCrossEngineReview,
  isReviewerPersona,
  type CrossEngineReviewContext,
} from "../../src/engines/review-policy.js";

describe("isReviewerPersona", () => {
  it("detects task-reviewer persona path", () => {
    expect(isReviewerPersona("/repo/agents/task-reviewer.md")).toBe(true);
    expect(isReviewerPersona("/repo/agents/implementer.md")).toBe(false);
  });
});

function ctx(overrides: Partial<CrossEngineReviewContext> & Pick<CrossEngineReviewContext, "proposedEngineId">): CrossEngineReviewContext {
  return {
    crossEngineReview: true,
    personaPath: "/repo/agents/task-reviewer.md",
    taskId: "T011",
    engineStarts: [],
    healthByEngineId: {},
    ...overrides,
  };
}

describe("applyCrossEngineReview", () => {
  it("returns proposed engine when policy is off", () => {
    const r = applyCrossEngineReview(
      ctx({
        crossEngineReview: false,
        proposedEngineId: "codex",
        engineStarts: [
          {
            engineId: "claude",
            personaPath: "/repo/agents/implementer.md",
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
        healthByEngineId: {
          claude: { health: "ok" },
          codex: { health: "ok" },
        },
      }),
    );
    expect(r).toEqual({ engineId: "codex" });
  });

  it("returns proposed engine for non-reviewer personas", () => {
    const r = applyCrossEngineReview(
      ctx({
        personaPath: "/repo/agents/implementer.md",
        proposedEngineId: "claude",
        engineStarts: [
          {
            engineId: "codex",
            personaPath: "/repo/agents/task-reviewer.md",
            at: "2026-01-02T00:00:00.000Z",
          },
        ],
        healthByEngineId: { claude: { health: "ok" }, codex: { health: "ok" } },
      }),
    );
    expect(r).toEqual({ engineId: "claude" });
  });

  it("keeps reviewer binding when it already differs from implementer start", () => {
    const r = applyCrossEngineReview(
      ctx({
        proposedEngineId: "codex",
        engineStarts: [
          {
            engineId: "claude",
            personaPath: "/repo/agents/implementer.md",
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
        healthByEngineId: { claude: { health: "ok" }, codex: { health: "ok" } },
      }),
    );
    expect(r).toEqual({ engineId: "codex" });
  });

  it("picks a different healthy engine when reviewer matches implementer", () => {
    const r = applyCrossEngineReview(
      ctx({
        proposedEngineId: "claude",
        engineStarts: [
          {
            engineId: "claude",
            personaPath: "/repo/agents/implementer.md",
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
        healthByEngineId: {
          claude: { health: "ok" },
          codex: { health: "ok" },
          "cursor-agent": { health: "missing" },
        },
      }),
    );
    expect(r.engineId).toBe("codex");
    expect(r.policyDegraded).toBeUndefined();
  });

  it("uses latest non-reviewer engine.start for the task", () => {
    const r = applyCrossEngineReview(
      ctx({
        proposedEngineId: "codex",
        engineStarts: [
          {
            engineId: "claude",
            personaPath: "/repo/agents/implementer.md",
            at: "2026-01-01T00:00:00.000Z",
          },
          {
            engineId: "codex",
            personaPath: "/repo/agents/implementer.md",
            at: "2026-01-02T00:00:00.000Z",
          },
        ],
        healthByEngineId: { claude: { health: "ok" }, codex: { health: "ok" } },
      }),
    );
    expect(r.engineId).toBe("claude");
  });

  it("falls back to busy non-reviewer roster engine when implementer start is missing", () => {
    const r = applyCrossEngineReview(
      ctx({
        proposedEngineId: "codex",
        busyNonReviewerEngineId: "claude",
        healthByEngineId: { claude: { health: "ok" }, codex: { health: "ok" } },
      }),
    );
    expect(r).toEqual({ engineId: "codex" });
  });

  it("degrades when only one healthy engine remains", () => {
    const r = applyCrossEngineReview(
      ctx({
        proposedEngineId: "claude",
        engineStarts: [
          {
            engineId: "claude",
            personaPath: "/repo/agents/implementer.md",
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
        healthByEngineId: {
          claude: { health: "ok" },
          codex: { health: "unauthorized" },
        },
      }),
    );
    expect(r).toEqual({
      engineId: "claude",
      policyDegraded: { reason: "single_healthy_engine" },
    });
  });
});
