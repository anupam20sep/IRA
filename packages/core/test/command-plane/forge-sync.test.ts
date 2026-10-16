import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { assertBeginTaskAllowed, maybeSyncHive } from "../../src/command-plane/dispatch-guard.js";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { HiveLedgerSchema } from "../../src/command-plane/schema.js";
import { loadState, reconcileState, saveState, type ForgeState } from "../../src/forge-loop.js";
import { runCli } from "../../src/cli.js";
import { buildToolDefinitions } from "../../src/mcp-server.js";
import type { Task } from "../../src/types.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;

const PLAN = [
  "### Task T001: Alpha",
  "**Implements:** FR-016",
  "**Depends on:** none",
  "**Kind:** code",
  "**Complexity:** complex",
  "",
  "### Task T002: Beta",
  "**Implements:** FR-018",
  "**Depends on:** T001",
  "**Kind:** code",
  "**Complexity:** mechanical",
  "",
].join("\n");

const SPEC = "- **FR-016**: coordinator stays compatible\n- **FR-018**: forge tools stay valid\n";

const tasks: Task[] = [
  { id: "T001", title: "Alpha", frRefs: ["FR-016"], dependsOn: [], complexity: "complex", kind: "code" },
  { id: "T002", title: "Beta", frRefs: ["FR-018"], dependsOn: ["T001"], complexity: "mechanical", kind: "code" },
];

beforeEach(() => {
  delete process.env.SUPERSPEC_ROOT;
});

afterEach(async () => {
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRepo(): Promise<{
  root: string;
  specDir: string;
  planPath: string;
  specPath: string;
  hive: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "cp-forge-sync-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# p\n");
  const specDir = join(root, "specs", "001-demo");
  const planPath = join(specDir, "plan.md");
  const specPath = join(specDir, "spec.md");
  await mkdir(specDir, { recursive: true });
  await writeFile(planPath, PLAN);
  await writeFile(specPath, SPEC);
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  expect(init.ok).toBe(true);
  return { root, specDir, planPath, specPath, hive: join(root, ".superspec", "hive") };
}

async function tempDirWithoutHive(): Promise<{ root: string; specDir: string; planPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "cp-forge-plain-"));
  roots.push(root);
  const specDir = join(root, "specs", "001-demo");
  const planPath = join(specDir, "plan.md");
  await mkdir(specDir, { recursive: true });
  await writeFile(planPath, PLAN);
  return { root, specDir, planPath };
}

async function setFeatureCeiling(hive: string, featureId: string, ceiling: number): Promise<void> {
  const settingsPath = join(hive, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    featureCeilings: Record<string, number>;
  };
  settings.featureCeilings[featureId] = ceiling;
  await writeFile(settingsPath, JSON.stringify(settings));
}

async function readLedger(hive: string, featureId = "001-demo") {
  const raw = await readFile(join(hive, "ledger", `${featureId}.json`), "utf8");
  return HiveLedgerSchema.parse(JSON.parse(raw));
}

async function readEvents(hive: string): Promise<Array<{ type: string }>> {
  const raw = await readFile(join(hive, "events", "events.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string });
}

function statePath(specDir: string): string {
  return join(specDir, ".superspec", "state.json");
}

describe("assertBeginTaskAllowed", () => {
  it("rejects external begin-task when hive exists", () => {
    expect(assertBeginTaskAllowed({ hiveExists: true, internalFromDispatch: false }).ok).toBe(false);
    expect(assertBeginTaskAllowed({ hiveExists: true, internalFromDispatch: false }).code).toBe(
      "DISPATCH_PATH_REQUIRED",
    );
  });

  it("allows the internal dispatch call when the hive exists", () => {
    expect(assertBeginTaskAllowed({ hiveExists: true, internalFromDispatch: true })).toEqual({ ok: true });
  });

  it("allows begin-task when the hive is absent", () => {
    expect(assertBeginTaskAllowed({ hiveExists: false, internalFromDispatch: false })).toEqual({ ok: true });
    expect(assertBeginTaskAllowed({ hiveExists: false, internalFromDispatch: true })).toEqual({ ok: true });
  });
});

describe("reconcileState", () => {
  it("adds missing plan tasks and keeps existing rows, including ids the plan dropped", () => {
    const previous: ForgeState = {
      tasks: {
        T001: { status: "done", reviewFailures: 2 },
        T009: { status: "pending", reviewFailures: 4 },
      },
    };
    const snapshot = structuredClone(previous);

    const next = reconcileState(tasks, previous);

    expect(next.tasks.T001).toEqual({ status: "done", reviewFailures: 2 });
    expect(next.tasks.T002).toEqual({ status: "pending", reviewFailures: 0 });
    expect(next.tasks.T009).toEqual({ status: "pending", reviewFailures: 4 });
    expect(Object.keys(next.tasks).sort()).toEqual(["T001", "T002", "T009"]);
    next.tasks.T001 = { status: "pending", reviewFailures: 0 };
    expect(previous).toEqual(snapshot);
  });

  it("matches a fresh forge state when nothing was persisted", () => {
    expect(reconcileState(tasks, null)).toEqual({
      tasks: {
        T001: { status: "pending", reviewFailures: 0 },
        T002: { status: "pending", reviewFailures: 0 },
      },
    });
  });
});

describe("maybeSyncHive", () => {
  it("does not create a ledger or throw when the hive is absent", async () => {
    const { root, specDir, planPath } = await tempDirWithoutHive();
    await saveState(specDir, {
      tasks: {
        T001: { status: "in_progress", reviewFailures: 0 },
        T002: { status: "pending", reviewFailures: 0 },
      },
    });
    const before = await readFile(statePath(specDir), "utf8");

    await expect(
      maybeSyncHive({
        hiveExists: false,
        featureId: "001-demo",
        repositoryRoot: root,
        specDir,
        planPath,
      }),
    ).resolves.toBeUndefined();

    expect(await readFile(statePath(specDir), "utf8")).toBe(before);
    await expect(access(join(root, ".superspec", "hive", "hive.json"))).rejects.toThrow();
  });

  it("leaves forge bytes in place when sync fails", async () => {
    const { root, specDir, planPath, hive } = await tempRepo();
    const state: ForgeState = {
      tasks: {
        T001: { status: "done", reviewFailures: 0 },
        T002: { status: "pending", reviewFailures: 0 },
      },
    };
    await saveState(specDir, state);
    const before = await readFile(statePath(specDir), "utf8");
    await writeFile(join(hive, "settings.json"), "{");

    await expect(
      maybeSyncHive({
        hiveExists: true,
        featureId: "001-demo",
        repositoryRoot: root,
        specDir,
        planPath,
      }),
    ).resolves.toBeUndefined();

    expect(await readFile(statePath(specDir), "utf8")).toBe(before);
    await expect(access(join(hive, "ledger", "001-demo.json"))).rejects.toThrow();
    expect((await readEvents(hive)).some((event) => event.type === "hive.sync_failed")).toBe(true);
  });
});

describe("begin-task dispatch guard", () => {
  it("keeps pre-Ira begin-task when the hive is absent", async () => {
    const { root, specDir, planPath } = await tempDirWithoutHive();
    const result = await runCli(["begin-task", "--plan", planPath, "--dir", specDir, "--task", "T001"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, taskId: "T001", dir: specDir });
    expect(await loadState(specDir)).toMatchObject({
      tasks: { T001: { status: "in_progress", reviewFailures: 0 } },
    });
    await expect(access(join(root, ".superspec", "hive", "hive.json"))).rejects.toThrow();
  });

  it("returns DISPATCH_PATH_REQUIRED and does not mark the task in progress when the hive exists", async () => {
    const { specDir, planPath, hive } = await tempRepo();
    const result = await runCli(["begin-task", "--plan", planPath, "--dir", specDir, "--task", "T001"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: "DISPATCH_PATH_REQUIRED",
    });
    await expect(access(statePath(specDir))).rejects.toThrow();
    await expect(access(join(hive, "ledger", "001-demo.json"))).rejects.toThrow();
  });

  it("does not honor an argv bypass of the dispatch guard", async () => {
    const { specDir, planPath } = await tempRepo();
    const result = await runCli([
      "begin-task",
      "--plan",
      planPath,
      "--dir",
      specDir,
      "--task",
      "T001",
      "--internal-from-dispatch",
    ]);

    expect(result.stdout).not.toContain('"ok": true');
    await expect(loadState(specDir)).resolves.toBeNull();
  });

  it("marks in progress and syncs doing only for the in-process dispatch call", async () => {
    const { specDir, planPath, hive } = await tempRepo();
    const result = await runCli(["begin-task", "--plan", planPath, "--dir", specDir, "--task", "T001"], {
      internalFromDispatch: true,
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, taskId: "T001" });
    expect((await loadState(specDir))?.tasks.T001).toEqual({ status: "in_progress", reviewFailures: 0 });
    const ledger = await readLedger(hive);
    expect(ledger.tasks.find((task) => task.id === "T001")).toMatchObject({
      status: "doing",
      reviewFailures: 0,
    });
  });
});

describe("forge hive sync on successful writes", () => {
  it("uses the feature review ceiling and mirrors record-result", async () => {
    const { specDir, planPath, hive } = await tempRepo();
    await setFeatureCeiling(hive, "001-demo", 1);

    const result = await runCli([
      "record-result",
      "--plan",
      planPath,
      "--dir",
      specDir,
      "--task",
      "T001",
      "--passed",
      "false",
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, taskId: "T001", passed: false });
    expect((await loadState(specDir))?.tasks.T001).toEqual({ status: "blocked", reviewFailures: 1 });
    const ledger = await readLedger(hive);
    expect(ledger.maxReviewFailures).toBe(1);
    expect(ledger.tasks.find((task) => task.id === "T001")).toMatchObject({
      status: "blocked",
      reviewFailures: 1,
      ceiling: 1,
    });
  });

  it("keeps the default ceiling of 3 when the hive is absent", async () => {
    const { specDir, planPath } = await tempDirWithoutHive();
    const result = await runCli([
      "record-result",
      "--plan",
      planPath,
      "--dir",
      specDir,
      "--task",
      "T001",
      "--passed",
      "false",
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, taskId: "T001", passed: false });
    expect((await loadState(specDir))?.tasks.T001).toEqual({ status: "pending", reviewFailures: 1 });
  });

  it("does not roll back forge or change the success result when sync fails", async () => {
    const { specDir, planPath, hive } = await tempRepo();
    await writeFile(join(hive, "settings.json"), "{");

    const result = await runCli([
      "record-result",
      "--plan",
      planPath,
      "--dir",
      specDir,
      "--task",
      "T001",
      "--passed",
      "true",
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, taskId: "T001", passed: true });
    expect((await loadState(specDir))?.tasks.T001).toEqual({ status: "done", reviewFailures: 0 });
    await expect(access(join(hive, "ledger", "001-demo.json"))).rejects.toThrow();
    expect((await readEvents(hive)).some((event) => event.type === "hive.sync_failed")).toBe(true);
  });

  it("still appends the coordinator log when the hive exists", async () => {
    const { specDir, planPath } = await tempRepo();
    const result = await runCli([
      "record-result",
      "--plan",
      planPath,
      "--dir",
      specDir,
      "--task",
      "T001",
      "--passed",
      "true",
      "--coordinator",
    ]);

    expect(result.code).toBe(0);
    const body = JSON.parse(result.stdout) as { ok: boolean; coordinatorPath?: string };
    expect(body.ok).toBe(true);
    expect(body.coordinatorPath).toBeTruthy();
    expect(await readFile(body.coordinatorPath as string, "utf8")).toContain("T001");
  });

  it("syncs after sync-status without replacing the forge report", async () => {
    const { specDir, planPath, specPath, hive } = await tempRepo();
    await saveState(specDir, {
      tasks: {
        T001: { status: "in_progress", reviewFailures: 0 },
        T002: { status: "pending", reviewFailures: 0 },
      },
    });

    const result = await runCli([
      "sync-status",
      "--spec",
      specPath,
      "--plan",
      planPath,
      "--dir",
      specDir,
    ]);

    expect(result.code).toBe(0);
    const body = JSON.parse(result.stdout) as { path: string; snapshot: { summary: { inProgress: number } } };
    expect(body.path).toBe(join(specDir, "status.md"));
    expect(body.snapshot.summary.inProgress).toBe(1);
    const ledger = await readLedger(hive);
    expect(ledger.tasks.find((task) => task.id === "T001")?.status).toBe("doing");
  });
});

describe("MCP begin-task and record-result", () => {
  it("rejects a direct begin-task when the hive exists and does not persist state", async () => {
    const { specDir, hive } = await tempRepo();
    const tool = buildToolDefinitions().find((entry) => entry.name === "begin-task");
    if (!tool) throw new Error("missing begin-task tool");
    const parsed = z.object(tool.schema).parse({
      planText: PLAN,
      stateDir: specDir,
      taskId: "T001",
      verbose: false,
      internalFromDispatch: true,
    });

    expect(parsed).not.toHaveProperty("internalFromDispatch");
    const rejected = await tool.handler(parsed);
    expect(JSON.parse(rejected.content[0].text)).toMatchObject({
      ok: false,
      error: "DISPATCH_PATH_REQUIRED",
    });
    await expect(loadState(specDir)).resolves.toBeNull();
    await expect(access(join(hive, "ledger", "001-demo.json"))).rejects.toThrow();
  });

  it("allows the in-process dispatch call to begin the task and sync doing", async () => {
    const { specDir, planPath, hive } = await tempRepo();
    const tool = buildToolDefinitions().find((entry) => entry.name === "begin-task");
    if (!tool) throw new Error("missing begin-task tool");

    const started = await tool.handler({
      planText: PLAN,
      stateDir: specDir,
      taskId: "T001",
      verbose: false,
      planPath,
      internalFromDispatch: true,
    });

    expect(JSON.parse(started.content[0].text)).toMatchObject({ ok: true, taskId: "T001" });
    expect((await loadState(specDir))?.tasks.T001.status).toBe("in_progress");
    const ledger = await readLedger(hive);
    expect(ledger.tasks.find((task) => task.id === "T001")?.status).toBe("doing");
  });

  it("passes the hive review ceiling through record-result and still succeeds when sync fails", async () => {
    const { specDir, planPath, hive } = await tempRepo();
    await setFeatureCeiling(hive, "001-demo", 5);
    const tool = buildToolDefinitions().find((entry) => entry.name === "record-result");
    if (!tool) throw new Error("missing record-result tool");

    const failed = await tool.handler({
      planText: PLAN,
      stateDir: specDir,
      taskId: "T001",
      passed: false,
      verbose: false,
      planPath,
    });

    expect(JSON.parse(failed.content[0].text)).toMatchObject({ ok: true, taskId: "T001", passed: false });
    expect((await loadState(specDir))?.tasks.T001).toEqual({ status: "pending", reviewFailures: 1 });

    await writeFile(join(hive, "settings.json"), "{");
    const passed = await tool.handler({
      planText: PLAN,
      stateDir: specDir,
      taskId: "T001",
      passed: true,
      verbose: false,
      planPath,
    });
    expect(JSON.parse(passed.content[0].text)).toMatchObject({ ok: true, passed: true });
    expect((await loadState(specDir))?.tasks.T001).toEqual({ status: "done", reviewFailures: 1 });
    const ledger = await readLedger(hive);
    expect(ledger.tasks.find((task) => task.id === "T001")).toMatchObject({
      status: "todo",
      reviewFailures: 1,
      ceiling: 5,
    });
  });

  it("keeps begin-task working when the hive is absent", async () => {
    const { specDir } = await tempDirWithoutHive();
    const tool = buildToolDefinitions().find((entry) => entry.name === "begin-task");
    if (!tool) throw new Error("missing begin-task tool");
    const result = await tool.handler({
      planText: PLAN,
      stateDir: specDir,
      taskId: "T001",
      verbose: false,
    });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: true, taskId: "T001" });
    expect((await loadState(specDir))?.tasks.T001.status).toBe("in_progress");
  });
});
