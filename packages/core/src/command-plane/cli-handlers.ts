import { access, readFile, readdir } from "node:fs/promises";
import { constants, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { forgeStatus, initState, loadState } from "../forge-loop.js";
import { parsePlan } from "../plan-parser.js";
import { answerAskMe, listAskMe } from "./ask-me.js";
import { awaySet, awayTick } from "./away.js";
import { hiveCiSet } from "./blackboard.js";
import { briefSubmit } from "./brief.js";
import { dispatchTask, type DispatchTaskResult } from "./dispatch.js";
import { runDoctor } from "./doctor.js";
import { hiveInit } from "./hive-init.js";
import { syncHiveFromForge } from "./ledger-sync.js";
import { mailboxPost, mailboxRead } from "./mailbox.js";
import { personaField } from "./persona.js";
import { resolveRepositoryRoot } from "./paths.js";
import {
  AutonomySettingsSchema,
  BriefSchema,
  HiveLedgerSchema,
  HiveManifestSchema,
  RosterAgentSchema,
  AskMeItemSchema,
  featureIdSchema,
} from "./schema.js";
import { taskAbort, taskHold, taskReassign } from "./task-control.js";
import { appendJsonlLine, writeJsonAtomic } from "./store.js";
import type { CommandPlaneErrorCode } from "./types.js";
export type CommandPlaneCliResult = { code: number; stdout: string };

const CP_ROOT_COMMANDS = new Set([
  "hive",
  "brief",
  "roster",
  "ask-me",
  "autonomy",
  "away",
  "dispatch-task",
  "task",
  "task-hold",
  "task-abort",
  "task-reassign",
  "mailbox",
  "doctor",
]);

export function isCommandPlaneCommand(command: string | undefined): boolean {
  return command !== undefined && CP_ROOT_COMMANDS.has(command);
}

export function commandPlaneHelpSummary(): string {
  return [
    "hive init | status | sync | ci-set",
    "brief submit | show",
    "roster list",
    "ask-me list | show | answer",
    "autonomy show | set",
    "away on | off | status | tick | start | stop",
    "dispatch-task",
    "task hold | abort",
    "task-hold | task-abort | task-reassign",
    "mailbox post | read",
    "doctor",
  ].join(" | ");
}

export async function runCommandPlaneCli(argv: string[]): Promise<CommandPlaneCliResult | null> {
  const [command, ...rest] = argv;
  if (!isCommandPlaneCommand(command)) return null;

  if (hasHelp(rest)) {
    return { code: 0, stdout: helpFor(command, rest) };
  }

  try {
    switch (command) {
      case "hive":
        return await handleHive(rest);
      case "brief":
        return await handleBrief(rest);
      case "roster":
        return await handleRoster(rest);
      case "ask-me":
        return await handleAskMe(rest);
      case "autonomy":
        return await handleAutonomy(rest);
      case "away":
        return await handleAway(rest);
      case "dispatch-task":
        return await handleDispatchTask(rest);
      case "task":
        return await handleTask(rest);
      case "task-hold":
        return await handleTask(["hold", ...rest]);
      case "task-abort":
        return await handleTask(["abort", ...rest]);
      case "task-reassign":
        return await handleTaskReassign(rest);
      case "mailbox":
        return await handleMailbox(rest);
      case "doctor":
        return await handleDoctor(rest);
      default:
        return null;
    }
  } catch (err) {
    return envelopeFail("INVALID_INPUT", err instanceof Error ? err.message : String(err));
  }
}

function hasHelp(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function helpFor(command: string, rest: string[]): string {
  const sub = rest[0] && !rest[0].startsWith("-") ? rest[0] : "";
  const key = sub ? `${command} ${sub}` : command;
  const lines: Record<string, string> = {
    "dispatch-task": "superspec dispatch-task --feature <id> --task <id> [--cwd path]",
    task: "superspec task hold|abort ...",
    "task hold": "superspec task hold --feature <id> --task <id> --hold true|false",
    "task abort": "superspec task abort --feature <id> --task <id> --confirm --reason <text>",
    "task-hold": "superspec task-hold --feature <id> --task <id> --hold true|false [--cwd path]",
    "task-abort": "superspec task-abort --feature <id> --task <id> --confirm true [--reason <text>] [--cwd path]",
    "task-reassign": "superspec task-reassign --feature <id> --task <id> --agent <id> [--cwd path]",
    away: "superspec away on|off|status|tick|start|stop [--allow-absent-ci true|false]",
    "away on": "superspec away on [--interval-ms N] [--allow-absent-ci true|false]",
    doctor: "superspec doctor [--cwd path]",
    hive: "superspec hive init|status|sync|ci-set",
  };
  return lines[key] ?? lines[command] ?? `superspec ${command}`;
}

async function handleHive(rest: string[]): Promise<CommandPlaneCliResult> {
  const [sub, ...args] = rest;
  if (sub === "init") {
    const { values } = parseArgs({
      args,
      options: { cwd: { type: "string" }, repair: { type: "boolean" } },
    });
    const cwd = (values.cwd as string | undefined) ?? process.cwd();
    const result = await hiveInit({ cwd, repair: values.repair === true });
    return envelope(result);
  }
  if (sub === "status") {
    const { values } = parseArgs({
      args,
      options: { cwd: { type: "string" }, feature: { type: "string" } },
    });
    const ctx = await resolveCtx(values.cwd as string | undefined);
    if (!ctx.ok) return envelope(ctx);
    const status = await buildHiveStatus(ctx.hiveRoot, ctx.repositoryRoot, values.feature as string | undefined);
    return envelope(status);
  }
  if (sub === "sync") {
    const { values } = parseArgs({
      args,
      options: {
        cwd: { type: "string" },
        feature: { type: "string" },
        dir: { type: "string" },
        plan: { type: "string" },
      },
    });
    const missing = ["feature", "dir", "plan"].filter((k) => values[k as keyof typeof values] === undefined);
    if (missing.length > 0) {
      return envelopeFail("INVALID_INPUT", `missing required flag --${missing.join(", --")}`);
    }
    const ctx = await resolveCtx(values.cwd as string | undefined);
    if (!ctx.ok) return envelope(ctx);
    const sync = await syncHiveFromForge({
      featureId: values.feature as string,
      repositoryRoot: ctx.repositoryRoot,
      specDir: values.dir as string,
      planPath: values.plan as string,
    });
    if (!sync.ok) return envelope(sync);
    const tasks = parsePlan(await readFile(resolve(ctx.repositoryRoot, values.plan as string), "utf8"));
    const state = (await loadState(resolve(ctx.repositoryRoot, values.dir as string))) ?? initState(tasks);
    return envelope({
      ok: true,
      featureId: sync.featureId,
      upserted: sync.upserted,
      drift: sync.drift,
      forge: forgeStatus(state),
    });
  }
  if (sub === "ci-set") {
    const { values } = parseArgs({
      args,
      options: {
        cwd: { type: "string" },
        feature: { type: "string" },
        state: { type: "string" },
        source: { type: "string", default: "cli" },
      },
    });
    if (!values.feature || !values.state) {
      return envelopeFail("INVALID_INPUT", "missing --feature or --state");
    }
    const state = values.state as string;
    if (state !== "green" && state !== "red" && state !== "absent") {
      return envelopeFail("INVALID_INPUT", "--state must be green, red, or absent");
    }
    const ctx = await resolveCtx(values.cwd as string | undefined);
    if (!ctx.ok) return envelope(ctx);
    const result = await hiveCiSet({
      hiveRoot: ctx.hiveRoot,
      featureId: values.feature as string,
      state,
      source: values.source as string,
    });
    return envelope(result);
  }
  return envelopeFail("INVALID_INPUT", `unknown hive subcommand: ${sub ?? "(none)"}`);
}

async function handleBrief(rest: string[]): Promise<CommandPlaneCliResult> {
  const [sub, ...args] = rest;
  if (sub === "submit") {
    const { values, tokens } = parseArgs({
      args,
      options: {
        cwd: { type: "string" },
        feature: { type: "string" },
        outcome: { type: "string" },
        deliverable: { type: "string" },
        constraint: { type: "string", multiple: true },
        "budget-usd": { type: "string" },
        "budget-tokens": { type: "string" },
      },
    });
    if (!values.feature || !values.outcome || !values.deliverable) {
      return envelopeFail("INVALID_INPUT", "missing --feature, --outcome, or --deliverable");
    }
    const constraints = tokens
      .filter((t) => t.name === "constraint")
      .map((t) => t.value)
      .filter((v): v is string => typeof v === "string");
    const result = await briefSubmit({
      cwd: values.cwd as string | undefined,
      featureId: values.feature as string,
      outcome: values.outcome as string,
      deliverable: values.deliverable as string,
      constraints,
      budgetUsd: parseOptionalNumber(values["budget-usd"] as string | undefined),
      budgetTokens: parseOptionalNumber(values["budget-tokens"] as string | undefined),
    });
    return envelope(result);
  }
  if (sub === "show") {
    const { values } = parseArgs({
      args,
      options: { cwd: { type: "string" }, feature: { type: "string" } },
    });
    if (!values.feature) return envelopeFail("INVALID_INPUT", "missing --feature");
    const ctx = await resolveCtx(values.cwd as string | undefined);
    if (!ctx.ok) return envelope(ctx);
    const briefPath = join(ctx.hiveRoot, "briefs", `${values.feature}.json`);
    try {
      const parsed = BriefSchema.safeParse(JSON.parse(await readFile(briefPath, "utf8")));
      if (!parsed.success) return envelopeFail("HIVE_CORRUPT", "Brief is unreadable.");
      return envelope({ ok: true, brief: parsed.data, persona: personaField() });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return envelopeFail("FEATURE_NOT_FOUND", "Brief not found.");
      }
      return envelopeFail("HIVE_CORRUPT", "Brief is unreadable.");
    }
  }
  return envelopeFail("INVALID_INPUT", `unknown brief subcommand: ${sub ?? "(none)"}`);
}

async function handleRoster(rest: string[]): Promise<CommandPlaneCliResult> {
  const [sub, ...args] = rest;
  if (sub !== "list") return envelopeFail("INVALID_INPUT", `unknown roster subcommand: ${sub ?? "(none)"}`);
  const { values } = parseArgs({ args, options: { cwd: { type: "string" } } });
  const ctx = await resolveCtx(values.cwd as string | undefined);
  if (!ctx.ok) return envelope(ctx);
  try {
    const parsed = RosterAgentSchema.array().safeParse(
      JSON.parse(await readFile(join(ctx.hiveRoot, "roster.json"), "utf8")),
    );
    if (!parsed.success) return envelopeFail("HIVE_CORRUPT", "Roster is unreadable.");
    return envelope({ ok: true, agents: parsed.data });
  } catch {
    return envelopeFail("HIVE_CORRUPT", "Roster is unreadable.");
  }
}

async function handleAskMe(rest: string[]): Promise<CommandPlaneCliResult> {
  const [sub, ...args] = rest;

  if (sub === "list") {
    const { values } = parseArgs({
      args,
      options: { state: { type: "string" }, feature: { type: "string" }, cwd: { type: "string" } },
    });
    const ctx = await resolveCtx(values.cwd as string | undefined);
    if (!ctx.ok) return envelope(ctx);
    const state = values.state as "open" | "resolved" | undefined;
    if (state !== undefined && state !== "open" && state !== "resolved") {
      return envelopeFail("INVALID_INPUT", "--state must be open or resolved");
    }
    const result = await listAskMe({
      hiveRoot: ctx.hiveRoot,
      state,
      featureId: values.feature as string | undefined,
    });
    return envelope(result);
  }
  if (sub === "show") {
    const { values } = parseArgs({
      args,
      options: { id: { type: "string" }, cwd: { type: "string" } },
    });
    const ctx = await resolveCtx(values.cwd as string | undefined);
    if (!ctx.ok) return envelope(ctx);
    if (!values.id) return envelopeFail("INVALID_INPUT", "missing --id");
    const item = await readAskMeItem(ctx.hiveRoot, values.id as string);
    if (!item.ok) return envelope(item);
    return envelope({ ok: true, item: item.item });
  }
  if (sub === "answer") {
    const { values } = parseArgs({
      args,
      options: {
        id: { type: "string" },
        text: { type: "string" },
        action: { type: "string" },
        cwd: { type: "string" },
      },
    });
    const ctx = await resolveCtx(values.cwd as string | undefined);
    if (!ctx.ok) return envelope(ctx);
    if (!values.id || !values.text || !values.action) {
      return envelopeFail("INVALID_INPUT", "missing --id, --text, or --action");
    }
    const action = values.action as string;
    if (action !== "retry" && action !== "keep_blocked" && action !== "acknowledge") {
      return envelopeFail("INVALID_INPUT", "--action must be retry, keep_blocked, or acknowledge");
    }
    const result = await answerAskMe({
      hiveRoot: ctx.hiveRoot,
      id: values.id as string,
      text: values.text as string,
      action,
    });
    return envelope(result);
  }
  return envelopeFail("INVALID_INPUT", `unknown ask-me subcommand: ${sub ?? "(none)"}`);
}

async function handleAutonomy(rest: string[]): Promise<CommandPlaneCliResult> {
  const [sub, ...args] = rest;
  const { values } = parseArgs({
    args,
    options: { cwd: { type: "string" }, mode: { type: "string" } },
  });
  const ctx = await resolveCtx(values.cwd as string | undefined);
  if (!ctx.ok) return envelope(ctx);

  if (sub === "show") {
    const settings = await readSettings(ctx.hiveRoot);
    if (!settings) return envelopeFail("HIVE_CORRUPT", "Settings are unreadable.");
    return envelope({ ok: true, settings, persona: personaField() });
  }
  if (sub === "set") {
    const mode = values.mode as string | undefined;
    if (mode !== "observe" && mode !== "supervised" && mode !== "autonomous") {
      return envelopeFail("INVALID_INPUT", "--mode must be observe, supervised, or autonomous");
    }
    const current = await readSettings(ctx.hiveRoot);
    if (!current) return envelopeFail("HIVE_CORRUPT", "Settings are unreadable.");
    const next = AutonomySettingsSchema.safeParse({
      ...current,
      autonomy: mode,
      updatedAt: new Date().toISOString(),
    });
    if (!next.success) return envelopeFail("INVALID_INPUT", "Settings update is invalid.");
    await writeJsonAtomic(join(ctx.hiveRoot, "settings.json"), next.data);
    await appendJsonlLine(join(ctx.hiveRoot, "events", "events.jsonl"), {
      id: `evt_${Date.now()}`,
      ts: next.data.updatedAt,
      type: "autonomy.changed",
      featureId: null,
      data: { autonomy: mode },
      actor: { kind: "operator", id: "operator" },
    });
    return envelope({ ok: true, settings: next.data });
  }
  return envelopeFail("INVALID_INPUT", `unknown autonomy subcommand: ${sub ?? "(none)"}`);
}

async function handleAway(rest: string[]): Promise<CommandPlaneCliResult> {
  const [sub, ...args] = rest;
  const { values } = parseArgs({
    args,
    options: {
      cwd: { type: "string" },
      feature: { type: "string" },
      "interval-ms": { type: "string" },
      "allow-absent-ci": { type: "string" },
      detach: { type: "boolean" },
    },
  });
  const ctx = await resolveCtx(values.cwd as string | undefined);
  if (!ctx.ok) return envelope(ctx);
  const allowAbsentCi = parseBoolFlag(values["allow-absent-ci"] as string | undefined);
  const pollIntervalMs = values["interval-ms"] ? Number(values["interval-ms"]) : undefined;

  if (sub === "on" || sub === "start") {
    const result = await awaySet({
      hiveRoot: ctx.hiveRoot,
      awayMode: true,
      pollIntervalMs,
      allowAbsentCi: allowAbsentCi ?? undefined,
      cwd: ctx.repositoryRoot,
    });
    return envelope(result);
  }
  if (sub === "off" || sub === "stop") {
    const result = await awaySet({ hiveRoot: ctx.hiveRoot, awayMode: false, cwd: ctx.repositoryRoot });
    return envelope(result);
  }
  if (sub === "status") {
    const settings = await readSettings(ctx.hiveRoot);
    if (!settings) return envelopeFail("HIVE_CORRUPT", "Settings are unreadable.");
    return envelope({
      ok: true,
      settings,
      poller: { running: settings.awayMode, pid: settings.awayMode ? process.pid : null },
    });
  }
  if (sub === "tick") {
    const result = await awayTick({
      hiveRoot: ctx.hiveRoot,
      cwd: ctx.repositoryRoot,
      featureId: values.feature as string | undefined,
    });
    return envelope(result);
  }
  return envelopeFail("INVALID_INPUT", `unknown away subcommand: ${sub ?? "(none)"}`);
}

async function handleDispatchTask(rest: string[]): Promise<CommandPlaneCliResult> {
  const { values } = parseArgs({
    args: rest,
    options: { cwd: { type: "string" }, feature: { type: "string" }, task: { type: "string" } },
  });
  if (!values.feature || !values.task) {
    return envelopeFail("INVALID_INPUT", "missing --feature or --task");
  }
  const result = await dispatchTask({
    featureId: values.feature as string,
    taskId: values.task as string,
    cwd: (values.cwd as string | undefined) ?? process.cwd(),
    freshSubagent: true,
  });
  return envelope(normalizeDispatch(result));
}

async function handleTask(rest: string[]): Promise<CommandPlaneCliResult> {
  const [sub, ...args] = rest;
  const confirm = splitConfirmFlag(args);
  const { values } = parseArgs({
    args: confirm.args,
    options: {
      cwd: { type: "string" },
      feature: { type: "string" },
      task: { type: "string" },
      hold: { type: "string" },
      reason: { type: "string" },
    },
  });
  const ctx = await resolveCtx(values.cwd as string | undefined);
  if (!ctx.ok) return envelope(ctx);
  if (!values.feature || !values.task) {
    return envelopeFail("INVALID_INPUT", "missing --feature or --task");
  }

  if (sub === "hold") {
    const hold = parseBoolFlag(values.hold as string | undefined);
    if (hold === null) return envelopeFail("INVALID_INPUT", "--hold must be true or false");
    const result = await taskHold({
      hiveRoot: ctx.hiveRoot,
      featureId: values.feature as string,
      taskId: values.task as string,
      hold,
    });
    return envelope(result);
  }
  if (sub === "abort") {
    const result = await taskAbort({
      hiveRoot: ctx.hiveRoot,
      featureId: values.feature as string,
      taskId: values.task as string,
      confirm: confirm.confirm,
      abortReason: (values.reason as string | undefined) ?? "",
    });
    return envelope(result);
  }
  return envelopeFail("INVALID_INPUT", `unknown task subcommand: ${sub ?? "(none)"}`);
}

async function handleTaskReassign(rest: string[]): Promise<CommandPlaneCliResult> {
  const { values } = parseArgs({
    args: rest,
    options: {
      cwd: { type: "string" },
      feature: { type: "string" },
      task: { type: "string" },
      agent: { type: "string" },
    },
  });
  const ctx = await resolveCtx(values.cwd as string | undefined);
  if (!ctx.ok) return envelope(ctx);
  if (!values.feature || !values.task || !values.agent) {
    return envelopeFail("INVALID_INPUT", "missing --feature, --task, or --agent");
  }
  const result = await taskReassign({
    hiveRoot: ctx.hiveRoot,
    featureId: values.feature as string,
    taskId: values.task as string,
    agentId: values.agent as string,
  });
  return envelope(result);
}

/** Accepts `--confirm`, `--confirm true`, and `--confirm false` before parseArgs. */
function splitConfirmFlag(args: string[]): { args: string[]; confirm: boolean } {
  const rest: string[] = [];
  let confirm = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--confirm=true" || token === "--confirm=false") {
      confirm = token === "--confirm=true";
      continue;
    }
    if (token !== "--confirm") {
      if (token !== undefined) rest.push(token);
      continue;
    }
    const next = args[index + 1];
    if (next === "true" || next === "false") {
      confirm = next === "true";
      index += 1;
      continue;
    }
    confirm = true;
  }
  return { args: rest, confirm };
}

async function handleMailbox(rest: string[]): Promise<CommandPlaneCliResult> {
  const [sub, ...args] = rest;

  if (sub === "post") {
    const { values } = parseArgs({
      args,
      options: {
        cwd: { type: "string" },
        role: { type: "string" },
        agent: { type: "string" },
        box: { type: "string" },
        to: { type: "string" },
        kind: { type: "string" },
        body: { type: "string" },
        feature: { type: "string" },
        "related-task": { type: "string" },
      },
    });
    const ctx = await resolveCtx(values.cwd as string | undefined);
    if (!ctx.ok) return envelope(ctx);
    if (!values.role || !values.agent || !values.box || !values.to || !values.kind || !values.body) {
      return envelopeFail("INVALID_INPUT", "missing mailbox post flags");
    }
    if (values.box !== "outbox") return envelopeFail("INVALID_INPUT", "post requires --box outbox");
    const result = await mailboxPost({
      hiveRoot: ctx.hiveRoot,
      role: values.role as "worker" | "ira",
      agentId: values.agent as string,
      box: "outbox",
      message: {
        toAgentId: values.to as string,
        kind: values.kind as "clarify" | "result" | "handoff" | "escalate",
        body: values.body as string,
        relatedTaskId: values["related-task"] as string | undefined,
        featureId: values.feature as string | undefined,
      },
    });
    return envelope(result);
  }
  if (sub === "read") {
    const { values } = parseArgs({
      args,
      options: {
        cwd: { type: "string" },
        role: { type: "string" },
        agent: { type: "string" },
        box: { type: "string" },
        limit: { type: "string" },
      },
    });
    const ctx = await resolveCtx(values.cwd as string | undefined);
    if (!ctx.ok) return envelope(ctx);
    if (!values.role || !values.agent || !values.box) {
      return envelopeFail("INVALID_INPUT", "missing mailbox read flags");
    }
    const box = values.box as string;
    if (box !== "inbox" && box !== "outbox") {
      return envelopeFail("INVALID_INPUT", "--box must be inbox or outbox");
    }
    const result = await mailboxRead({
      hiveRoot: ctx.hiveRoot,
      role: values.role as "worker" | "ira",
      agentId: values.agent as string,
      box,
      limit: values.limit ? Number(values.limit) : undefined,
    });
    return envelope(result);
  }
  return envelopeFail("INVALID_INPUT", `unknown mailbox subcommand: ${sub ?? "(none)"}`);
}

async function handleDoctor(rest: string[]): Promise<CommandPlaneCliResult> {
  const { values } = parseArgs({ args: rest, options: { cwd: { type: "string" } } });
  const report = await runDoctor({ cwd: (values.cwd as string | undefined) ?? process.cwd() });
  return envelope(report);
}

type Ctx =
  | { ok: true; repositoryRoot: string; hiveRoot: string }
  | { ok: false; error: CommandPlaneErrorCode; message: string; hint?: string };

async function resolveCtx(cwdOpt: string | undefined): Promise<Ctx> {
  const cwd = cwdOpt ?? process.cwd();
  const resolved = resolveRepositoryRoot(cwd);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      message: "Could not resolve repository root.",
      hint: "Add program.md at the SuperSpec repository root, then run superspec hive init.",
    };
  }
  try {
    await access(join(resolved.hiveRoot, "hive.json"), constants.R_OK);
  } catch {
    return {
      ok: false,
      error: "HIVE_NOT_INITIALIZED",
      message: "Hive is not initialized.",
      hint: "Run superspec hive init, then superspec doctor",
    };
  }
  return { ok: true, repositoryRoot: resolved.repositoryRoot, hiveRoot: resolved.hiveRoot };
}

async function buildHiveStatus(hiveRoot: string, repositoryRoot: string, featureFilter?: string) {
  const manifest = HiveManifestSchema.safeParse(JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8")));
  if (!manifest.success) return { ok: false as const, error: "HIVE_CORRUPT" as const, message: "Hive manifest invalid." };
  const settings = await readSettings(hiveRoot);
  if (!settings) return { ok: false as const, error: "HIVE_CORRUPT" as const, message: "Settings unreadable." };
  const writable = await isWritable(hiveRoot);
  const features = await listFeatureSummaries(hiveRoot, featureFilter);
  return {
    ok: true as const,
    repositoryRoot,
    hiveRoot,
    worktreeKind: detectWorktreeKind(repositoryRoot),
    writable,
    schemaVersion: 1 as const,
    autonomy: settings.autonomy,
    awayMode: settings.awayMode,
    features,
    persona: personaField(),
  };
}

async function listFeatureSummaries(hiveRoot: string, featureFilter?: string) {
  let names: string[];
  try {
    names = (await readdir(join(hiveRoot, "ledger"))).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Array<{
    featureId: string;
    taskCounts: Record<string, number>;
    openAskMe: number;
  }> = [];
  for (const file of names) {
    const featureId = file.replace(/\.json$/, "");
    if (featureFilter && featureId !== featureFilter) continue;
    if (!featureIdSchema.safeParse(featureId).success) continue;
    let ledger;
    try {
      ledger = HiveLedgerSchema.parse(JSON.parse(await readFile(join(hiveRoot, "ledger", file), "utf8")));
    } catch {
      continue;
    }
    const counts = { todo: 0, doing: 0, blocked: 0, done: 0 };
    for (const task of ledger.tasks) {
      counts[task.status] += 1;
    }
    const open = await listAskMe({ hiveRoot, state: "open", featureId });
    out.push({
      featureId,
      taskCounts: counts,
      openAskMe: open.ok ? open.items.length : 0,
    });
  }
  return out;
}

async function readAskMeItem(
  hiveRoot: string,
  id: string,
): Promise<{ ok: true; item: unknown } | { ok: false; error: CommandPlaneErrorCode; message: string }> {
  const path = join(hiveRoot, "ask-me", `${id}.json`);
  try {
    const parsed = AskMeItemSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!parsed.success) return { ok: false, error: "HIVE_CORRUPT", message: "Ask-Me item unreadable." };
    return { ok: true, item: parsed.data };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: "ASK_ME_NOT_FOUND", message: "Ask-Me item not found." };
    }
    return { ok: false, error: "HIVE_CORRUPT", message: "Ask-Me item unreadable." };
  }
}

async function readSettings(hiveRoot: string) {
  try {
    const parsed = AutonomySettingsSchema.safeParse(
      JSON.parse(await readFile(join(hiveRoot, "settings.json"), "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function isWritable(hiveRoot: string): Promise<boolean> {
  try {
    await access(hiveRoot, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function detectWorktreeKind(cwd: string): "main" | "linked" {
  try {
    const git = join(cwd, ".git");
    const info = statSync(git);
    return info.isDirectory() ? "main" : "linked";
  } catch {
    return "main";
  }
}

function parseBoolFlag(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function parseOptionalNumber(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "null") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeDispatch(result: DispatchTaskResult): Record<string, unknown> {
  if (result.ok) return result as Record<string, unknown>;
  const code = result.code;
  return {
    ok: false,
    error: code,
    message: result.message ?? dispatchMessage(code),
    hint: dispatchHint(code),
    ...(result.accepted === false ? { accepted: false } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

function dispatchMessage(code: string): string {
  const messages: Record<string, string> = {
    HIVE_NOT_READY: "Hive is not ready for dispatch.",
    DISPATCH_HELD: "Task is on hold.",
    INVALID_INPUT: "Dispatch input is invalid.",
  };
  return messages[code] ?? `Dispatch failed (${code}).`;
}

function dispatchHint(code: string): string | undefined {
  if (code === "HIVE_NOT_READY") return "Run superspec doctor, then superspec hive init if needed.";
  if (code === "DISPATCH_PATH_REQUIRED") return "Call dispatch-task. begin-task runs only after that command's hooks allow it.";
  return undefined;
}

function envelope(body: Record<string, unknown> | { ok: boolean }): CommandPlaneCliResult {
  const ok = (body as { ok?: boolean }).ok !== false;
  return { code: ok ? 0 : 1, stdout: JSON.stringify(body, null, 2) };
}

function envelopeFail(error: CommandPlaneErrorCode, message: string, hint?: string): CommandPlaneCliResult {
  return envelope({
    ok: false,
    error,
    message,
    ...(hint ? { hint } : {}),
  });
}
