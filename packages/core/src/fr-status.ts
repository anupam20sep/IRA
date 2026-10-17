import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parseSpec } from "./spec-parser.js";
import { parsePlan } from "./plan-parser.js";
import { buildMatrix } from "./matrix.js";
import type { ForgeState, TaskStatus } from "./forge-loop.js";
import { initState } from "./forge-loop.js";
import type { Task } from "./types.js";

export type FrStatus = "pending" | "in_progress" | "done" | "blocked";

export interface FrStatusRow {
  fr: string;
  text: string;
  status: FrStatus;
  tasks: string[];
}

export interface TaskStatusRow {
  id: string;
  title: string;
  status: TaskStatus;
  frRefs: string[];
}

export interface StatusSnapshot {
  feature: string;
  updatedAt: string;
  frRows: FrStatusRow[];
  taskRows: TaskStatusRow[];
  summary: { total: number; done: number; inProgress: number; blocked: number; pending: number };
}

const STATUS_LABEL: Record<FrStatus, string> = {
  pending: "⏳ pending",
  in_progress: "🔄 in progress",
  done: "✅ done",
  blocked: "🚫 blocked",
};

const TASK_LABEL: Record<TaskStatus, string> = {
  pending: "pending",
  in_progress: "in progress",
  done: "done",
  blocked: "blocked",
};

function deriveFrStatus(frId: string, tasks: Task[], state: ForgeState): FrStatus {
  const covering = tasks.filter((t) => t.frRefs.includes(frId));
  if (covering.length === 0) return "pending";

  const statuses = covering.map((t) => state.tasks[t.id]?.status ?? "pending");
  // Intentionally deferred tasks are `blocked`. They must not keep an FR
  // "in progress" when every remaining covering task is done (Slice A / staged forge).
  const active = statuses.filter((s) => s !== "blocked");
  if (active.length === 0) return "blocked";
  if (active.every((s) => s === "done")) return "done";
  if (active.some((s) => s === "done" || s === "in_progress")) return "in_progress";
  return "pending";
}

export function buildStatusSnapshot(
  specText: string,
  planText: string,
  state: ForgeState,
  feature = "feature",
): StatusSnapshot {
  const spec = parseSpec(specText);
  const tasks = parsePlan(planText);
  const matrix = buildMatrix(spec.requirements, tasks);
  const reqText = new Map(spec.requirements.map((r) => [r.id, r.text]));

  const frRows: FrStatusRow[] = matrix.rows.map((row) => ({
    fr: row.fr,
    text: reqText.get(row.fr) ?? "",
    status: deriveFrStatus(row.fr, tasks, state),
    tasks: row.tasks,
  }));

  const taskRows: TaskStatusRow[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: state.tasks[t.id]?.status ?? "pending",
    frRefs: t.frRefs,
  }));

  const summary = {
    total: taskRows.length,
    done: taskRows.filter((t) => t.status === "done").length,
    inProgress: taskRows.filter((t) => t.status === "in_progress").length,
    blocked: taskRows.filter((t) => t.status === "blocked").length,
    pending: taskRows.filter((t) => t.status === "pending").length,
  };

  return { feature, updatedAt: new Date().toISOString(), frRows, taskRows, summary };
}

export function renderStatusMarkdown(snapshot: StatusSnapshot): string {
  const lines: string[] = [
    `# Status: ${snapshot.feature}`,
    "",
    `**Last updated**: ${snapshot.updatedAt}`,
    `**Tasks**: ${snapshot.summary.done}/${snapshot.summary.total} done · ${snapshot.summary.inProgress} in progress · ${snapshot.summary.blocked} blocked · ${snapshot.summary.pending} pending`,
    "",
    "## Functional requirements",
    "",
    "| FR | Status | Tasks | Requirement |",
    "| --- | --- | --- | --- |",
  ];

  for (const row of snapshot.frRows) {
    const text = row.text.replace(/\|/g, "\\|").slice(0, 80);
    lines.push(
      `| ${row.fr} | ${STATUS_LABEL[row.status]} | ${row.tasks.join(", ") || "—"} | ${text || "—"} |`,
    );
  }

  lines.push(
    "",
    "## Task progress",
    "",
    "| Task | Status | FRs | Title |",
    "| --- | --- | --- | --- |",
  );

  for (const row of snapshot.taskRows) {
    lines.push(
      `| ${row.id} | ${TASK_LABEL[row.status]} | ${row.frRefs.join(", ")} | ${row.title.replace(/\|/g, "\\|")} |`,
    );
  }

  lines.push(
    "",
    "## Notes",
    "",
    "This file is updated by `@superspec-dev/core sync-status` (or MCP `sync-status`) during forge. Commit it to share FR progress with your team.",
    "",
  );

  return lines.join("\n");
}

export function statusFilePath(specDir: string): string {
  return join(specDir, "status.md");
}

export async function writeStatusFile(
  specDir: string,
  specText: string,
  planText: string,
  state: ForgeState,
  feature?: string,
): Promise<string> {
  const name = feature ?? specDir.split(/[/\\]/).filter(Boolean).pop() ?? "feature";
  const snapshot = buildStatusSnapshot(specText, planText, state, name);
  const path = statusFilePath(specDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderStatusMarkdown(snapshot), "utf8");
  return path;
}

export async function syncStatusFromFiles(
  specDir: string,
  specPath: string,
  planPath: string,
  state?: ForgeState,
): Promise<{ path: string; snapshot: StatusSnapshot }> {
  const specText = await readFile(specPath, "utf8");
  const planText = await readFile(planPath, "utf8");
  const tasks = parsePlan(planText);
  const resolved = state ?? initState(tasks);
  const featureName = specDir.split(/[/\\]/).filter(Boolean).pop() ?? "feature";
  const path = await writeStatusFile(specDir, specText, planText, resolved, featureName);
  const snapshot = buildStatusSnapshot(specText, planText, resolved, featureName);
  return { path, snapshot };
}
