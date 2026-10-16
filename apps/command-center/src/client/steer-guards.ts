import { isDagReadyForDispatch } from "./dag.js";
import type { HiveTaskStatus, RosterAgentStatus, SnapshotTask } from "../shared/snapshot-types.js";

/** Client and bridge share this result. A refusal sends no Plane command. */
export type SteerGuardResult = { ok: true } | { ok: false; message: string };

export type DispatchGuardInput = {
  task: SnapshotTask;
  tasksById: ReadonlyMap<string, SnapshotTask>;
  hiveReady: boolean;
  /** Roster status of the current assignee. Null when the task is unassigned. */
  assigneeStatus: RosterAgentStatus | null;
};

export type ReassignGuardInput = {
  status: HiveTaskStatus;
  targetAgentId: string | null;
  /** Null when `targetAgentId` is not on the roster. */
  targetStatus: RosterAgentStatus | null;
};

/**
 * Dispatch when the task is DAG-ready, hold is false, status is todo, the
 * assignee is not offline, and `hiveReady` is true.
 */
export function canDispatch(input: DispatchGuardInput): SteerGuardResult {
  if (input.hiveReady !== true) {
    return refuse("Hive is not ready for dispatch.");
  }
  if (input.task.hold === true) {
    return refuse("Task is on hold.");
  }
  if (input.assigneeStatus === "offline") {
    return refuse("Assignee is offline.");
  }
  if (input.task.status !== "todo") {
    return refuse("Dispatch requires a todo task.");
  }
  if (!isDagReadyForDispatch(input.task, input.tasksById)) {
    return refuse("Task is not ready to dispatch.");
  }
  return allow();
}

/**
 * Pause sets hold on a `doing` task. Confirm is not required.
 * `reviewFailures` and the review ceiling are not preconditions (OD-011).
 */
export function canPause(input: Pick<SnapshotTask, "status">): SteerGuardResult {
  if (input.status === "doing") return allow();
  return refuse("Pause is only available while a task is doing.");
}

/** Abort requires `confirm: true` and a todo or doing task. Done and blocked send nothing. */
export function canAbort(input: { status: HiveTaskStatus; confirm: boolean }): SteerGuardResult {
  if (input.confirm !== true) {
    return refuse("Abort requires confirm: true.");
  }
  if (input.status === "done") {
    return refuse("Abort is not supported for a completed task.");
  }
  if (input.status !== "todo" && input.status !== "doing") {
    return refuse("Abort is not supported for a blocked task.");
  }
  return allow();
}

/** Reassign a todo or doing task to an on-roster agent that is not offline. */
export function canReassign(input: ReassignGuardInput): SteerGuardResult {
  if (input.status === "done") {
    return refuse("Reassign is not available for a completed task.");
  }
  if (input.status !== "todo" && input.status !== "doing") {
    return refuse("Reassign is only available for todo or doing tasks.");
  }
  const targetId = input.targetAgentId?.trim() ?? "";
  if (targetId.length === 0) {
    return refuse("Reassign target is missing.");
  }
  if (input.targetStatus === null) {
    return refuse("Reassign target is not on the roster.");
  }
  if (input.targetStatus === "offline") {
    return refuse("Reassign target is offline.");
  }
  return allow();
}

function allow(): SteerGuardResult {
  return { ok: true };
}

function refuse(message: string): SteerGuardResult {
  return { ok: false, message };
}
