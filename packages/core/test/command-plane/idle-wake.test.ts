import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hiveCiSet } from "../../src/command-plane/blackboard.js";
import { briefSubmit } from "../../src/command-plane/brief.js";
import { idleWakeAfterPass, idleWakeUsesDispatchTask } from "../../src/command-plane/dispatch.js";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { HiveLedgerSchema, RosterAgentSchema } from "../../src/command-plane/schema.js";
import { loadState, saveState } from "../../src/forge-loop.js";
import { runCli } from "../../src/cli.js";
import { buildToolDefinitions } from "../../src/mcp-server.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;
const FEATURE = "001-demo";

const PLAN = [
  "### Task T001: Alpha",
  "**Implements:** FR-001",
  "**Depends on:** none",
  "**Kind:** code",
  "**Complexity:** mechanical",
  "",
  "### Task T002: Beta",
  "**Implements:** FR-006",
  "**Depends on:** T001",
  "**Kind:** code",
  "**Complexity:** mechanical",
  "",
  "### Task T003: Gap",
  "**Implements:** none",
  "**Depends on:** none",
  "**Kind:** code",
  "**Complexity:** mechanical",
  "",
  "### Task T004: Check",
  "**Implements:** none",
  "**Depends on:** none",
  "**Kind:** verify",
  "**Complexity:** mechanical",
  "",
].join("\n");

const child = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  exec: vi.fn(),
  fork: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, ...child };
});

beforeEach(() => {
  delete process.env.SUPERSPEC_ROOT;
  child.spawn.mockClear();
  child.execFile.mockClear();
  child.exec.mockClear();
  child.fork.mockClear();
});

afterEach(async () => {
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("idleWakeUsesDispatchTask", () => {
  it("is true for supervised and autonomous and false for observe", () => {
    expect(idleWakeUsesDispatchTask("supervised")).toBe(true);
    expect(idleWakeUsesDispatchTask("autonomous")).toBe(true);
    expect(idleWakeUsesDispatchTask("observe")).toBe(false);
  });
});

describe("idleWakeAfterPass", () => {
  it("does nothing when the recorded result did not pass", async () => {
    await expect(
      idleWakeAfterPass({
        hiveExists: false,
        completedTaskId: "T001",
        passed: false,
      }),
    ).resolves.toEqual({ woke: false, reason: "not_passed" });
    expect(beginTaskArgv()).toEqual([]);
  });

  it("calls dispatchTask and does not argv begin-task for supervised and autonomous", async () => {
    for (const autonomy of ["supervised", "autonomous"] as const) {
      child.spawn.mockClear();
      child.execFile.mockClear();
      child.exec.mockClear();
      child.fork.mockClear();
      const repo = await readyPass("T001");
      await setAutonomy(repo.hive, autonomy);

      const result = await idleWakeAfterPass({
        hiveExists: true,
        hiveRoot: repo.hive,
        featureId: FEATURE,
        cwd: repo.root,
        completedTaskId: "T001",
        passed: true,
      });

      expect(result).toMatchObject({
        woke: true,
        mode: "dispatched",
        taskId: "T002",
        via: "dispatch-task",
        began: true,
      });
      expect(beginTaskArgv()).toEqual([]);
      const queued = JSON.parse(await readFile(join(repo.hive, "dispatch-queue", FEATURE, "T002.json"), "utf8"));
      expect(queued).toMatchObject({ featureId: FEATURE, taskId: "T002", freshSubagent: true });
      expect((await loadState(repo.specDir))?.tasks.T002?.status).toBe("in_progress");
      const ledger = await readLedger(repo.hive);
      expect(ledger.tasks.find((task) => task.id === "T002")).toMatchObject({
        assigneeAgentId: "agent-host",
        status: "doing",
      });
      const events = await readEvents(repo.hive);
      expect(events.filter((event) => event.type === "task.recommended")).toEqual([]);
      expect(events.some((event) => event.type === "task.dispatched" && event.data.internal === true)).toBe(true);
      expect(events.some((event) => event.type === "task.assigned" && event.data.taskId === "T002")).toBe(true);
    }
  });

  it("assigns an idle tag match instead of a busy finisher", async () => {
    const repo = await readyPass("T001");
    await patchTask(repo.hive, "T001", { assigneeAgentId: "agent-host" });
    await patchTask(repo.hive, "T002", { capabilityTags: ["ui"] });
    await writeRoster(repo.hive, [
      rosterAgent("agent-host", "busy", ["ui"]),
      rosterAgent("idle-match", "idle", ["ui"]),
    ]);

    const result = await idleWakeAfterPass({
      hiveExists: true,
      hiveRoot: repo.hive,
      featureId: FEATURE,
      cwd: repo.root,
      completedTaskId: "T001",
      passed: true,
    });

    expect(result).toMatchObject({
      woke: true,
      mode: "dispatched",
      taskId: "T002",
      via: "dispatch-task",
      began: true,
    });
    const queued = JSON.parse(await readFile(join(repo.hive, "dispatch-queue", FEATURE, "T002.json"), "utf8"));
    expect(queued.agentId).toBe("idle-match");
    expect((await readLedger(repo.hive)).tasks.find((task) => task.id === "T002")).toMatchObject({
      assigneeAgentId: "idle-match",
      status: "doing",
    });
    const events = await readEvents(repo.hive);
    expect(events.some((event) => event.type === "task.assigned" && event.data.agentId === "idle-match")).toBe(true);
    expect(events.some((event) => event.type === "task.assigned" && event.data.agentId === "agent-host" && event.data.taskId === "T002")).toBe(false);
  });

  it("observe emits task.recommended only", async () => {
    const repo = await readyPass("T001");
    await setAutonomy(repo.hive, "observe");

    const result = await idleWakeAfterPass({
      hiveExists: true,
      hiveRoot: repo.hive,
      featureId: FEATURE,
      cwd: repo.root,
      completedTaskId: "T001",
      passed: true,
    });

    expect(result).toEqual({
      woke: true,
      mode: "recommended",
      taskId: "T002",
      agentId: "agent-host",
    });
    expect(beginTaskArgv()).toEqual([]);
    await expect(access(join(repo.hive, "dispatch-queue", FEATURE, "T002.json"))).rejects.toThrow();
    expect((await loadState(repo.specDir))?.tasks.T002?.status).toBe("pending");
    const next = (await readLedger(repo.hive)).tasks.find((task) => task.id === "T002");
    expect(next).toMatchObject({ assigneeAgentId: null, status: "todo" });
    const events = await readEvents(repo.hive);
    expect(events.filter((event) => event.type === "task.recommended")).toEqual([
      expect.objectContaining({
        type: "task.recommended",
        data: { taskId: "T002", agentId: "agent-host" },
      }),
    ]);
    expect(events.some((event) => event.type === "task.dispatched")).toBe(false);
    expect(events.some((event) => event.type === "task.assigned" && event.data.taskId === "T002")).toBe(false);
  });
});

describe("record-result idle wake", () => {
  it("wakes from CLI and MCP record-result by calling dispatch-task", async () => {
    const cliRepo = await readyRepo();
    const cli = await runCli([
      "record-result",
      "--plan",
      join(cliRepo.specDir, "plan.md"),
      "--dir",
      cliRepo.specDir,
      "--task",
      "T001",
      "--passed",
      "true",
    ]);
    expect(JSON.parse(cli.stdout)).toMatchObject({ ok: true, taskId: "T001", passed: true });
    expect((await loadState(cliRepo.specDir))?.tasks.T001?.status).toBe("done");
    expect((await loadState(cliRepo.specDir))?.tasks.T002?.status).toBe("in_progress");
    expect(beginTaskArgv()).toEqual([]);
    await expect(access(join(cliRepo.hive, "dispatch-queue", FEATURE, "T002.json"))).resolves.toBeUndefined();

    const mcpRepo = await readyRepo();
    const tool = buildToolDefinitions().find((entry) => entry.name === "record-result");
    if (!tool) throw new Error("missing record-result tool");
    const mcp = await tool.handler({
      planText: PLAN,
      stateDir: mcpRepo.specDir,
      taskId: "T001",
      passed: true,
      verbose: false,
      planPath: join(mcpRepo.specDir, "plan.md"),
    });
    expect(JSON.parse(mcp.content[0].text)).toMatchObject({ ok: true, taskId: "T001", passed: true });
    expect((await loadState(mcpRepo.specDir))?.tasks.T002?.status).toBe("in_progress");
    expect(beginTaskArgv()).toEqual([]);
    await expect(access(join(mcpRepo.hive, "dispatch-queue", FEATURE, "T002.json"))).resolves.toBeUndefined();
  });

  it("observe record-result emits task.recommended and does not dispatch", async () => {
    const repo = await readyRepo();
    await setAutonomy(repo.hive, "observe");
    const result = await runCli([
      "record-result",
      "--plan",
      join(repo.specDir, "plan.md"),
      "--dir",
      repo.specDir,
      "--task",
      "T001",
      "--passed",
      "true",
    ]);

    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, passed: true });
    expect((await loadState(repo.specDir))?.tasks.T002?.status ?? "pending").not.toBe("in_progress");
    await expect(access(join(repo.hive, "dispatch-queue", FEATURE, "T002.json"))).rejects.toThrow();
    const events = await readEvents(repo.hive);
    expect(events.some((event) => event.type === "task.recommended" && event.data.taskId === "T002")).toBe(true);
    expect(events.some((event) => event.type === "task.dispatched")).toBe(false);
    expect(beginTaskArgv()).toEqual([]);
  });
});

function beginTaskArgv(): unknown[][] {
  const calls = [
    ...child.spawn.mock.calls,
    ...child.execFile.mock.calls,
    ...child.exec.mock.calls,
    ...child.fork.mock.calls,
  ];
  return calls.filter((call) => JSON.stringify(call).includes("begin-task"));
}

async function readyRepo(): Promise<{ root: string; hive: string; specDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "cp-idle-wake-"));
  roots.push(root);
  const specDir = join(root, "specs", FEATURE);
  await mkdir(specDir, { recursive: true });
  await writeFile(join(root, "program.md"), "# p\n");
  await writeFile(join(specDir, "plan.md"), PLAN);
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  expect(init.ok).toBe(true);
  const submitted = await briefSubmit({
    cwd: root,
    featureId: FEATURE,
    outcome: "Wake the next task",
    deliverable: `specs/${FEATURE}`,
  });
  expect(submitted.ok).toBe(true);
  const hive = join(root, ".superspec", "hive");
  const ci = await hiveCiSet({ hiveRoot: hive, featureId: FEATURE, state: "green", source: "test" });
  expect(ci.ok).toBe(true);
  return { root, hive, specDir };
}

async function readyPass(completedTaskId: string): Promise<{ root: string; hive: string; specDir: string }> {
  const repo = await readyRepo();
  await patchTask(repo.hive, completedTaskId, { status: "done" });
  await saveState(repo.specDir, {
    tasks: {
      T001: { status: completedTaskId === "T001" ? "done" : "pending", reviewFailures: 0 },
      T002: { status: "pending", reviewFailures: 0 },
      T003: { status: "pending", reviewFailures: 0 },
      T004: { status: "pending", reviewFailures: 0 },
    },
  });
  return repo;
}

async function setAutonomy(hive: string, autonomy: "observe" | "supervised" | "autonomous"): Promise<void> {
  const path = join(hive, "settings.json");
  const settings = JSON.parse(await readFile(path, "utf8")) as { autonomy: string; updatedAt: string };
  settings.autonomy = autonomy;
  settings.updatedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(settings));
}

async function readLedger(hive: string) {
  const raw = await readFile(join(hive, "ledger", `${FEATURE}.json`), "utf8");
  return HiveLedgerSchema.parse(JSON.parse(raw));
}

async function readEvents(hive: string): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
  const raw = await readFile(join(hive, "events", "events.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
}

function rosterAgent(
  id: string,
  status: "idle" | "busy" | "blocked" | "offline",
  capabilityTags: string[],
) {
  return RosterAgentSchema.parse({
    id,
    name: id,
    personaPath: null,
    capabilityTags,
    engine: null,
    model: null,
    workspace: null,
    worktreePolicy: "shared",
    status,
    origin: "manual",
  });
}

async function writeRoster(
  hive: string,
  agents: ReturnType<typeof rosterAgent>[],
): Promise<void> {
  await writeFile(join(hive, "roster.json"), JSON.stringify(RosterAgentSchema.array().parse(agents)));
}

async function patchTask(hive: string, taskId: string, patch: Record<string, unknown>): Promise<void> {
  const path = join(hive, "ledger", `${FEATURE}.json`);
  const ledger = JSON.parse(await readFile(path, "utf8")) as { tasks: Array<Record<string, unknown>> };
  const task = ledger.tasks.find((row) => row.id === taskId);
  if (!task) throw new Error(`missing ${taskId}`);
  Object.assign(task, patch);
  await writeFile(path, JSON.stringify(ledger));
}
