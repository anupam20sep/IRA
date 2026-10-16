import { access, readFile, readdir } from "node:fs/promises";
import { constants, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
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
import { taskAbort, taskHold } from "./task-control.js";
import { appendJsonlLine, writeJsonAtomic } from "./store.js";
import type { CommandPlaneErrorCode } from "./types.js";

export interface McpToolContent {
  content: { type: "text"; text: string }[];
}

export interface McpToolDef {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<McpToolContent>;
}

function cpJson(value: unknown): McpToolContent {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

type HiveCtx =
  | { ok: true; repositoryRoot: string; hiveRoot: string }
  | { ok: false; error: CommandPlaneErrorCode; message: string; hint?: string };

async function resolveHiveCtx(cwdOpt: string | undefined): Promise<HiveCtx> {
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

function normalizeDispatch(result: DispatchTaskResult): Record<string, unknown> {
  if (result.ok) return result as Record<string, unknown>;
  const code = result.code;
  return {
    ok: false,
    error: code,
    message: result.message ?? `Dispatch failed (${code}).`,
    ...(code === "HIVE_NOT_READY"
      ? { hint: "Run superspec doctor, then superspec hive init if needed." }
      : code === "DISPATCH_PATH_REQUIRED"
        ? { hint: "Call dispatch-task. begin-task runs only after that command's hooks allow it." }
        : {}),
    ...(result.accepted === false ? { accepted: false } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

export function buildCommandPlaneMcpTools(): McpToolDef[] {
  return [
    {
      name: "hive-init",
      description: "Initialize the Ira hive store at .superspec/hive/.",
      schema: { cwd: z.string().optional(), repair: z.boolean().optional() },
      handler: async (args) =>
        cpJson(await hiveInit({ cwd: (args.cwd as string | undefined) ?? process.cwd(), repair: args.repair === true })),
    },
    {
      name: "hive-status",
      description: "Report hive manifest, autonomy, and per-feature ledger summaries.",
      schema: { cwd: z.string().optional(), featureId: z.string().optional() },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const status = await buildHiveStatus(ctx.hiveRoot, ctx.repositoryRoot, args.featureId as string | undefined);
        return cpJson(status);
      },
    },
    {
      name: "hive-sync",
      description: "Sync hive ledger tasks from forge plan and state.",
      schema: {
        cwd: z.string().optional(),
        featureId: z.string(),
        specDir: z.string(),
        planPath: z.string(),
      },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const sync = await syncHiveFromForge({
          featureId: args.featureId as string,
          repositoryRoot: ctx.repositoryRoot,
          specDir: args.specDir as string,
          planPath: args.planPath as string,
        });
        if (!sync.ok) return cpJson(sync);
        const tasks = parsePlan(await readFile(resolve(ctx.repositoryRoot, args.planPath as string), "utf8"));
        const state =
          (await loadState(resolve(ctx.repositoryRoot, args.specDir as string))) ?? initState(tasks);
        return cpJson({
          ok: true,
          featureId: sync.featureId,
          upserted: sync.upserted,
          drift: sync.drift,
          forge: forgeStatus(state),
        });
      },
    },
    {
      name: "hive-ci-set",
      description: "Write CI gate state on the hive blackboard (local gate only).",
      schema: {
        cwd: z.string().optional(),
        featureId: z.string(),
        state: z.enum(["green", "red", "absent"]),
        source: z.string().optional(),
      },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const result = await hiveCiSet({
          hiveRoot: ctx.hiveRoot,
          featureId: args.featureId as string,
          state: args.state as "green" | "red" | "absent",
          source: (args.source as string | undefined) ?? "mcp",
        });
        return cpJson(result);
      },
    },
    {
      name: "brief-submit",
      description: "Submit an operator brief and seed hive ledger tasks from the feature plan.",
      schema: {
        cwd: z.string().optional(),
        featureId: z.string(),
        outcome: z.string(),
        deliverable: z.string(),
        constraints: z.array(z.string()).optional(),
        budgetUsd: z.number().nullable().optional(),
        budgetTokens: z.number().nullable().optional(),
      },
      handler: async (args) =>
        cpJson(
          await briefSubmit({
            cwd: args.cwd as string | undefined,
            featureId: args.featureId as string,
            outcome: args.outcome as string,
            deliverable: args.deliverable as string,
            constraints: args.constraints as string[] | undefined,
            budgetUsd: args.budgetUsd as number | null | undefined,
            budgetTokens: args.budgetTokens as number | null | undefined,
          }),
        ),
    },
    {
      name: "brief-show",
      description: "Show the stored brief for a feature.",
      schema: { cwd: z.string().optional(), featureId: z.string() },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const briefPath = join(ctx.hiveRoot, "briefs", `${args.featureId}.json`);
        try {
          const parsed = BriefSchema.safeParse(JSON.parse(await readFile(briefPath, "utf8")));
          if (!parsed.success) {
            return cpJson({ ok: false, error: "HIVE_CORRUPT", message: "Brief is unreadable." });
          }
          return cpJson({ ok: true, brief: parsed.data, persona: personaField() });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return cpJson({ ok: false, error: "FEATURE_NOT_FOUND", message: "Brief not found." });
          }
          return cpJson({ ok: false, error: "HIVE_CORRUPT", message: "Brief is unreadable." });
        }
      },
    },
    {
      name: "roster-list",
      description: "List roster agents from the hive store.",
      schema: { cwd: z.string().optional() },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        try {
          const parsed = RosterAgentSchema.array().safeParse(
            JSON.parse(await readFile(join(ctx.hiveRoot, "roster.json"), "utf8")),
          );
          if (!parsed.success) {
            return cpJson({ ok: false, error: "HIVE_CORRUPT", message: "Roster is unreadable." });
          }
          return cpJson({ ok: true, agents: parsed.data });
        } catch {
          return cpJson({ ok: false, error: "HIVE_CORRUPT", message: "Roster is unreadable." });
        }
      },
    },
    {
      name: "ask-me-list",
      description: "List Ask-Me items, optionally filtered by state and feature.",
      schema: {
        cwd: z.string().optional(),
        state: z.enum(["open", "resolved"]).optional(),
        featureId: z.string().optional(),
      },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const result = await listAskMe({
          hiveRoot: ctx.hiveRoot,
          state: args.state as "open" | "resolved" | undefined,
          featureId: args.featureId as string | undefined,
        });
        return cpJson(result);
      },
    },
    {
      name: "ask-me-show",
      description: "Show one Ask-Me item by id.",
      schema: { cwd: z.string().optional(), id: z.string() },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const path = join(ctx.hiveRoot, "ask-me", `${args.id}.json`);
        try {
          const parsed = AskMeItemSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
          if (!parsed.success) {
            return cpJson({ ok: false, error: "HIVE_CORRUPT", message: "Ask-Me item unreadable." });
          }
          return cpJson({ ok: true, item: parsed.data });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return cpJson({ ok: false, error: "ASK_ME_NOT_FOUND", message: "Ask-Me item not found." });
          }
          return cpJson({ ok: false, error: "HIVE_CORRUPT", message: "Ask-Me item unreadable." });
        }
      },
    },
    {
      name: "ask-me-answer",
      description: "Answer an Ask-Me item with retry, keep_blocked, or acknowledge.",
      schema: {
        cwd: z.string().optional(),
        id: z.string(),
        text: z.string(),
        action: z.enum(["retry", "keep_blocked", "acknowledge"]),
      },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const result = await answerAskMe({
          hiveRoot: ctx.hiveRoot,
          id: args.id as string,
          text: args.text as string,
          action: args.action as "retry" | "keep_blocked" | "acknowledge",
        });
        return cpJson(result);
      },
    },
    {
      name: "autonomy-show",
      description: "Show autonomy settings from the hive store.",
      schema: { cwd: z.string().optional() },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const settings = await readSettings(ctx.hiveRoot);
        if (!settings) {
          return cpJson({ ok: false, error: "HIVE_CORRUPT", message: "Settings are unreadable." });
        }
        return cpJson({ ok: true, settings, persona: personaField() });
      },
    },
    {
      name: "autonomy-set",
      description: "Set autonomy mode (observe, supervised, autonomous).",
      schema: { cwd: z.string().optional(), autonomy: z.enum(["observe", "supervised", "autonomous"]) },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const current = await readSettings(ctx.hiveRoot);
        if (!current) {
          return cpJson({ ok: false, error: "HIVE_CORRUPT", message: "Settings are unreadable." });
        }
        const next = AutonomySettingsSchema.safeParse({
          ...current,
          autonomy: args.autonomy,
          updatedAt: new Date().toISOString(),
        });
        if (!next.success) {
          return cpJson({ ok: false, error: "INVALID_INPUT", message: "Settings update is invalid." });
        }
        await writeJsonAtomic(join(ctx.hiveRoot, "settings.json"), next.data);
        await appendJsonlLine(join(ctx.hiveRoot, "events", "events.jsonl"), {
          id: `evt_${Date.now()}`,
          ts: next.data.updatedAt,
          type: "autonomy.changed",
          featureId: null,
          data: { autonomy: args.autonomy },
          actor: { kind: "operator", id: "operator" },
        });
        return cpJson({ ok: true, settings: next.data });
      },
    },
    {
      name: "away-set",
      description: "Enable or disable away mode and optional poll interval.",
      schema: {
        cwd: z.string().optional(),
        awayMode: z.boolean(),
        pollIntervalMs: z.number().int().positive().optional(),
        allowAbsentCi: z.boolean().optional(),
      },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const result = await awaySet({
          hiveRoot: ctx.hiveRoot,
          awayMode: args.awayMode as boolean,
          pollIntervalMs: args.pollIntervalMs as number | undefined,
          allowAbsentCi: args.allowAbsentCi as boolean | undefined,
          cwd: ctx.repositoryRoot,
        });
        return cpJson(result);
      },
    },
    {
      name: "away-tick",
      description: "Run one away poll tick (autonomous dispatch gate evaluation).",
      schema: { cwd: z.string().optional(), featureId: z.string().optional() },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const result = await awayTick({
          hiveRoot: ctx.hiveRoot,
          cwd: ctx.repositoryRoot,
          featureId: args.featureId as string | undefined,
        });
        return cpJson(result);
      },
    },
    {
      name: "dispatch-task",
      description:
        "Steer dispatch: TokenHooks.beforeDispatch, EngineHooks.dispatch, then internal begin-task when allowed.",
      schema: {
        featureId: z.string(),
        taskId: z.string(),
        cwd: z.string().optional(),
      },
      handler: async (args) =>
        cpJson(
          normalizeDispatch(
            await dispatchTask({
              featureId: args.featureId as string,
              taskId: args.taskId as string,
              cwd: (args.cwd as string | undefined) ?? process.cwd(),
              freshSubagent: true,
            }),
          ),
        ),
    },
    {
      name: "task-hold",
      description: "Set or clear hive-only hold on a task (does not call record-result).",
      schema: {
        cwd: z.string().optional(),
        featureId: z.string(),
        taskId: z.string(),
        hold: z.boolean(),
      },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const result = await taskHold({
          hiveRoot: ctx.hiveRoot,
          featureId: args.featureId as string,
          taskId: args.taskId as string,
          hold: args.hold as boolean,
        });
        return cpJson(result);
      },
    },
    {
      name: "task-abort",
      description: "Abort a task with confirm:true (does not call record-result).",
      schema: {
        cwd: z.string().optional(),
        featureId: z.string(),
        taskId: z.string(),
        confirm: z.boolean(),
        abortReason: z.string().optional(),
      },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const result = await taskAbort({
          hiveRoot: ctx.hiveRoot,
          featureId: args.featureId as string,
          taskId: args.taskId as string,
          confirm: args.confirm === true,
          abortReason: (args.abortReason as string | undefined) ?? "",
        });
        return cpJson(result);
      },
    },
    {
      name: "doctor",
      description: "Report hive integrity, MCP wiring, and Slice A validation checks.",
      schema: { cwd: z.string().optional() },
      handler: async (args) =>
        cpJson(await runDoctor({ cwd: (args.cwd as string | undefined) ?? process.cwd() })),
    },
    {
      name: "mailbox-post",
      description: "Post a worker outbox message (Ira may escalate to Ask-Me).",
      schema: {
        cwd: z.string().optional(),
        role: z.enum(["worker", "ira"]),
        agentId: z.string(),
        box: z.literal("outbox"),
        message: z.object({
          toAgentId: z.string(),
          kind: z.enum(["clarify", "result", "handoff", "escalate"]),
          body: z.string(),
          relatedTaskId: z.string().optional(),
          featureId: z.string().optional(),
        }),
      },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const message = args.message as {
          toAgentId: string;
          kind: "clarify" | "result" | "handoff" | "escalate";
          body: string;
          relatedTaskId?: string;
          featureId?: string;
        };
        const result = await mailboxPost({
          hiveRoot: ctx.hiveRoot,
          role: args.role as "worker" | "ira",
          agentId: args.agentId as string,
          box: "outbox",
          message,
        });
        return cpJson(result);
      },
    },
    {
      name: "mailbox-read",
      description: "Read inbox or outbox messages for an agent.",
      schema: {
        cwd: z.string().optional(),
        role: z.enum(["worker", "ira"]),
        agentId: z.string(),
        box: z.enum(["inbox", "outbox"]),
        limit: z.number().int().positive().optional(),
      },
      handler: async (args) => {
        const ctx = await resolveHiveCtx(args.cwd as string | undefined);
        if (!ctx.ok) return cpJson(ctx);
        const result = await mailboxRead({
          hiveRoot: ctx.hiveRoot,
          role: args.role as "worker" | "ira",
          agentId: args.agentId as string,
          box: args.box as "inbox" | "outbox",
          limit: args.limit as number | undefined,
        });
        return cpJson(result);
      },
    },
  ];
}

async function buildHiveStatus(hiveRoot: string, repositoryRoot: string, featureFilter?: string) {
  const manifest = HiveManifestSchema.safeParse(JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8")));
  if (!manifest.success) {
    return { ok: false as const, error: "HIVE_CORRUPT" as const, message: "Hive manifest invalid." };
  }
  const settings = await readSettings(hiveRoot);
  if (!settings) {
    return { ok: false as const, error: "HIVE_CORRUPT" as const, message: "Settings unreadable." };
  }
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
  const out: Array<{ featureId: string; taskCounts: Record<string, number>; openAskMe: number }> = [];
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
