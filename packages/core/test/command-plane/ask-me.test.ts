import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { HiveLedgerSchema, AskMeItemSchema } from "../../src/command-plane/schema.js";
import type { AskMeReasonClass, HiveTask } from "../../src/command-plane/types.js";
import { saveState, type ForgeState } from "../../src/forge-loop.js";
import {
  answerAskMe,
  compareAskMeOrder,
  listAskMe,
  openAskMeItem,
} from "../../src/command-plane/ask-me.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;

const WEIGHT_ORDER: AskMeReasonClass[] = [
  "budget_exceed",
  "destructive_git",
  "constitution_violation",
  "spec_scope_change",
  "untrusted_import",
  "repeated_review_failure",
  "ambiguous_requirement",
];

beforeEach(() => {
  delete process.env.SUPERSPEC_ROOT;
});

afterEach(async () => {
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempHive(): Promise<{ root: string; hive: string; specDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "cp-ask-me-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# p\n");
  const specDir = join(root, "specs", "001-demo");
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  expect(init.ok).toBe(true);
  return { root, hive: join(root, ".superspec", "hive"), specDir };
}

function ledgerTask(overrides: Partial<HiveTask> = {}): HiveTask {
  return HiveLedgerSchema.parse({
    featureId: "001-demo",
    planPath: "specs/001-demo/plan.md",
    specDir: "specs/001-demo",
    maxReviewFailures: 3,
    updatedAt: "2026-10-16T00:00:00.000Z",
    tasks: [
      {
        id: "T002",
        featureId: "001-demo",
        title: "Beta",
        implementsFr: ["FR-010"],
        dependsOn: [],
        assigneeAgentId: "agent-host",
        status: "blocked",
        kind: "code",
        complexity: "complex",
        reviewFailures: 3,
        hold: false,
        ceiling: 3,
        drift: "ok",
        capabilityTags: [],
        blockedByAskMeId: null,
        updatedAt: "2026-10-16T00:00:00.000Z",
        ...overrides,
      },
    ],
  }).tasks[0];
}

async function writeLedger(
  hive: string,
  specDir: string,
  task: HiveTask,
): Promise<void> {
  const ledger = HiveLedgerSchema.parse({
    featureId: "001-demo",
    planPath: join(specDir, "plan.md"),
    specDir,
    maxReviewFailures: 3,
    updatedAt: "2026-10-16T00:00:00.000Z",
    tasks: [{ ...task, featureId: "001-demo" }],
  });
  await writeFile(join(hive, "ledger", "001-demo.json"), `${JSON.stringify(ledger)}\n`);
}

async function readLedger(hive: string) {
  const raw = await readFile(join(hive, "ledger", "001-demo.json"), "utf8");
  return HiveLedgerSchema.parse(JSON.parse(raw));
}

async function readEvents(hive: string): Promise<Array<{ type: string; actor: { kind: string; id: string }; data: Record<string, unknown> }>> {
  const raw = await readFile(join(hive, "events", "events.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string; actor: { kind: string; id: string }; data: Record<string, unknown> });
}

async function askFiles(hive: string): Promise<string[]> {
  const names = await readdir(join(hive, "ask-me"));
  return names.filter((name) => name.endsWith(".json")).sort();
}

describe("compareAskMeOrder", () => {
  it("sorts budget_exceed before ambiguous_requirement", () => {
    const a = { reasonClass: "budget_exceed", createdAt: "2026-10-15T02:00:00.000Z" };
    const b = { reasonClass: "ambiguous_requirement", createdAt: "2026-10-15T01:00:00.000Z" };
    expect(compareAskMeOrder(a, b)).toBeLessThan(0);
  });

  it("orders every critical class by severity, then older createdAt first", () => {
    const stamped = WEIGHT_ORDER.map((reasonClass, index) => ({
      reasonClass,
      createdAt: `2026-10-15T0${index}:00:00.000Z`,
    }));
    const shuffled = [...stamped].reverse();
    shuffled.sort(compareAskMeOrder);
    expect(shuffled.map((item) => item.reasonClass)).toEqual(WEIGHT_ORDER);

    const older = { reasonClass: "destructive_git", createdAt: "2026-10-15T01:00:00.000Z" };
    const newer = { reasonClass: "destructive_git", createdAt: "2026-10-15T03:00:00.000Z" };
    expect(compareAskMeOrder(older, newer)).toBeLessThan(0);
    expect(compareAskMeOrder(older, { ...older })).toBe(0);
  });
});

describe("openAskMeItem", () => {
  it("creates one wx file and returns the same id for an open duplicate", async () => {
    const { hive } = await tempHive();
    const first = await openAskMeItem({
      hiveRoot: hive,
      featureId: "001-demo",
      taskId: "T002",
      agentId: "agent-host",
      reasonClass: "budget_exceed",
      question: "Budget would be exceeded",
      now: "2026-10-15T02:00:00.000Z",
    });
    const second = await openAskMeItem({
      hiveRoot: hive,
      featureId: "001-demo",
      taskId: "T002",
      agentId: null,
      reasonClass: "budget_exceed",
      question: "A different wording of the same exceed",
      now: "2026-10-15T03:00:00.000Z",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.item.id).toBe(first.item.id);
    expect(second.item.question).toBe("Budget would be exceeded");
    expect(first.item).toMatchObject({
      state: "open",
      answer: null,
      action: null,
      resolvedAt: null,
      reasonClass: "budget_exceed",
    });
    expect(AskMeItemSchema.parse(first.item).id).toMatch(/^ask_/);

    const files = await askFiles(hive);
    expect(files).toEqual([`${first.item.id}.json`]);
    const info = await stat(join(hive, "ask-me", files[0]));
    expect(info.mode & 0o777).toBe(0o600);

    const opened = (await readEvents(hive)).filter((event) => event.type === "ask_me.opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      actor: { kind: "ira", id: "ira" },
      data: { askMeId: first.item.id, reasonClass: "budget_exceed", taskId: "T002" },
    });
  });

  it("does not dedupe a different reason class, task, or a resolved item", async () => {
    const { hive } = await tempHive();
    const base = {
      hiveRoot: hive,
      featureId: "001-demo" as const,
      taskId: "T002",
      agentId: null,
      question: "Needs a decision",
      now: "2026-10-15T02:00:00.000Z",
    };
    const budget = await openAskMeItem({ ...base, reasonClass: "budget_exceed" });
    const destructive = await openAskMeItem({ ...base, reasonClass: "destructive_git", taskId: "T002" });
    const otherTask = await openAskMeItem({ ...base, reasonClass: "budget_exceed", taskId: "T003" });
    expect(budget.ok && destructive.ok && otherTask.ok).toBe(true);
    if (!budget.ok || !destructive.ok || !otherTask.ok) return;

    const answered = await answerAskMe({
      hiveRoot: hive,
      id: budget.item.id,
      text: "Raise the ceiling",
      action: "acknowledge",
      now: "2026-10-15T04:00:00.000Z",
    });
    expect(answered.ok).toBe(true);
    const reopened = await openAskMeItem({ ...base, reasonClass: "budget_exceed", question: "Exceeded again" });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.created).toBe(true);
    expect(reopened.item.id).not.toBe(budget.item.id);
    expect(await askFiles(hive)).toHaveLength(4);
  });

  it("rejects an empty question and a missing hive", async () => {
    const { hive } = await tempHive();
    const empty = await openAskMeItem({
      hiveRoot: hive,
      featureId: "001-demo",
      taskId: "T002",
      agentId: null,
      reasonClass: "ambiguous_requirement",
      question: "   ",
    });
    expect(empty).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(await askFiles(hive)).toEqual([]);

    const missing = await openAskMeItem({
      hiveRoot: join(hive, "nope"),
      featureId: null,
      taskId: null,
      agentId: null,
      reasonClass: "budget_exceed",
      question: "Where is the hive?",
    });
    expect(missing).toMatchObject({ ok: false, error: "HIVE_NOT_INITIALIZED" });
  });

  it("links the ledger task when the item is opened for that task", async () => {
    const { hive, specDir } = await tempHive();
    await writeLedger(hive, specDir, ledgerTask());
    const opened = await openAskMeItem({
      hiveRoot: hive,
      featureId: "001-demo",
      taskId: "T002",
      agentId: "agent-host",
      reasonClass: "repeated_review_failure",
      question: "Review failed at the ceiling",
      now: "2026-10-16T01:00:00.000Z",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const ledger = await readLedger(hive);
    expect(ledger.tasks[0]).toMatchObject({
      status: "blocked",
      reviewFailures: 3,
      blockedByAskMeId: opened.item.id,
    });
  });
});

describe("listAskMe", () => {
  it("sorts by critical weight then age and reports ageSeconds", async () => {
    const { hive } = await tempHive();
    const openAt = async (taskId: string, reasonClass: AskMeReasonClass, now: string) => {
      const result = await openAskMeItem({
        hiveRoot: hive,
        featureId: "001-demo",
        taskId,
        agentId: null,
        reasonClass,
        question: `${reasonClass} ${taskId}`,
        now,
      });
      expect(result.ok).toBe(true);
    };
    await openAt("T001", "ambiguous_requirement", "2026-10-15T01:00:00.000Z");
    await openAt("T002", "budget_exceed", "2026-10-15T02:00:00.000Z");
    await openAt("T003", "budget_exceed", "2026-10-15T00:00:00.000Z");
    await openAskMeItem({
      hiveRoot: hive,
      featureId: "002-other",
      taskId: "T009",
      agentId: null,
      reasonClass: "destructive_git",
      question: "Other feature",
      now: "2026-10-15T00:30:00.000Z",
    });

    const listed = await listAskMe({
      hiveRoot: hive,
      featureId: "001-demo",
      state: "open",
      now: "2026-10-15T02:02:00.000Z",
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.items.map((item) => [item.reasonClass, item.taskId, item.ageSeconds])).toEqual([
      ["budget_exceed", "T003", 7320],
      ["budget_exceed", "T002", 120],
      ["ambiguous_requirement", "T001", 3720],
    ]);
  });
});

describe("answerAskMe", () => {
  it("retry sets forge pending without incrementing reviewFailures and hive todo", async () => {
    const { hive, specDir } = await tempHive();
    await writeLedger(hive, specDir, ledgerTask());
    const forge: ForgeState = { tasks: { T002: { status: "blocked", reviewFailures: 3 } } };
    await saveState(specDir, forge);

    const opened = await openAskMeItem({
      hiveRoot: hive,
      featureId: "001-demo",
      taskId: "T002",
      agentId: "agent-host",
      reasonClass: "repeated_review_failure",
      question: "Review failed at the ceiling",
      now: "2026-10-16T01:00:00.000Z",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const answered = await answerAskMe({
      hiveRoot: hive,
      id: opened.item.id,
      text: "Retry once at the same ceiling",
      action: "retry",
      now: "2026-10-16T02:00:00.000Z",
    });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.item).toMatchObject({
      state: "resolved",
      action: "retry",
      answer: "Retry once at the same ceiling",
      resolvedAt: "2026-10-16T02:00:00.000Z",
    });
    expect(answered.task).toEqual({ id: "T002", status: "todo", reviewFailures: 3 });

    const ledger = await readLedger(hive);
    expect(ledger.tasks[0]).toMatchObject({
      status: "todo",
      reviewFailures: 3,
      blockedByAskMeId: null,
    });
    const saved = JSON.parse(await readFile(join(specDir, ".superspec", "state.json"), "utf8")) as ForgeState;
    expect(saved.tasks.T002).toEqual({ status: "pending", reviewFailures: 3 });

    const resolved = (await readEvents(hive)).filter((event) => event.type === "ask_me.resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      actor: { kind: "operator", id: "operator" },
      data: { askMeId: opened.item.id, action: "retry" },
    });

    const again = await answerAskMe({
      hiveRoot: hive,
      id: opened.item.id,
      text: "Again",
      action: "retry",
    });
    expect(again).toMatchObject({ ok: false, error: "ASK_ME_ALREADY_RESOLVED" });
    const still = JSON.parse(await readFile(join(specDir, ".superspec", "state.json"), "utf8")) as ForgeState;
    expect(still.tasks.T002.reviewFailures).toBe(3);
  });

  it("keep_blocked leaves the task and forge row blocked", async () => {
    const { hive, specDir } = await tempHive();
    await writeLedger(hive, specDir, ledgerTask());
    await saveState(specDir, { tasks: { T002: { status: "blocked", reviewFailures: 3 } } });
    const opened = await openAskMeItem({
      hiveRoot: hive,
      featureId: "001-demo",
      taskId: "T002",
      agentId: null,
      reasonClass: "budget_exceed",
      question: "Stop before dispatch",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const forgeBefore = await readFile(join(specDir, ".superspec", "state.json"), "utf8");

    const answered = await answerAskMe({
      hiveRoot: hive,
      id: opened.item.id,
      text: "Leave it blocked",
      action: "keep_blocked",
      now: "2026-10-16T03:00:00.000Z",
    });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.task).toEqual({ id: "T002", status: "blocked", reviewFailures: 3 });
    expect((await readLedger(hive)).tasks[0].status).toBe("blocked");
    expect(await readFile(join(specDir, ".superspec", "state.json"), "utf8")).toBe(forgeBefore);
  });

  it("acknowledge resolves an item with no task and does not write forge state", async () => {
    const { hive, specDir } = await tempHive();
    const opened = await openAskMeItem({
      hiveRoot: hive,
      featureId: null,
      taskId: null,
      agentId: null,
      reasonClass: "ambiguous_requirement",
      question: "Which mode should overnight use?",
      now: "2026-10-16T01:00:00.000Z",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const answered = await answerAskMe({
      hiveRoot: hive,
      id: opened.item.id,
      text: "Stay supervised",
      action: "acknowledge",
      now: "2026-10-16T01:05:00.000Z",
    });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.task).toBeNull();
    expect(answered.item.state).toBe("resolved");
    await expect(readFile(join(specDir, ".superspec", "state.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    const listed = await listAskMe({ hiveRoot: hive, state: "resolved" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.items.map((item) => item.id)).toEqual([opened.item.id]);
    const openOnly = await listAskMe({ hiveRoot: hive, state: "open" });
    expect(openOnly.ok).toBe(true);
    if (!openOnly.ok) return;
    expect(openOnly.items).toEqual([]);
  });

  it("retry clears this item's link without rewriting forge when the task is already todo", async () => {
    const { hive, specDir } = await tempHive();
    await writeLedger(hive, specDir, ledgerTask({ status: "todo", reviewFailures: 1, blockedByAskMeId: null }));
    await saveState(specDir, { tasks: { T002: { status: "pending", reviewFailures: 1 } } });
    const opened = await openAskMeItem({
      hiveRoot: hive,
      featureId: "001-demo",
      taskId: "T002",
      agentId: null,
      reasonClass: "spec_scope_change",
      question: "Change an acceptance criterion?",
      now: "2026-10-16T06:00:00.000Z",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect((await readLedger(hive)).tasks[0].blockedByAskMeId).toBe(opened.item.id);
    const forgeBefore = await readFile(join(specDir, ".superspec", "state.json"), "utf8");

    const answered = await answerAskMe({
      hiveRoot: hive,
      id: opened.item.id,
      text: "Proceed",
      action: "retry",
      now: "2026-10-16T06:05:00.000Z",
    });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.task).toEqual({ id: "T002", status: "todo", reviewFailures: 1 });
    expect((await readLedger(hive)).tasks[0]).toMatchObject({
      status: "todo",
      reviewFailures: 1,
      blockedByAskMeId: null,
    });
    expect(await readFile(join(specDir, ".superspec", "state.json"), "utf8")).toBe(forgeBefore);
  });

  it("rejects an empty answer and a missing id", async () => {
    const { hive } = await tempHive();
    const opened = await openAskMeItem({
      hiveRoot: hive,
      featureId: "001-demo",
      taskId: "T002",
      agentId: null,
      reasonClass: "spec_scope_change",
      question: "Add a task?",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const empty = await answerAskMe({ hiveRoot: hive, id: opened.item.id, text: "  ", action: "acknowledge" });
    expect(empty).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    const raw = JSON.parse(await readFile(join(hive, "ask-me", `${opened.item.id}.json`), "utf8")) as { state: string };
    expect(raw.state).toBe("open");
    const missing = await answerAskMe({
      hiveRoot: hive,
      id: "ask_00000000-0000-4000-8000-000000000000",
      text: "no",
      action: "acknowledge",
    });
    expect(missing).toMatchObject({ ok: false, error: "ASK_ME_NOT_FOUND" });
  });

  it("does not unblock a task aborted or blocked by a different item", async () => {
    const { hive, specDir } = await tempHive();
    await writeLedger(
      hive,
      specDir,
      ledgerTask({ abortReason: "operator stop", blockedByAskMeId: null }),
    );
    await saveState(specDir, { tasks: { T002: { status: "blocked", reviewFailures: 3 } } });
    const opened = await openAskMeItem({
      hiveRoot: hive,
      featureId: "001-demo",
      taskId: "T002",
      agentId: null,
      reasonClass: "constitution_violation",
      question: "Constitution breach",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const answered = await answerAskMe({
      hiveRoot: hive,
      id: opened.item.id,
      text: "Noted",
      action: "retry",
      now: "2026-10-16T04:00:00.000Z",
    });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.task).toMatchObject({ id: "T002", status: "blocked", reviewFailures: 3 });
    const saved = JSON.parse(await readFile(join(specDir, ".superspec", "state.json"), "utf8")) as ForgeState;
    expect(saved.tasks.T002.status).toBe("blocked");
  });

  it("does not unblock a task blocked by a different Ask-Me item", async () => {
    const { hive, specDir } = await tempHive();
    await writeLedger(hive, specDir, ledgerTask());
    await saveState(specDir, { tasks: { T002: { status: "blocked", reviewFailures: 3 } } });
    const opened = await openAskMeItem({
      hiveRoot: hive,
      featureId: "001-demo",
      taskId: "T002",
      agentId: null,
      reasonClass: "untrusted_import",
      question: "Import this skill?",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await writeLedger(
      hive,
      specDir,
      ledgerTask({ blockedByAskMeId: "ask_11111111-1111-4111-8111-111111111111" }),
    );

    const answered = await answerAskMe({
      hiveRoot: hive,
      id: opened.item.id,
      text: "Not this item",
      action: "retry",
      now: "2026-10-16T05:00:00.000Z",
    });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.task).toEqual({ id: "T002", status: "blocked", reviewFailures: 3 });
    expect((await readLedger(hive)).tasks[0].blockedByAskMeId).toBe(
      "ask_11111111-1111-4111-8111-111111111111",
    );
    const saved = JSON.parse(await readFile(join(specDir, ".superspec", "state.json"), "utf8")) as ForgeState;
    expect(saved.tasks.T002).toEqual({ status: "blocked", reviewFailures: 3 });
  });
});
