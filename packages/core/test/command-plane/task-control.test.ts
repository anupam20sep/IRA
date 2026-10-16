import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { HiveLedgerSchema, RosterAgentSchema } from "../../src/command-plane/schema.js";
import type { HiveTask, RosterAgent } from "../../src/command-plane/types.js";
import { loadState, saveState } from "../../src/forge-loop.js";
import {
  abortBlockedByForgeStatus,
  abortWithoutConfirmWritesNothing,
  taskAbort,
  taskHold,
  taskReassign,
} from "../../src/command-plane/task-control.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;
const NOW = "2026-10-16T12:00:00.000Z";

const PLAN = [
  "### Task T001: Alpha",
  "**Implements:** FR-030",
  "**Depends on:** none",
  "**Kind:** code",
  "**Complexity:** mechanical",
  "",
].join("\n");

beforeEach(() => {
  delete process.env.SUPERSPEC_ROOT;
});

afterEach(async () => {
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("taskAbort", () => {
  it("requires confirm true", () => {
    expect(abortWithoutConfirmWritesNothing({ confirm: false }).writes).toBe(false);
    expect(abortWithoutConfirmWritesNothing({ confirm: true }).writes).toBe(true);
  });
});

describe("abortBlockedByForgeStatus", () => {
  it("returns ABORT_UNSUPPORTED only when forge is done", () => {
    expect(abortBlockedByForgeStatus("done")).toEqual({ blocked: true, code: "ABORT_UNSUPPORTED" });
    expect(abortBlockedByForgeStatus("in_progress")).toEqual({ blocked: false });
    expect(abortBlockedByForgeStatus("pending")).toEqual({ blocked: false });
    expect(abortBlockedByForgeStatus("blocked")).toEqual({ blocked: false });
  });
});

describe("taskHold", () => {
  it("sets hold without changing forge or reviewFailures", async () => {
    const ctx = await seeded({ reviewFailures: 2, forgeStatus: "in_progress", hiveStatus: "doing" });
    const forgeBefore = await readFile(join(ctx.specDir, ".superspec", "state.json"), "utf8");

    const held = await taskHold({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      hold: true,
      now: NOW,
    });

    expect(held).toMatchObject({ ok: true, task: { id: "T001", hold: true, reviewFailures: 2 } });
    expect(await readFile(join(ctx.specDir, ".superspec", "state.json"), "utf8")).toBe(forgeBefore);
    expect((await loadState(ctx.specDir))?.tasks.T001).toEqual({ status: "in_progress", reviewFailures: 2 });
    expect(await eventTypes(ctx.hive)).toEqual(["task.held"]);
  });

  it("clears hold and appends task.resumed", async () => {
    const ctx = await seeded({ hiveStatus: "doing" });
    await taskHold({ hiveRoot: ctx.hive, featureId: "001-demo", taskId: "T001", hold: true, now: NOW });

    const resumed = await taskHold({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      hold: false,
      now: NOW,
    });

    expect(resumed).toMatchObject({ ok: true, task: { hold: false } });
    expect((await readLedger(ctx.hive)).tasks[0].hold).toBe(false);
    expect(await eventTypes(ctx.hive)).toEqual(["task.held", "task.resumed"]);
  });
});

describe("taskAbort integration", () => {
  it("writes nothing without confirm", async () => {
    const ctx = await seeded({ forgeStatus: "in_progress", hiveStatus: "doing", reviewFailures: 1 });
    const ledgerBefore = await readFile(join(ctx.hive, "ledger", "001-demo.json"), "utf8");
    const forgeBefore = await readFile(join(ctx.specDir, ".superspec", "state.json"), "utf8");

    const result = await taskAbort({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      confirm: false,
      abortReason: "operator stop",
    });

    expect(result).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(await readFile(join(ctx.hive, "ledger", "001-demo.json"), "utf8")).toBe(ledgerBefore);
    expect(await readFile(join(ctx.specDir, ".superspec", "state.json"), "utf8")).toBe(forgeBefore);
    expect(await eventTypes(ctx.hive)).toEqual([]);
  });

  it("clears in_progress without incrementing reviewFailures", async () => {
    const ctx = await seeded({ forgeStatus: "in_progress", hiveStatus: "doing", reviewFailures: 2 });

    const result = await taskAbort({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      confirm: true,
      abortReason: "operator stop",
      now: NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      task: { id: "T001", status: "blocked", hold: false, reviewFailures: 2, abortReason: "operator stop" },
    });
    expect((await loadState(ctx.specDir))?.tasks.T001).toEqual({ status: "blocked", reviewFailures: 2 });
    expect(await eventTypes(ctx.hive)).toEqual(["task.aborted"]);
  });

  it("returns ABORT_UNSUPPORTED when forge is done", async () => {
    const ctx = await seeded({ forgeStatus: "done", hiveStatus: "done", reviewFailures: 0 });
    const ledgerBefore = await readFile(join(ctx.hive, "ledger", "001-demo.json"), "utf8");

    const result = await taskAbort({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      confirm: true,
      abortReason: "too late",
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, error: "ABORT_UNSUPPORTED" });
    expect(await readFile(join(ctx.hive, "ledger", "001-demo.json"), "utf8")).toBe(ledgerBefore);
    expect(await eventTypes(ctx.hive)).toEqual([]);
  });
});

describe("taskReassign", () => {
  it("updates assigneeAgentId and updatedAt only and appends a reassign event", async () => {
    const ctx = await seeded({ reviewFailures: 2, forgeStatus: "in_progress", hiveStatus: "doing" });
    await addAgent(ctx.hive, "agent-two", "idle");
    const forgeBefore = await readFile(join(ctx.specDir, ".superspec", "state.json"), "utf8");

    const result = await taskReassign({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      agentId: "agent-two",
      now: NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      task: {
        id: "T001",
        assigneeAgentId: "agent-two",
        status: "doing",
        reviewFailures: 2,
        updatedAt: NOW,
      },
    });
    const task = (await readLedger(ctx.hive)).tasks[0];
    expect(task).toMatchObject({
      assigneeAgentId: "agent-two",
      status: "doing",
      hold: false,
      reviewFailures: 2,
      updatedAt: NOW,
    });
    expect(await readFile(join(ctx.specDir, ".superspec", "state.json"), "utf8")).toBe(forgeBefore);
    expect(await eventTypes(ctx.hive)).toEqual(["task.reassigned"]);
  });

  it("refuses an offline or missing agent without writing the ledger", async () => {
    const ctx = await seeded({ hiveStatus: "doing", reviewFailures: 1 });
    await addAgent(ctx.hive, "agent-away", "offline");
    const ledgerBefore = await readFile(join(ctx.hive, "ledger", "001-demo.json"), "utf8");

    const offline = await taskReassign({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      agentId: "agent-away",
      now: NOW,
    });
    const missing = await taskReassign({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      agentId: "agent-missing",
      now: NOW,
    });

    expect(offline).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(missing).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(await readFile(join(ctx.hive, "ledger", "001-demo.json"), "utf8")).toBe(ledgerBefore);
    expect(await eventTypes(ctx.hive)).toEqual([]);
  });
});

async function addAgent(hive: string, id: string, status: RosterAgent["status"]): Promise<void> {
  const path = join(hive, "roster.json");
  const roster = RosterAgentSchema.array().parse(JSON.parse(await readFile(path, "utf8")));
  roster.push({
    id,
    name: id,
    personaPath: null,
    capabilityTags: [],
    engine: null,
    model: null,
    workspace: null,
    worktreePolicy: "shared",
    status,
    origin: "manual",
  });
  await writeFile(path, `${JSON.stringify(RosterAgentSchema.array().parse(roster))}\n`);
}

async function seeded(options: {
  reviewFailures?: number;
  forgeStatus?: "pending" | "in_progress" | "blocked" | "done";
  hiveStatus?: HiveTask["status"];
} = {}): Promise<{ hive: string; specDir: string }> {
  const reviewFailures = options.reviewFailures ?? 0;
  const forgeStatus = options.forgeStatus ?? "pending";
  const hive = await tempHive();
  const specDir = join(hive.root, "specs", "001-demo");
  await mkdir(specDir, { recursive: true });
  await writeFile(join(specDir, "plan.md"), PLAN);
  await saveState(specDir, { tasks: { T001: { status: forgeStatus, reviewFailures } } });
  const roster: RosterAgent[] = [
    {
      id: "agent-host",
      name: "agent-host",
      personaPath: null,
      capabilityTags: [],
      engine: null,
      model: null,
      workspace: null,
      worktreePolicy: "shared",
      status: "idle",
      origin: "manual",
    },
  ];
  await writeFile(join(hive.hive, "roster.json"), `${JSON.stringify(RosterAgentSchema.array().parse(roster))}\n`);
  const ledger = HiveLedgerSchema.parse({
    featureId: "001-demo",
    planPath: "specs/001-demo/plan.md",
    specDir: "specs/001-demo",
    maxReviewFailures: 3,
    updatedAt: NOW,
    tasks: [
      {
        id: "T001",
        featureId: "001-demo",
        title: "Alpha",
        implementsFr: ["FR-030"],
        dependsOn: [],
        assigneeAgentId: "agent-host",
        status: options.hiveStatus ?? "todo",
        kind: "code",
        complexity: "mechanical",
        reviewFailures,
        hold: false,
        ceiling: 3,
        drift: "ok",
        replan: null,
        capabilityTags: [],
        updatedAt: NOW,
      },
    ],
  });
  await mkdir(join(hive.hive, "ledger"), { recursive: true });
  await writeFile(join(hive.hive, "ledger", "001-demo.json"), `${JSON.stringify(ledger)}\n`);
  return { hive: hive.hive, specDir };
}

async function tempHive(): Promise<{ root: string; hive: string }> {
  const root = await mkdtemp(join(tmpdir(), "cp-task-control-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# p\n");
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  expect(init.ok).toBe(true);
  return { root, hive: join(root, ".superspec", "hive") };
}

async function readLedger(hive: string) {
  return HiveLedgerSchema.parse(JSON.parse(await readFile(join(hive, "ledger", "001-demo.json"), "utf8")));
}

async function eventTypes(hive: string): Promise<string[]> {
  const raw = await readFile(join(hive, "events", "events.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { type: string }).type);
}
