import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { HiveLedgerSchema, RosterAgentSchema } from "../../src/command-plane/schema.js";
import { listAskMe } from "../../src/command-plane/ask-me.js";
import type { HiveTask, RosterAgent } from "../../src/command-plane/types.js";
import { loadState, saveState } from "../../src/forge-loop.js";
import { runCli } from "../../src/cli.js";
import { buildToolDefinitions } from "../../src/mcp-server.js";
import {
  applyReplanAfterFailure,
  pauseIncrementsReviewFailures,
  replanKindForFailure,
} from "../../src/command-plane/replan.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;
const NOW = "2026-10-16T12:00:00.000Z";

const PLAN = [
  "### Task T001: Alpha",
  "**Implements:** FR-005",
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

describe("pauseIncrementsReviewFailures", () => {
  it("is false for task-hold path", () => {
    expect(pauseIncrementsReviewFailures()).toBe(false);
  });
});

describe("replanKindForFailure", () => {
  it("retries at a higher tier on the first real failure", () => {
    expect(
      replanKindForFailure({
        forgeStatus: "pending",
        reviewFailures: 1,
        ceiling: 3,
        assigneeAgentId: "agent-host",
        idleAgentIds: ["agent-host"],
      }),
    ).toBe("retry_tier");
  });

  it("reassigns on the second failure when another idle agent exists", () => {
    expect(
      replanKindForFailure({
        forgeStatus: "pending",
        reviewFailures: 2,
        ceiling: 3,
        assigneeAgentId: "agent-host",
        idleAgentIds: ["agent-host", "agent-b"],
      }),
    ).toBe("reassign");
  });

  it("stays on retry_tier when no other idle agent exists", () => {
    expect(
      replanKindForFailure({
        forgeStatus: "pending",
        reviewFailures: 2,
        ceiling: 3,
        assigneeAgentId: "agent-host",
        idleAgentIds: ["agent-host"],
      }),
    ).toBe("retry_tier");
  });

  it("returns null at the ceiling", () => {
    expect(
      replanKindForFailure({
        forgeStatus: "blocked",
        reviewFailures: 3,
        ceiling: 3,
        assigneeAgentId: "agent-host",
        idleAgentIds: ["agent-b"],
        substeps: ["draft the parser"],
      }),
    ).toBeNull();
  });

  it("records split only when substeps stay on this task under the ceiling", () => {
    expect(
      replanKindForFailure({
        forgeStatus: "pending",
        reviewFailures: 1,
        ceiling: 3,
        assigneeAgentId: "agent-host",
        idleAgentIds: [],
        substeps: ["draft the parser"],
      }),
    ).toBe("split");
  });
});

describe("applyReplanAfterFailure", () => {
  it("does not replan or increment reviewFailures on pause or abort", async () => {
    const ctx = await seeded({ reviewFailures: 2 });
    await saveState(ctx.specDir, { tasks: { T001: { status: "in_progress", reviewFailures: 2 } } });
    const before = await readFile(join(ctx.specDir, ".superspec", "state.json"), "utf8");
    const eventsBefore = await readEvents(ctx.hive);

    const paused = await applyReplanAfterFailure({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      source: "pause",
      now: NOW,
    });
    const aborted = await applyReplanAfterFailure({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      source: "abort",
      passed: false,
      forgeStatus: "blocked",
      reviewFailures: 2,
      ceiling: 3,
      now: NOW,
    });

    expect(paused).toMatchObject({ ok: true, applied: false, reason: "pause", reviewFailuresDelta: 0 });
    expect(aborted).toMatchObject({ ok: true, applied: false, reason: "abort", reviewFailuresDelta: 0 });
    expect(await readFile(join(ctx.specDir, ".superspec", "state.json"), "utf8")).toBe(before);
    expect((await readLedger(ctx.hive)).tasks[0]).toMatchObject({ reviewFailures: 2, replan: null });
    expect(await readEvents(ctx.hive)).toEqual(eventsBefore);
    expect(await listAskMe({ hiveRoot: ctx.hive, state: "open" })).toMatchObject({ ok: true, items: [] });
  });

  it("does nothing when record-result passed", async () => {
    const ctx = await seeded();
    const result = await applyReplanAfterFailure({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      source: "record-result",
      passed: true,
      forgeStatus: "done",
      reviewFailures: 0,
      ceiling: 3,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, applied: false, reason: "passed", reviewFailuresDelta: 0 });
    expect((await loadState(ctx.specDir))?.tasks.T001.reviewFailures).toBe(0);
    expect((await readLedger(ctx.hive)).tasks[0].replan ?? null).toBeNull();
    expect(await readEvents(ctx.hive)).toEqual([]);
  });

  it("replans retry_tier after the first passed:false and does not burn another review", async () => {
    const ctx = await seeded({ reviewFailures: 1, complexity: "mechanical" });
    const planBefore = await readFile(ctx.planPath, "utf8");

    const result = await applyReplanAfterFailure({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      source: "record-result",
      passed: false,
      forgeStatus: "pending",
      reviewFailures: 1,
      ceiling: 3,
      now: NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      action: "replan",
      kind: "retry_tier",
      reviewFailures: 1,
      ceiling: 3,
      attempt: 2,
      tier: "standard",
      fromAgentId: "agent-host",
      toAgentId: "agent-host",
      reviewFailuresDelta: 0,
    });
    expect((await loadState(ctx.specDir))?.tasks.T001).toEqual({ status: "pending", reviewFailures: 1 });
    expect((await readLedger(ctx.hive)).tasks[0]).toMatchObject({
      reviewFailures: 1,
      assigneeAgentId: "agent-host",
      replan: {
        kind: "retry_tier",
        reviewFailures: 1,
        ceiling: 3,
        attempt: 2,
        fromAgentId: "agent-host",
        toAgentId: "agent-host",
      },
    });
    expect((await eventTypes(ctx.hive)).filter((type) => type === "task.failed" || type === "task.replanned")).toEqual([
      "task.failed",
      "task.replanned",
    ]);
    expect(await readFile(ctx.planPath, "utf8")).toBe(planBefore);
  });

  it("reassigns on the second failure and uses a frontier attempt", async () => {
    const ctx = await seeded({
      reviewFailures: 2,
      assigneeAgentId: "agent-host",
      roster: [agent("agent-host", "busy"), agent("agent-b", "idle")],
    });

    const result = await applyReplanAfterFailure({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      source: "record-result",
      passed: false,
      forgeStatus: "pending",
      reviewFailures: 2,
      ceiling: 3,
      now: NOW,
    });

    expect(result).toMatchObject({
      action: "replan",
      kind: "reassign",
      attempt: 3,
      tier: "frontier",
      fromAgentId: "agent-host",
      toAgentId: "agent-b",
      reviewFailuresDelta: 0,
    });
    expect((await readLedger(ctx.hive)).tasks[0]).toMatchObject({
      reviewFailures: 2,
      assigneeAgentId: "agent-b",
    });
    expect((await loadState(ctx.specDir))?.tasks.T001.reviewFailures).toBe(2);
  });

  it("opens repeated_review_failure at the ceiling and does not silently replan", async () => {
    const ctx = await seeded({ reviewFailures: 3, hiveStatus: "blocked", forgeStatus: "blocked" });

    const first = await applyReplanAfterFailure({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      source: "record-result",
      passed: false,
      forgeStatus: "blocked",
      reviewFailures: 3,
      ceiling: 3,
      substeps: ["draft the parser"],
      now: NOW,
    });
    const second = await applyReplanAfterFailure({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      source: "record-result",
      passed: false,
      forgeStatus: "blocked",
      reviewFailures: 3,
      ceiling: 3,
      now: NOW,
    });

    expect(first).toMatchObject({
      ok: true,
      applied: true,
      action: "ask_me",
      reasonClass: "repeated_review_failure",
      created: true,
      reviewFailures: 3,
      reviewFailuresDelta: 0,
    });
    expect(second).toMatchObject({ action: "ask_me", created: false, reviewFailuresDelta: 0 });
    if (!first.ok || first.applied !== true || first.action !== "ask_me") throw new Error("expected ask-me");
    expect(second).toMatchObject({ askMeId: first.askMeId });
    const inbox = await listAskMe({ hiveRoot: ctx.hive, state: "open", featureId: "001-demo" });
    expect(inbox.ok && inbox.items.map((item) => item.reasonClass)).toEqual(["repeated_review_failure"]);
    expect((await readLedger(ctx.hive)).tasks[0]).toMatchObject({
      reviewFailures: 3,
      status: "blocked",
      replan: null,
      blockedByAskMeId: first.askMeId,
    });
    expect((await loadState(ctx.specDir))?.tasks.T001).toEqual({ status: "blocked", reviewFailures: 3 });
    expect(await eventTypes(ctx.hive)).not.toContain("task.replanned");
    expect(await eventTypes(ctx.hive)).toContain("task.blocked");
  });

  it("records split substeps on the same task without editing the plan", async () => {
    const ctx = await seeded({ reviewFailures: 1 });
    const planBefore = await readFile(ctx.planPath, "utf8");

    const result = await applyReplanAfterFailure({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      source: "record-result",
      passed: false,
      forgeStatus: "pending",
      reviewFailures: 1,
      ceiling: 3,
      substeps: ["draft the parser", "cover the ceiling"],
      now: NOW,
    });

    expect(result).toMatchObject({ action: "replan", kind: "split", reviewFailuresDelta: 0 });
    expect((await readLedger(ctx.hive)).tasks[0].replan).toMatchObject({
      kind: "split",
      substeps: ["draft the parser", "cover the ceiling"],
    });
    expect(await readFile(ctx.planPath, "utf8")).toBe(planBefore);
    expect(await readdir(ctx.specDir)).not.toContain("spec.md");
  });

  it("opens spec_scope_change when the worker asks to add a task or FR", async () => {
    const ctx = await seeded({ reviewFailures: 1 });
    const planBefore = await readFile(ctx.planPath, "utf8");

    const result = await applyReplanAfterFailure({
      hiveRoot: ctx.hive,
      featureId: "001-demo",
      taskId: "T001",
      source: "record-result",
      passed: false,
      forgeStatus: "pending",
      reviewFailures: 1,
      ceiling: 3,
      addsTaskOrFr: true,
      substeps: ["T099"],
      now: NOW,
    });

    expect(result).toMatchObject({
      action: "replan",
      kind: "retry_tier",
      reviewFailuresDelta: 0,
    });
    if (!result.ok || result.applied !== true || result.action !== "replan") throw new Error("expected replan");
    expect(result.scopeAskMeId).toEqual(expect.any(String));
    const inbox = await listAskMe({ hiveRoot: ctx.hive, state: "open" });
    expect(inbox.ok && inbox.items.map((item) => item.reasonClass)).toEqual(["spec_scope_change"]);
    expect((await readLedger(ctx.hive)).tasks[0].replan?.kind).toBe("retry_tier");
    expect(await readFile(ctx.planPath, "utf8")).toBe(planBefore);
  });
});

describe("record-result wiring", () => {
  it("replans only after CLI record-result passed false", async () => {
    const ctx = await wiredRepo();
    const failed = await runCli([
      "record-result",
      "--plan",
      ctx.planPath,
      "--dir",
      ctx.specDir,
      "--task",
      "T001",
      "--passed",
      "false",
    ]);
    expect(JSON.parse(failed.stdout)).toMatchObject({ ok: true, passed: false });
    expect((await loadState(ctx.specDir))?.tasks.T001).toEqual({ status: "pending", reviewFailures: 1 });
    expect((await readLedger(ctx.hive)).tasks.find((task) => task.id === "T001")).toMatchObject({
      reviewFailures: 1,
      replan: { kind: "retry_tier", attempt: 2, reviewFailures: 1 },
    });

    const passed = await runCli([
      "record-result",
      "--plan",
      ctx.planPath,
      "--dir",
      ctx.specDir,
      "--task",
      "T001",
      "--passed",
      "true",
    ]);
    expect(JSON.parse(passed.stdout)).toMatchObject({ ok: true, passed: true });
    expect((await loadState(ctx.specDir))?.tasks.T001.reviewFailures).toBe(1);
    expect((await eventTypes(ctx.hive)).filter((type) => type === "task.replanned")).toEqual(["task.replanned"]);
  });

  it("opens Ask-Me from CLI record-result at the feature ceiling", async () => {
    const ctx = await wiredRepo();
    await setFeatureCeiling(ctx.hive, 1);
    const failed = await runCli([
      "record-result",
      "--plan",
      ctx.planPath,
      "--dir",
      ctx.specDir,
      "--task",
      "T001",
      "--passed",
      "false",
    ]);

    expect(JSON.parse(failed.stdout)).toMatchObject({ ok: true, passed: false });
    expect((await loadState(ctx.specDir))?.tasks.T001).toEqual({ status: "blocked", reviewFailures: 1 });
    const task = (await readLedger(ctx.hive)).tasks.find((row) => row.id === "T001");
    expect(task).toMatchObject({ status: "blocked", reviewFailures: 1, ceiling: 1 });
    expect(task?.replan ?? null).toBeNull();
    const inbox = await listAskMe({ hiveRoot: ctx.hive, state: "open", featureId: "001-demo" });
    expect(inbox.ok && inbox.items.map((item) => item.reasonClass)).toEqual(["repeated_review_failure"]);
  });

  it("replans from MCP record-result only when passed is false", async () => {
    const ctx = await wiredRepo();
    const tool = buildToolDefinitions().find((entry) => entry.name === "record-result");
    if (!tool) throw new Error("missing record-result tool");

    const failed = await tool.handler({
      planText: PLAN,
      stateDir: ctx.specDir,
      taskId: "T001",
      passed: false,
      verbose: false,
      planPath: ctx.planPath,
    });
    expect(JSON.parse(failed.content[0].text)).toMatchObject({ ok: true, passed: false });
    expect((await loadState(ctx.specDir))?.tasks.T001.reviewFailures).toBe(1);
    expect((await readLedger(ctx.hive)).tasks.find((task) => task.id === "T001")?.replan?.kind).toBe("retry_tier");

    const passed = await tool.handler({
      planText: PLAN,
      stateDir: ctx.specDir,
      taskId: "T001",
      passed: true,
      verbose: false,
      planPath: ctx.planPath,
    });
    expect(JSON.parse(passed.content[0].text)).toMatchObject({ ok: true, passed: true });
    expect((await loadState(ctx.specDir))?.tasks.T001.reviewFailures).toBe(1);
    expect((await eventTypes(ctx.hive)).filter((type) => type === "task.replanned")).toHaveLength(1);
  });
});

async function seeded(options: {
  reviewFailures?: number;
  forgeStatus?: "pending" | "blocked";
  hiveStatus?: HiveTask["status"];
  assigneeAgentId?: string | null;
  complexity?: HiveTask["complexity"];
  roster?: RosterAgent[];
} = {}): Promise<{ hive: string; specDir: string; planPath: string }> {
  const reviewFailures = options.reviewFailures ?? 0;
  const forgeStatus = options.forgeStatus ?? "pending";
  const hive = await tempHive();
  const specDir = join(hive.root, "specs", "001-demo");
  const planPath = join(specDir, "plan.md");
  await mkdir(specDir, { recursive: true });
  await writeFile(planPath, PLAN);
  await saveState(specDir, { tasks: { T001: { status: forgeStatus, reviewFailures } } });
  const roster = options.roster ?? [agent("agent-host", "idle")];
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
        implementsFr: ["FR-005"],
        dependsOn: [],
        assigneeAgentId: options.assigneeAgentId === undefined ? "agent-host" : options.assigneeAgentId,
        status: options.hiveStatus ?? "todo",
        kind: "code",
        complexity: options.complexity ?? "mechanical",
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
  return { hive: hive.hive, specDir, planPath };
}

async function wiredRepo(): Promise<{ hive: string; specDir: string; planPath: string }> {
  const hive = await tempHive();
  const specDir = join(hive.root, "specs", "001-demo");
  const planPath = join(specDir, "plan.md");
  await mkdir(specDir, { recursive: true });
  await writeFile(planPath, PLAN);
  await writeFile(
    join(hive.hive, "roster.json"),
    `${JSON.stringify(RosterAgentSchema.array().parse([agent("agent-host", "idle")]))}\n`,
  );
  return { hive: hive.hive, specDir, planPath };
}

async function tempHive(): Promise<{ root: string; hive: string }> {
  const root = await mkdtemp(join(tmpdir(), "cp-replan-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# p\n");
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  expect(init.ok).toBe(true);
  return { root, hive: join(root, ".superspec", "hive") };
}

function agent(id: string, status: RosterAgent["status"]): RosterAgent {
  return {
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
  };
}

async function setFeatureCeiling(hive: string, ceiling: number): Promise<void> {
  const settingsPath = join(hive, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { featureCeilings: Record<string, number> };
  settings.featureCeilings["001-demo"] = ceiling;
  await writeFile(settingsPath, JSON.stringify(settings));
}

async function readLedger(hive: string) {
  return HiveLedgerSchema.parse(JSON.parse(await readFile(join(hive, "ledger", "001-demo.json"), "utf8")));
}

async function readEvents(hive: string): Promise<Array<{ type: string }>> {
  const raw = await readFile(join(hive, "events", "events.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string });
}

async function eventTypes(hive: string): Promise<string[]> {
  return (await readEvents(hive)).map((event) => event.type);
}
