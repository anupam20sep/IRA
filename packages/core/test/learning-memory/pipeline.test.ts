import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_LEARNING_CONFIG, type LearningConfig } from "../../src/learning-memory/config.js";
import {
  runConsolidateAfterDistill,
  runDistillAfterResult,
  runRetrieveForTask,
  scheduleLearningAfterRecordResult,
  type LearningStore,
} from "../../src/learning-memory/pipeline.js";
import type { DistillContext, RetrieveContext } from "../../src/learning-memory/types.js";

const roots: string[] = [];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function logs(): string[] {
  return vi.mocked(console.error).mock.calls.map((call) => call.map(String).join(" "));
}

function defaultConfig(overrides: Partial<LearningConfig> = {}): LearningConfig {
  return {
    ...DEFAULT_LEARNING_CONFIG,
    features: { ...DEFAULT_LEARNING_CONFIG.features },
    ...overrides,
  };
}

function distillCtx(overrides: Partial<DistillContext> = {}): DistillContext {
  return {
    featureId: "003-ira-learning-memory",
    taskId: "T012",
    passed: true,
    reviewFailures: 0,
    kind: "code",
    implementsFr: ["FR-004"],
    ...overrides,
  };
}

function retrieveCtx(): RetrieveContext {
  return {
    featureId: "003-ira-learning-memory",
    taskId: "T012",
    implementsFr: ["FR-004"],
    kind: "code",
    complexity: "complex",
    capabilityTags: [],
  };
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lm-pipe-"));
  roots.push(root);
  return root;
}

function store(overrides: Partial<LearningStore> = {}): LearningStore {
  return {
    repositoryRoot: "repo-a",
    patternsDir: "/tmp/lm-pipe-patterns",
    index: null,
    indexAvailable: false,
    sliceAValidated: true,
    config: defaultConfig(),
    ...overrides,
  };
}

describe("runDistillAfterResult", () => {
  it("swallows distill errors without throwing", async () => {
    const failing = store({
      distill: vi.fn().mockRejectedValue(new Error("engine down")),
    });
    await expect(
      runDistillAfterResult(failing, { taskId: "T1", passed: true } as never),
    ).resolves.toBeUndefined();
    expect(logs().some((line) => line.includes("learning.phase=distill") && line.includes("engine down"))).toBe(
      true,
    );
  });

  it("abandons a hung distill at the hard timeout and still resolves", async () => {
    const hung = store({
      repositoryRoot: "hung-repo",
      distill: vi.fn().mockImplementation(() => new Promise(() => {})),
    });
    await expect(
      runDistillAfterResult(hung, distillCtx(), { timeoutMs: 30 }),
    ).resolves.toBeUndefined();
    expect(logs().some((line) => line.includes("learning.phase=distill") && line.includes("timeout"))).toBe(
      true,
    );
  });

  it("skips pattern writes and logs SLICE_A_ONLY when the write gate is closed", async () => {
    const root = await tempRoot();
    const patternsDir = join(root, ".superspec", "patterns");
    await mkdir(patternsDir, { recursive: true });
    const distill = vi.fn();
    await runDistillAfterResult(
      store({
        repositoryRoot: root,
        patternsDir,
        sliceAValidated: false,
        distill,
      }),
      distillCtx(),
    );
    // Injected distill is the phase body; the gate is enforced for the real writer.
    await runDistillAfterResult(
      store({
        repositoryRoot: root,
        patternsDir,
        sliceAValidated: false,
      }),
      distillCtx(),
    );
    expect(distill).toHaveBeenCalledOnce();
    const names = await readdir(patternsDir);
    expect(names.filter((name) => name.endsWith(".md"))).toEqual([]);
    expect(logs().some((line) => line.includes("learning.phase=distill") && line.includes("SLICE_A_ONLY"))).toBe(
      true,
    );
  });

  it("writes a pattern through distill when the write gate is open", async () => {
    const root = await tempRoot();
    const patternsDir = join(root, ".superspec", "patterns");
    await mkdir(patternsDir, { recursive: true });
    await runDistillAfterResult(
      store({
        repositoryRoot: root,
        patternsDir,
        sliceAValidated: true,
        indexAvailable: false,
        index: null,
      }),
      distillCtx(),
    );
    const names = (await readdir(patternsDir)).filter((name) => name.endsWith(".md"));
    expect(names).toHaveLength(1);
    expect(logs().some((line) => line.startsWith("learning.phase=distill"))).toBe(true);
  });

  it("serializes distill writes for the same repository", async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const shared = store({
      repositoryRoot: "same-repo",
      distill: vi
        .fn()
        .mockImplementationOnce(async () => {
          order.push("first-start");
          await gate;
          order.push("first-end");
        })
        .mockImplementationOnce(async () => {
          order.push("second");
        }),
    });
    const first = runDistillAfterResult(shared, distillCtx());
    await Promise.resolve();
    const second = runDistillAfterResult(shared, distillCtx());
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});

describe("runRetrieveForTask", () => {
  it("returns null and logs when retrieve throws", async () => {
    const summary = await runRetrieveForTask(
      store({
        retrieve: vi.fn().mockRejectedValue(new Error("fts down")),
      }),
      retrieveCtx(),
    );
    expect(summary).toBeNull();
    expect(logs().some((line) => line.includes("learning.phase=retrieve") && line.includes("fts down"))).toBe(
      true,
    );
  });

  it("skips injection when retrieve is disabled", async () => {
    const retrieve = vi.fn();
    const summary = await runRetrieveForTask(
      store({
        config: defaultConfig({ retrieve: false }),
        retrieve,
      }),
      retrieveCtx(),
    );
    expect(summary).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    expect(logs().some((line) => line.includes("learning.phase=retrieve") && line.includes("skip=disabled"))).toBe(
      true,
    );
  });
});

describe("runConsolidateAfterDistill", () => {
  it("swallows consolidate errors", async () => {
    await expect(
      runConsolidateAfterDistill(
        store({
          consolidate: vi.fn().mockRejectedValue(new Error("merge failed")),
        }),
        "pat_1",
      ),
    ).resolves.toBeUndefined();
    expect(
      logs().some((line) => line.includes("learning.phase=consolidate") && line.includes("merge failed")),
    ).toBe(true);
  });
});

describe("scheduleLearningAfterRecordResult", () => {
  it("returns void and runs distill on next tick", async () => {
    const fn = vi.fn();
    const root = "/tmp/lm-pipeline-schedule";
    const ctx = distillCtx();
    const scheduled = scheduleLearningAfterRecordResult(root, ctx, { runDistill: fn });
    expect(scheduled).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(fn).toHaveBeenCalled();
  });

  it("runs consolidate only after distill resolves in the same off-stack chain", async () => {
    const order: string[] = [];
    const root = "/tmp/lm-pipeline-chain";
    scheduleLearningAfterRecordResult(root, distillCtx(), {
      runDistill: async () => {
        order.push("distill");
        return "pat_chain";
      },
      runConsolidate: async (patternId) => {
        order.push(`consolidate:${patternId}`);
      },
    });
    expect(order).toEqual([]);
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(["distill", "consolidate:pat_chain"]);
  });

  it("does not consolidate when background distill times out", async () => {
    let consolidated = false;
    scheduleLearningAfterRecordResult("/tmp/lm-pipeline-timeout", distillCtx(), {
      runDistill: () => new Promise(() => {}),
      runConsolidate: async () => {
        consolidated = true;
      },
      distillTimeoutMs: 30,
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(consolidated).toBe(false);
    expect(logs().some((line) => line.includes("learning.phase=distill") && line.includes("timeout"))).toBe(
      true,
    );
  });

  it("distills then consolidates on the real off-stack chain when writes are allowed", async () => {
    const root = await tempRoot();
    const patternsDir = join(root, ".superspec", "patterns");
    await mkdir(patternsDir, { recursive: true });
    scheduleLearningAfterRecordResult(root, distillCtx(), {
      openStore: async () =>
        store({
          repositoryRoot: root,
          patternsDir,
          sliceAValidated: true,
          index: null,
          indexAvailable: false,
        }),
    });
    expect(logs().some((line) => line.startsWith("learning.phase=distill"))).toBe(false);
    await vi.waitFor(async () => {
      const names = (await readdir(patternsDir)).filter((name) => name.endsWith(".md"));
      expect(names).toHaveLength(1);
    });
    const phaseLogs = logs().filter((line) => line.startsWith("learning.phase="));
    const distillAt = phaseLogs.findIndex((line) => line.startsWith("learning.phase=distill"));
    const consolidateAt = phaseLogs.findIndex((line) => line.startsWith("learning.phase=consolidate"));
    expect(distillAt).toBeGreaterThanOrEqual(0);
    expect(consolidateAt).toBeGreaterThan(distillAt);
  });

  it("skips pattern writes on the real scheduler until slice A is validated", async () => {
    const prior = process.env.SUPERSPEC_ROOT;
    delete process.env.SUPERSPEC_ROOT;
    const root = await tempRoot();
    await writeFile(join(root, "program.md"), "# pipeline\n");
    try {
      scheduleLearningAfterRecordResult(root, distillCtx());
      await vi.waitFor(
        () => {
          expect(
            logs().some((line) => line.includes("learning.phase=distill") && line.includes("SLICE_A_ONLY")),
          ).toBe(true);
        },
        { timeout: 10_000 },
      );
      const patternsDir = join(root, ".superspec", "patterns");
      const names = await readdir(patternsDir).catch(() => [] as string[]);
      expect(names.filter((name) => name.endsWith(".md"))).toEqual([]);
    } finally {
      if (prior === undefined) delete process.env.SUPERSPEC_ROOT;
      else process.env.SUPERSPEC_ROOT = prior;
    }
  });

  it("does not consolidate when distill fails", async () => {
    const consolidate = vi.fn();
    scheduleLearningAfterRecordResult("/tmp/lm-pipeline-fail", distillCtx(), {
      runDistill: async () => {
        throw new Error("engine down");
      },
      runConsolidate: consolidate,
    });
    await new Promise((r) => setImmediate(r));
    expect(consolidate).not.toHaveBeenCalled();
  });
});
