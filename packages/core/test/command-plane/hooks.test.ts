import { mkdir, mkdtemp, readFile, rm, chmod, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IraEventSchema } from "../../src/command-plane/schema.js";
import {
  registerCommandPlaneHooks,
  safeBeforeDispatch,
  safeEngineDispatch,
  safeMatchCapabilities,
  safeNormalizeEvent,
  safeOnRecordResult,
  safeOnUntrustedImport,
} from "../../src/command-plane/hooks.js";
import type { DispatchIntent } from "../../src/command-plane/hooks.js";

const intent = (hiveRoot: string): DispatchIntent => ({
  featureId: "f",
  taskId: "T001",
  agentId: "a",
  personaPath: null,
  workspace: null,
  hiveRoot,
  specDir: "/s",
  attempt: 1,
  tier: "economy",
  freshSubagent: true,
});

describe("safeBeforeDispatch", () => {
  let exitSpy: { mockRestore: () => void; mock: { calls: unknown[][] } };
  let root: string;

  beforeEach(async () => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    registerCommandPlaneHooks({ learning: {}, token: {}, hire: {}, engine: {} });
    root = await mkdtemp(join(tmpdir(), "cp-hooks-"));
  });

  afterEach(async () => {
    expect(exitSpy.mock.calls).toEqual([]);
    exitSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it("returns allow false when hook throws", async () => {
    registerCommandPlaneHooks({
      token: {
        async beforeDispatch() {
          throw new Error("boom");
        },
      },
    });
    const gate = await safeBeforeDispatch({
      intent: {
        featureId: "f",
        taskId: "T001",
        agentId: "a",
        personaPath: null,
        workspace: null,
        hiveRoot: "/h",
        specDir: "/s",
        attempt: 1,
        tier: "economy",
        freshSubagent: true,
      },
      brief: { budgetTokens: null, budgetUsd: null },
    });
    expect(gate).toEqual({
      allow: false,
      reasonClass: "budget_exceed",
      detail: { hookFailed: true, reason: "HOOK_FAILED_CLOSED" },
    });
  });

  it("allows dispatch when beforeDispatch is not registered", async () => {
    const gate = await safeBeforeDispatch({
      intent: intent(root),
      brief: { budgetTokens: null, budgetUsd: null },
    });
    expect(gate).toEqual({ allow: true });
  });

  it("passes a successful gate through", async () => {
    registerCommandPlaneHooks({
      token: {
        async beforeDispatch() {
          return { allow: true };
        },
      },
    });
    const gate = await safeBeforeDispatch({
      intent: intent(root),
      brief: { budgetTokens: 10, budgetUsd: null },
    });
    expect(gate).toEqual({ allow: true });
  });

  it("appends hook.failed when the event log is writable", async () => {
    const hiveRoot = join(root, "hive");
    await mkdir(join(hiveRoot, "events"), { recursive: true });
    await mkdir(join(hiveRoot, "locks"), { recursive: true });
    registerCommandPlaneHooks({
      token: {
        async beforeDispatch() {
          throw new Error("budget exploded");
        },
      },
    });
    const gate = await safeBeforeDispatch({
      intent: intent(hiveRoot),
      brief: { budgetTokens: null, budgetUsd: null },
    });
    expect(gate).toEqual({
      allow: false,
      reasonClass: "budget_exceed",
      detail: { hookFailed: true, reason: "HOOK_FAILED_CLOSED" },
    });
    const event = await readHookFailed(hiveRoot);
    expect(event.type).toBe("hook.failed");
    expect(event.featureId).toBe("f");
    expect(event.actor).toEqual({ kind: "ira", id: "ira" });
    expect(event.data).toEqual({ hook: "beforeDispatch", reason: "HOOK_FAILED_CLOSED" });
  });

  it("keeps the deny when the event log is not writable", async () => {
    const hiveRoot = join(root, "missing-hive");
    registerCommandPlaneHooks({
      token: {
        async beforeDispatch() {
          throw new Error("boom");
        },
      },
    });
    const gate = await safeBeforeDispatch({
      intent: intent(hiveRoot),
      brief: { budgetTokens: null, budgetUsd: null },
    });
    expect(gate).toEqual({
      allow: false,
      reasonClass: "budget_exceed",
      detail: { hookFailed: true, reason: "HOOK_FAILED_CLOSED" },
    });
    await expect(readFile(join(hiveRoot, "events", "events.jsonl"), "utf8")).rejects.toThrow();
  });
});

describe("wrapped command-plane hooks", () => {
  let exitSpy: { mockRestore: () => void; mock: { calls: unknown[][] } };
  let root: string;
  let hiveRoot: string;

  beforeEach(async () => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    registerCommandPlaneHooks({ learning: {}, token: {}, hire: {}, engine: {} });
    root = await mkdtemp(join(tmpdir(), "cp-hooks-"));
    hiveRoot = join(root, "hive");
    await mkdir(join(hiveRoot, "events"), { recursive: true });
    await mkdir(join(hiveRoot, "locks"), { recursive: true });
  });

  afterEach(async () => {
    expect(exitSpy.mock.calls).toEqual([]);
    exitSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it("returns accepted false when engine dispatch throws and does not rethrow", async () => {
    registerCommandPlaneHooks({
      engine: {
        async dispatch() {
          return Promise.reject(new Error("spawn blew up"));
        },
      },
    });
    const result = await safeEngineDispatch(intent(hiveRoot));
    expect(result).toEqual({ accepted: false, reason: "HOOK_FAILED_CLOSED" });
    const event = await readHookFailed(hiveRoot);
    expect(event.data).toEqual({ hook: "dispatch", reason: "HOOK_FAILED_CLOSED" });
  });

  it("returns the engine result when dispatch does not throw", async () => {
    registerCommandPlaneHooks({
      engine: {
        async dispatch() {
          return null;
        },
      },
    });
    expect(await safeEngineDispatch(intent(hiveRoot))).toBeNull();
    await expect(readFile(join(hiveRoot, "events", "events.jsonl"), "utf8")).rejects.toThrow();
  });

  it("skips an unregistered engine dispatch", async () => {
    expect(await safeEngineDispatch(intent(hiveRoot))).toBeNull();
  });

  it("swallows normalizeEvent throws and appends hook.failed", async () => {
    registerCommandPlaneHooks({
      engine: {
        async normalizeEvent() {
          throw "bad-event";
        },
      },
    });
    const event = await safeNormalizeEvent(
      { type: "task.started", agentId: "a" },
      { hiveRoot, featureId: "f" },
    );
    expect(event).toBeNull();
    const logged = await readHookFailed(hiveRoot);
    expect(logged.data).toEqual({ hook: "normalizeEvent", reason: "HOOK_FAILED_CLOSED" });
  });

  it("swallows onRecordResult throws so the caller still resolves", async () => {
    registerCommandPlaneHooks({
      token: {
        async onRecordResult() {
          throw new Error("compact failed");
        },
      },
    });
    await expect(
      safeOnRecordResult(
        { featureId: "f", taskId: "T001", passed: true, reviewFailures: 0 },
        { hiveRoot },
      ),
    ).resolves.toBeUndefined();
    const logged = await readHookFailed(hiveRoot);
    expect(logged.data).toEqual({ hook: "onRecordResult", reason: "HOOK_FAILED_CLOSED" });
    expect(JSON.stringify(logged)).not.toContain("compact failed");
  });

  it("returns accepted false when onUntrustedImport throws", async () => {
    registerCommandPlaneHooks({
      hire: {
        async onUntrustedImport() {
          throw new Error("import");
        },
      },
    });
    const result = await safeOnUntrustedImport(
      { featureId: "f", agentId: "a", detail: "unsigned" },
      { hiveRoot },
    );
    expect(result).toEqual({ accepted: false });
    const logged = await readHookFailed(hiveRoot);
    expect(logged.data).toEqual({ hook: "onUntrustedImport", reason: "HOOK_FAILED_CLOSED" });
  });

  it("returns null when matchCapabilities throws", async () => {
    registerCommandPlaneHooks({
      hire: {
        matchCapabilities() {
          throw new Error("roster");
        },
      },
    });
    const match = await safeMatchCapabilities({ capabilityTags: ["tdd"] }, [], { hiveRoot, featureId: "f" });
    expect(match).toBeNull();
    const logged = await readHookFailed(hiveRoot);
    expect(logged.data).toEqual({ hook: "matchCapabilities", reason: "HOOK_FAILED_CLOSED" });
  });

  it("does not append when the event file is not writable", async () => {
    const file = join(hiveRoot, "events", "events.jsonl");
    await writeFile(file, "", "utf8");
    await chmod(file, 0o444);
    registerCommandPlaneHooks({
      engine: {
        async dispatch() {
          throw new Error("nope");
        },
      },
    });
    const result = await safeEngineDispatch(intent(hiveRoot));
    expect(result).toEqual({ accepted: false, reason: "HOOK_FAILED_CLOSED" });
    expect(await readFile(file, "utf8")).toBe("");
    await chmod(file, 0o644);
  });

  it("appends after an existing event line", async () => {
    const file = join(hiveRoot, "events", "events.jsonl");
    await writeFile(file, '{"type":"doctor.ran"}\n', "utf8");
    registerCommandPlaneHooks({
      token: {
        async beforeDispatch() {
          throw new Error("boom");
        },
      },
    });
    await safeBeforeDispatch({
      intent: intent(hiveRoot),
      brief: { budgetTokens: null, budgetUsd: null },
    });
    const text = await readFile(file, "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ type: "doctor.ran" });
    expect(IraEventSchema.parse(JSON.parse(lines[1])).type).toBe("hook.failed");
  });

  it("records hook.failed with a null featureId when the id is not a hive id", async () => {
    registerCommandPlaneHooks({
      token: {
        async beforeDispatch() {
          throw new Error("boom");
        },
      },
    });
    const gate = await safeBeforeDispatch({
      intent: { ...intent(hiveRoot), featureId: "not a feature" },
      brief: { budgetTokens: null, budgetUsd: null },
    });
    expect(gate).toEqual({
      allow: false,
      reasonClass: "budget_exceed",
      detail: { hookFailed: true, reason: "HOOK_FAILED_CLOSED" },
    });
    const logged = await readHookFailed(hiveRoot);
    expect(logged.featureId).toBeNull();
    expect(logged.data).toEqual({ hook: "beforeDispatch", reason: "HOOK_FAILED_CLOSED" });
  });

  it("keeps an earlier token registration when a sibling registers engine hooks", async () => {
    registerCommandPlaneHooks({
      token: {
        async beforeDispatch() {
          return { allow: false, reasonClass: "budget_exceed", detail: "cap" };
        },
      },
    });
    registerCommandPlaneHooks({
      engine: {
        async dispatch() {
          return { accepted: true };
        },
      },
    });
    const gate = await safeBeforeDispatch({
      intent: intent(hiveRoot),
      brief: { budgetTokens: null, budgetUsd: null },
    });
    expect(gate).toEqual({ allow: false, reasonClass: "budget_exceed", detail: "cap" });
    expect(await safeEngineDispatch(intent(hiveRoot))).toEqual({ accepted: true });
  });
});

async function readHookFailed(hiveRoot: string) {
  const text = await readFile(join(hiveRoot, "events", "events.jsonl"), "utf8");
  const lines = text.trim().split("\n");
  expect(lines).toHaveLength(1);
  return IraEventSchema.parse(JSON.parse(lines[0]!));
}
