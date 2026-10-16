import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { runCommandPlaneCli } from "../../src/command-plane/cli-handlers.js";
import { buildCommandPlaneMcpTools } from "../../src/command-plane/mcp-command-plane-tools.js";
import type { DispatchTaskResult } from "../../src/command-plane/dispatch.js";
import { COMMAND_PLANE_ERROR_CODES } from "../../src/command-plane/types.js";

const dispatchTaskMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/command-plane/dispatch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/command-plane/dispatch.js")>();
  return { ...actual, dispatchTask: dispatchTaskMock };
});

const FEATURE = "001-ira-command-plane";
const TASK = "T003";
const CWD = "/tmp/ira-contract-fixture";

function mcpDispatchTask() {
  const tool = buildCommandPlaneMcpTools().find((t) => t.name === "dispatch-task");
  if (!tool) throw new Error("dispatch-task MCP tool missing");
  return tool;
}

async function cliDispatchJson(extra: string[] = []): Promise<Record<string, unknown>> {
  const res = await runCommandPlaneCli([
    "dispatch-task",
    "--feature",
    FEATURE,
    "--task",
    TASK,
    "--cwd",
    CWD,
    ...extra,
  ]);
  return JSON.parse(res!.stdout) as Record<string, unknown>;
}

async function mcpDispatchJson(): Promise<Record<string, unknown>> {
  const tool = mcpDispatchTask();
  const res = await tool.handler({ featureId: FEATURE, taskId: TASK, cwd: CWD });
  return JSON.parse(res.content[0]!.text) as Record<string, unknown>;
}

/** Same keys and scalar fields; message strings may differ until shared copy exists. */
function expectDispatchResponseShapeParity(
  cli: Record<string, unknown>,
  mcp: Record<string, unknown>,
): void {
  expect(Object.keys(cli).sort()).toEqual(Object.keys(mcp).sort());
  expect(cli.ok).toBe(mcp.ok);
  if (cli.ok === false) {
    expect(cli.error).toBe(mcp.error);
    expect(typeof cli.message).toBe("string");
    expect(typeof mcp.message).toBe("string");
    if ("hint" in cli || "hint" in mcp) {
      expect(cli.hint).toBe(mcp.hint);
    }
    if ("reason" in cli || "reason" in mcp) {
      expect(cli.reason).toBe(mcp.reason);
    }
    if ("accepted" in cli || "accepted" in mcp) {
      expect(cli.accepted).toBe(mcp.accepted);
    }
  }
}

describe("contracts", () => {
  beforeEach(() => {
    dispatchTaskMock.mockReset();
  });

  it("includes amendment steer codes", () => {
    expect(COMMAND_PLANE_ERROR_CODES).toContain("DISPATCH_PATH_REQUIRED");
    expect(COMMAND_PLANE_ERROR_CODES).toContain("DISPATCH_HELD");
    expect(COMMAND_PLANE_ERROR_CODES).toContain("SLICE_A_ONLY");
  });

  it("dispatch-task MCP request schema matches design fields", () => {
    const tool = mcpDispatchTask();
    const schema = z.object(tool.schema);
    expect(Object.keys(tool.schema).sort()).toEqual(["cwd", "featureId", "taskId"]);
    expect(() => schema.parse({ featureId: FEATURE, taskId: TASK })).not.toThrow();
    expect(() => schema.parse({ featureId: FEATURE, taskId: TASK, cwd: CWD })).not.toThrow();
  });

  it("CLI and MCP pass the same dispatch-task input to dispatchTask", async () => {
    const success: DispatchTaskResult = {
      ok: true,
      accepted: null,
      began: true,
      intent: { featureId: FEATURE, taskId: TASK, freshSubagent: true },
      hiveStatus: "doing",
    };
    dispatchTaskMock.mockResolvedValue(success);

    await cliDispatchJson();
    const cliCall = dispatchTaskMock.mock.calls[0]![0];

    dispatchTaskMock.mockClear();
    dispatchTaskMock.mockResolvedValue(success);

    await mcpDispatchJson();
    const mcpCall = dispatchTaskMock.mock.calls[0]![0];

    expect(cliCall).toEqual(mcpCall);
    expect(cliCall).toEqual({
      featureId: FEATURE,
      taskId: TASK,
      cwd: CWD,
      freshSubagent: true,
    });
  });

  it("CLI and MCP return the same dispatch-task success JSON shape", async () => {
    const success: DispatchTaskResult = {
      ok: true,
      accepted: null,
      began: true,
      intent: { featureId: FEATURE, taskId: TASK, freshSubagent: true },
      hiveStatus: "doing",
    };
    dispatchTaskMock.mockResolvedValue(success);

    const cli = await cliDispatchJson();
    dispatchTaskMock.mockClear();
    dispatchTaskMock.mockResolvedValue(success);
    const mcp = await mcpDispatchJson();

    expect(cli).toEqual(mcp);
    expect(Object.keys(cli).sort()).toEqual(
      ["accepted", "began", "hiveStatus", "intent", "ok"].sort(),
    );
  });

  it.each([
    "DISPATCH_HELD",
    "DISPATCH_PATH_REQUIRED",
    "SLICE_A_ONLY",
    "HIVE_NOT_READY",
  ] as const)("CLI and MCP parity for dispatch refusal %s", async (code) => {
    const refusal: DispatchTaskResult = {
      ok: false,
      code,
      began: false,
      message: code === "DISPATCH_HELD" ? "Task is on hold." : undefined,
    };
    dispatchTaskMock.mockResolvedValue(refusal);

    const cli = await cliDispatchJson();
    dispatchTaskMock.mockClear();
    dispatchTaskMock.mockResolvedValue(refusal);
    const mcp = await mcpDispatchJson();

    expectDispatchResponseShapeParity(cli, mcp);
    expect(cli.error).toBe(code);
    expect(COMMAND_PLANE_ERROR_CODES).toContain(code);
  });
});
