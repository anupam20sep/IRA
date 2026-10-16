import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Task } from "./types.js";

export type TaskStatus = "pending" | "in_progress" | "done" | "blocked";

export interface ForgeState {
  tasks: Record<string, { status: TaskStatus; reviewFailures: number }>;
}

export interface ForgeOptions {
  maxReviewFailures: number;
}

export interface ForgeStatus {
  total: number;
  done: number;
  blocked: number;
  pending: number;
  inProgress: number;
  /** True when every task is done — not the same as validate-ready. */
  complete: boolean;
  /**
   * Human-facing note: task loop finished ≠ principles satisfied.
   * Present when complete is true.
   */
  nextStep?: string;
}

export function initState(tasks: Task[]): ForgeState {
  const state: ForgeState = { tasks: {} };
  for (const t of tasks) {
    state.tasks[t.id] = { status: "pending", reviewFailures: 0 };
  }
  return state;
}

/**
 * Add plan task ids that forge state does not have yet.
 * Existing rows stay as they are, including ids the plan no longer lists.
 */
export function reconcileState(tasks: Task[], previous: ForgeState | null): ForgeState {
  const merged: ForgeState["tasks"] = {};
  if (previous) {
    for (const [id, row] of Object.entries(previous.tasks)) {
      merged[id] = { status: row.status, reviewFailures: row.reviewFailures };
    }
  }
  for (const task of tasks) {
    if (merged[task.id]) continue;
    merged[task.id] = { status: "pending", reviewFailures: 0 };
  }
  return { tasks: merged };
}

export function nextTask(tasks: Task[], state: ForgeState): Task | null {
  for (const t of tasks) {
    const s = state.tasks[t.id];
    if (!s || s.status !== "pending") continue;
    const depsDone = t.dependsOn.every((d) => state.tasks[d]?.status === "done");
    if (depsDone) return t;
  }
  return null;
}

export function markInProgress(state: ForgeState, taskId: string): ForgeState {
  const s = state.tasks[taskId];
  if (!s) throw new Error(`Unknown task id: ${taskId}`);
  if (s.status === "blocked") {
    throw new Error(`Cannot mark blocked task in progress: ${taskId}`);
  }
  if (s.status === "done") {
    throw new Error(`Cannot mark completed task in progress: ${taskId}`);
  }
  s.status = "in_progress";
  return state;
}

export function recordResult(
  state: ForgeState,
  taskId: string,
  passed: boolean,
  opts: ForgeOptions,
): ForgeState {
  const s = state.tasks[taskId];
  if (!s) throw new Error(`Unknown task id: ${taskId}`);
  if (s.status === "blocked") {
    throw new Error(`Cannot record result for already-blocked task: ${taskId}`);
  }
  if (passed) {
    s.status = "done";
  } else {
    s.reviewFailures += 1;
    if (s.reviewFailures >= opts.maxReviewFailures) {
      s.status = "blocked";
    } else {
      s.status = "pending";
    }
  }
  return state;
}

export function forgeStatus(state: ForgeState): ForgeStatus {
  const values = Object.values(state.tasks);
  const done = values.filter((v) => v.status === "done").length;
  const blocked = values.filter((v) => v.status === "blocked").length;
  const inProgress = values.filter((v) => v.status === "in_progress").length;
  const pending = values.filter((v) => v.status === "pending").length;
  const complete = values.length > 0 && done === values.length;
  return {
    total: values.length,
    done,
    blocked,
    pending,
    inProgress,
    complete,
    ...(complete
      ? {
          nextStep:
            "Tasks complete — run superspec-validate (matrix + lint-plan + standing gates) before ship. forge complete ≠ validate-ready.",
        }
      : {}),
  };
}

function statePath(dir: string): string {
  return join(dir, ".superspec", "state.json");
}

export async function saveState(dir: string, state: ForgeState): Promise<void> {
  const p = statePath(dir);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(state, null, 2), "utf8");
}

export async function loadState(dir: string): Promise<ForgeState | null> {
  try {
    const raw = await readFile(statePath(dir), "utf8");
    return JSON.parse(raw) as ForgeState;
  } catch {
    return null;
  }
}
