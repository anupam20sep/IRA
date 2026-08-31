import type { InitResult } from "./init.js";
import { formatInitError, formatInitReport } from "./init.js";
import type { ForgeStatus } from "./forge-loop.js";
import type { StatusSnapshot } from "./fr-status.js";
import type { Task } from "./types.js";

export function emitInitSuccess(result: InitResult, verbose: boolean): string {
  if (verbose) return formatInitReport(result);
  return JSON.stringify(result, null, 2);
}

export function emitInitFailure(err: unknown): string {
  return formatInitError(err);
}

export function formatForgeStatusReport(
  status: ForgeStatus,
  extra?: { statusPath?: string; cwd?: string; dir?: string },
  verbose = false,
): string {
  const head = `SuperSpec forge-status: ${status.done}/${status.total} done · ${status.inProgress} in progress · ${status.pending} pending · complete=${status.complete}`;
  const meta: string[] = [];
  if (status.complete && status.nextStep) meta.push(status.nextStep);
  if (extra?.dir) meta.push(`dir: ${extra.dir}`);
  if (extra?.statusPath) meta.push(`status.md: ${extra.statusPath}`);
  if (extra?.cwd) meta.push(`cwd: ${extra.cwd}`);
  if (!verbose) return JSON.stringify({ ...status, ...extra }, null, 2);
  return [head, ...meta.map((m) => `  ${m}`), "", JSON.stringify({ ...status, ...extra }, null, 2)].join(
    "\n",
  );
}

export function formatSyncStatusReport(
  result: { path: string; snapshot: StatusSnapshot },
  verbose = false,
): string {
  const head = `SuperSpec sync-status: wrote ${result.path} (${result.snapshot.frRows.length} FR, ${result.snapshot.summary.total} tasks)`;
  if (!verbose) return JSON.stringify(result, null, 2);
  return [head, "", JSON.stringify(result, null, 2)].join("\n");
}

export function formatCommandError(command: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return [
    `SuperSpec ${command}: FAILED — ${message}`,
    "",
    JSON.stringify({ ok: false, command, error: message, cwd: process.cwd() }, null, 2),
  ].join("\n");
}

export function formatNextTaskReport(
  task: Task | null,
  extra?: { dir?: string; cwd?: string },
  verbose = false,
): string {
  const payload = { task, ...extra };
  if (!verbose) return JSON.stringify(payload, null, 2);
  const head =
    task === null
      ? "SuperSpec next-task: no ready task (all done, blocked, or waiting on dependencies)"
      : `SuperSpec next-task: ${task.id} — ${task.title}`;
  const meta: string[] = [];
  if (extra?.dir) meta.push(`dir: ${extra.dir}`);
  if (extra?.cwd) meta.push(`cwd: ${extra.cwd}`);
  return [head, ...meta.map((m) => `  ${m}`), "", JSON.stringify(payload, null, 2)].join("\n");
}

export function formatBeginTaskReport(
  taskId: string,
  extra?: { dir?: string; cwd?: string },
  verbose = false,
): string {
  const payload = { ok: true, taskId, ...extra };
  if (!verbose) return JSON.stringify(payload, null, 2);
  const head = `SuperSpec begin-task: ${taskId} marked in progress`;
  const meta: string[] = [];
  if (extra?.dir) meta.push(`dir: ${extra.dir}`);
  if (extra?.cwd) meta.push(`cwd: ${extra.cwd}`);
  return [head, ...meta.map((m) => `  ${m}`), "", JSON.stringify(payload, null, 2)].join("\n");
}

export function formatCoordinatorBriefReport(
  briefPath: string,
  body: string,
  verbose = false,
): string {
  if (!verbose) {
    return JSON.stringify({ ok: true, path: briefPath }, null, 2);
  }
  return [`SuperSpec coordinator-brief: ${briefPath}`, "", body].join("\n");
}

export function formatRecordResultReport(
  taskId: string,
  passed: boolean,
  extra?: { dir?: string; statusPath?: string; coordinatorPath?: string; cwd?: string },
  verbose = false,
): string {
  const payload = { ok: true, taskId, passed, ...extra };
  if (!verbose) return JSON.stringify(payload, null, 2);
  const verdict = passed ? "passed" : "failed";
  const head = `SuperSpec record-result: ${taskId} ${verdict}`;
  const meta: string[] = [];
  if (extra?.dir) meta.push(`dir: ${extra.dir}`);
  if (extra?.statusPath) meta.push(`status.md: ${extra.statusPath}`);
  if (extra?.coordinatorPath) meta.push(`coordinator.md: ${extra.coordinatorPath}`);
  if (extra?.cwd) meta.push(`cwd: ${extra.cwd}`);
  return [head, ...meta.map((m) => `  ${m}`), "", JSON.stringify(payload, null, 2)].join("\n");
}

