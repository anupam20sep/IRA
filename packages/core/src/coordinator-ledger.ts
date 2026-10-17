import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { parsePlan } from "./plan-parser.js";
import { forgeStatus, initState, loadState, nextTask } from "./forge-loop.js";
import { priorPatternsForTask } from "./learning-memory/forge-wiring.js";

export const COORDINATOR_BRIEF = "coordinator.md";
export const REPORTS_DIR = "reports";
export const DEFAULT_LOG_LIMIT = 8;

export interface CoordinatorLogEntry {
  taskId: string;
  verdict: "pass" | "fail" | "blocked";
  commits?: string;
  implementerReport?: string;
  reviewerReport?: string;
  note?: string;
  at: string;
}

export interface CoordinatorBriefPaths {
  specDir: string;
  planPath: string;
  statusPath: string;
  statePath: string;
  briefPath: string;
  reportsDir: string;
}

export function coordinatorPaths(specDir: string, planPath?: string): CoordinatorBriefPaths {
  const plan = planPath ?? join(specDir, "plan.md");
  return {
    specDir,
    planPath: plan,
    statusPath: join(specDir, "status.md"),
    statePath: join(specDir, ".superspec", "state.json"),
    briefPath: join(specDir, ".superspec", COORDINATOR_BRIEF),
    reportsDir: join(specDir, ".superspec", REPORTS_DIR),
  };
}

export function reportFilePath(specDir: string, taskId: string, role: "implementer" | "reviewer"): string {
  return join(specDir, ".superspec", REPORTS_DIR, `${taskId}-${role}.md`);
}

export async function ensureCoordinatorDirs(specDir: string): Promise<CoordinatorBriefPaths> {
  const paths = coordinatorPaths(specDir);
  await mkdir(join(specDir, ".superspec"), { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
  return paths;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseLogSection(body: string): CoordinatorLogEntry[] {
  const marker = "## Recent log";
  const idx = body.indexOf(marker);
  if (idx === -1) return [];

  const table = body.slice(idx);
  const lines = table.split("\n").filter((l) => l.startsWith("|") && !l.includes("---") && !l.includes("Task |"));
  const entries: CoordinatorLogEntry[] = [];

  for (const line of lines) {
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 3) continue;
    const [taskId, verdictRaw, commits, reports] = cells;
    const verdict = verdictRaw as CoordinatorLogEntry["verdict"];
    if (verdict !== "pass" && verdict !== "fail" && verdict !== "blocked") continue;
    const implMatch = reports?.match(/impl:\s*([^\s·]+)/);
    const reviewMatch = reports?.match(/review:\s*([^\s|]+)/);
    entries.push({
      taskId,
      verdict,
      commits: commits === "—" ? undefined : commits,
      implementerReport: implMatch?.[1],
      reviewerReport: reviewMatch?.[1],
      at: new Date().toISOString(),
    });
  }
  return entries;
}

function formatLogTable(entries: CoordinatorLogEntry[]): string {
  if (entries.length === 0) {
    return "| Task | Verdict | Commits | Reports |\n|------|---------|---------|----------|\n| — | — | — | — |";
  }
  const rows = entries.map((e) => {
    const reports: string[] = [];
    if (e.implementerReport) reports.push(`impl: ${e.implementerReport}`);
    if (e.reviewerReport) reports.push(`review: ${e.reviewerReport}`);
    return `| ${e.taskId} | ${e.verdict} | ${e.commits ?? "—"} | ${reports.join(" · ") || "—"} |`;
  });
  return ["| Task | Verdict | Commits | Reports |", "|------|---------|---------|----------|", ...rows].join(
    "\n",
  );
}

function coordinatorReplyTemplate(taskId: string): string {
  return `\`${taskId}\` done → run \`coordinator-brief\` → dispatch next task. Chat: one line only.`;
}

export interface BuildCoordinatorBriefInput {
  specDir: string;
  planPath: string;
  logLimit?: number;
  previousLog?: CoordinatorLogEntry[];
}

export async function buildCoordinatorBrief(input: BuildCoordinatorBriefInput): Promise<string> {
  const paths = coordinatorPaths(input.specDir, input.planPath);
  await ensureCoordinatorDirs(input.specDir);

  const planText = await readFile(input.planPath, "utf8");
  const tasks = parsePlan(planText);
  const state = (await loadState(input.specDir)) ?? initState(tasks);
  const status = forgeStatus(state);
  const next = nextTask(tasks, state);

  let previousLog = input.previousLog ?? [];
  if (previousLog.length === 0 && (await fileExists(paths.briefPath))) {
    const existing = await readFile(paths.briefPath, "utf8");
    previousLog = parseLogSection(existing);
  }

  const logLimit = input.logLimit ?? DEFAULT_LOG_LIMIT;
  const log = previousLog.slice(0, logLimit);
  const nextLabel = next ? `${next.id} — ${next.title}` : status.complete ? "(none — complete)" : "(none — blocked or waiting)";
  const prior = next ? await priorPatternsForTask({ specDir: input.specDir, task: next }) : null;
  const priorSection = prior?.text.trim()
    ? `\n### Prior patterns for next task\n\n${prior.text.trim()}\n`
    : "";

  return `# Forge Coordinator Brief (lean loop)

> **Re-read this file** at loop start and after compaction. Chat history is not authoritative.

**Spec dir:** \`${input.specDir}\`
**Plan:** \`${input.planPath}\`
**Status:** \`${paths.statusPath}\`
**State:** \`${paths.statePath}\`
**Reports:** \`${paths.reportsDir}/\`

## Lean loop rules

1. **CLI only** for forge ops — \`next-task\`, \`begin-task\`, \`record-result\`, \`sync-status\`, \`forge-status\`. Pass \`--plan\` / \`--dir\` file paths; never embed plan/spec text in MCP or chat.
2. **Subagent prompts by reference** — tell workers to read \`agents/implementer.md\`, \`agents/task-reviewer.md\`, and \`constitution.md\` from disk. Do not paste those files into \`Task\` prompts.
3. **Reports on disk** — implementer → \`.superspec/reports/T00X-implementer.md\`; reviewer → \`.superspec/reports/T00X-reviewer.md\`. Coordinators get ≤8 lines back from subagents.
4. **One chat line per task** in the coordinator thread: \`T00X pass abc1234\` or \`T00X fail (retry)\`. Details live in report files and this brief.
5. After each \`record-result\`, run \`coordinator-brief\` (or \`record-result --coordinator\`) to refresh this file before the next dispatch.

## Current position

- **Progress:** ${status.done}/${status.total} done · ${status.blocked} blocked · ${status.inProgress} in progress · complete=${status.complete}
- **Next task:** ${nextLabel}
${status.nextStep ? `- **Note:** ${status.nextStep}` : ""}${priorSection}

## Coordinator reply template

\`\`\`
${next ? coordinatorReplyTemplate(next.id) : status.complete ? "Forge complete → superspec-validate" : "No ready task → check status.md and blocked tasks"}
\`\`\`

## Recent log (newest first, max ${logLimit})

${formatLogTable(log)}
`;
}

export async function writeCoordinatorBrief(input: BuildCoordinatorBriefInput): Promise<string> {
  const paths = coordinatorPaths(input.specDir, input.planPath);
  const body = await buildCoordinatorBrief(input);
  await ensureCoordinatorDirs(input.specDir);
  await writeFile(paths.briefPath, body, "utf8");
  return paths.briefPath;
}

export interface AppendCoordinatorLogInput {
  specDir: string;
  planPath: string;
  entry: CoordinatorLogEntry;
  logLimit?: number;
}

export async function appendCoordinatorLog(input: AppendCoordinatorLogInput): Promise<string> {
  const paths = coordinatorPaths(input.specDir, input.planPath);
  let previous: CoordinatorLogEntry[] = [];
  if (await fileExists(paths.briefPath)) {
    const existing = await readFile(paths.briefPath, "utf8");
    previous = parseLogSection(existing);
  }
  const logLimit = input.logLimit ?? DEFAULT_LOG_LIMIT;
  const log = [input.entry, ...previous.filter((e) => e.taskId !== input.entry.taskId)].slice(0, logLimit);
  return writeCoordinatorBrief({
    specDir: input.specDir,
    planPath: input.planPath,
    logLimit,
    previousLog: log,
  });
}

export async function readCoordinatorBriefText(specDir: string): Promise<string> {
  const paths = coordinatorPaths(specDir);
  return readFile(paths.briefPath, "utf8");
}
