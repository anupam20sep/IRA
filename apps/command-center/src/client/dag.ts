import type { SnapshotTask, TaskReadiness } from "../shared/snapshot-types.js";

/**
 * P-001 DAG-ready rule (command-plane task invariant) on hive ledger rows.
 * Dependency completion is hive `status === "done"`.
 *
 * Ready when status is `todo`, drift is `ok` | `added` | `changed`, hold is
 * false or omitted, `blockedByAskMeId` is empty, every dependency is `done`,
 * and a `code` task has a non-empty `implementsFr`.
 *
 * This predicate sees the task and `tasksById` only.
 */
export function isDagReadyForDispatch(
  task: SnapshotTask,
  tasksById: ReadonlyMap<string, SnapshotTask>,
): boolean {
  if (task.status !== "todo") return false;
  if (task.drift === "removed") return false;
  if (task.hold === true) return false;
  if (askMeBlocks(task)) return false;
  if (task.kind === "code" && task.implementsFr.length === 0) return false;
  return dependenciesDone(task, tasksById);
}

/** Kanban label for a todo card. Non-todo columns use `status` itself. */
export function computeReadiness(
  task: SnapshotTask,
  tasksById: ReadonlyMap<string, SnapshotTask>,
): TaskReadiness {
  return isDagReadyForDispatch(task, tasksById) ? "ready" : "waiting";
}

function askMeBlocks(task: SnapshotTask): boolean {
  return typeof task.blockedByAskMeId === "string" && task.blockedByAskMeId.length > 0;
}

function dependenciesDone(
  task: SnapshotTask,
  tasksById: ReadonlyMap<string, SnapshotTask>,
): boolean {
  return task.dependsOn.every((id) => tasksById.get(id)?.status === "done");
}
