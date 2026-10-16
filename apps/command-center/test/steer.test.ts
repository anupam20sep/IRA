import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotTask } from "../src/shared/snapshot-types.js";
import type { BearerAuthRequest } from "../src/server/auth.js";
import type { RunSuperspecResult } from "../src/server/cli.js";

vi.mock("../src/server/cli.js", () => ({
  runSuperspec: vi.fn(),
}));

import { runSuperspec } from "../src/server/cli.js";
import {
  steerAbort,
  steerArgvAbort,
  steerArgvDispatch,
  steerArgvPause,
  steerArgvReassign,
  steerDispatch,
  steerPause,
  steerReassign,
  STEER_TIMEOUT_MS,
  type SteerDispatchInput,
} from "../src/server/steer.js";

const FEATURE = "002-ira-command-center";
const TASK = "T011";
const CWD = "/repo/superspec";
const TOKEN = "loopback-secret-abc";

function task(overrides: Partial<SnapshotTask> & Pick<SnapshotTask, "id">): SnapshotTask {
  return {
    featureId: FEATURE,
    title: overrides.id,
    implementsFr: ["FR-010"],
    dependsOn: [],
    assigneeAgentId: null,
    status: "todo",
    kind: "code",
    complexity: "complex",
    reviewFailures: 0,
    hold: false,
    ceiling: 3,
    blockedByAskMeId: null,
    drift: "ok",
    capabilityTags: [],
    updatedAt: "2026-10-16T00:00:00.000Z",
    readiness: "ready",
    ...overrides,
  };
}

async function writeLoopbackToken(hiveRoot: string, token: string): Promise<void> {
  const authDir = join(hiveRoot, "auth");
  await mkdir(authDir, { recursive: true });
  await chmod(authDir, 0o700);
  const tokenPath = join(authDir, "loopback.token");
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600);
}

function authed(url = "/api/tasks/dispatch"): BearerAuthRequest {
  return { url, headers: { authorization: `Bearer ${TOKEN}` } };
}

function dispatchInput(
  overrides: Partial<SteerDispatchInput> = {},
  subject?: SnapshotTask,
): SteerDispatchInput {
  const row = subject ?? task({ id: TASK });
  return {
    request: authed(),
    hiveRoot: "",
    cwd: CWD,
    featureId: row.featureId,
    taskId: row.id,
    task: row,
    tasksById: new Map([[row.id, row]]),
    hiveReady: true,
    assigneeStatus: "idle",
    ...overrides,
  };
}

describe("steer argv", () => {
  it("builds dispatch-task with --feature and --task", () => {
    expect(steerArgvDispatch({ featureId: FEATURE, taskId: TASK })).toEqual([
      "dispatch-task",
      "--feature",
      FEATURE,
      "--task",
      TASK,
    ]);
    expect(steerArgvDispatch({ featureId: FEATURE, taskId: TASK, cwd: CWD })).toEqual([
      "dispatch-task",
      "--feature",
      FEATURE,
      "--task",
      TASK,
      "--cwd",
      CWD,
    ]);
  });

  it("builds task-hold with --hold true", () => {
    expect(steerArgvPause({ featureId: FEATURE, taskId: TASK })).toEqual([
      "task-hold",
      "--feature",
      FEATURE,
      "--task",
      TASK,
      "--hold",
      "true",
    ]);
  });

  it("builds task-abort with --confirm true", () => {
    expect(steerArgvAbort({ featureId: FEATURE, taskId: TASK })).toEqual([
      "task-abort",
      "--feature",
      FEATURE,
      "--task",
      TASK,
      "--confirm",
      "true",
    ]);
  });

  it("builds task-reassign", () => {
    expect(steerArgvReassign({ featureId: FEATURE, taskId: TASK, agentId: "agent-host" })).toEqual([
      "task-reassign",
      "--feature",
      FEATURE,
      "--task",
      TASK,
      "--agent",
      "agent-host",
    ]);
  });

  it("does not name forbidden forge commands in the steer module source", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/server/steer.ts", import.meta.url)), "utf8");
    expect(source.includes("begin-task")).toBe(false);
    expect(source.includes("record-result")).toBe(false);
    expect(source.includes("locks/")).toBe(false);
    expect(source.includes("withLock")).toBe(false);
  });
});

describe("steer handlers", () => {
  let hiveRoot: string;

  beforeEach(async () => {
    hiveRoot = await mkdtemp(join(tmpdir(), "cc-steer-"));
    await writeLoopbackToken(hiveRoot, TOKEN);
    vi.mocked(runSuperspec).mockReset();
    vi.mocked(runSuperspec).mockResolvedValue({ ok: true, json: { ok: true } });
  });

  afterEach(() => {
    vi.mocked(runSuperspec).mockReset();
  });

  it("returns TOKEN_REQUIRED and does not spawn when the bearer is missing", async () => {
    const result = await steerDispatch(
      dispatchInput({ hiveRoot, request: { headers: {}, url: "/api/tasks/dispatch" } }),
    );

    expect(result).toEqual({
      status: 401,
      body: {
        ok: false,
        error: "TOKEN_REQUIRED",
        message: expect.any(String),
      },
    });
    expect(runSuperspec).not.toHaveBeenCalled();
  });

  it("returns TOKEN_REQUIRED and does not spawn when the query string carries a token", async () => {
    const result = await steerDispatch(
      dispatchInput({
        hiveRoot,
        request: {
          headers: { authorization: `Bearer ${TOKEN}` },
          url: "/api/tasks/dispatch?token=leak",
        },
      }),
    );

    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ ok: false, error: "TOKEN_REQUIRED" });
    expect(runSuperspec).not.toHaveBeenCalled();
  });

  it("returns an INVALID_INPUT envelope and does not spawn when the dispatch guard refuses", async () => {
    const held = task({ id: TASK, hold: true });
    const result = await steerDispatch(
      dispatchInput({ hiveRoot, task: held, tasksById: new Map([[held.id, held]]) }),
    );

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        error: "INVALID_INPUT",
        message: "Task is on hold. The action was not sent.",
      },
    });
    expect(runSuperspec).not.toHaveBeenCalled();
  });

  it("spawns dispatch-task only after auth and guards pass", async () => {
    const result = await steerDispatch(dispatchInput({ hiveRoot }));

    expect(runSuperspec).toHaveBeenCalledTimes(1);
    expect(runSuperspec).toHaveBeenCalledWith(steerArgvDispatch({ featureId: FEATURE, taskId: TASK, cwd: CWD }), {
      cwd: CWD,
      timeoutMs: STEER_TIMEOUT_MS,
    });
    expect(STEER_TIMEOUT_MS).toBe(30_000);
    expect(result).toEqual({ status: 200, body: { ok: true } });
  });

  it("passes a Plane error envelope through when the CLI refuses", async () => {
    vi.mocked(runSuperspec).mockResolvedValue({
      ok: true,
      json: {
        ok: false,
        error: "DISPATCH_HELD",
        message: "Task is on hold.",
        hint: "Clear hold before dispatch.",
      },
    });

    const result = await steerDispatch(dispatchInput({ hiveRoot }));

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        error: "DISPATCH_HELD",
        message: "Task is on hold.",
        hint: "Clear hold before dispatch.",
      },
    });
  });

  it("returns INVALID_INPUT when the CLI stdout is not a Plane JSON object", async () => {
    vi.mocked(runSuperspec).mockResolvedValue({
      ok: false,
      error: "CLI stdout is not valid JSON.",
    });

    const result = await steerPause(
      dispatchInput({
        hiveRoot,
        task: task({ id: TASK, status: "doing" }),
      }),
    );

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        error: "INVALID_INPUT",
        message: "CLI stdout is not valid JSON.",
      },
    });
  });

  it("spawns task-hold --hold true for a doing task and does not require confirm", async () => {
    const doing = task({ id: TASK, status: "doing", reviewFailures: 3, ceiling: 3 });
    const result = await steerPause(
      dispatchInput({ hiveRoot, task: doing, tasksById: new Map([[doing.id, doing]]) }),
    );

    expect(result.status).toBe(200);
    expect(runSuperspec).toHaveBeenCalledWith(
      [
        "task-hold",
        "--feature",
        FEATURE,
        "--task",
        TASK,
        "--hold",
        "true",
        "--cwd",
        CWD,
      ],
      { cwd: CWD, timeoutMs: 30_000 },
    );
  });

  it("refuses pause when the task is not doing", async () => {
    const result = await steerPause(dispatchInput({ hiveRoot }));

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        error: "INVALID_INPUT",
        message: "Pause is only available while a task is doing. The action was not sent.",
      },
    });
    expect(runSuperspec).not.toHaveBeenCalled();
  });

  it("spawns task-abort --confirm true only when the abort guard allows it", async () => {
    const doing = task({ id: TASK, status: "doing" });
    const allowed = await steerAbort({
      ...dispatchInput({ hiveRoot, task: doing, tasksById: new Map([[doing.id, doing]]) }),
      confirm: true,
    });

    expect(allowed.status).toBe(200);
    expect(runSuperspec).toHaveBeenCalledWith(
      ["task-abort", "--feature", FEATURE, "--task", TASK, "--confirm", "true", "--cwd", CWD],
      { cwd: CWD, timeoutMs: 30_000 },
    );

    vi.mocked(runSuperspec).mockClear();
    const refused = await steerAbort({
      ...dispatchInput({ hiveRoot, task: doing, tasksById: new Map([[doing.id, doing]]) }),
      confirm: false,
    });
    expect(refused.body).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
      message: "Abort requires confirm: true. The action was not sent.",
    });
    expect(runSuperspec).not.toHaveBeenCalled();
  });

  it("spawns task-reassign for an on-roster agent and refuses an offline target", async () => {
    const doing = task({ id: TASK, status: "doing" });
    const base = dispatchInput({ hiveRoot, task: doing, tasksById: new Map([[doing.id, doing]]) });

    const allowed = await steerReassign({
      ...base,
      agentId: "agent-host",
      targetStatus: "idle",
    });
    expect(allowed.status).toBe(200);
    expect(runSuperspec).toHaveBeenCalledWith(
      ["task-reassign", "--feature", FEATURE, "--task", TASK, "--agent", "agent-host", "--cwd", CWD],
      { cwd: CWD, timeoutMs: 30_000 },
    );

    vi.mocked(runSuperspec).mockClear();
    const refused = await steerReassign({
      ...base,
      agentId: "agent-host",
      targetStatus: "offline",
    });
    expect(refused.body).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
      message: "Reassign target is offline. The action was not sent.",
    });
    expect(runSuperspec).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT when a second steer for the same feature is already running", async () => {
    let release!: (value: RunSuperspecResult) => void;
    const hanging = new Promise<RunSuperspecResult>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const startedGate = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(runSuperspec).mockImplementation(() => {
      started();
      return hanging;
    });

    const input = dispatchInput({ hiveRoot, featureId: "feat-inflight" });
    const first = steerDispatch({
      ...input,
      task: task({ id: TASK, featureId: "feat-inflight" }),
      tasksById: new Map([[TASK, task({ id: TASK, featureId: "feat-inflight" })]]),
    });
    await startedGate;

    const second = await steerDispatch({
      ...input,
      task: task({ id: "T012", featureId: "feat-inflight" }),
      taskId: "T012",
      tasksById: new Map([["T012", task({ id: "T012", featureId: "feat-inflight" })]]),
    });

    expect(second).toEqual({
      status: 400,
      body: {
        ok: false,
        error: "INVALID_INPUT",
        message: "A steer action is already running.",
      },
    });
    expect(runSuperspec).toHaveBeenCalledTimes(1);

    release({ ok: true, json: { ok: true } });
    await expect(first).resolves.toEqual({ status: 200, body: { ok: true } });
  });

  it("allows steer on a different feature while one feature is in flight", async () => {
    let release!: (value: RunSuperspecResult) => void;
    const hanging = new Promise<RunSuperspecResult>((resolve) => {
      release = resolve;
    });
    let featAStarted!: () => void;
    const featAGate = new Promise<void>((resolve) => {
      featAStarted = resolve;
    });
    vi.mocked(runSuperspec).mockImplementation((argv: string[]) => {
      if (argv.includes("feat-a")) {
        featAStarted();
        return hanging;
      }
      return Promise.resolve({ ok: true, json: { ok: true, featureId: "feat-b" } });
    });

    const firstTask = task({ id: TASK, featureId: "feat-a" });
    const secondTask = task({ id: TASK, featureId: "feat-b" });
    const first = steerDispatch(
      dispatchInput({
        hiveRoot,
        featureId: "feat-a",
        task: firstTask,
        tasksById: new Map([[firstTask.id, firstTask]]),
      }),
    );
    await featAGate;
    const second = await steerDispatch(
      dispatchInput({
        hiveRoot,
        featureId: "feat-b",
        task: secondTask,
        tasksById: new Map([[secondTask.id, secondTask]]),
      }),
    );

    expect(second).toEqual({ status: 200, body: { ok: true, featureId: "feat-b" } });
    expect(runSuperspec).toHaveBeenCalledTimes(2);
    release({ ok: true, json: { ok: true } });
    await first;
  });

  it("refuses when the task identity does not match the request", async () => {
    const result = await steerDispatch(
      dispatchInput({ hiveRoot, taskId: "T099" }),
    );

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        error: "INVALID_INPUT",
        message: "Task does not match the steer request. The action was not sent.",
      },
    });
    expect(runSuperspec).not.toHaveBeenCalled();
  });

  it("does not reserve the feature when auth or a guard refuses", async () => {
    await steerDispatch(dispatchInput({ hiveRoot, request: { headers: {} } }));
    await steerDispatch(dispatchInput({ hiveRoot, hiveReady: false }));
    const result = await steerDispatch(dispatchInput({ hiveRoot }));
    expect(result.status).toBe(200);
    expect(runSuperspec).toHaveBeenCalledTimes(1);
  });
});
