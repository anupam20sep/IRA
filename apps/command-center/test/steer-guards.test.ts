import { describe, expect, it } from "vitest";
import { canAbort, canDispatch, canPause, canReassign } from "../src/client/steer-guards.js";
import type { SnapshotTask } from "../src/shared/snapshot-types.js";

function task(overrides: Partial<SnapshotTask> & Pick<SnapshotTask, "id">): SnapshotTask {
  return {
    featureId: "002-ira-command-center",
    title: overrides.id,
    implementsFr: ["FR-010"],
    dependsOn: [],
    assigneeAgentId: null,
    status: "todo",
    kind: "code",
    complexity: "moderate",
    reviewFailures: 0,
    hold: false,
    ceiling: 3,
    blockedByAskMeId: null,
    drift: "ok",
    capabilityTags: [],
    updatedAt: "2026-10-16T00:00:00.000Z",
    readiness: "waiting",
    ...overrides,
  };
}

function byId(tasks: SnapshotTask[]): ReadonlyMap<string, SnapshotTask> {
  return new Map(tasks.map((row) => [row.id, row]));
}

describe("canDispatch", () => {
  it("refuses when hiveReady is false", () => {
    const subject = task({ id: "T001", readiness: "ready" });

    expect(
      canDispatch({
        task: subject,
        tasksById: byId([subject]),
        hiveReady: false,
        assigneeStatus: null,
      }),
    ).toEqual({ ok: false, message: "Hive is not ready for dispatch." });
  });

  it("refuses when hold is true", () => {
    const subject = task({ id: "T001", hold: true, readiness: "ready" });

    expect(
      canDispatch({
        task: subject,
        tasksById: byId([subject]),
        hiveReady: true,
        assigneeStatus: "idle",
      }),
    ).toEqual({ ok: false, message: "Task is on hold." });
  });

  it("refuses when the assignee is offline", () => {
    const subject = task({ id: "T001", assigneeAgentId: "worker-1", readiness: "ready" });

    expect(
      canDispatch({
        task: subject,
        tasksById: byId([subject]),
        hiveReady: true,
        assigneeStatus: "offline",
      }),
    ).toEqual({ ok: false, message: "Assignee is offline." });
  });

  it("refuses when status is not todo", () => {
    const subject = task({ id: "T001", status: "doing", readiness: "waiting" });

    expect(
      canDispatch({
        task: subject,
        tasksById: byId([subject]),
        hiveReady: true,
        assigneeStatus: "busy",
      }),
    ).toEqual({ ok: false, message: "Dispatch requires a todo task." });
  });

  it("refuses when the task is not DAG-ready", () => {
    const predecessor = task({ id: "T001", status: "todo" });
    const subject = task({ id: "T002", dependsOn: ["T001"], readiness: "waiting" });

    expect(
      canDispatch({
        task: subject,
        tasksById: byId([predecessor, subject]),
        hiveReady: true,
        assigneeStatus: null,
      }),
    ).toEqual({ ok: false, message: "Task is not ready to dispatch." });
  });

  it("refuses a code task with an empty implementsFr or an open Ask-Me block", () => {
    const emptyFr = task({ id: "T001", implementsFr: [], readiness: "waiting" });
    const blocked = task({
      id: "T002",
      blockedByAskMeId: "ask-1",
      readiness: "waiting",
    });

    expect(
      canDispatch({
        task: emptyFr,
        tasksById: byId([emptyFr]),
        hiveReady: true,
        assigneeStatus: null,
      }),
    ).toEqual({ ok: false, message: "Task is not ready to dispatch." });
    expect(
      canDispatch({
        task: blocked,
        tasksById: byId([blocked]),
        hiveReady: true,
        assigneeStatus: null,
      }),
    ).toEqual({ ok: false, message: "Task is not ready to dispatch." });
  });

  it("allows a DAG-ready todo task when the hive is ready and the assignee is not offline", () => {
    const done = task({ id: "T001", status: "done" });
    const subject = task({
      id: "T002",
      dependsOn: ["T001"],
      assigneeAgentId: "worker-1",
      readiness: "ready",
    });

    expect(
      canDispatch({
        task: subject,
        tasksById: byId([done, subject]),
        hiveReady: true,
        assigneeStatus: "idle",
      }),
    ).toEqual({ ok: true });
  });
});

describe("canPause", () => {
  it("allows pause on doing without confirm, even at the review-failure ceiling", () => {
    const doing = task({
      id: "T001",
      status: "doing",
      reviewFailures: 3,
      ceiling: 3,
    });

    expect(canPause(doing)).toEqual({ ok: true });
  });

  it("refuses pause when status is not doing", () => {
    expect(canPause({ status: "todo" })).toEqual({
      ok: false,
      message: "Pause is only available while a task is doing.",
    });
    expect(canPause({ status: "done" }).ok).toBe(false);
    expect(canPause({ status: "blocked" }).ok).toBe(false);
  });
});

describe("canAbort", () => {
  it("refuses abort on done", () => {
    expect(canAbort({ status: "done", confirm: true })).toEqual({
      ok: false,
      message: "Abort is not supported for a completed task.",
    });
  });

  it("refuses abort when confirm is not true", () => {
    expect(canAbort({ status: "doing", confirm: false })).toEqual({
      ok: false,
      message: "Abort requires confirm: true.",
    });
  });

  it("refuses abort when the task is already blocked", () => {
    expect(canAbort({ status: "blocked", confirm: true })).toEqual({
      ok: false,
      message: "Abort is not supported for a blocked task.",
    });
  });

  it("allows abort of todo or doing when confirm is true", () => {
    expect(canAbort({ status: "todo", confirm: true })).toEqual({ ok: true });
    expect(canAbort({ status: "doing", confirm: true })).toEqual({ ok: true });
  });
});

describe("canReassign", () => {
  it("refuses reassign to an offline agent", () => {
    expect(
      canReassign({
        status: "doing",
        targetAgentId: "worker-1",
        targetStatus: "offline",
      }),
    ).toEqual({ ok: false, message: "Reassign target is offline." });
  });

  it("refuses reassign when the target is missing or not on the roster", () => {
    expect(
      canReassign({ status: "todo", targetAgentId: null, targetStatus: null }),
    ).toEqual({ ok: false, message: "Reassign target is missing." });
    expect(
      canReassign({ status: "todo", targetAgentId: "ghost", targetStatus: null }),
    ).toEqual({ ok: false, message: "Reassign target is not on the roster." });
  });

  it("refuses reassign of a done or blocked task", () => {
    expect(
      canReassign({ status: "done", targetAgentId: "worker-1", targetStatus: "idle" }),
    ).toEqual({ ok: false, message: "Reassign is not available for a completed task." });
    expect(
      canReassign({ status: "blocked", targetAgentId: "worker-1", targetStatus: "idle" }),
    ).toEqual({ ok: false, message: "Reassign is only available for todo or doing tasks." });
  });

  it("allows reassign of todo or doing to an on-roster agent that is not offline", () => {
    expect(
      canReassign({ status: "todo", targetAgentId: "worker-1", targetStatus: "idle" }),
    ).toEqual({ ok: true });
    expect(
      canReassign({ status: "doing", targetAgentId: "worker-2", targetStatus: "busy" }),
    ).toEqual({ ok: true });
  });
});
