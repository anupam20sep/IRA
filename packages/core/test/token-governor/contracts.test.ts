import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TOKEN_MCP_TOOL_NAMES,
  buildTokenMcpTools,
  tokenBudgetShowHandler,
  tokenSpendQueryHandler,
} from "../../src/token-governor/mcp-handlers.js";
import { buildToolDefinitions } from "../../src/mcp-server.js";
import { routeModel } from "../../src/model-router.js";

const VALID_TIERS = ["economy", "standard", "frontier"] as const;

describe("token MCP surface", () => {
  it("registers eleven token-* tool names", () => {
    expect(TOKEN_MCP_TOOL_NAMES).toContain("token-spend-query");
    expect(TOKEN_MCP_TOOL_NAMES.length).toBe(11);
  });
});

describe("tokenBudgetShowHandler", () => {
  it("returns HIVE_NOT_INITIALIZED when hive is missing", async () => {
    const out = await tokenBudgetShowHandler(
      {},
      {
        resolveHiveRoot: async () => ({ ok: false as const, error: "HIVE_NOT_INITIALIZED" }),
      },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("HIVE_NOT_INITIALIZED");
      expect(out.message).toContain("not initialized");
      expect(out.hint).toContain("doctor");
    }
  });
});

describe("tokenSpendQueryHandler", () => {
  it("returns HIVE_NOT_INITIALIZED before validating query scope", async () => {
    const out = await tokenSpendQueryHandler(
      {},
      {
        resolveHiveRoot: async () => ({ ok: false as const, error: "HIVE_NOT_INITIALIZED" }),
      },
    );
    expect(out).toMatchObject({
      ok: false,
      error: "HIVE_NOT_INITIALIZED",
      message: "Hive is not initialized.",
    });
  });
});

describe("buildTokenMcpTools", () => {
  it("registers handlers that emit JSON text envelopes", async () => {
    const tools = buildTokenMcpTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOKEN_MCP_TOOL_NAMES].sort());

    const root = await mkdtemp(join(tmpdir(), "repo-token-mcp-tool-"));
    await writeFile(join(root, "program.md"), "# program\n");

    const budgetShow = tools.find((t) => t.name === "token-budget-show")!;
    const res = await budgetShow.handler({ cwd: root });
    const payload = JSON.parse(res.content[0].text);
    expect(payload).toMatchObject({
      ok: false,
      error: "HIVE_NOT_INITIALIZED",
    });
    expect(payload.hint).toContain("doctor");
  });
});

describe("route-model core unchanged", () => {
  it("returns only economy for mechanical attempt 1", () => {
    expect(routeModel({ complexity: "mechanical", attempt: 1 }).tier).toBe("economy");
  });
});

describe("route-model MCP quota fields", () => {
  it("includes quotaApplied and overrideApplied booleans with no fourth tier", async () => {
    const tool = buildToolDefinitions().find((t) => t.name === "route-model")!;
    const res = await tool.handler({ complexity: "mechanical", attempt: 1 });
    const payload = JSON.parse(res.content[0].text);
    expect(VALID_TIERS).toContain(payload.tier);
    expect(payload.quotaApplied).toBe(false);
    expect(payload.overrideApplied).toBe(false);
    expect(payload.routingHint).toBeUndefined();
  });

  it("sets routingHint when quotaRemainingPercent is below threshold", async () => {
    const tool = buildToolDefinitions().find((t) => t.name === "route-model")!;
    const res = await tool.handler({
      complexity: "moderate",
      attempt: 1,
      quotaRemainingPercent: 5,
      lowQuotaPercent: 20,
    });
    const payload = JSON.parse(res.content[0].text);
    expect(VALID_TIERS).toContain(payload.tier);
    expect(payload.quotaApplied).toBe(true);
    expect(payload.routingHint).toMatchObject({
      preferredTier: "economy",
      reason: "low_quota",
    });
  });

  it("applies operatorOverrideTier without introducing a fourth tier", async () => {
    const tool = buildToolDefinitions().find((t) => t.name === "route-model")!;
    const res = await tool.handler({
      complexity: "mechanical",
      attempt: 1,
      operatorOverrideTier: "frontier",
    });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.tier).toBe("frontier");
    expect(payload.overrideApplied).toBe(true);
    expect(VALID_TIERS).toContain(payload.tier);
  });
});

describe("mcp-server registration", () => {
  it("includes token tools in buildToolDefinitions", () => {
    const names = buildToolDefinitions().map((t) => t.name);
    for (const name of TOKEN_MCP_TOOL_NAMES) {
      expect(names).toContain(name);
    }
  });
});

describe("token MCP integration", () => {
  it("reads budget show when hive is initialized", async () => {
    const root = await mkdtemp(join(tmpdir(), "repo-token-mcp-"));
    await writeFile(join(root, "program.md"), "# program\n");
    const hive = join(root, ".superspec", "hive");
    await mkdir(hive, { recursive: true });
    await writeFile(join(hive, "hive.json"), JSON.stringify({ schemaVersion: 1 }));

    const out = await tokenBudgetShowHandler({ cwd: root, agentId: "implementer" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.caps).toBeDefined();
      expect(out.spent).toBeDefined();
      expect(out.remaining).toBeDefined();
      expect(out.enforcedRemaining).toBeDefined();
    }
  });
});
