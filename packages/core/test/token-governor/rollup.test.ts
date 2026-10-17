import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";
import { appendSpendEvent } from "../../src/token-governor/spend-ledger.js";
import { querySpendTotals } from "../../src/token-governor/rollup.js";

describe("rollup", () => {
  it("sums tokens by featureId", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    await appendSpendEvent(hive, {
      agentId: "a",
      sessionId: "s",
      featureId: "f1",
      taskId: null,
      inputTokens: 100,
      outputTokens: 0,
      usdEstimate: null,
      source: "api",
      partial: false,
    });
    await appendSpendEvent(hive, {
      agentId: "a",
      sessionId: "s",
      featureId: "f1",
      taskId: null,
      inputTokens: 50,
      outputTokens: 0,
      usdEstimate: null,
      source: "api",
      partial: false,
    });
    const t = await querySpendTotals(hive, { featureId: "f1" });
    expect(t.inputTokens).toBe(150);
    expect(t.events).toBe(2);
  });

  it("sums usd only for non-null estimates", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    await appendSpendEvent(hive, {
      agentId: "a",
      sessionId: "s",
      featureId: "f2",
      taskId: null,
      inputTokens: 0,
      outputTokens: 0,
      usdEstimate: 1,
      source: "api",
      partial: false,
    });
    await appendSpendEvent(hive, {
      agentId: "a",
      sessionId: "s",
      featureId: "f2",
      taskId: null,
      inputTokens: 0,
      outputTokens: 0,
      usdEstimate: null,
      source: "estimate",
      partial: true,
    });
    await appendSpendEvent(hive, {
      agentId: "a",
      sessionId: "s",
      featureId: "f2",
      taskId: null,
      inputTokens: 0,
      outputTokens: 0,
      usdEstimate: null,
      source: "estimate",
      partial: true,
    });
    const t = await querySpendTotals(hive, { featureId: "f2" });
    expect(t.usdEstimate).toBe(1);
  });

  it("returns null usd when no events have estimates", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    await appendSpendEvent(hive, {
      agentId: "a",
      sessionId: "s",
      featureId: "f3",
      taskId: null,
      inputTokens: 10,
      outputTokens: 5,
      usdEstimate: null,
      source: "estimate",
      partial: true,
    });
    const t = await querySpendTotals(hive, { featureId: "f3" });
    expect(t.usdEstimate).toBeNull();
  });
});
