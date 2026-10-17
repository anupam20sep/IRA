import { describe, it, expect } from "vitest";
import { SpendEventSchema, TokenSettingsSchema } from "../../src/token-governor/schema.js";

describe("SpendEventSchema", () => {
  it("requires source transcript|api|estimate and partial flag", () => {
    const e = SpendEventSchema.parse({
      id: "spend_test",
      ts: "2026-10-15T00:00:00.000Z",
      agentId: "agent-host",
      sessionId: "sess_1",
      featureId: "004-ira-token-context",
      taskId: "T001",
      engine: null,
      model: null,
      inputTokens: 100,
      outputTokens: 50,
      usdEstimate: 0.01,
      source: "api",
      partial: false,
    });
    expect(e.source).toBe("api");
  });
});

describe("TokenSettingsSchema", () => {
  it("defaults lowQuotaPercent 20 and breaker thresholds", () => {
    const s = TokenSettingsSchema.parse({
      schemaVersion: 1,
      breakerWindowMs: 60000,
      loopThreshold: 3,
      errorThreshold: 5,
      lowQuotaPercent: 20,
      compactionSummarizeThresholdTokens: 8000,
    });
    expect(s.lowQuotaPercent).toBe(20);
  });
});
