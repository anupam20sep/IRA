import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assertSupervisorNotInMcp,
  buildDetachedSupervisorSpawnSpec,
} from "../../src/engines/supervisor.js";
import { buildSupervisorEnv } from "../../src/engines/env-scrub.js";

const child = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  fork: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, ...child };
});

beforeEach(() => {
  child.spawn.mockClear();
  child.execFile.mockClear();
  child.fork.mockClear();
});

function isLegalStdio(stdio: unknown): boolean {
  if (stdio === "ignore") return true;
  return (
    Array.isArray(stdio) &&
    stdio.length === 2 &&
    stdio[0] === "pipe" &&
    stdio[1] === "pipe"
  );
}

describe("buildDetachedSupervisorSpawnSpec", () => {
  it("builds a detached argv spec and starts no child", () => {
    const env = buildSupervisorEnv({
      rung: "local",
      processEnv: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-secret", HOME: "/home/op" },
      byokAllowlist: [],
    });
    const intentPath = "/repo/.superspec/hive/dispatch-queue/006/T013.json";
    const spec = buildDetachedSupervisorSpawnSpec(intentPath, env);

    expect(spec.argv).toEqual(["superspec", "engines", "supervise", intentPath]);
    expect(spec.detached).toBe(true);
    expect(spec.shell).toBe(false);
    expect(isLegalStdio(spec.stdio)).toBe(true);
    expect(spec.stdio).not.toBe("inherit");
    expect(spec.stdio).not.toContain(process.stdin);
    expect(spec.stdio).not.toContain(process.stdout);
    expect(spec.env).toEqual(env);
    expect(spec.env).not.toBe(process.env);
    expect(spec.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(child.spawn).not.toHaveBeenCalled();
    expect(child.execFile).not.toHaveBeenCalled();
    expect(child.fork).not.toHaveBeenCalled();
  });
});

describe("assertSupervisorNotInMcp", () => {
  it("throws SUPERVISOR_IN_MCP_FORBIDDEN for an MCP handler and allows cli-supervise", () => {
    expect(() => assertSupervisorNotInMcp("mcp-handler")).toThrow("SUPERVISOR_IN_MCP_FORBIDDEN");
    expect(() => assertSupervisorNotInMcp("cli-supervise")).not.toThrow();
  });
});
