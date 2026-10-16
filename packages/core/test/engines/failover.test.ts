import { describe, expect, it, vi } from "vitest";
import { selectEffectiveEngine } from "../../src/engines/failover.js";

const ladder = ["subscription", "byok", "local"] as const;

describe("selectEffectiveEngine", () => {
  it("keeps preferred engine when healthy", () => {
    const beforeDispatch = vi.fn(() => ({ allow: true as const }));
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      health: { codex: { health: "ok", authMode: "subscription" } },
      policy: { failoverEnabled: true, ladder: ["subscription", "byok", "local"] },
      localGateOk: true,
      beforeDispatch,
    });
    expect(d.engineId).toBe("codex");
    expect(d.accepted).toBe(true);
    expect(d.failoverEvent).toBeUndefined();
    expect(beforeDispatch).not.toHaveBeenCalled();
  });

  it("keeps an explicit preference whose auth mode is unknown", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "cursor-agent",
      health: {
        "cursor-agent": { health: "ok", authMode: "unknown" },
        opencode: { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
    });
    expect(d.engineId).toBe("cursor-agent");
    expect(d.failoverEvent).toBeUndefined();
  });

  it("keeps a healthy cloud preference when the local context gate fails", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      health: { codex: { health: "ok", authMode: "subscription" } },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: false,
    });
    expect(d.engineId).toBe("codex");
    expect(d.accepted).toBe(true);
  });

  it("walks subscription to the first healthy BYOK engine", () => {
    const beforeDispatch = vi.fn(() => ({ allow: true as const }));
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      agentId: "implementer",
      taskId: "T010",
      model: "gpt-5.4",
      tier: "frontier",
      health: {
        claude: { health: "ok", authMode: "subscription" },
        codex: { health: "missing", authMode: "unknown", reasonClass: "missing" },
        opencode: { health: "ok", authMode: "byok" },
        crush: { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
      beforeDispatch,
    });
    expect(d.accepted).toBe(true);
    expect(d.engineId).toBe("opencode");
    expect(d.model).toBe("gpt-5.4");
    expect(d.tier).toBe("frontier");
    expect(d.failoverEvent).toEqual({
      type: "engine.failover",
      data: {
        agentId: "implementer",
        taskId: "T010",
        fromEngine: "codex",
        toEngine: "opencode",
        reasonClass: "missing",
        rung: "byok",
      },
    });
    expect(beforeDispatch).toHaveBeenCalledOnce();
    expect(beforeDispatch).toHaveBeenCalledWith({
      engineId: "opencode",
      model: "gpt-5.4",
      budgetTokens: null,
      budgetUsd: null,
    });
  });

  it("walks past BYOK to local and does not stay on the preferred rung", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "opencode",
      health: {
        opencode: { health: "unauthorized", authMode: "byok", reasonClass: "unauthorized" },
        crush: { health: "ok", authMode: "byok" },
        aider: { health: "ok", authMode: "local" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
    });
    expect(d.engineId).toBe("aider");
    expect(d.failoverEvent?.data.rung).toBe("local");
    expect(d.failoverEvent?.data.reasonClass).toBe("unauthorized");
  });

  it("does not auto-select an unknown auth mode on a later rung", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      health: {
        codex: { health: "unauthorized", authMode: "subscription", reasonClass: "unauthorized" },
        opencode: { health: "ok", authMode: "unknown" },
        crush: { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
    });
    expect(d.engineId).toBe("crush");
  });

  it("yields a quota-degraded subscription engine without rewriting tier or model", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      model: null,
      tier: "frontier",
      health: {
        codex: { health: "degraded", authMode: "subscription", reasonClass: "quota_exhausted" },
        opencode: { health: "missing", authMode: "unknown" },
        aider: { health: "ok", authMode: "local" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
    });
    expect(d.engineId).toBe("aider");
    expect(d.tier).toBe("frontier");
    expect(d.model).toBeNull();
    expect(d.failoverEvent?.data.reasonClass).toBe("quota_exhausted");
    expect(d.failoverEvent?.data.rung).toBe("local");
  });

  it("treats rate_limited as degraded and walks the ladder", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "claude",
      health: {
        claude: { health: "degraded", authMode: "subscription", reasonClass: "rate_limited" },
        opencode: { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
    });
    expect(d.engineId).toBe("opencode");
    expect(d.failoverEvent?.data.reasonClass).toBe("rate_limited");
  });

  it("does not infer a shared quota unless the engines are grouped", () => {
    const health = {
      codex: { health: "degraded" as const, authMode: "subscription" as const, reasonClass: "quota_exhausted" },
      opencode: { health: "degraded" as const, authMode: "byok" as const, reasonClass: "quota_exhausted" },
      crush: { health: "ok" as const, authMode: "byok" as const },
    };
    const ungrouped = selectEffectiveEngine({
      preferredEngineId: "codex",
      health,
      policy: { failoverEnabled: true, ladder: [...ladder], quotaGroups: [] },
      localGateOk: true,
    });
    expect(ungrouped.engineId).toBe("crush");

    const grouped = selectEffectiveEngine({
      preferredEngineId: "codex",
      health,
      policy: {
        failoverEnabled: true,
        ladder: [...ladder],
        quotaGroups: [["opencode", "crush"]],
      },
      localGateOk: true,
    });
    expect(grouped.accepted).toBe(false);
    expect(grouped.engineId).toBeUndefined();
    expect(grouped.doctorCode).toBe("ENGINE_NONE_HEALTHY");
  });

  it("skips a local candidate that fails the context gate", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      health: {
        codex: { health: "missing", authMode: "unknown" },
        opencode: { health: "ok", authMode: "local" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: false,
    });
    expect(d.accepted).toBe(false);
    expect(d.doctorCode).toBe("ENGINE_NONE_HEALTHY");
    expect(d.engineId).toBeUndefined();
  });

  it("escalates HITL when beforeDispatch denies the new rung", () => {
    const beforeDispatch = vi.fn(() => ({
      allow: false as const,
      reasonClass: "budget_exceed" as const,
      detail: "over cap",
    }));
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      health: {
        codex: { health: "degraded", authMode: "subscription", reasonClass: "quota_exhausted" },
        opencode: { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder], hitl: ["budget_exceed", "destructive_git"] },
      localGateOk: true,
      beforeDispatch,
    });
    expect(beforeDispatch).toHaveBeenCalledOnce();
    expect(d.accepted).toBe(false);
    expect(d.engineId).toBeUndefined();
    expect(d.failoverEvent).toBeUndefined();
    expect(d.askMe?.reasonClass).toBe("budget_exceed");
    expect(d.askMe?.question).toContain("budget_exceed");
  });

  it("does not silent-failover into a critical HITL class", () => {
    const beforeDispatch = vi.fn(() => ({ allow: true as const }));
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      criticalClass: "destructive_git",
      health: {
        codex: { health: "missing", authMode: "unknown" },
        opencode: { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder], hitl: ["budget_exceed", "destructive_git"] },
      localGateOk: true,
      beforeDispatch,
    });
    expect(d.accepted).toBe(false);
    expect(d.engineId).toBeUndefined();
    expect(d.failoverEvent).toBeUndefined();
    expect(d.askMe?.reasonClass).toBe("destructive_git");
    expect(beforeDispatch).not.toHaveBeenCalled();
  });

  it("skips rungs that cannot emit tokens when a numeric budget is set", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      budgetTokens: 1000,
      budgetUsd: null,
      health: {
        codex: { health: "missing", authMode: "unknown" },
        custom: { health: "ok", authMode: "byok" },
        aider: { health: "ok", authMode: "local" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
    });
    expect(d.engineId).toBe("aider");
    expect(d.failoverEvent?.data.rung).toBe("local");
  });

  it("denies when every healthy rung lacks token signals under a numeric cap", () => {
    const beforeDispatch = vi.fn(() => ({ allow: true as const }));
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      budgetTokens: 0,
      health: {
        codex: { health: "unauthorized", authMode: "subscription", reasonClass: "unauthorized" },
        custom: { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
      beforeDispatch,
    });
    expect(d.accepted).toBe(false);
    expect(d.reason).toBe("budget_unmetered_rung");
    expect(d.engineId).toBeUndefined();
    expect(d.failoverEvent).toBeUndefined();
    expect(d.doctorCode).toBeUndefined();
    expect(beforeDispatch).not.toHaveBeenCalled();
  });

  it("allows an unmetered rung when no numeric budget is set", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      budgetTokens: null,
      budgetUsd: null,
      health: {
        codex: { health: "missing", authMode: "unknown" },
        custom: { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
    });
    expect(d.accepted).toBe(true);
    expect(d.engineId).toBe("custom");
  });

  it("returns Ask-Me ambiguous_requirement when no rung is healthy", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      health: {
        codex: { health: "unauthorized", authMode: "subscription", reasonClass: "unauthorized" },
        opencode: { health: "missing", authMode: "unknown" },
        aider: { health: "degraded", authMode: "local", reasonClass: "context_below_floor" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: false,
    });
    expect(d.accepted).toBe(false);
    expect(d.engineId).toBeUndefined();
    expect(d.failoverEvent).toBeUndefined();
    expect(d.doctorCode).toBe("ENGINE_NONE_HEALTHY");
    expect(d.askMe?.reasonClass).toBe("ambiguous_requirement");
    expect(d.askMe?.question).toContain("subscription");
    expect(d.askMe?.question).toContain("byok");
    expect(d.askMe?.question).toContain("local");
    expect(d.askMe?.question.toLowerCase()).toContain("install");
    expect(d.askMe?.question.toLowerCase()).toContain("log in");
    expect(d.askMe?.question.toLowerCase()).toContain("choose a model");
    expect(d).not.toHaveProperty("startEvent");
  });

  it("does not walk the ladder when failover is disabled", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      health: {
        codex: { health: "degraded", authMode: "subscription", reasonClass: "rate_limited" },
        opencode: { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: false, ladder: [...ladder] },
      localGateOk: true,
    });
    expect(d.accepted).toBe(false);
    expect(d.engineId).toBeUndefined();
    expect(d.failoverEvent).toBeUndefined();
    expect(d.doctorCode).toBe("ENGINE_NONE_HEALTHY");
  });

  it("refuses selection off the fresh dispatch boundary", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      freshSubagent: false,
      health: {
        codex: { health: "degraded", authMode: "subscription", reasonClass: "quota_exhausted" },
        opencode: { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
    });
    expect(d.accepted).toBe(false);
    expect(d.reason).toBe("INVALID_INPUT");
    expect(d.engineId).toBeUndefined();
    expect(d.failoverEvent).toBeUndefined();
  });

  it("does not invent an engine id that is outside the catalog", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      health: {
        codex: { health: "missing", authMode: "unknown" },
        "not-an-engine": { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
    });
    expect(d.accepted).toBe(false);
    expect(d.engineId).toBeUndefined();
    expect(d.doctorCode).toBe("ENGINE_NONE_HEALTHY");
  });

  it("fail-closes when the token gate throws", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      health: {
        codex: { health: "missing", authMode: "unknown" },
        opencode: { health: "ok", authMode: "byok" },
      },
      policy: { failoverEnabled: true, ladder: [...ladder] },
      localGateOk: true,
      beforeDispatch: () => {
        throw new Error("hook down");
      },
    });
    expect(d.accepted).toBe(false);
    expect(d.reason).toBe("HOOK_FAILED_CLOSED");
    expect(d.askMe?.reasonClass).toBe("budget_exceed");
    expect(d.failoverEvent).toBeUndefined();
    expect(d.engineId).toBeUndefined();
  });
});
