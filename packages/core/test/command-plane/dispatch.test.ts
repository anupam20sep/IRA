import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAskMeItem, listAskMe } from "../../src/command-plane/ask-me.js";
import { hiveCiSet } from "../../src/command-plane/blackboard.js";
import {
  dispatchRefusalForHold,
  dispatchTask,
  queueHostDispatchIntent,
  rejectUnfreshSubagent,
  sliceABeforeDispatch,
} from "../../src/command-plane/dispatch.js";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { briefSubmit } from "../../src/command-plane/brief.js";
import { registerCommandPlaneHooks } from "../../src/command-plane/hooks.js";
import type { DispatchIntent } from "../../src/command-plane/hooks.js";
import { HiveLedgerSchema } from "../../src/command-plane/schema.js";
import { loadState, saveState } from "../../src/forge-loop.js";

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
  "**Implements:** FR-020",
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

const HOST_ARGV0 = new Set(["claude", "codex", "cursor-agent", "agent"]);

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
  registerCommandPlaneHooks({ token: {}, engine: {}, learning: {}, hire: {} });
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("dispatchRefusalForHold", () => {
  it("returns DISPATCH_HELD when hold true", () => {
    expect(dispatchRefusalForHold({ hold: true })).toEqual({ ok: false, code: "DISPATCH_HELD" });
  });

  it("does not refuse when hold is false", () => {
    expect(dispatchRefusalForHold({ hold: false })).toBeNull();
  });
});

describe("rejectUnfreshSubagent", () => {
  it("rejects a false freshSubagent before any spawn", () => {
    expect(rejectUnfreshSubagent(false)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(rejectUnfreshSubagent(true)).toBeNull();
    expect(child.spawn).not.toHaveBeenCalled();
  });
});

describe("sliceABeforeDispatch", () => {
  it("allows host engines and denies byok or local supervisor rungs", () => {
    for (const engine of [null, "claude", "codex", "cursor-agent", "cursor"]) {
      expect(sliceABeforeDispatch(engine)).toEqual({ allow: true });
    }
    for (const engine of ["byok", "local", "opencode", "crush", "aider", "custom"]) {
      expect(sliceABeforeDispatch(engine)).toEqual({ allow: false, reason: "SLICE_A_ONLY" });
    }
  });
});

describe("queueHostDispatchIntent", () => {
  it("persists the intent at dispatch-queue/<featureId>/<taskId>.json mode 0600", async () => {
    const repo = await readyRepo();
    const intent = sampleIntent(repo.hive, repo.specDir);
    const path = await queueHostDispatchIntent({ hiveRoot: repo.hive, intent });
    expect(path).toBe(join(repo.hive, "dispatch-queue", FEATURE, "T001.json"));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      featureId: FEATURE,
      taskId: "T001",
      freshSubagent: true,
    });
  });
});

describe("dispatchTask", () => {
  it("returns HIVE_NOT_READY and does not begin-task when the hive is absent", async () => {
    const root = await bareRepo();
    const result = await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: root });
    expect(result).toMatchObject({ ok: false, code: "HIVE_NOT_READY", began: false });
    await expect(access(join(root, "specs", FEATURE, ".superspec", "state.json"))).rejects.toThrow();
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it("returns HIVE_NOT_READY when schema, gitignore, ledger, or away pid is unhealthy", async () => {
    const schema = await readyRepo();
    await writeFile(
      join(schema.hive, "hive.json"),
      JSON.stringify({ schemaVersion: 2 }),
    );
    expect(await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: schema.root })).toMatchObject({
      ok: false,
      code: "HIVE_NOT_READY",
      began: false,
    });

    const ignored = await readyRepo();
    const gitignore = join(ignored.root, ".gitignore");
    const text = await readFile(gitignore, "utf8");
    await writeFile(gitignore, text.replace(".superspec/hive/\n", ""));
    expect(await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: ignored.root })).toMatchObject({
      code: "HIVE_NOT_READY",
    });

    const corrupt = await readyRepo();
    await writeFile(join(corrupt.hive, "ledger", `${FEATURE}.json`), "{");
    expect(await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: corrupt.root })).toMatchObject({
      code: "HIVE_NOT_READY",
    });

    const stale = await readyRepo();
    await writeFile(join(stale.hive, "away.pid"), "2147483646\n");
    expect(await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: stale.root })).toMatchObject({
      code: "HIVE_NOT_READY",
      began: false,
    });
    expect(await readFile(join(stale.hive, "away.pid"), "utf8")).toBe("2147483646\n");

    const away = await readyRepo();
    const settings = JSON.parse(await readFile(join(away.hive, "settings.json"), "utf8")) as {
      awayMode: boolean;
    };
    settings.awayMode = true;
    await writeFile(join(away.hive, "settings.json"), JSON.stringify(settings));
    expect(await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: away.root })).toMatchObject({
      code: "HIVE_NOT_READY",
    });
  });

  it("refuses a false freshSubagent with INVALID_INPUT and starts nothing", async () => {
    const repo = await readyRepo();
    const result = await dispatchTask({
      featureId: FEATURE,
      taskId: "T001",
      cwd: repo.root,
      freshSubagent: false,
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT", began: false });
    await expect(access(join(repo.hive, "dispatch-queue", FEATURE, "T001.json"))).rejects.toThrow();
    expect(await loadState(repo.specDir)).toBeNull();
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it("returns DISPATCH_HELD and does not begin-task", async () => {
    const repo = await readyRepo();
    await patchTask(repo.hive, "T001", { hold: true });
    const result = await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: repo.root });
    expect(result).toMatchObject({ ok: false, code: "DISPATCH_HELD", began: false });
    expect((await readLedger(repo.hive)).tasks.find((task) => task.id === "T001")?.status).toBe("todo");
    expect(await loadState(repo.specDir)).toBeNull();
  });

  it("refuses a task that is not DAG-ready", async () => {
    const repo = await readyRepo();
    const result = await dispatchTask({ featureId: FEATURE, taskId: "T002", cwd: repo.root });
    expect(result).toMatchObject({ ok: false, code: "NOT_DAG_READY", began: false });
    expect(await loadState(repo.specDir)).toBeNull();
  });

  it("refuses while an Ask-Me item is open for the feature", async () => {
    const repo = await readyRepo();
    const opened = await openAskMeItem({
      hiveRoot: repo.hive,
      featureId: FEATURE,
      taskId: "T001",
      agentId: "agent-host",
      reasonClass: "ambiguous_requirement",
      question: "Which boundary?",
    });
    expect(opened.ok).toBe(true);
    const result = await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: repo.root });
    expect(result).toMatchObject({ ok: false, code: "ASK_ME_OPEN", began: false });
    expect(await loadState(repo.specDir)).toBeNull();
  });

  it("applies the CI gate before hooks", async () => {
    const absent = await staffedRepo();
    expect(await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: absent.root })).toMatchObject({
      ok: false,
      code: "ci_absent",
      began: false,
    });

    const allowed = await staffedRepo();
    await setAllowAbsentCi(allowed.hive, true);
    expect(await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: allowed.root })).toMatchObject({
      ok: true,
      began: true,
    });

    const red = await readyRepo();
    await hiveCiSet({ hiveRoot: red.hive, featureId: FEATURE, state: "red", source: "test" });
    await setAllowAbsentCi(red.hive, true);
    expect(await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: red.root })).toMatchObject({
      ok: false,
      code: "ci_not_green",
      began: false,
    });
    expect(child.spawn).not.toHaveBeenCalled();
  });

  it("refuses a code task with an empty implementsFr", async () => {
    const repo = await readyRepo();
    const result = await dispatchTask({ featureId: FEATURE, taskId: "T003", cwd: repo.root });
    expect(result).toMatchObject({ ok: false, code: "TRACEABILITY_GAP", began: false });
    expect(await loadState(repo.specDir)).toBeNull();
  });

  it("dispatches a non-code task that has no FR tags", async () => {
    const repo = await readyRepo();
    const result = await dispatchTask({ featureId: FEATURE, taskId: "T004", cwd: repo.root, internal: true });
    expect(result).toMatchObject({
      ok: true,
      accepted: null,
      began: true,
      hiveStatus: "doing",
      intent: { taskId: "T004", freshSubagent: true },
    });
  });

  it.each([null, "claude", "codex", "cursor-agent", "cursor"])(
    "queues host engine %s, begins the task, and never spawns a host CLI",
    async (engine) => {
      const spend: string[] = [];
      registerCommandPlaneHooks({
        token: { recordSpend: async () => { spend.push("spent"); } },
      });
      const repo = await readyRepo();
      await setEngine(repo.hive, engine);
      const result = await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: repo.root });
      expect(result).toMatchObject({
        ok: true,
        accepted: null,
        began: true,
        hiveStatus: "doing",
        intent: { featureId: FEATURE, taskId: "T001", freshSubagent: true, tier: "economy" },
      });
      const queuePath = join(repo.hive, "dispatch-queue", FEATURE, "T001.json");
      expect((await stat(queuePath)).mode & 0o777).toBe(0o600);
      expect(await loadState(repo.specDir)).toMatchObject({
        tasks: { T001: { status: "in_progress", reviewFailures: 0 } },
      });
      expect(spend).toEqual([]);
      expect(hostSpawnCalls()).toEqual([]);
      const events = await readEvents(repo.hive);
      expect(events.some((event) => event.type === "task.dispatched")).toBe(true);
    },
  );

  it.each(["byok", "local", "opencode", "crush", "aider", "custom"])(
    "denies supervisor rung %s with SLICE_A_ONLY and writes nothing",
    async (engine) => {
      const spend: string[] = [];
      let engineCalled = false;
      registerCommandPlaneHooks({
        token: {
          beforeDispatch: async () => {
            throw new Error("hook must not run after Slice A deny");
          },
          recordSpend: async () => { spend.push("spent"); },
        },
        engine: {
          dispatch: async () => {
            engineCalled = true;
            return { accepted: true };
          },
        },
      });
      const repo = await readyRepo();
      await setEngine(repo.hive, engine);
      const result = await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: repo.root });
      expect(result).toMatchObject({ ok: false, code: "SLICE_A_ONLY", began: false });
      expect(engineCalled).toBe(false);
      expect(spend).toEqual([]);
      await expect(access(join(repo.hive, "dispatch-queue", FEATURE, "T001.json"))).rejects.toThrow();
      expect(await loadState(repo.specDir)).toBeNull();
      expect((await readLedger(repo.hive)).tasks.find((task) => task.id === "T001")?.status).toBe("todo");
      expect(hostSpawnCalls()).toEqual([]);
    },
  );

  it("stops when beforeDispatch denies and opens Ask-Me for a critical class", async () => {
    let engineCalled = false;
    registerCommandPlaneHooks({
      token: {
        beforeDispatch: async () => ({ allow: false, reasonClass: "budget_exceed", detail: "over cap" }),
      },
      engine: {
        dispatch: async () => {
          engineCalled = true;
          return null;
        },
      },
    });
    const repo = await readyRepo();
    const result = await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: repo.root });
    expect(result).toMatchObject({ ok: false, began: false });
    expect(engineCalled).toBe(false);
    expect(await loadState(repo.specDir)).toBeNull();
    const listed = await listAskMe({ hiveRoot: repo.hive, state: "open", featureId: FEATURE });
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.items.map((item) => item.reasonClass)).toContain("budget_exceed");
    expect((await readLedger(repo.hive)).tasks.find((task) => task.id === "T001")?.status).toBe("todo");
  });

  it("treats a beforeDispatch throw as HOOK_FAILED_CLOSED", async () => {
    registerCommandPlaneHooks({
      token: {
        beforeDispatch: async () => {
          throw new Error("boom");
        },
      },
    });
    const repo = await readyRepo();
    const result = await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: repo.root });
    expect(result).toMatchObject({ ok: false, code: "HOOK_FAILED_CLOSED", began: false });
    expect(await loadState(repo.specDir)).toBeNull();
    const events = await readEvents(repo.hive);
    expect(events.some((event) => event.type === "hook.failed")).toBe(true);
  });

  it("does not begin-task when engine dispatch returns accepted false", async () => {
    registerCommandPlaneHooks({
      engine: { dispatch: async () => ({ accepted: false }) },
    });
    const repo = await readyRepo();
    const result = await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: repo.root });
    expect(result).toMatchObject({ ok: false, accepted: false, began: false });
    await expect(access(join(repo.hive, "dispatch-queue", FEATURE, "T001.json"))).rejects.toThrow();
    expect(await loadState(repo.specDir)).toBeNull();
    expect((await readLedger(repo.hive)).tasks.find((task) => task.id === "T001")?.status).toBe("todo");
  });

  it("returns HOST_SPAWN_FORBIDDEN when a host dispatch claims accepted true", async () => {
    registerCommandPlaneHooks({
      engine: { dispatch: async () => ({ accepted: true }) },
    });
    const repo = await readyRepo();
    await setEngine(repo.hive, "claude");
    const result = await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: repo.root });
    expect(result).toMatchObject({ ok: false, code: "HOST_SPAWN_FORBIDDEN", began: false });
    await expect(access(join(repo.hive, "dispatch-queue", FEATURE, "T001.json"))).rejects.toThrow();
    expect(await loadState(repo.specDir)).toBeNull();
    expect(hostSpawnCalls()).toEqual([]);
  });

  it("deletes the queued host intent when begin-task fails and leaves hive status unchanged", async () => {
    const repo = await readyRepo();
    await saveState(repo.specDir, {
      tasks: {
        T001: { status: "done", reviewFailures: 0 },
        T002: { status: "pending", reviewFailures: 0 },
        T003: { status: "pending", reviewFailures: 0 },
        T004: { status: "pending", reviewFailures: 0 },
      },
    });
    const result = await dispatchTask({ featureId: FEATURE, taskId: "T001", cwd: repo.root });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/completed task/);
    expect(result).toMatchObject({ began: false });
    await expect(access(join(repo.hive, "dispatch-queue", FEATURE, "T001.json"))).rejects.toThrow();
    expect((await readLedger(repo.hive)).tasks.find((task) => task.id === "T001")?.status).toBe("todo");
    expect(await loadState(repo.specDir)).toMatchObject({
      tasks: { T001: { status: "done", reviewFailures: 0 } },
    });
  });

  it("does not spawn from this module", async () => {
    const src = await readFile(new URL("../../src/command-plane/dispatch.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\b(spawn|execFile|exec|fork)\s*\(/);
  });
});

function hostSpawnCalls(): string[] {
  const calls = [
    ...child.spawn.mock.calls,
    ...child.execFile.mock.calls,
    ...child.exec.mock.calls,
    ...child.fork.mock.calls,
  ];
  return calls.map((call) => String(call[0])).filter((argv0) => HOST_ARGV0.has(argv0));
}

function sampleIntent(hiveRoot: string, specDir: string): DispatchIntent {
  return {
    featureId: FEATURE,
    taskId: "T001",
    agentId: "agent-host",
    personaPath: null,
    workspace: null,
    hiveRoot,
    specDir,
    attempt: 1,
    tier: "economy",
    freshSubagent: true,
  };
}

async function bareRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cp-dispatch-bare-"));
  roots.push(root);
  await mkdir(join(root, "specs", FEATURE), { recursive: true });
  await writeFile(join(root, "program.md"), "# p\n");
  await writeFile(join(root, "specs", FEATURE, "plan.md"), PLAN);
  process.env.SUPERSPEC_ROOT = root;
  return root;
}

async function staffedRepo(): Promise<{ root: string; hive: string; specDir: string }> {
  const root = await bareRepo();
  const init = await hiveInit({ cwd: root });
  expect(init.ok).toBe(true);
  const submitted = await briefSubmit({
    cwd: root,
    featureId: FEATURE,
    outcome: "Steer one task",
    deliverable: `specs/${FEATURE}`,
  });
  expect(submitted.ok).toBe(true);
  return { root, hive: join(root, ".superspec", "hive"), specDir: join(root, "specs", FEATURE) };
}

async function readyRepo(): Promise<{ root: string; hive: string; specDir: string }> {
  const repo = await staffedRepo();
  const ci = await hiveCiSet({ hiveRoot: repo.hive, featureId: FEATURE, state: "green", source: "test" });
  expect(ci.ok).toBe(true);
  return repo;
}

async function readLedger(hive: string) {
  const raw = await readFile(join(hive, "ledger", `${FEATURE}.json`), "utf8");
  return HiveLedgerSchema.parse(JSON.parse(raw));
}

async function readEvents(hive: string): Promise<Array<{ type: string }>> {
  const raw = await readFile(join(hive, "events", "events.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string });
}

async function patchTask(hive: string, taskId: string, patch: Record<string, unknown>): Promise<void> {
  const path = join(hive, "ledger", `${FEATURE}.json`);
  const ledger = JSON.parse(await readFile(path, "utf8")) as {
    tasks: Array<Record<string, unknown>>;
  };
  const task = ledger.tasks.find((row) => row.id === taskId);
  if (!task) throw new Error(`missing ${taskId}`);
  Object.assign(task, patch);
  await writeFile(path, JSON.stringify(ledger));
}

async function setEngine(hive: string, engine: string | null): Promise<void> {
  const path = join(hive, "roster.json");
  const roster = JSON.parse(await readFile(path, "utf8")) as Array<{ engine: string | null }>;
  const host = roster[0];
  if (!host) throw new Error("roster empty");
  host.engine = engine;
  await writeFile(path, JSON.stringify(roster));
}

async function setAllowAbsentCi(hive: string, allowAbsentCi: boolean): Promise<void> {
  const path = join(hive, "settings.json");
  const settings = JSON.parse(await readFile(path, "utf8")) as { allowAbsentCi?: boolean };
  settings.allowAbsentCi = allowAbsentCi;
  await writeFile(path, JSON.stringify(settings));
}
