import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout, tokenRoot } from "../../src/token-governor/paths.js";
import { appendSpendEvent } from "../../src/token-governor/spend-ledger.js";
import {
  setBudget,
  getEnforcedRemaining,
  wouldExceedRemaining,
  syncBriefBudgetMirror,
  syncRosterBudgetMirror,
} from "../../src/token-governor/budgets.js";

async function hive(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hive-"));
  await ensureTokenLayout(root);
  return root;
}

describe("budgets", () => {
  it("uses tighter remaining cap across agent and feature usd", async () => {
    const hiveRoot = await hive();
    await setBudget(hiveRoot, { scope: "agent", scopeId: "a1", unit: "usd", cap: 10 });
    await setBudget(hiveRoot, { scope: "feature", scopeId: "f1", unit: "usd", cap: 5 });
    await appendSpendEvent(hiveRoot, {
      agentId: "a1",
      sessionId: "s",
      featureId: "f1",
      taskId: null,
      inputTokens: 0,
      outputTokens: 0,
      usdEstimate: 4,
      source: "api",
      partial: false,
    });
    const rem = await getEnforcedRemaining(hiveRoot, { agentId: "a1", featureId: "f1" });
    expect(rem.usd).toBe(1);
  });

  it("treats a null cap as unlimited", async () => {
    const hiveRoot = await hive();
    await setBudget(hiveRoot, { scope: "agent", scopeId: "a1", unit: "usd", cap: null });
    await setBudget(hiveRoot, { scope: "feature", scopeId: "f1", unit: "tokens", cap: null });
    await appendSpendEvent(hiveRoot, {
      agentId: "a1",
      sessionId: "s",
      featureId: "f1",
      taskId: null,
      inputTokens: 100,
      outputTokens: 50,
      usdEstimate: 9,
      source: "api",
      partial: false,
    });
    const rem = await getEnforcedRemaining(hiveRoot, { agentId: "a1", featureId: "f1" });
    expect(rem.usd).toBeNull();
    expect(rem.tokens).toBeNull();
    expect(wouldExceedRemaining(rem, { usd: 1000, tokens: 1000 })).toBe(false);
  });

  it("reports explicit zero remaining when the cap is zero before any spend", async () => {
    const hiveRoot = await hive();
    await setBudget(hiveRoot, { scope: "feature", scopeId: "f1", unit: "usd", cap: 0 });
    const rem = await getEnforcedRemaining(hiveRoot, { featureId: "f1" });
    expect(rem.usd).toBe(0);
    expect(wouldExceedRemaining(rem, { usd: 0 })).toBe(true);
  });

  it("reports explicit zero remaining when the cap is at or below spend", async () => {
    const hiveRoot = await hive();
    await setBudget(hiveRoot, { scope: "feature", scopeId: "f1", unit: "usd", cap: 3 });
    await setBudget(hiveRoot, { scope: "feature", scopeId: "f1", unit: "tokens", cap: 10 });
    await appendSpendEvent(hiveRoot, {
      agentId: "a1",
      sessionId: "s",
      featureId: "f1",
      taskId: null,
      inputTokens: 8,
      outputTokens: 4,
      usdEstimate: 3,
      source: "api",
      partial: false,
    });
    const rem = await getEnforcedRemaining(hiveRoot, { featureId: "f1" });
    expect(rem.usd).toBe(0);
    expect(rem.tokens).toBe(0);
    expect(wouldExceedRemaining(rem, { usd: 0, tokens: 0 })).toBe(true);
    expect(wouldExceedRemaining(rem, {})).toBe(true);
  });

  it("uses the tighter remaining token cap and allows a request equal to remaining", async () => {
    const hiveRoot = await hive();
    await setBudget(hiveRoot, { scope: "agent", scopeId: "a1", unit: "tokens", cap: 200 });
    await setBudget(hiveRoot, { scope: "feature", scopeId: "f1", unit: "tokens", cap: 80 });
    await appendSpendEvent(hiveRoot, {
      agentId: "a1",
      sessionId: "s",
      featureId: "f1",
      taskId: null,
      inputTokens: 30,
      outputTokens: 20,
      usdEstimate: null,
      source: "api",
      partial: false,
    });
    const rem = await getEnforcedRemaining(hiveRoot, { agentId: "a1", featureId: "f1" });
    expect(rem.tokens).toBe(30);
    expect(wouldExceedRemaining(rem, { tokens: 30 })).toBe(false);
    expect(wouldExceedRemaining(rem, { tokens: 31 })).toBe(true);
  });

  it("upserts brief and roster mirrors into budgets.json", async () => {
    const hiveRoot = await hive();
    await syncRosterBudgetMirror(hiveRoot, "a1", { budgetTokens: 100, budgetUsd: null });
    await syncBriefBudgetMirror(hiveRoot, "f1", { budgetTokens: 40, budgetUsd: 2 });
    await appendSpendEvent(hiveRoot, {
      agentId: "a1",
      sessionId: "s",
      featureId: "f1",
      taskId: null,
      inputTokens: 10,
      outputTokens: 0,
      usdEstimate: 0.5,
      source: "api",
      partial: false,
    });
    const rem = await getEnforcedRemaining(hiveRoot, { agentId: "a1", featureId: "f1" });
    expect(rem.tokens).toBe(30);
    expect(rem.usd).toBe(1.5);

    await syncRosterBudgetMirror(hiveRoot, "a1", { budgetUsd: 9 });
    const stored = JSON.parse(await readFile(join(tokenRoot(hiveRoot), "budgets.json"), "utf8")) as {
      items: { scope: string; unit: string; cap: number | null }[];
    };
    const agentTokens = stored.items.find((row) => row.scope === "agent" && row.unit === "tokens");
    const agentUsd = stored.items.find((row) => row.scope === "agent" && row.unit === "usd");
    expect(agentTokens?.cap).toBe(100);
    expect(agentUsd?.cap).toBe(9);
  });

  it("merges on-disk brief and roster caps when budgets.json has no row", async () => {
    const hiveRoot = await hive();
    await mkdir(join(hiveRoot, "briefs"), { recursive: true });
    await writeFile(
      join(hiveRoot, "briefs", "f1.json"),
      JSON.stringify({ budgetTokens: null, budgetUsd: 5 }),
    );
    await writeFile(
      join(hiveRoot, "roster.json"),
      JSON.stringify([{ id: "a1", budgetTokens: 20, budgetUsd: null }]),
    );
    await appendSpendEvent(hiveRoot, {
      agentId: "a1",
      sessionId: "s",
      featureId: "f1",
      taskId: null,
      inputTokens: 5,
      outputTokens: 0,
      usdEstimate: 4,
      source: "api",
      partial: false,
    });
    const rem = await getEnforcedRemaining(hiveRoot, { agentId: "a1", featureId: "f1" });
    expect(rem.usd).toBe(1);
    expect(rem.tokens).toBe(15);
  });

  it("keeps an explicit budgets.json cap ahead of a different brief mirror", async () => {
    const hiveRoot = await hive();
    await setBudget(hiveRoot, { scope: "feature", scopeId: "f1", unit: "usd", cap: 10 });
    await mkdir(join(hiveRoot, "briefs"), { recursive: true });
    await writeFile(join(hiveRoot, "briefs", "f1.json"), JSON.stringify({ budgetUsd: 5, budgetTokens: 1 }));
    await appendSpendEvent(hiveRoot, {
      agentId: "a1",
      sessionId: "s",
      featureId: "f1",
      taskId: null,
      inputTokens: 0,
      outputTokens: 0,
      usdEstimate: 4,
      source: "api",
      partial: false,
    });
    const rem = await getEnforcedRemaining(hiveRoot, { featureId: "f1" });
    expect(rem.usd).toBe(6);
    expect(rem.tokens).toBe(1);

    await setBudget(hiveRoot, { scope: "feature", scopeId: "f1", unit: "tokens", cap: null });
    const unlimited = await getEnforcedRemaining(hiveRoot, { featureId: "f1" });
    expect(unlimited.tokens).toBeNull();
  });
});
