import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { runCli } from "../../src/cli.js";
import { buildToolDefinitions } from "../../src/mcp-server.js";
import { loadState } from "../../src/forge-loop.js";
import * as installMod from "../../src/learning-memory/install.js";
import { writePatternAtomic } from "../../src/learning-memory/pattern-io.js";
import * as pipeline from "../../src/learning-memory/pipeline.js";
import { openPatternIndex, upsertPattern } from "../../src/learning-memory/pattern-index.js";
import { registerCommandPlaneHooks } from "../../src/command-plane/hooks.js";

const PLAN = [
  "### Task T001: Wire forge",
  "**Implements:** FR-003",
  "**Complexity:** moderate",
  "**Kind:** code",
  "",
].join("\n");

const LESSON = "Seeded forge lesson for begin-task.";

const roots: string[] = [];
const logs: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;

beforeEach(() => {
  logs.length = 0;
  delete process.env.SUPERSPEC_ROOT;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  registerCommandPlaneHooks({ learning: {}, token: {}, hire: {}, engine: {} });
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("forge learning hooks", () => {
  it("begin-task includes prior patterns when the store is seeded", async () => {
    const repo = await seededRepo();
    const installed = vi.spyOn(installMod, "installLearningMemory");

    const verbose = await runCli([
      "begin-task",
      "--plan",
      repo.planPath,
      "--dir",
      repo.specDir,
      "--task",
      "T001",
      "-v",
    ]);
    expect(verbose.code).toBe(0);
    expect(verbose.stdout).toContain("## Prior patterns (learning memory)");
    expect(verbose.stdout).toContain(LESSON);
    expect(installed).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: repo.root }));

    const quiet = await runCli([
      "begin-task",
      "--plan",
      repo.planPath,
      "--dir",
      repo.specDir,
      "--task",
      "T001",
    ]);
    const payload = JSON.parse(quiet.stdout) as { patternCount?: number; patternIds?: string[] };
    expect(payload.patternCount).toBe(1);
    expect(payload.patternIds).toEqual(["pat_forge1"]);

    const tool = buildToolDefinitions().find((entry) => entry.name === "begin-task");
    if (!tool) throw new Error("missing begin-task tool");
    const mcp = await tool.handler({
      planText: PLAN,
      stateDir: repo.specDir,
      taskId: "T001",
      verbose: true,
    });
    expect(mcp.content[0]?.text).toContain("## Prior patterns (learning memory)");
    expect(mcp.content[0]?.text).toContain(LESSON);
  });

  it("record-result returns before background distill and skips Slice A writes", async () => {
    const repo = await seededRepo();
    const before = logs.length;
    const t0 = Date.now();
    const result = await runCli([
      "record-result",
      "--plan",
      repo.planPath,
      "--dir",
      repo.specDir,
      "--task",
      "T001",
      "--passed",
      "true",
      "-v",
    ]);
    const elapsed = Date.now() - t0;
    expect(result.code).toBe(0);
    expect(elapsed).toBeLessThan(500);
    expect(result.stdout).toContain("patterns: distill scheduled");
    expect(result.stdout).not.toContain("FAILED");
    expect(logs.slice(before).some((line) => line.includes("learning.phase=distill"))).toBe(false);

    await waitForLog("SLICE_A_ONLY");
    const names = (await readdir(repo.patternsDir)).filter((name) => name.endsWith(".md"));
    expect(names).toEqual(["pat_forge1.md"]);
  });

  it("does not change the record-result exit code when distill throws", async () => {
    const repo = await seededRepo();
    const impl = join(repo.specDir, ".superspec", "reports", "T001-implementer.md");
    const review = join(repo.specDir, ".superspec", "reports", "T001-reviewer.md");
    let captured: unknown;
    const schedule = vi.spyOn(pipeline, "scheduleLearningAfterRecordResult").mockImplementation((_root, ctx) => {
      captured = ctx;
      throw new Error("distill exploded");
    });

    const result = await runCli([
      "record-result",
      "--plan",
      repo.planPath,
      "--dir",
      repo.specDir,
      "--task",
      "T001",
      "--passed",
      "true",
      "--implementer-report",
      impl,
      "--reviewer-report",
      review,
    ]);

    expect(schedule).toHaveBeenCalled();
    expect(captured).toMatchObject({
      featureId: "003-demo",
      taskId: "T001",
      passed: true,
      reviewFailures: 0,
      kind: "code",
      implementsFr: ["FR-003"],
      implementerReport: impl,
      reviewerReport: review,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("FAILED");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, taskId: "T001", passed: true });
    expect(logs.some((line) => line.includes("distill exploded"))).toBe(true);
    expect(await loadState(repo.specDir)).toMatchObject({
      tasks: { T001: { status: "done", reviewFailures: 0 } },
    });
  });

  it("route-model adds patternHint and patternIds only when task context is passed", async () => {
    const repo = await seededRepo();
    const tool = buildToolDefinitions().find((entry) => entry.name === "route-model");
    if (!tool) throw new Error("missing route-model tool");

    const schema = z.object(tool.schema);
    expect(
      schema.parse({
        complexity: "moderate",
        taskId: "T001",
        planText: PLAN,
        implementsFr: ["FR-003"],
        featureId: "003-demo",
        projectRoot: repo.root,
      }).taskId,
    ).toBe("T001");

    const bare = JSON.parse((await tool.handler({ complexity: "mechanical" })).content[0]!.text) as {
      tier: string;
      patternHint?: string;
      patternIds?: string[];
    };
    expect(bare.tier).toBe("economy");
    expect(bare.patternHint).toBeUndefined();
    expect(bare.patternIds).toBeUndefined();

    const hinted = JSON.parse(
      (
        await tool.handler({
          complexity: "moderate",
          projectRoot: repo.root,
          taskId: "T001",
          featureId: "003-demo",
          planText: PLAN,
          implementsFr: ["FR-003"],
        })
      ).content[0]!.text,
    ) as { tier: string; patternHint?: string; patternIds?: string[] };
    expect(hinted.tier).toBe("standard");
    expect(hinted.patternIds).toEqual(["pat_forge1"]);
    expect(hinted.patternHint).toContain("Seeded forge lesson");

    const cli = await runCli([
      "route-model",
      "--complexity",
      "moderate",
      "--project-root",
      repo.root,
      "--task",
      "T001",
      "--plan",
      repo.planPath,
      "--feature",
      "003-demo",
    ]);
    expect(cli.code).toBe(0);
    const cliPayload = JSON.parse(cli.stdout) as { patternHint?: string; patternIds?: string[]; tier: string };
    expect(cliPayload.tier).toBe("standard");
    expect(cliPayload.patternIds).toEqual(["pat_forge1"]);
    expect(cliPayload.patternHint).toContain("Seeded forge lesson");
  });

  it("coordinator brief injects prior patterns for the next task", async () => {
    const repo = await seededRepo();
    const result = await runCli([
      "coordinator-brief",
      "--dir",
      repo.specDir,
      "--plan",
      repo.planPath,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("### Prior patterns for next task");
    expect(result.stdout).toContain(LESSON);
    expect(result.stdout).toContain("## Current position");
  });
});

async function seededRepo(): Promise<{
  root: string;
  specDir: string;
  planPath: string;
  patternsDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "lm-forge-"));
  roots.push(root);
  const specDir = join(root, "specs", "003-demo");
  const patternsDir = join(root, ".superspec", "patterns");
  await mkdir(specDir, { recursive: true });
  await writeFile(join(root, "program.md"), "# program\n", "utf8");
  const planPath = join(specDir, "plan.md");
  await writeFile(planPath, PLAN, "utf8");
  const record = {
    frontmatter: {
      id: "pat_forge1",
      kind: "success" as const,
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
      signals: { frTags: ["FR-003"], taskKind: "code" as const, featureId: "003-demo" },
      evidenceRefs: ["task:T001"],
      useCount: 0,
      status: "active" as const,
    },
    summary: LESSON,
  };
  await writePatternAtomic(patternsDir, record);
  const opened = openPatternIndex({
    indexPath: join(patternsDir, "index.sqlite"),
    lockPath: join(patternsDir, ".index.lock"),
  });
  try {
    if (opened.index && opened.indexAvailable) upsertPattern(opened.index, record);
  } finally {
    opened.close();
  }
  return { root, specDir, planPath, patternsDir };
}

async function waitForLog(needle: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (logs.some((line) => line.includes(needle))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for log containing ${needle}; saw ${logs.join(" | ")}`);
}
