#!/usr/bin/env node
import "./hire/index.js";
import { readFile } from "node:fs/promises";
import { stdin } from "node:process";
import { parseArgs } from "node:util";
import { parseSpec } from "./spec-parser.js";
import { parsePlan } from "./plan-parser.js";
import { buildMatrix, matrixGaps } from "./matrix.js";
import { lintPlan } from "./plan-lint.js";
import { lintDesign } from "./design-lint.js";
import { lintSpec } from "./spec-lint.js";
import { scaffold } from "./scaffold.js";
import { discoverPersonas } from "./persona-discovery.js";
import { runMcpServer } from "./mcp-server.js";
import {
  initState,
  nextTask,
  recordResult,
  forgeStatus,
  loadState,
  saveState,
  markInProgress,
  reconcileState,
} from "./forge-loop.js";
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
import { initProject } from "./init.js";
import { syncStatusFromFiles } from "./fr-status.js";
import {
  appendCoordinatorLog,
  readCoordinatorBriefText,
  writeCoordinatorBrief,
} from "./coordinator-ledger.js";
import {
  emitInitFailure,
  emitInitSuccess,
  formatBeginTaskReport,
  formatCommandError,
  formatCoordinatorBriefReport,
  formatForgeStatusReport,
  formatNextTaskReport,
  formatRecordResultReport,
  formatSyncStatusReport,
} from "./cli-output.js";
import { isDirectRun } from "./cli-entry.js";
import { runHookIngest } from "./engines/hook-ingest.js";
import { runEnginesCli } from "./engines/cli-engines.js";
import { runTokenCli } from "./token-governor/cli-token.js";
import { runHireCli } from "./hire/cli-hire.js";
import { writeStatusFile } from "./fr-status.js";
import {
  commandPlaneHelpSummary,
  isCommandPlaneCommand,
  runCommandPlaneCli,
} from "./command-plane/cli-handlers.js";
import { priorPatternsForTask, routeModelWithLearning, scheduleRecordResultLearning } from "./learning-memory/forge-wiring.js";
import { listPatterns, showPattern } from "./learning-memory/query.js";
import { reindexFromMarkdown } from "./learning-memory/pattern-index.js";
import { resolvePatternStoreRoot } from "./learning-memory/paths.js";
import type { Complexity, TaskKind } from "./types.js";
import type { HarnessId } from "./harness-model-map.js";
import type { RouteRole } from "./model-router.js";

export interface CliResult {
  code: number;
  stdout: string;
}

/** In-process options. `internalFromDispatch` is not a CLI flag. */
export interface RunCliOptions {
  internalFromDispatch?: boolean;
}

export async function runCli(argv: string[], options?: RunCliOptions): Promise<CliResult> {
  try {
    return await runCliInner(argv, options);
  } catch (err) {
    return { code: 0, stdout: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runCliInner(argv: string[], options?: RunCliOptions): Promise<CliResult> {
  const [command, ...rest] = argv;

  if (command === "token") {
    return runTokenCli(rest);
  }

  if (command === "hire") {
    return runHireCli(rest);
  }

  if (command === "engines" && rest.length > 0 && rest[0] !== "hook-ingest") {
    return runEnginesCli(rest);
  }

  if (command === "engines" && rest[0] === "hook-ingest") {
    const { values } = parseArgs({
      args: rest.slice(1),
      options: { session: { type: "string" } },
    });
    const sessionId =
      (values.session as string | undefined)?.trim() ||
      process.env.SUPERSPEC_ENGINE_SESSION?.trim() ||
      "";
    if (!sessionId) {
      return { code: 1, stdout: "Error: --session or SUPERSPEC_ENGINE_SESSION is required." };
    }
    try {
      const stdinJson = await readStdinText();
      await runHookIngest(stdinJson, sessionId);
      return { code: 0, stdout: "" };
    } catch (err) {
      return { code: 1, stdout: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (isCommandPlaneCommand(command)) {
    const cp = await runCommandPlaneCli(argv);
    if (cp !== null) return cp;
  }

  if (command === "mcp") {
    // Long-running: connects the MCP server to stdio and never resolves in
    // normal operation, unlike every other subcommand here which computes a
    // result and returns. This mirrors mcp-server.ts's own direct-invocation
    // behavior exactly (same createServer() + StdioServerTransport), just
    // reachable via the single `superspec` bin instead of a dedicated file.
    await runMcpServer();
    return { code: 0, stdout: "" };
  }

  if (command === "matrix") {
    const { values } = parseArgs({
      args: rest,
      options: { spec: { type: "string" }, plan: { type: "string" } },
    });
    const missing = [
      values.spec === undefined ? "--spec" : null,
      values.plan === undefined ? "--plan" : null,
    ].filter((x): x is string => x !== null);
    if (missing.length > 0) {
      return { code: 0, stdout: `Error: missing required argument ${missing.join(", ")}` };
    }
    try {
      const spec = parseSpec(await readFile(values.spec as string, "utf8"));
      const tasks = parsePlan(await readFile(values.plan as string, "utf8"));
      const matrix = buildMatrix(spec.requirements, tasks);
      return { code: 0, stdout: JSON.stringify({ matrix, gaps: matrixGaps(matrix) }, null, 2) };
    } catch (err) {
      return { code: 0, stdout: `Error: ${(err as Error).message}` };
    }
  }

  if (command === "lint") {
    const { values } = parseArgs({
      args: rest,
      options: {
        plan: { type: "string" },
        design: { type: "string" },
        spec: { type: "string" },
        "specs-root": { type: "string" },
      },
    });
    if (values.spec !== undefined) {
      try {
        const findings = lintSpec(await readFile(values.spec as string, "utf8"));
        return { code: 0, stdout: JSON.stringify(findings, null, 2) };
      } catch (err) {
        return { code: 0, stdout: `Error: ${(err as Error).message}` };
      }
    }
    if (values.design !== undefined) {
      try {
        const findings = await lintDesign(await readFile(values.design as string, "utf8"), {
          specsRoot: values["specs-root"] as string | undefined,
        });
        return { code: 0, stdout: JSON.stringify(findings, null, 2) };
      } catch (err) {
        return { code: 0, stdout: `Error: ${(err as Error).message}` };
      }
    }
    if (values.plan === undefined) {
      return { code: 0, stdout: "Error: missing required argument --plan, --design, or --spec" };
    }
    try {
      const findings = lintPlan(await readFile(values.plan as string, "utf8"));
      return { code: 0, stdout: JSON.stringify(findings, null, 2) };
    } catch (err) {
      return { code: 0, stdout: `Error: ${(err as Error).message}` };
    }
  }

  if (command === "init") {
    const { values } = parseArgs({
      args: rest,
      options: {
        root: { type: "string", default: "." },
        mode: { type: "string" },
        templates: { type: "string" },
        feature: { type: "string" },
        verbose: { type: "boolean", short: "v" },
        "with-models": { type: "boolean" },
      },
    });
    if (values.mode !== "lite" && values.mode !== "full") {
      return {
        code: 0,
        stdout: emitInitFailure(new Error("--mode is required and must be lite or full")),
      };
    }
    const verbose = values.verbose === true;
    try {
      const result = await initProject({
        root: values.root as string,
        mode: values.mode,
        templatesDir: values.templates as string | undefined,
        feature: values.feature as string | undefined,
        verbose,
        withModels: values["with-models"] === true,
      });
      if (result.filesWritten === 0) {
        return {
          code: 0,
          stdout: emitInitFailure(new Error("init completed but wrote 0 files — check --root path")),
        };
      }
      return { code: 0, stdout: emitInitSuccess(result, verbose) };
    } catch (err) {
      return { code: 0, stdout: emitInitFailure(err) };
    }
  }

  if (command === "sync-status") {
    const { values } = parseArgs({
      args: rest,
      options: {
        spec: { type: "string" },
        plan: { type: "string" },
        dir: { type: "string" },
        verbose: { type: "boolean", short: "v" },
      },
    });
    const missing = [
      values.spec === undefined ? "--spec" : null,
      values.plan === undefined ? "--plan" : null,
      values.dir === undefined ? "--dir" : null,
    ].filter((x): x is string => x !== null);
    if (missing.length > 0) {
      return {
        code: 0,
        stdout: formatCommandError("sync-status", new Error(`missing required argument ${missing.join(", ")}`)),
      };
    }
    try {
      const tasks = parsePlan(await readFile(values.plan as string, "utf8"));
      const specDir = values.dir as string;
      const state = (await loadState(specDir)) ?? initState(tasks);
      const result = await syncStatusFromFiles(
        specDir,
        values.spec as string,
        values.plan as string,
        state,
      );
      const stdout = formatSyncStatusReport(result, values.verbose === true);
      await maybeSyncHive(hiveSyncTarget(resolveHiveAnchor(specDir), specDir, values.plan as string));
      return { code: 0, stdout };
    } catch (err) {
      return { code: 0, stdout: formatCommandError("sync-status", err) };
    }
  }

  if (command === "begin-task") {
    const { values } = parseArgs({
      args: rest,
      options: {
        plan: { type: "string" },
        dir: { type: "string" },
        task: { type: "string" },
        verbose: { type: "boolean", short: "v" },
      },
    });
    const missing = [
      values.plan === undefined ? "--plan" : null,
      values.dir === undefined ? "--dir" : null,
      values.task === undefined ? "--task" : null,
    ].filter((x): x is string => x !== null);
    if (missing.length > 0) {
      return {
        code: 0,
        stdout: formatCommandError("begin-task", new Error(`missing required argument ${missing.join(", ")}`)),
      };
    }
    try {
      const tasks = parsePlan(await readFile(values.plan as string, "utf8"));
      const specDir = values.dir as string;
      const anchor = resolveHiveAnchor(specDir);
      const gate = assertBeginTaskAllowed({
        hiveExists: anchor.hiveExists,
        internalFromDispatch: options?.internalFromDispatch === true,
      });
      if (!gate.ok) {
        return { code: 1, stdout: formatDispatchPathRequired() };
      }
      const state = reconcileState(tasks, await loadState(specDir));
      const taskId = values.task as string;
      markInProgress(state, taskId);
      await saveState(specDir, state);
      const task = tasks.find((entry) => entry.id === taskId);
      const prior = task ? await priorPatternsForTask({ specDir, task }) : null;
      const stdout = formatBeginTaskReport(
        taskId,
        {
          dir: specDir,
          cwd: process.cwd(),
          priorPatternsText: prior?.text ?? null,
          patternIds: prior?.patternIds,
        },
        values.verbose === true,
      );
      await maybeSyncHive(hiveSyncTarget(anchor, specDir, values.plan as string));
      return { code: 0, stdout };
    } catch (err) {
      return { code: 0, stdout: formatCommandError("begin-task", err) };
    }
  }

  if (command === "scaffold") {
    const { values } = parseArgs({
      args: rest,
      options: { templates: { type: "string" }, out: { type: "string" } },
    });
    const missing = [
      values.templates === undefined ? "--templates" : null,
      values.out === undefined ? "--out" : null,
    ].filter((x): x is string => x !== null);
    if (missing.length > 0) {
      return { code: 0, stdout: `Error: missing required argument ${missing.join(", ")}` };
    }
    try {
      const written = await scaffold(values.templates as string, values.out as string, {});
      return { code: 0, stdout: JSON.stringify({ written }, null, 2) };
    } catch (err) {
      return { code: 0, stdout: `Error: ${(err as Error).message}` };
    }
  }

  if (command === "next-task") {
    const { values } = parseArgs({
      args: rest,
      options: {
        plan: { type: "string" },
        dir: { type: "string" },
        verbose: { type: "boolean", short: "v" },
      },
    });
    const missing = [
      values.plan === undefined ? "--plan" : null,
      values.dir === undefined ? "--dir" : null,
    ].filter((x): x is string => x !== null);
    if (missing.length > 0) {
      return {
        code: 0,
        stdout: formatCommandError("next-task", new Error(`missing required argument ${missing.join(", ")}`)),
      };
    }
    try {
      const tasks = parsePlan(await readFile(values.plan as string, "utf8"));
      const state = (await loadState(values.dir as string)) ?? initState(tasks);
      const task = nextTask(tasks, state);
      return {
        code: 0,
        stdout: formatNextTaskReport(
          task,
          { dir: values.dir as string, cwd: process.cwd() },
          values.verbose === true,
        ),
      };
    } catch (err) {
      return { code: 0, stdout: formatCommandError("next-task", err) };
    }
  }

  if (command === "coordinator-brief" || command === "coordinator-init") {
    const { values } = parseArgs({
      args: rest,
      options: {
        dir: { type: "string" },
        plan: { type: "string" },
        verbose: { type: "boolean", short: "v" },
      },
    });
    const missing = [
      values.dir === undefined ? "--dir" : null,
      values.plan === undefined ? "--plan" : null,
    ].filter((x): x is string => x !== null);
    if (missing.length > 0) {
      return {
        code: 0,
        stdout: formatCommandError(command, new Error(`missing required argument ${missing.join(", ")}`)),
      };
    }
    try {
      const briefPath = await writeCoordinatorBrief({
        specDir: values.dir as string,
        planPath: values.plan as string,
      });
      const body = await readCoordinatorBriefText(values.dir as string);
      return {
        code: 0,
        stdout: formatCoordinatorBriefReport(briefPath, body, values.verbose !== false),
      };
    } catch (err) {
      return { code: 0, stdout: formatCommandError(command, err) };
    }
  }

  if (command === "record-result") {
    const { values } = parseArgs({
      args: rest,
      options: {
        plan: { type: "string" },
        dir: { type: "string" },
        task: { type: "string" },
        passed: { type: "string" },
        spec: { type: "string" },
        verbose: { type: "boolean", short: "v" },
        coordinator: { type: "boolean" },
        commits: { type: "string" },
        "implementer-report": { type: "string" },
        "reviewer-report": { type: "string" },
      },
    });
    const missing = [
      values.plan === undefined ? "--plan" : null,
      values.dir === undefined ? "--dir" : null,
      values.task === undefined ? "--task" : null,
      values.passed === undefined ? "--passed" : null,
    ].filter((x): x is string => x !== null);
    if (missing.length > 0) {
      return {
        code: 0,
        stdout: formatCommandError("record-result", new Error(`missing required argument ${missing.join(", ")}`)),
      };
    }
    if (values.passed !== "true" && values.passed !== "false") {
      return {
        code: 0,
        stdout: formatCommandError("record-result", new Error("--passed must be true or false")),
      };
    }
    try {
      const tasks = parsePlan(await readFile(values.plan as string, "utf8"));
      const specDir = values.dir as string;
      const anchor = resolveHiveAnchor(specDir);
      const state = reconcileState(tasks, await loadState(specDir));
      const passed = values.passed === "true";
      const maxReviewFailures = await readMaxReviewFailures(anchor);
      recordResult(state, values.task as string, passed, { maxReviewFailures });
      await saveState(specDir, state);
      let statusPath: string | undefined;
      if (values.spec !== undefined) {
        statusPath = await writeStatusFile(
          values.dir as string,
          await readFile(values.spec as string, "utf8"),
          await readFile(values.plan as string, "utf8"),
          state,
        );
      }
      let coordinatorPath: string | undefined;
      if (values.coordinator === true) {
        coordinatorPath = await appendCoordinatorLog({
          specDir: values.dir as string,
          planPath: values.plan as string,
          entry: {
            taskId: values.task as string,
            verdict: passed ? "pass" : state.tasks[values.task as string]?.status === "blocked" ? "blocked" : "fail",
            commits: values.commits as string | undefined,
            implementerReport: values["implementer-report"] as string | undefined,
            reviewerReport: values["reviewer-report"] as string | undefined,
            at: new Date().toISOString(),
          },
        });
      }
      await maybeSyncHive(hiveSyncTarget(anchor, specDir, values.plan as string));
      const taskId = values.task as string;
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
      const task = tasks.find((entry) => entry.id === taskId);
      const patternsScheduled = scheduleRecordResultLearning({
        specDir,
        task,
        taskId,
        passed,
        reviewFailures: recorded?.reviewFailures ?? 0,
        implementerReport: values["implementer-report"] as string | undefined,
        reviewerReport: values["reviewer-report"] as string | undefined,
      });
      const stdout = formatRecordResultReport(
        taskId,
        passed,
        {
          dir: specDir,
          statusPath,
          coordinatorPath,
          cwd: process.cwd(),
          patternsScheduled,
        },
        values.verbose === true,
      );
      return { code: 0, stdout };
    } catch (err) {
      return { code: 0, stdout: formatCommandError("record-result", err) };
    }
  }

  if (command === "forge-status") {
    const { values } = parseArgs({
      args: rest,
      options: {
        plan: { type: "string" },
        dir: { type: "string" },
        spec: { type: "string" },
        verbose: { type: "boolean", short: "v" },
      },
    });
    const missing = [
      values.plan === undefined ? "--plan" : null,
      values.dir === undefined ? "--dir" : null,
    ].filter((x): x is string => x !== null);
    if (missing.length > 0) {
      return {
        code: 0,
        stdout: formatCommandError("forge-status", new Error(`missing required argument ${missing.join(", ")}`)),
      };
    }
    try {
      const planText = await readFile(values.plan as string, "utf8");
      const tasks = parsePlan(planText);
      const state = (await loadState(values.dir as string)) ?? initState(tasks);
      const status = forgeStatus(state);
      let statusPath: string | undefined;
      if (values.spec !== undefined) {
        const specText = await readFile(values.spec as string, "utf8");
        statusPath = await writeStatusFile(values.dir as string, specText, planText, state);
      }
      return {
        code: 0,
        stdout: formatForgeStatusReport(
          status,
          { dir: values.dir as string, statusPath, cwd: process.cwd() },
          values.verbose === true,
        ),
      };
    } catch (err) {
      return { code: 0, stdout: formatCommandError("forge-status", err) };
    }
  }

  if (command === "list-personas") {
    const { values } = parseArgs({
      args: rest,
      options: {
        root: { type: "string" },
        "claude-agents-dir": { type: "string" },
        "cursor-agents-dir": { type: "string" },
        "codex-agents-dir": { type: "string" },
        "no-defaults": { type: "boolean" },
        "no-home": { type: "boolean" },
      },
    });
    try {
      const personas = await discoverPersonas({
        projectRoot: values.root as string | undefined,
        claude: values["claude-agents-dir"] as string | undefined,
        cursor: values["cursor-agents-dir"] as string | undefined,
        codex: values["codex-agents-dir"] as string | undefined,
        includeDefaults: values["no-defaults"] === true ? false : undefined,
        includeHome: values["no-home"] === true ? false : undefined,
      });
      return { code: 0, stdout: JSON.stringify(personas, null, 2) };
    } catch (err) {
      return { code: 0, stdout: `Error: ${(err as Error).message}` };
    }
  }

  if (command === "route-model") {
    return runRouteModelCli(rest);
  }

  if (command === "patterns") {
    return runPatternsCli(rest);
  }

  return {
    code: 0,
    stdout: `Unknown command: ${command ?? "(none)"}. Try: init | matrix | lint | scaffold | list-personas | patterns | token | hire | coordinator-init | coordinator-brief | next-task | begin-task | record-result | route-model | sync-status | forge-status | ${commandPlaneHelpSummary()} | mcp`,
  };
}

async function runPatternsCli(rest: string[]): Promise<CliResult> {
  const sub = rest[0];
  const projectRootDefault = process.cwd();

  if (sub === "list") {
    const { values } = parseArgs({
      args: rest.slice(1),
      options: {
        "project-root": { type: "string", default: projectRootDefault },
        feature: { type: "string" },
        "fr-tag": { type: "string" },
        kind: { type: "string" },
        limit: { type: "string" },
        cursor: { type: "string" },
      },
    });
    try {
      const payload = await listPatterns({
        projectRoot: values["project-root"] as string,
        ...(values.feature !== undefined ? { featureId: values.feature as string } : {}),
        ...(values["fr-tag"] !== undefined ? { frTag: values["fr-tag"] as string } : {}),
        ...(values.kind !== undefined ? { kind: values.kind as "success" | "failure" | "routing" } : {}),
        ...(values.limit !== undefined ? { limit: Number(values.limit) } : {}),
        ...(values.cursor !== undefined ? { cursor: values.cursor as string } : {}),
      });
      return { code: 0, stdout: JSON.stringify(payload, null, 2) };
    } catch (err) {
      return { code: 0, stdout: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (sub === "show") {
    const { values } = parseArgs({
      args: rest.slice(1),
      options: {
        "project-root": { type: "string", default: projectRootDefault },
        id: { type: "string" },
      },
    });
    if (values.id === undefined) {
      return { code: 0, stdout: "Error: missing required argument --id" };
    }
    try {
      const payload = await showPattern({
        projectRoot: values["project-root"] as string,
        id: values.id as string,
      });
      return { code: 0, stdout: JSON.stringify(payload, null, 2) };
    } catch (err) {
      return { code: 0, stdout: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (sub === "reindex") {
    const { values } = parseArgs({
      args: rest.slice(1),
      options: {
        "project-root": { type: "string", default: projectRootDefault },
      },
    });
    const store = resolvePatternStoreRoot(values["project-root"] as string);
    if (!store.ok) {
      return { code: 0, stdout: JSON.stringify({ error: store.code, message: store.message }, null, 2) };
    }
    try {
      const report = reindexFromMarkdown(store.patternsDir, store.indexPath, store.lockPath);
      return { code: 0, stdout: JSON.stringify(report, null, 2) };
    } catch (err) {
      return { code: 0, stdout: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  return {
    code: 0,
    stdout: "Unknown patterns subcommand. Try: patterns list | patterns show | patterns reindex",
  };
}

async function runRouteModelCli(rest: string[]): Promise<CliResult> {
  const { values } = parseArgs({
    args: rest,
    options: {
      complexity: { type: "string" },
      role: { type: "string" },
      attempt: { type: "string" },
      kind: { type: "string" },
      harness: { type: "string" },
      "project-root": { type: "string" },
      task: { type: "string" },
      plan: { type: "string" },
      feature: { type: "string" },
      implements: { type: "string" },
    },
  });
  if (values.complexity === undefined) {
    return {
      code: 0,
      stdout: formatCommandError("route-model", new Error("missing required argument --complexity")),
    };
  }
  const complexity = values.complexity as string;
  if (!isComplexity(complexity)) {
    return {
      code: 0,
      stdout: formatCommandError("route-model", new Error("--complexity must be mechanical, moderate, or complex")),
    };
  }
  let role: RouteRole | undefined;
  if (values.role !== undefined) {
    if (!isRouteRole(values.role)) {
      return {
        code: 0,
        stdout: formatCommandError("route-model", new Error("--role must be implementer or reviewer")),
      };
    }
    role = values.role;
  }
  let kind: TaskKind | undefined;
  if (values.kind !== undefined) {
    if (!isTaskKind(values.kind)) {
      return {
        code: 0,
        stdout: formatCommandError("route-model", new Error("--kind must be code, verify, provision, signoff, or doc-sync")),
      };
    }
    kind = values.kind;
  }
  let harness: HarnessId | undefined;
  if (values.harness !== undefined) {
    if (!isHarness(values.harness)) {
      return {
        code: 0,
        stdout: formatCommandError("route-model", new Error("--harness must be cursor, claude, or codex")),
      };
    }
    harness = values.harness;
  }
  let attempt: number | undefined;
  if (values.attempt !== undefined) {
    attempt = Number(values.attempt);
    if (!Number.isInteger(attempt) || attempt < 1) {
      return {
        code: 0,
        stdout: formatCommandError("route-model", new Error("--attempt must be an integer >= 1")),
      };
    }
  }
  try {
    const planText = values.plan ? await readFile(values.plan as string, "utf8") : undefined;
    const implementsFr = (values.implements as string | undefined)
      ?.split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    const payload = await routeModelWithLearning({
      complexity,
      role,
      attempt,
      kind,
      harness,
      projectRoot: values["project-root"] as string | undefined,
      taskId: values.task as string | undefined,
      planText,
      implementsFr,
      featureId: values.feature as string | undefined,
    });
    return { code: 0, stdout: JSON.stringify(payload, null, 2) };
  } catch (err) {
    return { code: 0, stdout: formatCommandError("route-model", err) };
  }
}

function isComplexity(value: string): value is Complexity {
  return value === "mechanical" || value === "moderate" || value === "complex";
}

function isRouteRole(value: string): value is RouteRole {
  return value === "implementer" || value === "reviewer";
}

function isTaskKind(value: string): value is TaskKind {
  return value === "code" || value === "verify" || value === "provision" || value === "signoff" || value === "doc-sync";
}

function isHarness(value: string): value is HarnessId {
  return value === "cursor" || value === "claude" || value === "codex";
}

export async function runCliMain(argv: string[]): Promise<number> {
  const { stdout, code } = await runCli(argv);
  if (stdout.length > 0) {
    process.stdout.write(stdout + "\n");
  } else if (argv.length > 0 && argv[0] !== "mcp") {
    process.stderr.write(
      `SuperSpec: no output from command ${argv[0]!} (cwd=${process.cwd()}). Try --verbose or use bin/superspec.js entry.\n`,
    );
  }
  return code;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runCliMain(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
