import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { runCli } from "../../src/cli.js";
import { buildToolDefinitions } from "../../src/mcp-server.js";
import { initState, loadState, saveState } from "../../src/forge-loop.js";
import { DEFAULT_LEARNING_CONFIG } from "../../src/learning-memory/config.js";
import { distillPattern } from "../../src/learning-memory/distill.js";
import { resolvePatternStoreRoot } from "../../src/learning-memory/paths.js";
import { listPatterns } from "../../src/learning-memory/query.js";
import type { Task } from "../../src/types.js";
import * as installMod from "../../src/learning-memory/install.js";
import { writePatternAtomic } from "../../src/learning-memory/pattern-io.js";
import * as pipeline from "../../src/learning-memory/pipeline.js";
import { openPatternIndex, upsertPattern } from "../../src/learning-memory/pattern-index.js";
import { registerCommandPlaneHooks } from "../../src/command-plane/hooks.js";
import * as dispatch from "../../src/engines/dispatch.js";

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

describe("pattern store survives forge state compaction", () => {
  it("retains patterns after ten state re-inits", async () => {
    const repo = await bareRepo();
    const tasks: Task[] = [
      {
        id: "T001",
        title: "Wire forge",
        frRefs: ["FR-006"],
        dependsOn: [],
        complexity: "moderate",
        kind: "code",
      },
    ];
    const stateFile = join(repo.specDir, ".superspec", "state.json");
    const before = await countPatternMarkdown(repo.root);

    const distilled = await distillOnePattern(repo.specDir, { sliceAValidated: true });
    expect(distilled.repositoryRoot).toBe(repo.root);
    expect(distilled.patternsDir).toBe(join(repo.root, ".superspec", "patterns"));
    expect(distilled.patternsDir.startsWith(repo.specDir)).toBe(false);

    const written = await countPatternMarkdown(repo.root);
    expect(written).toBe(before + 1);
    const snapshot = await snapshotPatternMarkdown(distilled.patternsDir);

    for (let i = 0; i < 10; i++) {
      await rm(stateFile, { force: true });
      await saveState(repo.specDir, initState(tasks));
    }

    expect(await countPatternMarkdown(repo.root)).toBe(written);
    expect(await snapshotPatternMarkdown(distilled.patternsDir)).toEqual(snapshot);
    const listed = await listPatterns({ projectRoot: repo.root, limit: 10 });
    expect(listed.patterns.length).toBeGreaterThan(0);
    expect(listed.patterns.length).toBe(written);
    expect(listed.patterns.map((pattern) => pattern.id)).toContain(distilled.patternId);
    expect(await loadState(repo.specDir)).toEqual(initState(tasks));
    expect(await readdir(join(repo.specDir, ".superspec"))).toEqual(["state.json"]);
  });
});

describe("OD-016 record-result isolation", () => {
  it("does not change exit code when background distill throws", async () => {
    let specDir = "";
    await withSlowDistillMock(async () => {
      const started = Date.now();
      const result = await runRecordResultFixture({ passed: true });
      specDir = result.repo.specDir;
      expect(result.code).toBe(0);
      expect(Date.now() - started).toBeLessThan(500);
      expect(result.stdout).not.toContain("FAILED");
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, taskId: "T001", passed: true });
      expect(logs.some((line) => line.includes("background distill exploded"))).toBe(false);
    });
    expect(logs.some((line) => line.includes("background distill exploded"))).toBe(true);
    expect(await loadState(specDir)).toMatchObject({
      tasks: { T001: { status: "done", reviewFailures: 0 } },
    });
  });
});

describe("OD-020 Slice A distill", () => {
  it("writes no pattern md when sliceAValidated is false", async () => {
    const repo = await bareRepo();
    await withDoctorSnapshot({ sliceAValidated: false }, async () => {
      const { code } = await runRecordResultFixture({ passed: true, repo });
      expect(code).toBe(0);
      await waitForLog("SLICE_A_ONLY");
      expect(await countPatternMarkdown(repo.root)).toBe(0);
    });
  });
});

async function seededRepo(): Promise<{
  root: string;
  specDir: string;
  planPath: string;
  patternsDir: string;
}> {
  const repo = await bareRepo();
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
  await writePatternAtomic(repo.patternsDir, record);
  const opened = openPatternIndex({
    indexPath: join(repo.patternsDir, "index.sqlite"),
    lockPath: join(repo.patternsDir, ".index.lock"),
  });
  try {
    if (opened.index && opened.indexAvailable) upsertPattern(opened.index, record);
  } finally {
    opened.close();
  }
  return repo;
}

async function bareRepo(): Promise<{
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
  return { root, specDir, planPath, patternsDir };
}

async function runRecordResultFixture(input: {
  passed: boolean;
  repo?: { root: string; specDir: string; planPath: string };
}): Promise<{ code: number; stdout: string; repo: { root: string; specDir: string; planPath: string } }> {
  const repo = input.repo ?? (await bareRepo());
  const result = await runCli([
    "record-result",
    "--plan",
    repo.planPath,
    "--dir",
    repo.specDir,
    "--task",
    "T001",
    "--passed",
    input.passed ? "true" : "false",
  ]);
  return { code: result.code, stdout: result.stdout, repo };
}

/**
 * Hang DISTILL past the record-result return, then reject off-stack (OD-016).
 * The handler must already have exited before the rejection is logged.
 */
async function withSlowDistillMock(run: () => Promise<void>): Promise<void> {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const realSchedule = pipeline.scheduleLearningAfterRecordResult;
  const spy = vi.spyOn(pipeline, "scheduleLearningAfterRecordResult").mockImplementation((root, ctx) => {
    realSchedule(root, ctx, {
      runDistill: () =>
        gate.then(() => {
          throw new Error("background distill exploded");
        }),
    });
  });
  try {
    await run();
    release();
    await waitForLog("background distill exploded");
  } finally {
    spy.mockRestore();
  }
}

/** Inject the doctor snapshot the distill write gate reads (OD-020). */
async function withDoctorSnapshot(
  snapshot: { sliceAValidated: boolean },
  run: () => Promise<void>,
): Promise<void> {
  const spy = vi.spyOn(dispatch, "readSliceAValidated").mockResolvedValue(snapshot.sliceAValidated);
  try {
    await run();
    if (spy.mock.calls.length === 0) {
      throw new Error("doctor snapshot was not consulted");
    }
  } finally {
    spy.mockRestore();
  }
}

/** Distill one pattern into the store resolved from the spec directory. */
async function distillOnePattern(
  specDir: string,
  opts: { sliceAValidated: boolean },
): Promise<{ patternId: string; patternsDir: string; repositoryRoot: string }> {
  const store = resolvePatternStoreRoot(specDir);
  if (!store.ok) throw new Error(store.message);
  const opened = openPatternIndex({
    indexPath: store.indexPath,
    lockPath: store.lockPath,
  });
  try {
    const result = await distillPattern(
      {
        featureId: "003-demo",
        taskId: "T001",
        passed: true,
        reviewFailures: 0,
        kind: "code",
        implementsFr: ["FR-006"],
      },
      {
        patternsDir: store.patternsDir,
        index: opened.index,
        indexAvailable: opened.indexAvailable,
        sliceAValidated: opts.sliceAValidated,
      },
      DEFAULT_LEARNING_CONFIG,
    );
    if (!result.written || !result.patternId) {
      throw new Error(`distill did not write a pattern: ${result.skipReason ?? "unknown"}`);
    }
    return {
      patternId: result.patternId,
      patternsDir: store.patternsDir,
      repositoryRoot: store.repositoryRoot,
    };
  } finally {
    opened.close();
  }
}

async function snapshotPatternMarkdown(patternsDir: string): Promise<Record<string, string>> {
  const names = (await readdir(patternsDir)).filter((name) => name.endsWith(".md")).sort();
  const bodies: Record<string, string> = {};
  for (const name of names) {
    bodies[name] = await readFile(join(patternsDir, name), "utf8");
  }
  return bodies;
}

async function countPatternMarkdown(repoRoot: string): Promise<number> {
  try {
    const names = await readdir(join(repoRoot, ".superspec", "patterns"));
    return names.filter((name) => name.endsWith(".md")).length;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return 0;
    throw err;
  }
}

async function waitForLog(needle: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (logs.some((line) => line.includes(needle))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for log containing ${needle}; saw ${logs.join(" | ")}`);
}
