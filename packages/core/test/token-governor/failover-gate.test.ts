import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DispatchIntent } from "../../src/command-plane/hooks.js";
import { dispatchEngine } from "../../src/engines/dispatch.js";
import * as envScrub from "../../src/engines/env-scrub.js";
import type { FailoverPolicy } from "../../src/engines/types.js";
import { setBudget } from "../../src/token-governor/budgets.js";
import { reGateBeforeSpawn, selectSignalCapableRung } from "../../src/token-governor/failover-gate.js";
import { tokenHooksImpl } from "../../src/token-governor/hooks-impl.js";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";

describe("failover-gate", () => {
  it("rejects ladder when only remaining rung lacks token signals under numeric cap", () => {
    const r = selectSignalCapableRung(
      [
        { engineId: "local-opaque", emitsTokenSignals: false },
      ],
      { numericBudgetCapSet: true },
    );
    expect(r).toEqual({ accepted: false, reason: "budget_unmetered_rung" });
  });

  it("allows signal-capable rung when numeric cap set", () => {
    const r = selectSignalCapableRung(
      [{ engineId: "cursor-agent", emitsTokenSignals: true }],
      { numericBudgetCapSet: true },
    );
    expect(r).toEqual({ rung: { engineId: "cursor-agent", emitsTokenSignals: true } });
  });

  it("does not filter on token signals when no numeric cap is set", () => {
    const opaque = { engineId: "local-opaque", emitsTokenSignals: false };
    const metered = { engineId: "cursor-agent", emitsTokenSignals: true };
    expect(selectSignalCapableRung([opaque, metered], { numericBudgetCapSet: false })).toEqual({
      rung: opaque,
    });
  });

  it("skips unmetered rungs and keeps the next signal-capable rung", () => {
    const opaque = { engineId: "local-opaque", emitsTokenSignals: false };
    const metered = { engineId: "aider", emitsTokenSignals: true };
    expect(selectSignalCapableRung([opaque, metered], { numericBudgetCapSet: true })).toEqual({
      rung: metered,
    });
  });
});

describe("reGateBeforeSpawn", () => {
  it("calls beforeDispatch with the effective engine and model", async () => {
    const spy = vi.spyOn(tokenHooksImpl, "beforeDispatch").mockResolvedValue({ allow: true });
    const ctx = {
      intent: intent("/tmp/hive"),
      brief: { budgetTokens: null, budgetUsd: null },
    };
    try {
      const gate = await reGateBeforeSpawn("cursor-agent", "frontier", ctx);
      expect(gate).toEqual({ allow: true });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          engine: "cursor-agent",
          model: "frontier",
          intent: ctx.intent,
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("fail-closes when beforeDispatch throws", async () => {
    const spy = vi.spyOn(tokenHooksImpl, "beforeDispatch").mockRejectedValue(new Error("down"));
    try {
      const gate = await reGateBeforeSpawn("cursor-agent", "frontier", {
        intent: intent("/tmp/hive"),
        brief: { budgetTokens: null, budgetUsd: null },
      });
      expect(gate.allow).toBe(false);
      if (!gate.allow) {
        expect(gate.reasonClass).toBe("budget_exceed");
        expect(gate.detail).toEqual({ hookFailed: true, reason: "HOOK_FAILED_CLOSED" });
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("returns the beforeDispatch deny when the enforced budget is already spent", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-regate-"));
    await ensureTokenLayout(hive);
    await setBudget(hive, { scope: "feature", scopeId: "f1", unit: "usd", cap: 0 });
    const gate = await reGateBeforeSpawn("opencode", "economy", {
      intent: intent(hive, { featureId: "f1" }),
      brief: { budgetTokens: null, budgetUsd: null },
      estimatedUsd: 0.01,
      sliceAActive: false,
      engineRung: "byok",
    });
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect(gate.reasonClass).toBe("budget_exceed");
  });
});

describe("EngineHooks.dispatch failover re-gate", () => {
  it("denies failover onto an unmetered rung when budgets.json has a numeric cap", async () => {
    const root = await hive({
      rosterEngine: "claude",
      health: {
        claude: healthRow("claude", "subscription", "missing"),
        custom: healthRow("custom", "byok"),
      },
    });
    await ensureTokenLayout(root);
    await setBudget(root, { scope: "feature", scopeId: "f1", unit: "tokens", cap: 1000 });
    const result = await dispatchEngine(intent(root, { featureId: "f1" }), { sliceAValidated: false });
    expect(result).toEqual({ accepted: false });
  });

  it("skips an unmetered rung and continues to a signal-capable rung under a numeric cap", async () => {
    const root = await hive({
      rosterEngine: "claude",
      health: {
        claude: healthRow("claude", "subscription", "missing"),
        custom: healthRow("custom", "byok"),
        aider: healthRow("aider", "local"),
      },
    });
    await ensureTokenLayout(root);
    await setBudget(root, { scope: "feature", scopeId: "f1", unit: "usd", cap: 5 });
    const scrub = vi.spyOn(envScrub, "buildSupervisorEnv");
    const result = await dispatchEngine(intent(root, { featureId: "f1" }), {
      sliceAValidated: true,
      processEnv: { PATH: "/usr/bin", OPENAI_API_KEY: "sk-aider" },
    });
    expect(result).toEqual({ accepted: false });
    expect(scrub).toHaveBeenCalledWith(
      expect.objectContaining({ byokAllowlist: ["OPENAI_API_KEY"] }),
    );
    scrub.mockRestore();
  });
});

function intent(hiveRoot: string, overrides: Partial<DispatchIntent> = {}): DispatchIntent {
  return {
    featureId: "f1",
    taskId: "T023",
    agentId: "implementer",
    personaPath: "/repo/agents/implementer.md",
    workspace: "/work/implementer",
    hiveRoot,
    specDir: "/repo/specs/004-ira-token-context",
    attempt: 1,
    tier: "standard",
    freshSubagent: true,
    ...overrides,
  };
}

function healthRow(engineId: string, authMode: string, health = "ok") {
  return {
    engineId,
    authMode,
    health,
    reasonClass: null,
    binaryVersion: null,
    checkedAt: "2026-10-16T00:00:00.000Z",
  };
}

async function hive(options: {
  rosterEngine: string;
  health: Record<string, ReturnType<typeof healthRow>>;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hive-failover-gate-"));
  await mkdir(join(root, "engines"), { recursive: true });
  await writeFile(join(root, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
  await writeFile(
    join(root, "roster.json"),
    JSON.stringify([
      {
        id: "implementer",
        name: "implementer",
        personaPath: "/repo/agents/implementer.md",
        capabilityTags: [],
        engine: options.rosterEngine,
        model: "standard",
        budgetTokens: null,
        budgetUsd: null,
        workspace: "/work/implementer",
        worktreePolicy: "isolated",
        status: "idle",
        origin: "manual",
      },
    ]),
  );
  const policy: FailoverPolicy = {
    schemaVersion: 1,
    failoverEnabled: true,
    ladder: ["subscription", "byok", "local"],
    crossEngineReview: false,
    delegateToHost: null,
    hitl: ["budget_exceed", "destructive_git"],
    quotaGroups: [],
  };
  await writeFile(join(root, "engines", "policy.json"), JSON.stringify(policy));
  await writeFile(join(root, "engines", "health.json"), JSON.stringify(options.health));
  return root;
}
