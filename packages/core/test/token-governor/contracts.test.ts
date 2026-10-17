import { describe, it, expect } from "vitest";
import { TOKEN_MCP_TOOL_NAMES } from "../../src/token-governor/mcp-handlers.js";

describe("token MCP surface", () => {
  it("registers eleven token-* tool names", () => {
    expect(TOKEN_MCP_TOOL_NAMES).toContain("token-spend-query");
    expect(TOKEN_MCP_TOOL_NAMES.length).toBe(11);
  });
});
