import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hiveCiSet } from "../../src/command-plane/blackboard.js";
import { briefSubmit } from "../../src/command-plane/brief.js";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { registerCommandPlaneHooks } from "../../src/command-plane/hooks.js";
import { buildToolDefinitions } from "../../src/mcp-server.js";

/**
 * FR-024 / OD-010: TokenHooks.beforeDispatch is step 4 of dispatch-task
 * (`command-plane/dispatch.ts`). External begin-task never enters that step.
 *
 * Idle wake and away tick call dispatch-task only. Those fixtures are covered
 * by the P-001 plan; this file does not re-fixture them.
 */

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;

const PLAN = [
  "### Task T001: Dispatch path",
  "**Implements:** FR-024",
  "**Depends on:** none",
  "**Kind:** code",
  "**Complexity:** mechanical",
  "",
].join("\n");

afterEach(async () => {
  registerCommandPlaneHooks({ token: {}, engine: {}, learning: {}, hire: {} });
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("dispatch-task hook wiring", () => {
  it("does not run beforeDispatch on external begin-task", async () => {
    const r = await runBeginTaskWithoutDispatchPath({ featureId: "004-ira-token-context", taskId: "T001" });
    expect(r.code).toBe("DISPATCH_PATH_REQUIRED");
    expect(r.beforeDispatchCalls).toBe(0);
  });

  it("runs beforeDispatch once on dispatch-task success path", async () => {
    const r = await runDispatchTaskFixture({ featureId: "004-ira-token-context", taskId: "T001" });
    expect(r.beforeDispatchCalls).toBe(1);
  });
});

function installCountingHook(): { count: number } {
  const box = { count: 0 };
  registerCommandPlaneHooks({
    token: {
      beforeDispatch: async () => {
        box.count += 1;
        return { allow: true };
      },
    },
    // Host handoff: engine dispatch returns null, so the token gate runs once before begin-task.
    engine: { dispatch: async () => null },
  });
  return box;
}

async function runBeginTaskWithoutDispatchPath(input: {
  featureId: string;
  taskId: string;
}): Promise<{ code: string; beforeDispatchCalls: number }> {
  const repo = await staffedRepo(input.featureId);
  const calls = installCountingHook();
  const begin = mcpTool("begin-task");
  const result = await begin.handler({
    planText: PLAN,
    stateDir: repo.specDir,
    taskId: input.taskId,
  });
  const body = parseToolJson(result);
  const code = typeof body.error === "string" ? body.error : "";
  return { code, beforeDispatchCalls: calls.count };
}

async function runDispatchTaskFixture(input: {
  featureId: string;
  taskId: string;
}): Promise<{ beforeDispatchCalls: number }> {
  const repo = await staffedRepo(input.featureId);
  const ci = await hiveCiSet({
    hiveRoot: repo.hive,
    featureId: input.featureId,
    state: "green",
    source: "test",
  });
  if (!ci.ok) throw new Error(`ci-set failed: ${ci.error}`);
  const calls = installCountingHook();
  const dispatch = mcpTool("dispatch-task");
  const result = await dispatch.handler({
    featureId: input.featureId,
    taskId: input.taskId,
    cwd: repo.root,
  });
  const body = parseToolJson(result);
  if (body.ok !== true) {
    throw new Error(`dispatch-task fixture failed: ${result.content[0]?.text ?? ""}`);
  }
  return { beforeDispatchCalls: calls.count };
}

function mcpTool(name: string) {
  const found = buildToolDefinitions().find((entry) => entry.name === name);
  if (!found) throw new Error(`missing MCP tool ${name}`);
  return found;
}

function parseToolJson(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? "") as Record<string, unknown>;
}

async function staffedRepo(featureId: string): Promise<{ root: string; hive: string; specDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "tg-dispatch-"));
  roots.push(root);
  const specDir = join(root, "specs", featureId);
  await mkdir(specDir, { recursive: true });
  await writeFile(join(root, "program.md"), "# p\n");
  await writeFile(join(specDir, "plan.md"), PLAN);
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  if (!init.ok) throw new Error(`hive init failed: ${init.error}`);
  const submitted = await briefSubmit({
    cwd: root,
    featureId,
    outcome: "Steer one task through dispatch-task",
    deliverable: `specs/${featureId}`,
  });
  if (!submitted.ok) throw new Error(`brief submit failed: ${submitted.error}`);
  return { root, hive: join(root, ".superspec", "hive"), specDir };
}
