#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseSpec } from "./spec-parser.js";
import { parsePlan } from "./plan-parser.js";
import { buildMatrix, matrixGaps } from "./matrix.js";
import { lintPlan } from "./plan-lint.js";
import { lintDesign, lintDesignText } from "./design-lint.js";
import { lintSpec } from "./spec-lint.js";
import { routeModel } from "./model-router.js";
import { type HarnessId } from "./harness-model-map.js";
import { resolveDispatchModel } from "./models-config.js";
import { scaffold } from "./scaffold.js";
import { initState, forgeStatus, nextTask, recordResult, loadState, saveState, markInProgress, reconcileState } from "./forge-loop.js";
import {
  assertBeginTaskAllowed,
  formatDispatchPathRequired,
  hiveSyncTarget,
  maybeSyncHive,
  readMaxReviewFailures,
  resolveHiveAnchor,
} from "./command-plane/dispatch-guard.js";
import { idleWakeAfterPass } from "./command-plane/dispatch.js";
import { maybeReplanAfterRecordResult } from "./command-plane/replan.js";
import { discoverPersonas } from "./persona-discovery.js";
import { initProject, formatInitReport, formatInitError } from "./init.js";
import { buildStatusSnapshot, writeStatusFile } from "./fr-status.js";
import {
  formatBeginTaskReport,
  formatForgeStatusReport,
  formatNextTaskReport,
  formatRecordResultReport,
  formatSyncStatusReport,
  formatCommandError,
  formatCoordinatorBriefReport,
} from "./cli-output.js";
import {
  appendCoordinatorLog,
  readCoordinatorBriefText,
  writeCoordinatorBrief,
} from "./coordinator-ledger.js";
import { isDirectRun } from "./cli-entry.js";

interface ToolContent {
  content: { type: "text"; text: string }[];
}

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<ToolContent>;
}

function json(value: unknown): ToolContent {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function buildToolDefinitions(): ToolDef[] {
  return [
    {
      name: "build-matrix",
      description: "Build the FR-to-task coverage matrix from spec and plan text.",
      schema: { specText: z.string(), planText: z.string() },
      handler: async (args) => {
        const spec = parseSpec(args.specText as string);
        const tasks = parsePlan(args.planText as string);
        const matrix = buildMatrix(spec.requirements, tasks);
        return json({ matrix, gaps: matrixGaps(matrix) });
      },
    },
    {
      name: "lint-plan",
      description: "Lint plan text for placeholders and missing TDD cycles.",
      schema: { planText: z.string() },
      handler: async (args) => json(lintPlan(args.planText as string)),
    },
    {
      name: "lint-spec",
      description: "Lint spec.md for type, FR/SC completeness, placeholders, and clarification count.",
      schema: { specText: z.string() },
      handler: async (args) => json(lintSpec(args.specText as string)),
    },
    {
      name: "lint-design",
      description: "Lint design.md for incomplete decisions, NEEDS CLARIFICATION, and contract table shape.",
      schema: { designText: z.string() },
      handler: async (args) => json(lintDesignText(args.designText as string)),
    },
    {
      name: "route-model",
      description:
        "Recommend abstract model tier (economy|standard|frontier) from task complexity, role, and attempt. " +
        "Resolves optional model overrides from <projectRoot>/.superspec/models.yaml, then ~/.superspec/models.yaml, then built-in harness defaults. " +
        "Slug resolution order: kinds → attempts → roles → tiers → builtin. " +
        "Each override may be a scalar or a { cursor, claude, codex } map keyed by the harness arg.",
      schema: {
        complexity: z.enum(["mechanical", "moderate", "complex"]),
        role: z.enum(["implementer", "reviewer"]).optional(),
        attempt: z.number().int().min(1).optional(),
        kind: z.enum(["code", "verify", "provision", "signoff", "doc-sync"]).optional(),
        harness: z.enum(["cursor", "claude", "codex"]).optional(),
        projectRoot: z.string().optional(),
      },
      handler: async (args) => {
        const routed = routeModel({
          complexity: args.complexity as "mechanical" | "moderate" | "complex",
          role: args.role as "implementer" | "reviewer" | undefined,
          attempt: args.attempt as number | undefined,
          kind: args.kind as "code" | "verify" | "provision" | "signoff" | "doc-sync" | undefined,
        });
        const harness = (args.harness as HarnessId | undefined) ?? undefined;
        const resolved = await resolveDispatchModel({
          tier: routed.tier,
          role: routed.role,
          kind: args.kind as "code" | "verify" | "provision" | "signoff" | "doc-sync" | undefined,
          attempt: routed.attempt,
          harness,
          projectRoot: args.projectRoot as string | undefined,
        });
        return json({
          ...routed,
          harness: resolved.harness,
          slug: resolved.slug,
          thinkingHint: resolved.thinkingHint,
          examples: resolved.examples,
          source: resolved.source,
          configPath: resolved.configPath,
        });
      },
    },
    {
      name: "scaffold",
      description: "Render tier templates into a target directory.",
      schema: { templatesDir: z.string(), targetDir: z.string() },
      handler: async (args) => json({ written: await scaffold(args.templatesDir as string, args.targetDir as string, {}) }),
    },
    {
      name: "init",
      description:
        "Bootstrap SuperSpec in a repository: constitution.md at root, specs/, .superspec/templates/, optional program.md (full mode), optional .superspec/models.yaml when withModels is true.",
      schema: {
        root: z.string(),
        mode: z.enum(["lite", "full"]),
        templatesDir: z.string().optional(),
        feature: z.string().optional(),
        verbose: z.boolean().optional(),
        withModels: z.boolean().optional(),
      },
      handler: async (args) => {
        try {
          const result = await initProject({
            root: args.root as string,
            mode: args.mode as "lite" | "full",
            templatesDir: args.templatesDir as string | undefined,
            feature: args.feature as string | undefined,
            verbose: (args.verbose as boolean | undefined) ?? true,
            withModels: (args.withModels as boolean | undefined) ?? false,
          });
          return {
            content: [
              {
                type: "text",
                text: (args.verbose as boolean | undefined) === false
                  ? JSON.stringify(result, null, 2)
                  : formatInitReport(result),
              },
            ],
          };
        } catch (err) {
          return { content: [{ type: "text", text: formatInitError(err) }] };
        }
      },
    },
    {
      name: "sync-status",
      description:
        "Write or refresh specs/<feature>/status.md from spec, plan, and persisted forge state (FR + task progress).",
      schema: {
        specDir: z.string(),
        specText: z.string(),
        planText: z.string(),
        stateDir: z.string().optional(),
        planPath: z.string().optional(),
        verbose: z.boolean().optional(),
      },
      handler: async (args) => {
        try {
          const tasks = parsePlan(args.planText as string);
          const stateDir = args.stateDir as string | undefined;
          const state =
            stateDir !== undefined
              ? ((await loadState(stateDir)) ?? initState(tasks))
              : initState(tasks);
          const path = await writeStatusFile(
            args.specDir as string,
            args.specText as string,
            args.planText as string,
            state,
          );
          const snapshot = buildStatusSnapshot(
            args.specText as string,
            args.planText as string,
            state,
          );
          const payload = { ok: true, path, snapshot };
          const verbose = (args.verbose as boolean | undefined) ?? true;
          const text = verbose ? formatSyncStatusReport({ path, snapshot }, true) : JSON.stringify(payload, null, 2);
          const planPath = args.planPath as string | undefined;
          if (planPath) {
            const forgeDir = stateDir ?? (args.specDir as string);
            await maybeSyncHive(hiveSyncTarget(resolveHiveAnchor(forgeDir), forgeDir, planPath));
          }
          return { content: [{ type: "text", text }] };
        } catch (err) {
          return { content: [{ type: "text", text: formatCommandError("sync-status", err) }] };
        }
      },
    },
    {
      name: "coordinator-brief",
      description:
        "Write or refresh specs/<feature>/.superspec/coordinator.md — the lean forge loop handoff file. " +
        "Coordinator agents re-read this after compaction instead of chat history. Pass specDir + planPath (filesystem paths, not file contents).",
      schema: {
        specDir: z.string(),
        planPath: z.string(),
        verbose: z.boolean().optional(),
      },
      handler: async (args) => {
        try {
          const briefPath = await writeCoordinatorBrief({
            specDir: args.specDir as string,
            planPath: args.planPath as string,
          });
          const body = await readCoordinatorBriefText(args.specDir as string);
          const verbose = (args.verbose as boolean | undefined) ?? true;
          return { content: [{ type: "text", text: formatCoordinatorBriefReport(briefPath, body, verbose) }] };
        } catch (err) {
          return { content: [{ type: "text", text: formatCommandError("coordinator-brief", err) }] };
        }
      },
    },
    {
      name: "begin-task",
      description: "Mark a forge task as in_progress and persist state.",
      schema: {
        planText: z.string(),
        stateDir: z.string(),
        taskId: z.string(),
        verbose: z.boolean().optional(),
      },
      handler: async (args) => {
        try {
          const tasks = parsePlan(args.planText as string);
          const stateDir = args.stateDir as string;
          // Not a schema field. The MCP client cannot set this; dispatch-task calls the handler in-process.
          const anchor = resolveHiveAnchor(stateDir);
          const gate = assertBeginTaskAllowed({
            hiveExists: anchor.hiveExists,
            internalFromDispatch: args.internalFromDispatch === true,
          });
          if (!gate.ok) {
            return { content: [{ type: "text", text: formatDispatchPathRequired() }] };
          }
          const state = reconcileState(tasks, await loadState(stateDir));
          const taskId = args.taskId as string;
          markInProgress(state, taskId);
          await saveState(stateDir, state);
          const verbose = (args.verbose as boolean | undefined) ?? true;
          const text = formatBeginTaskReport(taskId, { dir: stateDir, cwd: process.cwd() }, verbose);
          const planPath = args.planPath as string | undefined;
          if (typeof planPath === "string") {
            await maybeSyncHive(hiveSyncTarget(anchor, stateDir, planPath));
          }
          return { content: [{ type: "text", text }] };
        } catch (err) {
          return { content: [{ type: "text", text: formatCommandError("begin-task", err) }] };
        }
      },
    },
    {
      name: "next-task",
      description: "Return the next DAG-ready pending task from persisted forge state.",
      schema: {
        planText: z.string(),
        stateDir: z.string(),
        verbose: z.boolean().optional(),
      },
      handler: async (args) => {
        try {
          const tasks = parsePlan(args.planText as string);
          const state = (await loadState(args.stateDir as string)) ?? initState(tasks);
          const task = nextTask(tasks, state);
          const verbose = (args.verbose as boolean | undefined) ?? true;
          const text = formatNextTaskReport(
            task,
            { dir: args.stateDir as string, cwd: process.cwd() },
            verbose,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          return { content: [{ type: "text", text: formatCommandError("next-task", err) }] };
        }
      },
    },
    {
      name: "record-result",
      description: "Record a pass/fail review verdict for a task and persist forge state.",
      schema: {
        planText: z.string(),
        stateDir: z.string(),
        taskId: z.string(),
        passed: z.boolean(),
        specText: z.string().optional(),
        specDir: z.string().optional(),
        verbose: z.boolean().optional(),
        coordinator: z.boolean().optional(),
        commits: z.string().optional(),
        implementerReport: z.string().optional(),
        reviewerReport: z.string().optional(),
        planPath: z.string().optional(),
      },
      handler: async (args) => {
        try {
          const tasks = parsePlan(args.planText as string);
          const stateDir = args.stateDir as string;
          const anchor = resolveHiveAnchor(stateDir);
          const state = reconcileState(tasks, await loadState(stateDir));
          const taskId = args.taskId as string;
          const passed = args.passed as boolean;
          const maxReviewFailures = await readMaxReviewFailures(anchor);
          recordResult(state, taskId, passed, { maxReviewFailures });
          await saveState(stateDir, state);
          let statusPath: string | undefined;
          const specText = args.specText as string | undefined;
          const specDir = args.specDir as string | undefined;
          if (specText !== undefined && specDir !== undefined) {
            statusPath = await writeStatusFile(
              specDir,
              specText,
              args.planText as string,
              state,
            );
          }
          let coordinatorPath: string | undefined;
          if (args.coordinator === true && args.planPath !== undefined) {
            coordinatorPath = await appendCoordinatorLog({
              specDir: args.stateDir as string,
              planPath: args.planPath as string,
              entry: {
                taskId,
                verdict: passed ? "pass" : state.tasks[taskId]?.status === "blocked" ? "blocked" : "fail",
                commits: args.commits as string | undefined,
                implementerReport: args.implementerReport as string | undefined,
                reviewerReport: args.reviewerReport as string | undefined,
                at: new Date().toISOString(),
              },
            });
          }
          const verbose = (args.verbose as boolean | undefined) ?? true;
          const text = formatRecordResultReport(
            taskId,
            passed,
            { dir: stateDir, statusPath, coordinatorPath, cwd: process.cwd() },
            verbose,
          );
          const planPath = args.planPath as string | undefined;
          if (typeof planPath === "string") {
            await maybeSyncHive(hiveSyncTarget(anchor, stateDir, planPath));
          }
          const recorded = state.tasks[taskId];
          if (recorded) {
            await maybeReplanAfterRecordResult({
              hiveExists: anchor.hiveExists,
              hiveRoot: anchor.hiveExists ? anchor.hiveRoot : undefined,
              featureId: anchor.hiveExists ? anchor.featureId : undefined,
              taskId,
              passed,
              forgeStatus: recorded.status,
              reviewFailures: recorded.reviewFailures,
              ceiling: maxReviewFailures,
            });
          }
          if (passed) {
            await idleWakeAfterPass({
              hiveExists: anchor.hiveExists,
              hiveRoot: anchor.hiveExists ? anchor.hiveRoot : undefined,
              featureId: anchor.hiveExists ? anchor.featureId : undefined,
              cwd: anchor.hiveExists ? anchor.repositoryRoot : undefined,
              completedTaskId: taskId,
              passed: true,
            });
          }
          return { content: [{ type: "text", text }] };
        } catch (err) {
          return { content: [{ type: "text", text: formatCommandError("record-result", err) }] };
        }
      },
    },
    {
      name: "forge-status",
      description:
        "Report forge completion status for plan tasks. Loads persisted state from stateDir when provided; otherwise uses fresh state.",
      schema: {
        planText: z.string(),
        stateDir: z.string().optional(),
        specText: z.string().optional(),
        specDir: z.string().optional(),
        verbose: z.boolean().optional(),
      },
      handler: async (args) => {
        try {
          const tasks = parsePlan(args.planText as string);
          const stateDir = args.stateDir as string | undefined;
          const state =
            stateDir !== undefined
              ? ((await loadState(stateDir)) ?? initState(tasks))
              : initState(tasks);
          const status = forgeStatus(state);
          let statusPath: string | undefined;
          const specText = args.specText as string | undefined;
          const specDir = args.specDir as string | undefined;
          if (specText !== undefined && specDir !== undefined) {
            statusPath = await writeStatusFile(specDir, specText, args.planText as string, state);
          }
          const verbose = (args.verbose as boolean | undefined) ?? true;
          const text = formatForgeStatusReport(
            status,
            { dir: stateDir, statusPath, cwd: process.cwd() },
            verbose,
          );
          return { content: [{ type: "text", text }] };
        } catch (err) {
          return { content: [{ type: "text", text: formatCommandError("forge-status", err) }] };
        }
      },
    },
    {
      name: "list-personas",
      description:
        "List specialized sub-agent personas from project and user agent directories. Defaults to <projectRoot>/{.claude,.cursor,.codex}/agents and ~/.{claude,cursor,codex}/agents (markdown; Codex also TOML). Pass projectRoot when the MCP cwd is not the repo root; optional claudeAgentsDir/cursorAgentsDir/codexAgentsDir override or extend discovery.",
      schema: {
        projectRoot: z.string().optional(),
        claudeAgentsDir: z.string().optional(),
        cursorAgentsDir: z.string().optional(),
        codexAgentsDir: z.string().optional(),
        includeDefaults: z.boolean().optional(),
        includeHome: z.boolean().optional(),
      },
      handler: async (args) =>
        json(
          await discoverPersonas({
            projectRoot: args.projectRoot as string | undefined,
            claude: args.claudeAgentsDir as string | undefined,
            cursor: args.cursorAgentsDir as string | undefined,
            codex: args.codexAgentsDir as string | undefined,
            includeDefaults: args.includeDefaults as boolean | undefined,
            includeHome: args.includeHome as boolean | undefined,
          }),
        ),
    },
  ];
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "superspec", version: "0.1.0" });
  for (const tool of buildToolDefinitions()) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args: Record<string, unknown>) => {
        const result = await tool.handler(args);
        return result as ToolContent & { [x: string]: unknown };
      },
    );
  }
  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runMcpServer();
}
