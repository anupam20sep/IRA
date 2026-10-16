import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { parsePlan } from "../plan-parser.js";
import { discoverPersonas } from "../persona-discovery.js";
import { resolveRepositoryRoot } from "./paths.js";
import {
  AutonomySettingsSchema,
  BriefSchema,
  HiveLedgerSchema,
  IraEventSchema,
  RosterAgentSchema,
  featureIdSchema,
} from "./schema.js";
import { AGENT_HOST_ID, ensurePlaceholderRoster } from "./roster.js";
import { EVENT_LOCK_WAIT_MS, LEDGER_LOCK_WAIT_MS, appendJsonlLine, withLock, writeJsonAtomic } from "./store.js";
import type { Brief, CommandPlaneErrorCode, HiveLedger, HiveTask, IraEvent, RosterAgent } from "./types.js";

export type BriefSubmitInput = {
  cwd?: string;
  featureId: string;
  outcome: string;
  constraints?: string[];
  budgetTokens?: number | null;
  budgetUsd?: number | null;
  deliverable: string;
};

export type BriefSubmitResult =
  | {
      ok: true;
      brief: Brief;
      tasks: HiveTask[];
      assignment: { taskId: string; agentId: string } | null;
    }
  | { ok: false; error: CommandPlaneErrorCode; message: string };

/** Pick an idle agent for the task; empty roster falls back to agent-host. */
export function pickFirstAssignment(
  roster: RosterAgent[],
  taskId: string,
  task: { capabilityTags?: string[] } = {},
): { taskId: string; agentId: string } | null {
  const tags = task.capabilityTags ?? [];
  if (roster.length === 0) {
    return { taskId, agentId: AGENT_HOST_ID };
  }
  const agentId = matchIdleAgent(roster, tags);
  if (!agentId) return null;
  return { taskId, agentId };
}

export async function briefSubmit(input: BriefSubmitInput): Promise<BriefSubmitResult> {
  const cwd = input.cwd ?? process.cwd();
  if (!featureIdSchema.safeParse(input.featureId).success) {
    return { ok: false, error: "INVALID_INPUT", message: "Invalid featureId." };
  }

  const resolved = resolveRepositoryRoot(cwd);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, message: "Could not resolve repository root." };
  }

  const { repositoryRoot, hiveRoot } = resolved;
  const hive = await readHive(hiveRoot);
  if (!hive.ok) return hive;

  const specDirAbs = join(repositoryRoot, "specs", input.featureId);
  const planPathAbs = join(specDirAbs, "plan.md");
  let planText: string;
  try {
    planText = await readFile(planPathAbs, "utf8");
  } catch {
    return { ok: false, error: "FEATURE_NOT_FOUND", message: "Feature plan is missing." };
  }

  const planTasks = dedupePlan(parsePlan(planText));
  if (planTasks.length === 0) {
    return { ok: false, error: "INVALID_INPUT", message: "Plan has no tasks." };
  }

  const ceiling = await readCeiling(hiveRoot, input.featureId);
  if (!ceiling.ok) {
    return { ok: false, error: "HIVE_CORRUPT", message: ceiling.message };
  }

  const personaPath = await resolveImplementerPersonaPath(repositoryRoot);
  const now = new Date().toISOString();
  const briefPath = join(hiveRoot, "briefs", `${input.featureId}.json`);
  const existingBrief = await readBrief(briefPath);
  const briefId = existingBrief?.id ?? `brief_${randomUUID()}`;
  const createdAt = existingBrief?.createdAt ?? now;

  const brief: Brief = {
    id: briefId,
    featureId: input.featureId,
    outcome: input.outcome,
    constraints: input.constraints ?? [],
    budgetTokens: input.budgetTokens ?? null,
    budgetUsd: input.budgetUsd ?? null,
    deliverable: input.deliverable,
    createdAt,
    updatedAt: now,
    createdBy: "operator",
  };
  const briefParsed = BriefSchema.safeParse(brief);
  if (!briefParsed.success) {
    return { ok: false, error: "INVALID_INPUT", message: "Brief fields are invalid." };
  }

  const ledgerPath = join(hiveRoot, "ledger", `${input.featureId}.json`);
  const ledgerLock = join(hiveRoot, "locks", `ledger-${input.featureId}.lock`);
  const planPath = repoRelative(repositoryRoot, planPathAbs);
  const specDir = repoRelative(repositoryRoot, specDirAbs);

  const locked = await withLock(ledgerLock, { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    let roster = await readRoster(hiveRoot);
    const placeholder = ensurePlaceholderRoster(roster, personaPath);
    roster = placeholder.roster;

    const tasks = staffTasksFromPlan({
      featureId: input.featureId,
      planTasks,
      ceiling: ceiling.ceiling,
      planPath,
      specDir,
      now,
    });

    const assignTask = firstBriefAssignableTask(tasks);
    const assignment = assignTask
      ? pickFirstAssignment(roster, assignTask.id, { capabilityTags: assignTask.capabilityTags })
      : null;

    if (assignment) {
      const row = tasks.find((t) => t.id === assignment.taskId);
      if (row) row.assigneeAgentId = assignment.agentId;
    }

    const ledger: HiveLedger = {
      featureId: input.featureId,
      planPath,
      specDir,
      maxReviewFailures: ceiling.ceiling,
      updatedAt: now,
      tasks,
    };
    const ledgerParsed = HiveLedgerSchema.safeParse(ledger);
    if (!ledgerParsed.success) {
      return { ok: false as const, error: "HIVE_CORRUPT" as const, message: "Ledger staffing failed validation." };
    }

    const rosterParsed = RosterAgentSchema.array().safeParse(roster);
    if (!rosterParsed.success) {
      return { ok: false as const, error: "HIVE_CORRUPT" as const, message: "Roster update failed validation." };
    }

    await writeJsonAtomic(briefPath, briefParsed.data);
    if (placeholder.inserted) {
      await writeJsonAtomic(join(hiveRoot, "roster.json"), rosterParsed.data);
    }
    await writeJsonAtomic(ledgerPath, ledgerParsed.data);

    return {
      ok: true as const,
      brief: briefParsed.data,
      tasks: ledgerParsed.data.tasks,
      assignment,
      placeholderInserted: placeholder.inserted,
    };
  });

  if (!locked.ok) {
    return { ok: false, error: locked.code, message: "Ledger lock is busy." };
  }
  if (!locked.value.ok) {
    return { ok: false, error: locked.value.error, message: locked.value.message };
  }

  await appendBriefEvents(hiveRoot, input.featureId, locked.value.brief.id, locked.value.assignment, locked.value.tasks);

  return {
    ok: true,
    brief: locked.value.brief,
    tasks: locked.value.tasks,
    assignment: locked.value.assignment,
  };
}

function matchIdleAgent(roster: RosterAgent[], capabilityTags: string[]): string | null {
  const idle = roster.filter((agent) => agent.status === "idle");
  if (idle.length === 0) return null;
  if (capabilityTags.length === 0) return idle[0].id;
  for (const agent of idle) {
    if (agent.capabilityTags.some((tag) => capabilityTags.includes(tag))) return agent.id;
  }
  return null;
}

function firstBriefAssignableTask(tasks: HiveTask[]): HiveTask | null {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    if (task.kind === "code" && task.implementsFr.length === 0) continue;
    if (task.hold || task.drift === "removed") continue;
    const ready = task.dependsOn.every((depId) => byId.get(depId)?.status === "done");
    if (ready) return task;
  }
  return null;
}

function staffTasksFromPlan(input: {
  featureId: string;
  planTasks: ReturnType<typeof parsePlan>;
  ceiling: number;
  planPath: string;
  specDir: string;
  now: string;
}): HiveTask[] {
  return input.planTasks.map((planTask) => ({
    id: planTask.id,
    featureId: input.featureId,
    title: planTask.title,
    implementsFr: [...planTask.frRefs],
    dependsOn: [...planTask.dependsOn],
    assigneeAgentId: null,
    status: "todo" as const,
    kind: planTask.kind,
    complexity: planTask.complexity,
    reviewFailures: 0,
    hold: false,
    ceiling: input.ceiling,
    drift: "added" as const,
    capabilityTags: [],
    updatedAt: input.now,
  }));
}

async function resolveImplementerPersonaPath(repositoryRoot: string): Promise<string | null> {
  try {
    const personas = await discoverPersonas({ projectRoot: repositoryRoot, includeDefaults: false });
    const implementer = personas.find((p) => p.name === "implementer");
    return implementer?.path ?? null;
  } catch {
    return null;
  }
}

async function readBrief(path: string): Promise<Brief | null> {
  try {
    const parsed = BriefSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

async function readRoster(hiveRoot: string): Promise<RosterAgent[]> {
  try {
    const parsed = RosterAgentSchema.array().safeParse(
      JSON.parse(await readFile(join(hiveRoot, "roster.json"), "utf8")),
    );
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

async function readHive(hiveRoot: string): Promise<{ ok: true } | { ok: false; error: CommandPlaneErrorCode; message: string }> {
  try {
    const value: unknown = JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8"));
    const version =
      value && typeof value === "object" ? (value as { schemaVersion?: unknown }).schemaVersion : undefined;
    if (version === 1) return { ok: true };
    if (typeof version === "number") {
      return { ok: false, error: "HIVE_SCHEMA_MISMATCH", message: "Hive schema version is not supported." };
    }
    return { ok: false, error: "HIVE_CORRUPT", message: "Hive manifest is unreadable." };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: "HIVE_NOT_INITIALIZED", message: "Hive is not initialized." };
    }
    return { ok: false, error: "HIVE_CORRUPT", message: "Hive manifest is unreadable." };
  }
}

async function readCeiling(
  hiveRoot: string,
  featureId: string,
): Promise<{ ok: true; ceiling: number } | { ok: false; message: string }> {
  try {
    const parsed = AutonomySettingsSchema.safeParse(
      JSON.parse(await readFile(join(hiveRoot, "settings.json"), "utf8")),
    );
    if (!parsed.success) return { ok: false, message: "Settings JSON is unreadable." };
    return { ok: true, ceiling: parsed.data.featureCeilings[featureId] ?? parsed.data.maxReviewFailures };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, ceiling: 3 };
    return { ok: false, message: "Settings JSON is unreadable." };
  }
}

async function appendBriefEvents(
  hiveRoot: string,
  featureId: string,
  briefId: string,
  assignment: { taskId: string; agentId: string } | null,
  tasks: HiveTask[],
): Promise<void> {
  await appendEvent(hiveRoot, featureId, "brief.submitted", { briefId, featureId });
  for (const task of tasks) {
    await appendEvent(hiveRoot, featureId, "task.upserted", { taskId: task.id, drift: task.drift });
  }
  if (assignment) {
    await appendEvent(hiveRoot, featureId, "task.assigned", {
      taskId: assignment.taskId,
      agentId: assignment.agentId,
    });
  }
}

async function appendEvent(
  hiveRoot: string,
  featureId: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  const file = join(hiveRoot, "events", "events.jsonl");
  const event: IraEvent = {
    id: `evt_${randomUUID()}`,
    type,
    version: 1,
    ts: new Date().toISOString(),
    featureId: featureIdSchema.safeParse(featureId).success ? featureId : null,
    actor: { kind: "ira", id: "ira" },
    data,
  };
  const parsed = IraEventSchema.safeParse(event);
  if (!parsed.success) return;
  await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
    appendJsonlLine(file, parsed.data),
  );
}

function repoRelative(root: string, absPath: string): string {
  return relative(resolve(root), absPath).split(sep).join("/");
}

function dedupePlan(tasks: ReturnType<typeof parsePlan>): ReturnType<typeof parsePlan> {
  const seen = new Set<string>();
  const unique: ReturnType<typeof parsePlan> = [];
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    unique.push(task);
  }
  return unique;
}
