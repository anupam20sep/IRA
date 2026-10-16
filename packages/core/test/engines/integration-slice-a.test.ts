import { describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  fork: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, ...child };
});

const HOST_ARGV0 = new Set(["claude", "codex", "cursor-agent", "agent"]);

function hostChildCount(): number {
  const calls = [...child.spawn.mock.calls, ...child.execFile.mock.calls, ...child.fork.mock.calls];
  return calls.filter((args) => HOST_ARGV0.has(String(args[0] ?? "").split(/[\\/]/).pop())).length;
}

describe("integration slice A dispatch", () => {
  it("returns SLICE_A_ONLY for opencode when sliceAValidated is false", async () => {
    const { runDispatchFixture, lastDispatchFixture } = await import("./helpers/dispatch-fixture.js");
    const r = await runDispatchFixture("opencode-pre-slice-a");
    expect(r).toEqual({ ok: false, code: "SLICE_A_ONLY" });
    expect(lastDispatchFixture().doctorStubCalls).toBeGreaterThan(0);
    expect(lastDispatchFixture().queueMode).toBeNull();
    expect(hostChildCount()).toBe(0);
  });

  it("returns null for a host engine and writes dispatch-queue mode 0600", async () => {
    const { runDispatchFixture, lastDispatchFixture } = await import("./helpers/dispatch-fixture.js");
    for (const engineId of ["claude", "codex", "cursor-agent", "cursor"] as const) {
      child.spawn.mockClear();
      child.execFile.mockClear();
      child.fork.mockClear();
      const result = await runDispatchFixture("host-delegate", { engineId });
      expect(result).toBeNull();
      expect(lastDispatchFixture().queueMode).toBe(0o600);
      expect(lastDispatchFixture().hostChildCount).toBe(0);
      expect(hostChildCount()).toBe(0);
    }
  });

  it("returns HOST_SPAWN_FORBIDDEN and starts no host child", async () => {
    const { runDispatchFixture, lastDispatchFixture } = await import("./helpers/dispatch-fixture.js");
    child.spawn.mockClear();
    const result = await runDispatchFixture("host-spawn-forbidden");
    expect(result).toEqual({ ok: false, code: "HOST_SPAWN_FORBIDDEN" });
    expect(lastDispatchFixture().queueMode).toBeNull();
    expect(lastDispatchFixture().hostChildCount).toBe(0);
    expect(hostChildCount()).toBe(0);
  });

  it("refuses the local context gate and leaves hiveReady unchanged", async () => {
    const { runDispatchFixture, lastDispatchFixture } = await import("./helpers/dispatch-fixture.js");
    child.spawn.mockClear();
    const result = await runDispatchFixture("local-gate-refusal");
    expect(result).toEqual({ accepted: false });
    const report = lastDispatchFixture();
    expect(report.hiveReadyBefore).toBe(true);
    expect(report.hiveReadyAfter).toBe(report.hiveReadyBefore);
    expect(report.localContextFinding).toBe(true);
    expect(report.queueMode).toBeNull();
    expect(report.hostChildCount).toBe(0);
    expect(hostChildCount()).toBe(0);
  });
});
