import { readFile, readdir, realpath } from "node:fs/promises";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { computeReadiness } from "../client/dag.js";
import { runSuperspec, type RunSuperspecResult } from "./cli.js";
import type {
  AutonomyMode,
  AutonomySlice,
  BoardSnapshot,
  Brief,
  DoctorFinding,
  DoctorSlice,
  HiveTaskStatus,
  IraPersona,
  RosterAgentOrigin,
  RosterAgentStatus,
  SnapshotAgent,
  SnapshotAskMe,
  SnapshotEvent,
  SnapshotEventActor,
  SnapshotFeature,
  SnapshotTask,
  TaskComplexity,
  TaskCounts,
  TaskDrift,
  TaskKind,
  WorktreePolicy,
} from "../shared/snapshot-types.js";

/** Read-only CLI calls. Steer and brief-submit use a longer timeout elsewhere. */
const READ_TIMEOUT_MS = 10_000;
const EVENT_WINDOW = 200;

const FEATURE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const IRA_PERSONA: IraPersona = {
  callsign: "Ira",
  expansion: "Intelligent Resource Automation",
};

const TASK_STATUS = new Set<HiveTaskStatus>(["todo", "doing", "blocked", "done"]);
const TASK_KIND = new Set<TaskKind>(["code", "verify", "provision", "signoff", "doc-sync"]);
const TASK_COMPLEXITY = new Set<TaskComplexity>(["mechanical", "moderate", "complex"]);
const TASK_DRIFT = new Set<TaskDrift>(["ok", "added", "removed", "changed"]);
const AGENT_STATUS = new Set<RosterAgentStatus>(["idle", "busy", "blocked", "offline"]);
const AGENT_ORIGIN = new Set<RosterAgentOrigin>(["placeholder", "hire", "manual"]);
const WORKTREE = new Set<WorktreePolicy>(["isolated", "shared"]);
const AUTONOMY = new Set<AutonomyMode>(["observe", "supervised", "autonomous"]);
const ACTOR_KIND = new Set<SnapshotEventActor["kind"]>(["ira", "operator", "worker", "system"]);
const ASK_REASON = new Set<SnapshotAskMe["reasonClass"]>([
  "budget_exceed",
  "destructive_git",
  "constitution_violation",
  "spec_scope_change",
  "untrusted_import",
  "repeated_review_failure",
  "ambiguous_requirement",
]);

export type PatternsDirState = "empty" | "unavailable" | "files-no-query";

export type SnapshotContext = {
  repositoryRoot: string;
  hiveRoot?: string;
  eventsBefore?: string;
  eventLimit?: number;
};

type JsonRecord = Record<string, unknown>;

type FeatureSummary = {
  featureId: string;
  taskCounts: TaskCounts;
  openAskMe: number;
};

/**
 * Presence probe for `<repo>/.superspec/patterns`.
 * Missing or no `*.md` files is `empty`. Markdown on disk is `files-no-query`
 * (names only; file bytes and sqlite stay unread). Unreadable or escaped paths
 * are `unavailable`.
 */
export function detectPatternsDirState(repoRoot: string): PatternsDirState {
  const root = resolve(repoRoot);
  const patterns = join(root, ".superspec", "patterns");
  let info;
  try {
    info = statSync(patterns);
  } catch (err) {
    return errno(err) === "ENOENT" ? "empty" : "unavailable";
  }
  if (!info.isDirectory()) return "unavailable";

  let realRoot: string;
  let realPatterns: string;
  try {
    realRoot = realpathSync(root);
    realPatterns = realpathSync(patterns);
  } catch {
    return "unavailable";
  }
  if (!isInside(realRoot, realPatterns)) return "unavailable";

  try {
    return containsMarkdown(realPatterns, realPatterns) ? "files-no-query" : "empty";
  } catch {
    return "unavailable";
  }
}

/**
 * Board projection from read-only Plane commands plus ledger and event files.
 * Spend is omitted: P-004 has no query, so totals are absent rather than zero.
 * `stale` follows `hiveReady` (and a failed doctor or hive-status call).
 * `engineRungReady` is copied separately and does not blank coordination fields.
 */
export async function buildSnapshot(ctx: SnapshotContext): Promise<BoardSnapshot> {
  const repositoryRoot = resolve(ctx.repositoryRoot);
  const opts = { cwd: repositoryRoot, timeoutMs: READ_TIMEOUT_MS };
  const [doctorResult, hiveResult, rosterResult, askResult, autonomyResult] = await Promise.all([
    runSuperspec(["doctor", "--cwd", repositoryRoot], opts),
    runSuperspec(["hive", "status", "--cwd", repositoryRoot], opts),
    runSuperspec(["roster", "list", "--cwd", repositoryRoot], opts),
    runSuperspec(["ask-me", "list", "--state", "open", "--cwd", repositoryRoot], opts),
    runSuperspec(["autonomy", "show", "--cwd", repositoryRoot], opts),
  ]);

  const doctorBody = cliBody(doctorResult);
  const hiveBody = cliBody(hiveResult);
  const doctor = toDoctor(doctorBody);
  const hiveRoot = resolveHiveRoot(ctx.hiveRoot, hiveBody, doctorBody, repositoryRoot);
  const hiveStatusFailed = hiveBody === null;
  const listed = hiveBody ? featureSummaries(hiveBody) : await ledgerFeatureIds(hiveRoot);
  const [tasksByFeature, briefs, events] = await Promise.all([
    readFeatureTasks(hiveRoot, listed),
    readBriefs(repositoryRoot, listed, opts),
    readEventTail(hiveRoot, ctx.eventsBefore, ctx.eventLimit),
  ]);

  const askMe = toAskMe(cliBody(askResult));
  const summaries = hiveStatusFailed ? countsFromFiles(listed, tasksByFeature, askMe) : listed;
  const tasks = summaries.flatMap((feature) => tasksByFeature.get(feature.featureId) ?? []);
  const roster = toAgents(cliBody(rosterResult), tasks);
  const features = summaries.map((feature) =>
    toFeature(feature, tasksByFeature.get(feature.featureId) ?? [], briefs.get(feature.featureId) ?? null),
  );

  const stale = !doctor.ok || !doctor.hiveReady || hiveStatusFailed;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    stale,
    repositoryRoot,
    hiveRoot,
    persona: personaFrom(doctorBody, hiveBody, cliBody(autonomyResult)),
    doctor,
    autonomy: toAutonomy(cliBody(autonomyResult), hiveBody),
    features,
    agents: roster,
    askMe,
    events,
  };
}

function toFeature(summary: FeatureSummary, tasks: SnapshotTask[], brief: Brief | null): SnapshotFeature {
  return {
    featureId: summary.featureId,
    taskCounts: summary.taskCounts,
    openAskMe: summary.openAskMe,
    tasks,
    brief,
  };
}

function toDoctor(body: JsonRecord | null): DoctorSlice {
  if (!body) {
    return { ok: false, hiveReady: false, engineRungReady: false, ready: false, findings: [] };
  }
  const hiveReady = body.hiveReady === true;
  return {
    ok: true,
    hiveReady,
    engineRungReady: body.engineRungReady === true,
    ready: hiveReady,
    findings: toFindings(body.findings),
  };
}

function toFindings(value: unknown): DoctorFinding[] {
  if (!Array.isArray(value)) return [];
  const findings: DoctorFinding[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    if (!rec || typeof rec.code !== "string" || typeof rec.message !== "string") continue;
    if (rec.severity !== "error" && rec.severity !== "warning" && rec.severity !== "info") continue;
    const finding: DoctorFinding = { code: rec.code, severity: rec.severity, message: rec.message };
    if (typeof rec.remedy === "string") finding.remedy = rec.remedy;
    findings.push(finding);
  }
  return findings;
}

function toAutonomy(body: JsonRecord | null, hiveBody: JsonRecord | null): AutonomySlice {
  const settings = body ? asRecord(body.settings) : null;
  const mode = autonomyMode(settings?.autonomy) ?? autonomyMode(hiveBody?.autonomy) ?? "supervised";
  const awayMode =
    typeof settings?.awayMode === "boolean" ? settings.awayMode : hiveBody?.awayMode === true;
  const poll = settings?.pollIntervalMs;
  const pollIntervalMs = typeof poll === "number" && Number.isFinite(poll) ? poll : 60_000;
  return { autonomy: mode, awayMode, pollIntervalMs };
}

function featureSummaries(body: JsonRecord): FeatureSummary[] {
  if (!Array.isArray(body.features)) return [];
  const summaries: FeatureSummary[] = [];
  for (const item of body.features) {
    const rec = asRecord(item);
    if (!rec || typeof rec.featureId !== "string" || !FEATURE_ID.test(rec.featureId)) continue;
    summaries.push({
      featureId: rec.featureId,
      taskCounts: toCounts(rec.taskCounts),
      openAskMe: typeof rec.openAskMe === "number" && Number.isFinite(rec.openAskMe) ? rec.openAskMe : 0,
    });
  }
  return summaries;
}

async function ledgerFeatureIds(hiveRoot: string): Promise<FeatureSummary[]> {
  const dir = resolveUnder(hiveRoot, "ledger");
  if (!dir) return [];
  const realDir = await realInside(hiveRoot, dir);
  if (!realDir) return [];
  let names: string[];
  try {
    names = await readdir(realDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter((featureId) => FEATURE_ID.test(featureId))
    .sort()
    .map((featureId) => ({
      featureId,
      taskCounts: { todo: 0, doing: 0, blocked: 0, done: 0 },
      openAskMe: 0,
    }));
}

async function readFeatureTasks(
  hiveRoot: string,
  summaries: FeatureSummary[],
): Promise<Map<string, SnapshotTask[]>> {
  const entries = await Promise.all(
    summaries.map(async (summary) => [summary.featureId, await readLedgerTasks(hiveRoot, summary.featureId)] as const),
  );
  return new Map(entries);
}

async function readLedgerTasks(hiveRoot: string, featureId: string): Promise<SnapshotTask[]> {
  if (!FEATURE_ID.test(featureId)) return [];
  const path = resolveUnder(hiveRoot, "ledger", `${featureId}.json`);
  if (!path) return [];
  const real = await realInside(hiveRoot, path);
  if (!real) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(real, "utf8"));
  } catch {
    return [];
  }
  const body = asRecord(parsed);
  if (!body || !Array.isArray(body.tasks)) return [];
  const drafts: SnapshotTask[] = [];
  for (const item of body.tasks) {
    const task = toTask(item, featureId);
    if (task) drafts.push(task);
  }
  const byId = new Map(drafts.map((task) => [task.id, task]));
  return drafts.map((task) => ({ ...task, readiness: computeReadiness(task, byId) }));
}

function toTask(value: unknown, featureId: string): SnapshotTask | null {
  const rec = asRecord(value);
  if (!rec || typeof rec.id !== "string" || rec.id.length === 0) return null;
  if (typeof rec.title !== "string" || rec.title.length === 0) return null;
  if (!isEnum(rec.status, TASK_STATUS)) return null;
  if (!isEnum(rec.kind, TASK_KIND)) return null;
  if (!isEnum(rec.complexity, TASK_COMPLEXITY)) return null;
  if (!isEnum(rec.drift, TASK_DRIFT)) return null;
  const implementsFr = stringArray(rec.implementsFr);
  const dependsOn = stringArray(rec.dependsOn);
  const capabilityTags = stringArray(rec.capabilityTags);
  if (!implementsFr || !dependsOn || !capabilityTags) return null;
  if (typeof rec.updatedAt !== "string" || rec.updatedAt.length === 0) return null;
  if (typeof rec.reviewFailures !== "number" || typeof rec.ceiling !== "number") return null;
  const taskFeature = typeof rec.featureId === "string" && FEATURE_ID.test(rec.featureId) ? rec.featureId : featureId;
  const assignee = assigneeId(rec.assigneeAgentId);

  const task: SnapshotTask = {
    id: rec.id,
    featureId: taskFeature,
    title: rec.title,
    implementsFr,
    dependsOn,
    assigneeAgentId: assignee,
    status: rec.status,
    kind: rec.kind,
    complexity: rec.complexity,
    reviewFailures: rec.reviewFailures,
    ceiling: rec.ceiling,
    drift: rec.drift,
    capabilityTags,
    updatedAt: rec.updatedAt,
    readiness: "waiting",
  };
  if (typeof rec.hold === "boolean") task.hold = rec.hold;
  if (typeof rec.abortReason === "string" || rec.abortReason === null) task.abortReason = rec.abortReason;
  if (typeof rec.resultRef === "string" || rec.resultRef === null) task.resultRef = rec.resultRef;
  if (typeof rec.blockedByAskMeId === "string" || rec.blockedByAskMeId === null) {
    task.blockedByAskMeId = rec.blockedByAskMeId;
  }
  return task;
}

async function readBriefs(
  repositoryRoot: string,
  summaries: FeatureSummary[],
  opts: { cwd: string; timeoutMs: number },
): Promise<Map<string, Brief | null>> {
  const entries = await Promise.all(
    summaries.map(async (summary) => {
      const result = await runSuperspec(
        ["brief", "show", "--feature", summary.featureId, "--cwd", repositoryRoot],
        opts,
      );
      return [summary.featureId, toBrief(cliBody(result), summary.featureId)] as const;
    }),
  );
  return new Map(entries);
}

function toBrief(body: JsonRecord | null, featureId: string): Brief | null {
  const rec = body ? asRecord(body.brief) : null;
  if (!rec) return null;
  if (typeof rec.id !== "string" || rec.featureId !== featureId) return null;
  if (typeof rec.outcome !== "string" || typeof rec.deliverable !== "string") return null;
  if (typeof rec.createdAt !== "string" || typeof rec.updatedAt !== "string") return null;
  if (rec.createdBy !== "operator") return null;
  const constraints = stringArray(rec.constraints);
  if (!constraints) return null;
  const budgetTokens = money(rec.budgetTokens);
  const budgetUsd = money(rec.budgetUsd);
  if (budgetTokens === undefined || budgetUsd === undefined) return null;
  return {
    id: rec.id,
    featureId,
    outcome: rec.outcome,
    constraints,
    budgetTokens,
    budgetUsd,
    deliverable: rec.deliverable,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    createdBy: "operator",
  };
}

function toAgents(body: JsonRecord | null, tasks: SnapshotTask[]): SnapshotAgent[] {
  if (!body || !Array.isArray(body.agents)) return [];
  const agents: SnapshotAgent[] = [];
  for (const item of body.agents) {
    const agent = toAgent(item, tasks);
    if (agent) agents.push(agent);
  }
  return agents;
}

function toAgent(value: unknown, tasks: SnapshotTask[]): SnapshotAgent | null {
  const rec = asRecord(value);
  if (!rec || typeof rec.id !== "string" || !AGENT_ID.test(rec.id)) return null;
  if (typeof rec.name !== "string" || rec.name.length === 0) return null;
  if (!isEnum(rec.status, AGENT_STATUS)) return null;
  if (!isEnum(rec.origin, AGENT_ORIGIN)) return null;
  if (!isEnum(rec.worktreePolicy, WORKTREE)) return null;
  const capabilityTags = stringArray(rec.capabilityTags);
  if (!capabilityTags) return null;
  const agent: SnapshotAgent = {
    id: rec.id,
    name: rec.name,
    personaPath: rec.personaPath === null || typeof rec.personaPath === "string" ? (rec.personaPath ?? null) : null,
    capabilityTags,
    engine: rec.engine === null || typeof rec.engine === "string" ? (rec.engine ?? null) : null,
    model: rec.model === null || typeof rec.model === "string" ? (rec.model ?? null) : null,
    workspace: rec.workspace === null || typeof rec.workspace === "string" ? (rec.workspace ?? null) : null,
    worktreePolicy: rec.worktreePolicy,
    status: rec.status,
    origin: rec.origin,
    currentTaskId: currentTaskFor(rec.id, tasks),
  };
  if (typeof rec.contextUsedRatio === "number" && inUnitInterval(rec.contextUsedRatio)) {
    agent.contextUsedRatio = rec.contextUsedRatio;
  }
  const allowedSkills = stringArray(rec.allowedSkills);
  const allowedMcp = stringArray(rec.allowedMcp);
  if (allowedSkills) agent.allowedSkills = allowedSkills;
  if (allowedMcp) agent.allowedMcp = allowedMcp;
  if (rec.featureId === null || (typeof rec.featureId === "string" && FEATURE_ID.test(rec.featureId))) {
    if ("featureId" in rec) agent.featureId = rec.featureId as string | null;
  }
  return agent;
}

function currentTaskFor(agentId: string, tasks: SnapshotTask[]): string | null {
  const doing = tasks
    .filter((task) => task.status === "doing" && task.assigneeAgentId === agentId)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return doing.at(-1)?.id ?? null;
}

function toAskMe(body: JsonRecord | null): SnapshotAskMe[] {
  if (!body || !Array.isArray(body.items)) return [];
  const items: SnapshotAskMe[] = [];
  for (const item of body.items) {
    const parsed = toAskMeItem(item);
    if (parsed) items.push(parsed);
  }
  return items;
}

function toAskMeItem(value: unknown): SnapshotAskMe | null {
  const rec = asRecord(value);
  if (!rec || typeof rec.id !== "string" || typeof rec.question !== "string") return null;
  if (!isEnum(rec.reasonClass, ASK_REASON)) return null;
  if (rec.state !== "open" && rec.state !== "resolved") return null;
  if (typeof rec.createdAt !== "string" || typeof rec.ageSeconds !== "number") return null;
  if (rec.answer !== null && typeof rec.answer !== "string") return null;
  if (rec.action !== null && rec.action !== "retry" && rec.action !== "keep_blocked" && rec.action !== "acknowledge") {
    return null;
  }
  if (rec.resolvedAt !== null && typeof rec.resolvedAt !== "string") return null;
  const featureId = idOrNull(rec.featureId, FEATURE_ID);
  const agentId = idOrNull(rec.agentId, AGENT_ID);
  if (featureId === undefined || agentId === undefined) return null;
  if (rec.taskId !== null && typeof rec.taskId !== "string") return null;
  return {
    id: rec.id,
    featureId,
    taskId: rec.taskId === null ? null : rec.taskId,
    agentId,
    reasonClass: rec.reasonClass,
    question: rec.question,
    answer: rec.answer,
    action: rec.action,
    state: rec.state,
    createdAt: rec.createdAt,
    resolvedAt: rec.resolvedAt,
    ageSeconds: rec.ageSeconds,
  };
}

async function readEventTail(hiveRoot: string, eventsBefore: string | undefined, eventLimit: number | undefined): Promise<SnapshotEvent[]> {
  const path = resolveUnder(hiveRoot, "events", "events.jsonl");
  if (!path) return [];
  const real = await realInside(hiveRoot, path);
  if (!real) return [];
  let text: string;
  try {
    text = await readFile(real, "utf8");
  } catch {
    return [];
  }
  const events: SnapshotEvent[] = [];
  for (const line of text.split("\n")) {
    const event = toEvent(line);
    if (event) events.push(event);
  }
  return pageEvents(events, eventsBefore, eventLimit);
}

function toEvent(line: string): SnapshotEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const rec = asRecord(raw);
  if (!rec || typeof rec.id !== "string" || rec.id.length === 0) return null;
  if (typeof rec.type !== "string" || rec.type.length === 0) return null;
  if (rec.version !== 1 || typeof rec.ts !== "string") return null;
  const actor = asRecord(rec.actor);
  if (!actor || !isEnum(actor.kind, ACTOR_KIND) || typeof actor.id !== "string" || actor.id.length === 0) return null;
  if (rec.featureId !== null && typeof rec.featureId !== "string") return null;
  const data = asRecord(rec.data);
  if (!data) return null;
  return {
    id: rec.id,
    type: rec.type,
    version: 1,
    ts: rec.ts,
    featureId: rec.featureId,
    actor: { kind: actor.kind, id: actor.id },
    data,
  };
}

function pageEvents(events: SnapshotEvent[], eventsBefore: string | undefined, eventLimit: number | undefined): SnapshotEvent[] {
  const limit = normalizeLimit(eventLimit);
  if (eventsBefore === undefined) return events.slice(-limit);
  const index = events.findIndex((event) => event.id === eventsBefore);
  if (index <= 0) return [];
  return events.slice(Math.max(0, index - limit), index);
}

function containsMarkdown(dir: string, fence: string): boolean {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      if (symlinkedHasMarkdown(path, fence)) return true;
      continue;
    }
    if (entry.isDirectory()) {
      if (containsMarkdown(path, fence)) return true;
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) return true;
  }
  return false;
}

function symlinkedHasMarkdown(path: string, fence: string): boolean {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return false;
  }
  if (!isInside(fence, real)) return false;
  const info = statSync(real);
  if (info.isDirectory()) return containsMarkdown(real, fence);
  return info.isFile() && path.endsWith(".md");
}

function resolveHiveRoot(
  explicit: string | undefined,
  hiveBody: JsonRecord | null,
  doctorBody: JsonRecord | null,
  repositoryRoot: string,
): string {
  const raw = [explicit, hiveBody?.hiveRoot, doctorBody?.hiveRoot].find(
    (value) => typeof value === "string" && value.length > 0 && !value.includes("\0"),
  );
  if (typeof raw !== "string") return join(repositoryRoot, ".superspec", "hive");
  return isAbsolute(raw) ? resolve(raw) : resolve(repositoryRoot, raw);
}

async function realInside(root: string, path: string): Promise<string | null> {
  try {
    const realRoot = await realpath(root);
    const realPath = await realpath(path);
    return isInside(realRoot, realPath) ? realPath : null;
  } catch {
    return null;
  }
}

function resolveUnder(root: string, ...segments: string[]): string | null {
  if (segments.some((segment) => segment.includes("\0") || segment.includes("/") || segment.includes("\\"))) {
    return null;
  }
  const base = resolve(root);
  const target = resolve(base, ...segments);
  return isInside(base, target) ? target : null;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function cliBody(result: RunSuperspecResult): JsonRecord | null {
  if (!result.ok) return null;
  const body = asRecord(result.json);
  if (!body || body.ok !== true) return null;
  return body;
}

function personaFrom(...bodies: Array<JsonRecord | null>): IraPersona {
  for (const body of bodies) {
    const persona = body ? asRecord(body.persona) : null;
    if (persona?.callsign === "Ira" && persona.expansion === "Intelligent Resource Automation") {
      return IRA_PERSONA;
    }
  }
  return IRA_PERSONA;
}

function countsFromFiles(
  summaries: FeatureSummary[],
  tasksByFeature: Map<string, SnapshotTask[]>,
  askMe: SnapshotAskMe[],
): FeatureSummary[] {
  return summaries.map((summary) => {
    const tasks = tasksByFeature.get(summary.featureId) ?? [];
    return {
      featureId: summary.featureId,
      taskCounts: countsFromTasks(tasks),
      openAskMe: askMe.filter((item) => item.featureId === summary.featureId && item.state === "open").length,
    };
  });
}

function countsFromTasks(tasks: SnapshotTask[]): TaskCounts {
  const counts: TaskCounts = { todo: 0, doing: 0, blocked: 0, done: 0 };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

function toCounts(value: unknown): TaskCounts {
  const rec = asRecord(value);
  const count = (key: keyof TaskCounts): number => {
    const n = rec?.[key];
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  };
  return { todo: count("todo"), doing: count("doing"), blocked: count("blocked"), done: count("done") };
}

function autonomyMode(value: unknown): AutonomyMode | null {
  return isEnum(value, AUTONOMY) ? value : null;
}

function money(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return undefined;
}

function assigneeId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string" && AGENT_ID.test(value)) return value;
  return null;
}

function idOrNull(value: unknown, pattern: RegExp): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && pattern.test(value)) return value;
  return undefined;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value;
}

function inUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) return EVENT_WINDOW;
  return Math.min(Math.floor(limit), EVENT_WINDOW);
}

function asRecord(value: unknown): JsonRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function isEnum<T extends string>(value: unknown, allowed: Set<T>): value is T {
  return typeof value === "string" && allowed.has(value as T);
}

function errno(err: unknown): string | undefined {
  return err !== null && typeof err === "object" && "code" in err && typeof err.code === "string" ? err.code : undefined;
}
