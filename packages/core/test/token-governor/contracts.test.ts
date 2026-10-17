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
