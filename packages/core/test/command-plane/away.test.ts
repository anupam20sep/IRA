import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { answerAskMe, openAskMeItem } from "../../src/command-plane/ask-me.js";
import {
  awaySet,
  awayTick,
  awayTickOrder,
  writeAwayHeartbeat,
} from "../../src/command-plane/away.js";
import { hiveCiSet } from "../../src/command-plane/blackboard.js";
import { briefSubmit } from "../../src/command-plane/brief.js";
import * as dispatchMod from "../../src/command-plane/dispatch.js";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { loadState } from "../../src/forge-loop.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;
const FEATURE = "001-demo";

const PLAN = [
  "### Task T001: Alpha",
  "**Implements:** FR-007",
  "**Depends on:** none",
  "**Kind:** code",
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
  vi.restoreAllMocks();
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(
    roots.splice(0).map(async (dir) => {
      await awaySet({ hiveRoot: join(dir, ".superspec", "hive"), awayMode: false }).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("awayTickOrder", () => {
  it("writes heartbeat before gates and dispatch-task", () => {
    expect(awayTickOrder()).toEqual(["heartbeat", "gates", "dispatch-task"]);
  });
});

describe("writeAwayHeartbeat", () => {
  it("fsyncs { pid, at } with mode 0600", async () => {
    const hive = await mkdtemp(join(tmpdir(), "cp-away-beat-"));
    roots.push(hive);
    const probe = await import("node:fs/promises").then((fs) => fs.open(join(hive, ".probe"), "w"));
    const sync = vi.spyOn(Object.getPrototypeOf(probe), "sync");
    await probe.close();

    const wrote = await writeAwayHeartbeat({ hiveRoot: hive, pid: 4242, at: "2026-10-16T12:00:00.000Z" });
    expect(wrote).toEqual({ ok: true });
    expect(sync).toHaveBeenCalled();
    const path = join(hive, "away.heartbeat");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      pid: 4242,
      at: "2026-10-16T12:00:00.000Z",
    });
  });

  it("returns heartbeat_failed when the hive path cannot be written", async () => {
    const root = await mkdtemp(join(tmpdir(), "cp-away-beat-fail-"));
    roots.push(root);
    const file = join(root, "not-a-directory");
    await writeFile(file, "x");
    await expect(writeAwayHeartbeat({ hiveRoot: file })).resolves.toEqual({
      ok: false,
      reason: "heartbeat_failed",
    });
  });
});

describe("awayTick", () => {
  it("does not argv begin-task; the module calls dispatch-task", async () => {
    const source = await readFile(fileURLToPath(new URL("../../src/command-plane/away.ts", import.meta.url)), "utf8");
    expect(source.includes("begin-task")).toBe(false);
    expect(source.includes("child_process")).toBe(false);
    expect(source.includes("markInProgress")).toBe(false);
    expect(source.includes("dispatchTask")).toBe(true);
  });

  it("skips dispatch when the heartbeat cannot be written", async () => {
    const root = await mkdtemp(join(tmpdir(), "cp-away-skip-beat-"));
    roots.push(root);
    const file = join(root, "not-a-directory");
    await writeFile(file, "x");
    const spy = vi.spyOn(dispatchMod, "dispatchTask");
    const result = await awayTick({ hiveRoot: file, cwd: root });
    expect(result).toEqual({
      ok: true,
      ticks: [{ featureId: null, dispatched: false, reason: "heartbeat_failed", intent: null }],
    });
    expect(spy).not.toHaveBeenCalled();
    expect(beginTaskArgv()).toEqual([]);
  });

  it("dispatches only in autonomous mode and only through dispatch-task", async () => {
    const repo = await readyRepo();
    await hiveCiSet({ hiveRoot: repo.hive, featureId: FEATURE, state: "green", source: "test" });
    const original = dispatchMod.dispatchTask;
    const spy = vi.spyOn(dispatchMod, "dispatchTask").mockImplementation(async (input) => {
      const beat = JSON.parse(await readFile(join(repo.hive, "away.heartbeat"), "utf8")) as { pid: number; at: string };
      expect(beat.pid).toBe(process.pid);
      expect(beat.at).toEqual(expect.any(String));
      return original(input);
    });

    await writeSettings(repo.hive, { awayMode: true, autonomy: "supervised" });
    const supervised = await awayTick({ hiveRoot: repo.hive, cwd: repo.root });
    expect(supervised.ticks).toEqual([
      expect.objectContaining({ featureId: FEATURE, dispatched: false, reason: "autonomy_supervised", intent: null }),
    ]);
    expect(spy).not.toHaveBeenCalled();

    await writeSettings(repo.hive, { autonomy: "observe" });
    const observe = await awayTick({ hiveRoot: repo.hive, cwd: repo.root });
    expect(observe.ticks[0]).toMatchObject({ dispatched: false, reason: "autonomy_observe" });

    await writeSettings(repo.hive, { autonomy: "autonomous" });
    const dispatched = await awayTick({ hiveRoot: repo.hive, cwd: repo.root });
    expect(dispatched.ticks[0]).toMatchObject({
      featureId: FEATURE,
      dispatched: true,
      reason: null,
    });
    expect(dispatched.ticks[0]?.intent).toMatchObject({
      featureId: FEATURE,
      taskId: "T001",
      freshSubagent: true,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      featureId: FEATURE,
      taskId: "T001",
      cwd: repo.root,
      internal: true,
      freshSubagent: true,
    });
    expect(beginTaskArgv()).toEqual([]);
    expect(child.spawn).not.toHaveBeenCalled();
    expect(child.execFile).not.toHaveBeenCalled();
    expect(child.exec).not.toHaveBeenCalled();
    expect(child.fork).not.toHaveBeenCalled();
    expect((await loadState(repo.specDir))?.tasks.T001?.status).toBe("in_progress");
    const queued = JSON.parse(await readFile(join(repo.hive, "dispatch-queue", FEATURE, "T001.json"), "utf8"));
    expect(queued).toMatchObject({ taskId: "T001", freshSubagent: true });
    const events = await readEvents(repo.hive);
    expect(events.some((event) => event.type === "task.dispatched" && event.data.internal === true)).toBe(true);
    expect(events.some((event) => event.type === "away.tick" && event.data.dispatched === true)).toBe(true);
  });

  it("blocks on ci_absent unless allowAbsentCi is exactly true, and red is always ci_not_green", async () => {
    const absent = await readyRepo();
    await writeSettings(absent.hive, { awayMode: true, autonomy: "autonomous" });
    const missing = await awayTick({ hiveRoot: absent.hive, cwd: absent.root });
    expect(missing.ticks[0]).toMatchObject({ dispatched: false, reason: "ci_absent" });
    expect(await dispatchQueueExists(absent.hive)).toBe(false);

    await hiveCiSet({ hiveRoot: absent.hive, featureId: FEATURE, state: "absent", source: "test" });
    const explicitAbsent = await awayTick({ hiveRoot: absent.hive, cwd: absent.root });
    expect(explicitAbsent.ticks[0]).toMatchObject({ dispatched: false, reason: "ci_absent" });

    await writeSettings(absent.hive, { allowAbsentCi: true });
    const allowed = await awayTick({ hiveRoot: absent.hive, cwd: absent.root });
    expect(allowed.ticks[0]).toMatchObject({ dispatched: true, reason: null });

    const red = await readyRepo();
    await writeSettings(red.hive, { awayMode: true, autonomy: "autonomous", allowAbsentCi: true });
    await hiveCiSet({ hiveRoot: red.hive, featureId: FEATURE, state: "red", source: "test" });
    const spy = vi.spyOn(dispatchMod, "dispatchTask");
    const blocked = await awayTick({ hiveRoot: red.hive, cwd: red.root });
    expect(blocked.ticks[0]).toMatchObject({ dispatched: false, reason: "ci_not_green" });
    expect(spy).not.toHaveBeenCalled();
    expect((await loadState(red.specDir))?.tasks.T001?.status).not.toBe("in_progress");
    const events = await readEvents(red.hive);
    expect(events.some((event) => event.type === "away.tick" && event.data.reason === "ci_not_green")).toBe(true);
    expect((await stat(join(red.hive, "away.heartbeat"))).isFile()).toBe(true);
  });

  it("blocks while a critical Ask-Me item is open, including an item with no feature", async () => {
    const repo = await readyRepo();
    await arm(repo, { allowAbsentCi: false });
    const opened = await openAskMeItem({
      hiveRoot: repo.hive,
      featureId: FEATURE,
      taskId: "T001",
      agentId: null,
      reasonClass: "budget_exceed",
      question: "Budget would be exceeded",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const blocked = await awayTick({ hiveRoot: repo.hive, cwd: repo.root });
    expect(blocked.ticks[0]).toMatchObject({ dispatched: false, reason: "ask_me_open" });
    expect(await dispatchQueueExists(repo.hive)).toBe(false);

    const answered = await answerAskMe({
      hiveRoot: repo.hive,
      id: opened.item.id,
      text: "Proceed",
      action: "acknowledge",
    });
    expect(answered.ok).toBe(true);
    const resumed = await awayTick({ hiveRoot: repo.hive, cwd: repo.root });
    expect(resumed.ticks[0]).toMatchObject({ dispatched: true, reason: null });

    const global = await readyRepo();
    await arm(global, { allowAbsentCi: false });
    const everywhere = await openAskMeItem({
      hiveRoot: global.hive,
      featureId: null,
      taskId: null,
      agentId: null,
      reasonClass: "ambiguous_requirement",
      question: "Which outcome is in scope?",
    });
    expect(everywhere.ok).toBe(true);
    const held = await awayTick({ hiveRoot: global.hive, cwd: global.root });
    expect(held.ticks[0]).toMatchObject({ dispatched: false, reason: "ask_me_open" });
    expect((await loadState(global.specDir))?.tasks.T001?.status).not.toBe("in_progress");
  });

  it("records away_off, dispatch_held, and hive_corrupt without deleting a dead away.pid", async () => {
    const off = await readyRepo();
    await arm(off, { allowAbsentCi: true });
    await writeSettings(off.hive, { awayMode: false });
    const awayOff = await awayTick({ hiveRoot: off.hive, cwd: off.root });
    expect(awayOff.ticks[0]).toMatchObject({ dispatched: false, reason: "away_off" });

    const held = await readyRepo();
    await arm(held, { allowAbsentCi: true });
    await patchTask(held.hive, "T001", { hold: true });
    const heldTick = await awayTick({ hiveRoot: held.hive, cwd: held.root });
    expect(heldTick.ticks[0]).toMatchObject({ dispatched: false, reason: "dispatch_held" });
    expect(await dispatchQueueExists(held.hive)).toBe(false);

    const stale = await readyRepo();
    await arm(stale, { allowAbsentCi: true });
    await writeFile(join(stale.hive, "away.pid"), "4000000000\n", { mode: 0o600 });
    const spy = vi.spyOn(dispatchMod, "dispatchTask");
    const corrupt = await awayTick({ hiveRoot: stale.hive, cwd: stale.root });
    expect(corrupt.ticks[0]).toMatchObject({ dispatched: false, reason: "hive_corrupt" });
    expect(spy).not.toHaveBeenCalled();
    expect((await readFile(join(stale.hive, "away.pid"), "utf8")).trim()).toBe("4000000000");
  });
});

describe("awaySet", () => {
  it("polls every 60s, writes away.pid, and auto-dispatches only when autonomous", async () => {
    const repo = await readyRepo();
    await hiveCiSet({ hiveRoot: repo.hive, featureId: FEATURE, state: "green", source: "test" });
    const scheduled: Array<{ fn: () => Promise<void>; ms: number }> = [];
    vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => Promise<void>, ms?: number) => {
      scheduled.push({ fn, ms: ms ?? 0 });
      return 0 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);

    const started = await awaySet({ hiveRoot: repo.hive, cwd: repo.root, awayMode: true });
    expect(started).toMatchObject({
      ok: true,
      poller: { running: true, pid: process.pid },
      settings: { awayMode: true, pollIntervalMs: 60_000, autonomy: "supervised" },
    });
    expect(scheduled).toEqual([expect.objectContaining({ ms: 60_000 })]);
    expect((await stat(join(repo.hive, "away.pid"))).mode & 0o777).toBe(0o600);
    expect((await readFile(join(repo.hive, "away.pid"), "utf8")).trim()).toBe(String(process.pid));
    expect(await dispatchQueueExists(repo.hive)).toBe(false);

    const again = await awaySet({ hiveRoot: repo.hive, cwd: repo.root, awayMode: true });
    expect(again).toMatchObject({ ok: false, error: "AWAY_ALREADY_RUNNING" });

    await scheduled[0]?.fn();
    expect(await dispatchQueueExists(repo.hive)).toBe(false);
    expect((await readEvents(repo.hive)).some((event) => event.type === "away.tick" && event.data.reason === "autonomy_supervised")).toBe(true);

    await writeSettings(repo.hive, { autonomy: "autonomous" });
    await scheduled[0]?.fn();
    expect(await dispatchQueueExists(repo.hive)).toBe(true);
    expect(beginTaskArgv()).toEqual([]);
    expect(child.spawn).not.toHaveBeenCalled();

    const events = await readEvents(repo.hive);
    expect(events.some((event) => event.type === "away.changed" && event.data.awayMode === true)).toBe(true);

    const stopped = await awaySet({ hiveRoot: repo.hive, cwd: repo.root, awayMode: false });
    expect(stopped).toMatchObject({ ok: true, poller: { running: false, pid: null }, settings: { awayMode: false } });
    await expect(access(join(repo.hive, "away.pid"))).rejects.toThrow();
  });

  it("rejects a poll interval under 10s and persists allowAbsentCi", async () => {
    const repo = await readyRepo();
    const spy = vi.spyOn(globalThis, "setInterval");
    const rejected = await awaySet({ hiveRoot: repo.hive, cwd: repo.root, awayMode: true, pollIntervalMs: 9999 });
    expect(rejected).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(spy).not.toHaveBeenCalled();

    const saved = await awaySet({
      hiveRoot: repo.hive,
      cwd: repo.root,
      awayMode: false,
      allowAbsentCi: true,
      pollIntervalMs: 15_000,
    });
    expect(saved).toMatchObject({
      ok: true,
      poller: { running: false, pid: null },
      settings: { allowAbsentCi: true, pollIntervalMs: 15_000, awayMode: false },
    });
    const raw = JSON.parse(await readFile(join(repo.hive, "settings.json"), "utf8")) as { allowAbsentCi: boolean };
    expect(raw.allowAbsentCi).toBe(true);
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
  const root = await mkdtemp(join(tmpdir(), "cp-away-"));
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
    outcome: "Continue eligible forge work",
    deliverable: `specs/${FEATURE}`,
  });
  expect(submitted.ok).toBe(true);
  return { root, hive: join(root, ".superspec", "hive"), specDir };
}

async function arm(
  repo: { hive: string },
  patch: { allowAbsentCi: boolean },
): Promise<void> {
  await writeSettings(repo.hive, { awayMode: true, autonomy: "autonomous", ...patch });
  await hiveCiSet({ hiveRoot: repo.hive, featureId: FEATURE, state: "green", source: "test" });
}

async function writeSettings(hive: string, patch: Record<string, unknown>): Promise<void> {
  const path = join(hive, "settings.json");
  const settings = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  Object.assign(settings, patch, { updatedAt: new Date().toISOString() });
  await writeFile(path, JSON.stringify(settings));
}

async function patchTask(hive: string, taskId: string, patch: Record<string, unknown>): Promise<void> {
  const path = join(hive, "ledger", `${FEATURE}.json`);
  const ledger = JSON.parse(await readFile(path, "utf8")) as { tasks: Array<Record<string, unknown>> };
  const task = ledger.tasks.find((row) => row.id === taskId);
  if (!task) throw new Error(`missing ${taskId}`);
  Object.assign(task, patch);
  await writeFile(path, JSON.stringify(ledger));
}

async function readEvents(hive: string): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
  const raw = await readFile(join(hive, "events", "events.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
}

async function dispatchQueueExists(hive: string): Promise<boolean> {
  try {
    await access(join(hive, "dispatch-queue", FEATURE, "T001.json"));
    return true;
  } catch {
    return false;
  }
}
