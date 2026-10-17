import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout, tokenRoot } from "../../src/token-governor/paths.js";
import { registerTokenGovernor, tokenHooksImpl } from "../../src/token-governor/hooks-impl.js";
import { isTokenGovernorRegistered } from "../../src/token-governor/index.js";
import { setBudget } from "../../src/token-governor/budgets.js";
import { appendSpendEvent } from "../../src/token-governor/spend-ledger.js";

describe("token registration", () => {
  it("starts unregistered before hive bootstrap in unit test", () => {
    expect(isTokenGovernorRegistered()).toBe(false);
  });
});

describe("TokenHooks.beforeDispatch", () => {
  it("denies dispatch when remaining usd is zero after Slice A validates", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    await setBudget(hive, { scope: "feature", scopeId: "f1", unit: "usd", cap: 0 });
    registerTokenGovernor(hive);
    const gate = await tokenHooksImpl.beforeDispatch!({
      featureId: "f1",
      taskId: "T011",
      agentId: "a1",
      estimatedUsd: 0.01,
      engineRung: "host",
      sliceAActive: false,
    } as any);
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect(gate.reasonClass).toBe("budget_exceed");
  });

  it("allows host engine with no spend write when Slice A active", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    registerTokenGovernor(hive);
    const spendPath = join(tokenRoot(hive), "spend.jsonl");
    const before = await readFile(spendPath, "utf8");
    const gate = await tokenHooksImpl.beforeDispatch!({
      featureId: "f1",
      taskId: "T011",
      agentId: "a1",
      engineRung: "host",
      sliceAActive: true,
      hiveRoot: hive,
    } as any);
    expect(gate.allow).toBe(true);
    expect(await readFile(spendPath, "utf8")).toBe(before);
  });

  it("denies byok rung with SLICE_A_ONLY when Slice A active", async () => {
    const gate = await tokenHooksImpl.beforeDispatch!({
      featureId: "f1",
      taskId: "T011",
      agentId: "a1",
      engineRung: "byok",
      sliceAActive: true,
    } as any);
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect((gate as any).reason).toBe("SLICE_A_ONLY");
  });

  it("denies DispatchContext when the hive budget remaining is zero", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    await setBudget(hive, { scope: "feature", scopeId: "f1", unit: "usd", cap: 0 });
    const gate = await tokenHooksImpl.beforeDispatch!({
      intent: {
        featureId: "f1",
        taskId: "T011",
        agentId: "a1",
        hiveRoot: hive,
      },
      brief: { budgetTokens: null, budgetUsd: null },
      estimatedUsd: 0.01,
      sliceAActive: false,
    } as any);
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect(gate.reasonClass).toBe("budget_exceed");
  });

  it("denies when a forecast exceeds the tighter remaining cap", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    await setBudget(hive, { scope: "feature", scopeId: "f1", unit: "usd", cap: 7 });
    await writeDonePeers(hive);
    await appendSpendEvent(hive, spend("T001", 2));
    await appendSpendEvent(hive, spend("T002", 4));
    registerTokenGovernor(hive);
    const gate = await tokenHooksImpl.beforeDispatch!({
      featureId: "f1",
      taskId: "T099",
      agentId: "a1",
      taskKind: "code",
      engineRung: "host",
      sliceAActive: false,
    } as any);
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect(gate.reasonClass).toBe("budget_exceed");
  });
});

describe("TokenHooks registration and side effects", () => {
  it("does not register when the hive directory is absent", () => {
    const missing = join(tmpdir(), `t011-absent-${Date.now()}`);
    expect(() => registerTokenGovernor(missing)).not.toThrow();
    expect(existsSync(missing)).toBe(false);
  });

  it("recordSpend appends after Slice A and skips the write while Slice A is active", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    registerTokenGovernor(hive);
    const spendPath = join(tokenRoot(hive), "spend.jsonl");
    await tokenHooksImpl.recordSpend!({
      ts: "2026-10-17T00:00:00.000Z",
      agentId: "a1",
      featureId: "f1",
      engine: null,
      model: null,
      inputTokens: 3,
      outputTokens: 1,
      usdEstimate: 0.1,
      source: "api",
      sliceAActive: true,
    } as any);
    expect((await readFile(spendPath, "utf8")).trim()).toBe("");

    await tokenHooksImpl.recordSpend!({
      ts: "2026-10-17T00:00:01.000Z",
      agentId: "a1",
      featureId: "f1",
      engine: "host",
      model: null,
      inputTokens: 3,
      outputTokens: 1,
      usdEstimate: 0.1,
      source: "api",
      sliceAActive: false,
    } as any);
    expect(await readFile(spendPath, "utf8")).toContain('"agentId":"a1"');
  });

  it("onRecordResult compacts after Slice A and skips the write while Slice A is active", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    registerTokenGovernor(hive);
    const compactionPath = join(tokenRoot(hive), "compaction.jsonl");
    await tokenHooksImpl.onRecordResult!({
      featureId: "f1",
      taskId: "T011",
      passed: false,
      reviewFailures: 1,
      agentId: "a1",
      sessionId: "s1",
      sliceAActive: true,
    } as any);
    expect((await readFile(compactionPath, "utf8")).trim()).toBe("");

    await tokenHooksImpl.onRecordResult!({
      featureId: "f1",
      taskId: "T011",
      passed: true,
      reviewFailures: 0,
      agentId: "a1",
      sessionId: "s1",
      sliceAActive: false,
    } as any);
    expect(await readFile(compactionPath, "utf8")).toContain('"taskId":"T011"');
  });
});

function spend(taskId: string, usdEstimate: number) {
  return {
    agentId: "a1",
    sessionId: "s",
    featureId: "f1",
    taskId,
    inputTokens: 10,
    outputTokens: 5,
    usdEstimate,
    source: "api" as const,
    partial: false,
  };
}

async function writeDonePeers(hive: string): Promise<void> {
  const task = (id: string) => ({
    id,
    featureId: "f1",
    title: id,
    implementsFr: ["FR-016"],
    dependsOn: [],
    assigneeAgentId: "a1",
    status: "done",
    kind: "code",
    complexity: "moderate",
    reviewFailures: 0,
    ceiling: 3,
    drift: "ok",
    capabilityTags: [],
    updatedAt: "2026-10-15T00:00:00.000Z",
  });
  await mkdir(join(hive, "ledger"), { recursive: true });
  await writeFile(
    join(hive, "ledger", "f1.json"),
    JSON.stringify({
      featureId: "f1",
      planPath: "specs/f1/plan.md",
      specDir: "specs/f1",
      maxReviewFailures: 3,
      updatedAt: "2026-10-15T00:00:00.000Z",
      tasks: [task("T001"), task("T002")],
    }),
  );
}
