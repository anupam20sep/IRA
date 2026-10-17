import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAskMe } from "../../src/command-plane/ask-me.js";
import { hiveCiSet } from "../../src/command-plane/blackboard.js";
import { briefSubmit } from "../../src/command-plane/brief.js";
import { dispatchTask } from "../../src/command-plane/dispatch.js";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { registerCommandPlaneHooks, type DispatchIntent, type SpendEventInput } from "../../src/command-plane/hooks.js";
import { mailboxRead } from "../../src/command-plane/mailbox.js";
import { dispatchEngine } from "../../src/engines/dispatch.js";
import type { FailoverPolicy } from "../../src/engines/types.js";
import { buildToolDefinitions } from "../../src/mcp-server.js";
import { setBudget, getEnforcedRemaining } from "../../src/token-governor/budgets.js";
import { evaluateBreaker, type BreakerSignal } from "../../src/token-governor/breaker.js";
import { tokenHooksImpl } from "../../src/token-governor/hooks-impl.js";
import { ensureTokenLayout, tokenRoot } from "../../src/token-governor/paths.js";
import { appendSpendEvent } from "../../src/token-governor/spend-ledger.js";

/**
 * SC-002: a dispatch over remaining budget does not start without Operator confirmation.
 * SC-003: loop, error-storm, and in-flight budget breach stop only after steer then constrain.
 */

const FEATURE = "004-gov-e2e";
const HOST = "agent-host";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;

afterEach(async () => {
  registerCommandPlaneHooks({ token: {}, engine: {}, learning: {}, hire: {} });
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("governor e2e fixtures", () => {
  it("denies dispatch when recorded spend meets the budget cap", async () => {
    expect(await runBudgetDenyFixture()).toEqual({
      allow: false,
      reasonClass: "budget_exceed",
      began: false,
      taskStatus: "todo",
      externalBegin: "DISPATCH_PATH_REQUIRED",
      askMeQuestion: expect.stringContaining("dispatch exceeds remaining budget"),
    });
  });

  it("denies dispatch when forecast exceeds remaining budget", async () => {
    expect(await runForecastDenyFixture()).toEqual({
      allow: false,
      reasonClass: "budget_exceed",
      began: false,
      taskStatus: "todo",
      remainingUsd: 1,
      askMeQuestion: expect.stringContaining("forecast exceeds remaining budget"),
    });
  });

  it("reaches stop on a loop only after steer then constrain", async () => {
    const hive = await tempHive();
    const seen = await walkBreaker(hive, "a1:s1", { trigger: "loop", toolHash: "read_file", currentTier: "frontier" });
    expect(seen.stages).toEqual(["steer", "constrain", "stop"]);
    expect(seen.haltReason).toContain("loop");
    expect(seen.haltReason).toContain("read_file");
    expect(seen.askMeQuestion).toContain(seen.haltReason);
    expect(seen.resumed).toBe(false);
  });

  it("reaches stop on an error storm only after steer then constrain", async () => {
    const hive = await tempHive();
    const seen = await walkBreaker(hive, "a1:s1", { trigger: "errors", currentTier: "frontier" });
    expect(seen.stages).toEqual(["steer", "constrain", "stop"]);
    expect(seen.haltReason).toContain("errors");
    expect(seen.askMeQuestion).toContain(seen.haltReason);
    expect(seen.resumed).toBe(false);
  });

  it("reaches stop on in-flight budget breach only after steer then constrain", async () => {
    const hive = await tempHive();
    await setBudget(hive, { scope: "feature", scopeId: FEATURE, unit: "tokens", cap: 10 });
    const workerKey = "a1:s1";

    await recordTokens(hive, 10);
    const steered = await readBreaker(hive, workerKey);
    expect(steered?.stage).toBe("steer");
    expect(steered?.haltReason).toBeNull();
    await expectSteerMail(hive, "a1");
    expect(await stopQuestions(hive)).toEqual([]);

    await recordTokens(hive, 1);
    const constrained = await readBreaker(hive, workerKey);
    expect(constrained?.stage).toBe("constrain");
    expect(constrained?.effectiveTier).toBe("standard");
    expect(constrained?.constrainContextGrowth).toBe(true);
    expect(constrained?.haltReason).toBeNull();
    expect(await stopQuestions(hive)).toEqual([]);

    await recordTokens(hive, 1);
    const stopped = await readBreaker(hive, workerKey);
    expect(stopped?.stage).toBe("stop");
    expect(stopped?.haltReason).toContain("budget");
    const questions = await stopQuestions(hive);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain(stopped?.haltReason ?? "");

    await recordTokens(hive, 1);
    const held = await readBreaker(hive, workerKey);
    expect(held?.stage).toBe("stop");
    expect(held?.haltReason).toBe(stopped?.haltReason);
    expect(await stopQuestions(hive)).toHaveLength(1);
  });

  it("denies failover onto an unmetered rung when a numeric budget cap is set", async () => {
    const capped = await failoverHive();
    await ensureTokenLayout(capped);
    await setBudget(capped, { scope: "feature", scopeId: "f1", unit: "tokens", cap: 1000 });
    expect(await dispatchEngine(failoverIntent(capped), { sliceAValidated: false })).toEqual({ accepted: false });

    const open = await failoverHive();
    await ensureTokenLayout(open);
    expect(await dispatchEngine(failoverIntent(open), { sliceAValidated: false })).toEqual({
      ok: false,
      code: "SLICE_A_ONLY",
    });
  });
});

async function runBudgetDenyFixture(): Promise<{
  allow: false;
  reasonClass: "budget_exceed";
  began: false;
  taskStatus: string;
  externalBegin: string;
  askMeQuestion: string;
}> {
  const repo = await staffedRepo(["T001"]);
  await setBudget(repo.hive, { scope: "feature", scopeId: FEATURE, unit: "usd", cap: 1 });
  await seedUsd(repo.hive, "T000", 1);
  const remaining = await getEnforcedRemaining(repo.hive, { agentId: HOST, featureId: FEATURE });
  expect(remaining.usd).toBe(0);

  const externalBegin = await beginTaskOutsideDispatch(repo);
  expect(await taskStatus(repo.hive, "T001")).toBe("todo");
  expect(await budgetQuestions(repo.hive)).toEqual([]);

  const dispatched = await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: repo.root });
  expect(dispatched.ok).toBe(false);
  if (dispatched.ok) throw new Error("budget deny fixture started the task");
  await expect(access(join(repo.hive, "dispatch-queue", FEATURE, "T001.json"))).rejects.toThrow();

  const questions = await budgetQuestions(repo.hive);
  expect(questions).toHaveLength(1);
  return {
    allow: false,
    reasonClass: "budget_exceed",
    began: dispatched.began,
    taskStatus: await taskStatus(repo.hive, "T001"),
    externalBegin,
    askMeQuestion: questions[0] ?? "",
  };
}

async function runForecastDenyFixture(): Promise<{
  allow: false;
  reasonClass: "budget_exceed";
  began: false;
  taskStatus: string;
  remainingUsd: number | null;
  askMeQuestion: string;
}> {
  const repo = await staffedRepo(["T001", "T002", "T003"]);
  await markDone(repo.hive, ["T001", "T002"]);
  await setBudget(repo.hive, { scope: "feature", scopeId: FEATURE, unit: "usd", cap: 7 });
  await seedUsd(repo.hive, "T001", 2);
  await seedUsd(repo.hive, "T002", 4);
  const remaining = await getEnforcedRemaining(repo.hive, { agentId: HOST, featureId: FEATURE });
  expect(remaining.usd).toBe(1);

  const dispatched = await dispatchTask({ featureId: FEATURE, taskId: "T003", cwd: repo.root });
  expect(dispatched.ok).toBe(false);
  if (dispatched.ok) throw new Error("forecast fixture started the task");
  await expect(access(join(repo.hive, "dispatch-queue", FEATURE, "T003.json"))).rejects.toThrow();

  const questions = await budgetQuestions(repo.hive);
  expect(questions).toHaveLength(1);
  return {
    allow: false,
    reasonClass: "budget_exceed",
    began: dispatched.began,
    taskStatus: await taskStatus(repo.hive, "T003"),
    remainingUsd: remaining.usd,
    askMeQuestion: questions[0] ?? "",
  };
}

async function walkBreaker(
  hive: string,
  workerKey: string,
  signal: BreakerSignal,
): Promise<{ stages: string[]; haltReason: string; askMeQuestion: string; resumed: boolean }> {
  const agentId = workerKey.slice(0, workerKey.indexOf(":"));
  const stages: string[] = [];
  let haltReason = "";
  const fired: BreakerSignal = { ...signal, featureId: FEATURE, taskId: "T001", sliceAActive: false };

  for (let step = 0; step < 3; step += 1) {
    const state = await evaluateBreaker(hive, workerKey, fired);
    stages.push(state.stage);
    if (step === 0) {
      expect(state.stage).toBe("steer");
      expect(state.haltReason).toBeNull();
      await expectSteerMail(hive, agentId);
      expect(await stopQuestions(hive)).toEqual([]);
    }
    if (step === 1) {
      expect(state.stage).toBe("constrain");
      expect(state.effectiveTier).toBe("standard");
      expect(state.constrainContextGrowth).toBe(true);
      expect(state.haltReason).toBeNull();
      expect(await stopQuestions(hive)).toEqual([]);
    }
    if (step === 2) {
      expect(state.stage).toBe("stop");
      haltReason = state.haltReason ?? "";
    }
  }

  const again = await evaluateBreaker(hive, workerKey, fired);
  const questions = await stopQuestions(hive);
  expect(questions).toHaveLength(1);
  return {
    stages,
    haltReason,
    askMeQuestion: questions[0] ?? "",
    resumed: again.stage !== "stop" || again.haltReason !== haltReason,
  };
}

async function tempHive(): Promise<string> {
  const repo = await tempRepo();
  return repo.hive;
}

async function staffedRepo(taskIds: string[]): Promise<{ root: string; hive: string; specDir: string; plan: string }> {
  const repo = await tempRepo();
  const specDir = join(repo.root, "specs", FEATURE);
  await mkdir(specDir, { recursive: true });
  const plan = taskIds.map(taskBlock).join("\n");
  await writeFile(join(specDir, "plan.md"), plan);
  const submitted = await briefSubmit({
    cwd: repo.root,
    featureId: FEATURE,
    outcome: "Govern token spend",
    deliverable: `specs/${FEATURE}`,
  });
  if (!submitted.ok) throw new Error(`brief submit failed: ${submitted.error}`);
  const ci = await hiveCiSet({ hiveRoot: repo.hive, featureId: FEATURE, state: "green", source: "test" });
  if (!ci.ok) throw new Error(`ci-set failed: ${ci.error}`);
  return { ...repo, specDir, plan };
}

async function tempRepo(): Promise<{ root: string; hive: string }> {
  const root = await mkdtemp(join(tmpdir(), "tg-gov-"));
  roots.push(root);
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "program.md"), "# program\n");
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  if (!init.ok) throw new Error(`hive init failed: ${init.error}`);
  return { root, hive: init.hiveRoot };
}

function taskBlock(id: string): string {
  return [
    `### Task ${id}: Governor fixture`,
    "**Implements:** FR-004",
    "**Depends on:** none",
    "**Kind:** code",
    "**Complexity:** mechanical",
    "",
  ].join("\n");
}

async function seedUsd(hive: string, taskId: string, usdEstimate: number): Promise<void> {
  const result = await appendSpendEvent(hive, {
    agentId: HOST,
    sessionId: "s",
    featureId: FEATURE,
    taskId,
    engine: null,
    model: null,
    inputTokens: 10,
    outputTokens: 5,
    usdEstimate,
    source: "api",
    partial: false,
  });
  if (!("id" in result)) throw new Error(`spend not recorded: ${JSON.stringify(result)}`);
}

async function markDone(hive: string, ids: string[]): Promise<void> {
  const path = join(hive, "ledger", `${FEATURE}.json`);
  const ledger = JSON.parse(await readFile(path, "utf8")) as { tasks: Array<{ id: string; status: string }> };
  for (const task of ledger.tasks) {
    if (ids.includes(task.id)) task.status = "done";
  }
  await writeFile(path, JSON.stringify(ledger));
}

async function taskStatus(hive: string, taskId: string): Promise<string> {
  const ledger = JSON.parse(await readFile(join(hive, "ledger", `${FEATURE}.json`), "utf8")) as {
    tasks: Array<{ id: string; status: string }>;
  };
  return ledger.tasks.find((task) => task.id === taskId)?.status ?? "missing";
}

async function beginTaskOutsideDispatch(repo: { specDir: string; plan: string }): Promise<string> {
  const begin = buildToolDefinitions().find((entry) => entry.name === "begin-task");
  if (!begin) throw new Error("missing MCP tool begin-task");
  const result = await begin.handler({ planText: repo.plan, stateDir: repo.specDir, taskId: "T001" });
  const body = JSON.parse(result.content[0]?.text ?? "") as { error?: string };
  return body.error ?? "";
}

async function budgetQuestions(hive: string): Promise<string[]> {
  return askQuestions(hive, "budget_exceed");
}

async function stopQuestions(hive: string): Promise<string[]> {
  return askQuestions(hive, "circuit_breaker_stop");
}

async function askQuestions(hive: string, reasonClass: string): Promise<string[]> {
  const listed = await listAskMe({ hiveRoot: hive, state: "open", featureId: FEATURE });
  if (!listed.ok) throw new Error(`listAskMe failed: ${listed.error}`);
  return listed.items.filter((item) => item.reasonClass === reasonClass).map((item) => item.question);
}

async function expectSteerMail(hive: string, agentId: string): Promise<void> {
  const mail = await mailboxRead({ hiveRoot: hive, role: "ira", agentId, box: "inbox" });
  expect(mail.ok).toBe(true);
  if (!mail.ok) return;
  expect(mail.messages).toHaveLength(1);
  expect(mail.messages[0]?.body).toContain("change approach");
  expect(mail.messages[0]?.body).toContain("still running");
}

async function recordTokens(hive: string, inputTokens: number): Promise<void> {
  const event: SpendEventInput & { sessionId: string; taskId: string; sliceAActive: false } = {
    ts: new Date().toISOString(),
    agentId: "a1",
    featureId: FEATURE,
    engine: "host",
    model: null,
    inputTokens,
    outputTokens: 0,
    usdEstimate: null,
    source: "api",
    sessionId: "s1",
    taskId: "T001",
    sliceAActive: false,
  };
  await tokenHooksImpl.recordSpend!(event);
}

type StoredBreaker = {
  stage: string;
  haltReason: string | null;
  effectiveTier: string | null;
  constrainContextGrowth: boolean;
};

async function readBreaker(hive: string, workerKey: string): Promise<StoredBreaker | undefined> {
  const raw = JSON.parse(await readFile(join(tokenRoot(hive), "breakers.json"), "utf8")) as {
    items: Record<string, StoredBreaker>;
  };
  return raw.items[workerKey];
}

async function failoverHive(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tg-gov-failover-"));
  roots.push(root);
  await mkdir(join(root, "engines"), { recursive: true });
  await writeFile(join(root, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
  await writeFile(
    join(root, "roster.json"),
    JSON.stringify([
      {
        id: "implementer",
        name: "implementer",
        personaPath: "/repo/agents/implementer.md",
        capabilityTags: [],
        engine: "claude",
        model: "standard",
        budgetTokens: null,
        budgetUsd: null,
        workspace: "/work/implementer",
        worktreePolicy: "isolated",
        status: "idle",
        origin: "manual",
      },
    ]),
  );
  const policy: FailoverPolicy = {
    schemaVersion: 1,
    failoverEnabled: true,
    ladder: ["subscription", "byok", "local"],
    crossEngineReview: false,
    delegateToHost: null,
    hitl: ["budget_exceed", "destructive_git"],
    quotaGroups: [],
  };
  await writeFile(join(root, "engines", "policy.json"), JSON.stringify(policy));
  await writeFile(
    join(root, "engines", "health.json"),
    JSON.stringify({
      claude: healthRow("claude", "subscription", "missing"),
      custom: healthRow("custom", "byok"),
    }),
  );
  return root;
}

function healthRow(engineId: string, authMode: string, health = "ok") {
  return {
    engineId,
    authMode,
    health,
    reasonClass: null,
    binaryVersion: null,
    checkedAt: "2026-10-16T00:00:00.000Z",
  };
}

function failoverIntent(hiveRoot: string): DispatchIntent {
  return {
    featureId: "f1",
    taskId: "T018",
    agentId: "implementer",
    personaPath: "/repo/agents/implementer.md",
    workspace: "/work/implementer",
    hiveRoot,
    specDir: "/repo/specs/004-ira-token-context",
    attempt: 1,
    tier: "standard",
    freshSubagent: true,
  };
}
