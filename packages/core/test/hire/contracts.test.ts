import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildToolDefinitions } from "../../src/mcp-server.js";
import { HIRE_MCP_TOOL_NAMES } from "../../src/hire/mcp-handlers.js";
import { createPendingReview } from "../../src/hire/review.js";
import type { HireManifest, SanitizationReport } from "../../src/hire/types.js";

const MANIFEST: HireManifest = {
  id: "x",
  displayName: "X",
  goal: "g",
  capabilityTags: ["qa"],
  suggestedEngine: "cursor",
  suggestedModelTier: "standard",
  budget: { tokens: 1, usd: 1 },
  allowlists: { skills: [], mcp: [] },
  persona: { harness: "cursor", scope: "project", body: "b" },
  schemaVersion: "hireManifest/v1",
};

function report(): SanitizationReport {
  return {
    droppedKeys: [],
    rejected: [],
    warnings: [],
    contentSha256: "abc",
    sanitizedAt: new Date().toISOString(),
  };
}

function tool(name: string) {
  const found = buildToolDefinitions().find((entry) => entry.name === name);
  if (!found) throw new Error(`MCP tool missing: ${name}`);
  return found;
}

describe("hire MCP contracts", () => {
  it("registers hire-import tool", () => {
    const names = buildToolDefinitions().map((t) => t.name);
    expect(names).toContain("hire-import");
  });

  it("registers all hire MCP tools", () => {
    const names = buildToolDefinitions().map((t) => t.name);
    for (const name of HIRE_MCP_TOOL_NAMES) {
      expect(names).toContain(name);
    }
  });

  it("ask-me-answer acknowledge on hire untrusted_import returns HIRE_ACK_CANCELS", async () => {
    const root = await mkdtemp(join(tmpdir(), "hire-mcp-ack-"));
    await writeFile(join(root, "program.md"), "# program\n");
    const hiveRoot = join(root, ".superspec", "hive");
    await mkdir(join(hiveRoot, "reviews"), { recursive: true });
    await mkdir(join(hiveRoot, "events"), { recursive: true });
    await writeFile(
      join(hiveRoot, "hive.json"),
      `${JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString() })}\n`,
    );

    const review = await createPendingReview({
      hiveRoot,
      sourceKind: "file",
      sourceRef: "file:/tmp/m.yaml",
      approvalCopyVariant: "standard",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: [],
      contentSha256: "abc",
    });

    const answerTool = tool("ask-me-answer");
    const res = await answerTool.handler({
      cwd: root,
      id: review.askMeId,
      text: "Acknowledge and cancel hire import",
      action: "acknowledge",
    });
    const payload = JSON.parse(res.content[0]!.text) as {
      ok: boolean;
      hire?: { ok: boolean; code?: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.hire?.ok).toBe(true);
    expect(payload.hire?.code).toBe("HIRE_ACK_CANCELS");
    await expect(access(join(hiveRoot, "roster.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
