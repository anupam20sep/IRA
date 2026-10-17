import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ensureTokenLayout, tokenRoot } from "../../src/token-governor/paths.js";
import { CompactionRecordSchema } from "../../src/token-governor/schema.js";
import { runCompaction, type CompactionContext } from "../../src/token-governor/compaction.js";

const baseCtx: CompactionContext = {
  featureId: "f",
  taskId: "T009",
  passed: true,
  agentId: "a",
  sessionId: "s",
};

async function freshHive(): Promise<string> {
  const hive = await mkdtemp(join(tmpdir(), "hive-"));
  await ensureTokenLayout(hive);
  return hive;
}

describe("compaction", () => {
  it("writes CompactionRecord without touching spend.jsonl", async () => {
    const hive = await freshHive();
    const spendPath = join(tokenRoot(hive), "spend.jsonl");
    const spendBefore = await readFile(spendPath);
    await runCompaction(hive, { featureId: "f", taskId: "T009", passed: true, agentId: "a", sessionId: "s" });
    const cmp = (await readFile(join(tokenRoot(hive), "compaction.jsonl"), "utf8")).trim();
    expect(cmp.length).toBeGreaterThan(0);
    await readFile(spendPath);
    expect(await readFile(spendPath)).toEqual(spendBefore);

    const record = CompactionRecordSchema.parse(JSON.parse(cmp));
    expect(record.id.startsWith("cmp_")).toBe(true);
    expect(record.taskId).toBe("T009");
    expect(record.passed).toBe(true);
    expect(record.agentId).toBe("a");
    expect(record.sessionId).toBe("s");
    expect(record.featureId).toBe("f");
    expect(record.strategy).toBe("compact-skipped");
    expect(record.strategiesAttempted).toEqual(["drop-tool-noise", "dedupe-reads", "compact-skipped"]);
  });

  it("returns compact-skipped and does not append while Slice A is active", async () => {
    const hive = await freshHive();
    const compactionPath = join(tokenRoot(hive), "compaction.jsonl");
    const before = await readFile(compactionPath);
    let engineCalled = false;
    const record = await runCompaction(hive, {
      ...baseCtx,
      sliceAActive: true,
      residualTokens: 90_000,
      engine: {
        async clear() {
          engineCalled = true;
          return true;
        },
      },
    });
    expect(engineCalled).toBe(false);
    expect(record.strategy).toBe("compact-skipped");
    expect(record.strategiesAttempted).toEqual(["compact-skipped"]);
    expect(record.passed).toBe(true);
    expect(CompactionRecordSchema.parse(record)).toEqual(record);
    expect(await readFile(compactionPath)).toEqual(before);
  });

  it("does not append when a resolved hive is not slice-A validated", async () => {
    const hive = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-hive-"));
    try {
      await ensureTokenLayout(hive);
      let engineCalled = false;
      const record = await runCompaction(hive, {
        ...baseCtx,
        residualTokens: 90_000,
        engine: {
          async clear() {
            engineCalled = true;
            return true;
          },
        },
      });
      expect(engineCalled).toBe(false);
      expect(record.strategy).toBe("compact-skipped");
      expect(record.strategiesAttempted).toEqual(["compact-skipped"]);
      expect((await readFile(join(tokenRoot(hive), "compaction.jsonl"), "utf8")).trim()).toBe("");
    } finally {
      await rm(hive, { recursive: true, force: true });
    }
  });

  it("compacts on a failed record-result", async () => {
    const hive = await freshHive();
    const record = await runCompaction(hive, { ...baseCtx, passed: false, taskId: "T002" });
    expect(record.passed).toBe(false);
    expect(record.taskId).toBe("T002");
    expect(record.strategy).toBe("compact-skipped");
    const lines = (await readFile(join(tokenRoot(hive), "compaction.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).passed).toBe(false);
  });

  it("treats task completion as the trigger even when residual is under the summarize bound", async () => {
    const hive = await freshHive();
    const record = await runCompaction(hive, { ...baseCtx, residualTokens: 0 });
    expect(record.strategy).toBe("compact-skipped");
    expect(record.strategiesAttempted).toEqual(["drop-tool-noise", "dedupe-reads", "compact-skipped"]);
    const cmp = (await readFile(join(tokenRoot(hive), "compaction.jsonl"), "utf8")).trim();
    expect(cmp.length).toBeGreaterThan(0);
  });

  it("attempts summarize only when residual exceeds the configured bound", async () => {
    const hive = await freshHive();
    const settingsPath = join(tokenRoot(hive), "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { compactionSummarizeThresholdTokens: number };
    settings.compactionSummarizeThresholdTokens = 100;
    await writeFile(settingsPath, JSON.stringify(settings));

    const under = await runCompaction(hive, { ...baseCtx, taskId: "under", residualTokens: 100 });
    const over = await runCompaction(hive, { ...baseCtx, taskId: "over", residualTokens: 101 });

    expect(under.strategiesAttempted).toEqual(["drop-tool-noise", "dedupe-reads", "compact-skipped"]);
    expect(over.strategiesAttempted).toEqual([
      "drop-tool-noise",
      "dedupe-reads",
      "summarize",
      "compact-skipped",
    ]);
    expect(over.strategy).toBe("compact-skipped");
    const lines = (await readFile(join(tokenRoot(hive), "compaction.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).taskId).toBe("under");
    expect(JSON.parse(lines[1]).taskId).toBe("over");
  });

  it("records compact-skipped when the engine cannot clear", async () => {
    const hive = await freshHive();
    const record = await runCompaction(hive, {
      ...baseCtx,
      residualTokens: 9000,
      engine: {
        async clear() {
          return false;
        },
      },
    });
    expect(record.strategy).toBe("compact-skipped");
    expect(record.strategiesAttempted).toEqual([
      "drop-tool-noise",
      "dedupe-reads",
      "summarize",
      "clear",
      "compact-skipped",
    ]);
  });

  it("stops after drop-tool-noise when that tier satisfies the bound", async () => {
    const hive = await freshHive();
    let deduped = false;
    const record = await runCompaction(hive, {
      ...baseCtx,
      residualTokens: 9000,
      engine: {
        async dropToolNoise() {
          return { residualTokens: 100 };
        },
        async dedupeReads() {
          deduped = true;
          return { residualTokens: 10 };
        },
      },
    });
    expect(deduped).toBe(false);
    expect(record.strategy).toBe("drop-tool-noise");
    expect(record.strategiesAttempted).toEqual(["drop-tool-noise"]);
  });

  it("stops at the first applied tier that brings residual under the bound", async () => {
    const hive = await freshHive();
    let summarized = false;
    const record = await runCompaction(hive, {
      ...baseCtx,
      residualTokens: 9000,
      engine: {
        async dropToolNoise(scratch) {
          return { residualTokens: scratch.residualTokens ?? 9000 };
        },
        async dedupeReads() {
          return { residualTokens: 500 };
        },
        async summarize() {
          summarized = true;
          return { residualTokens: 10 };
        },
      },
    });
    expect(summarized).toBe(false);
    expect(record.strategy).toBe("dedupe-reads");
    expect(record.strategiesAttempted).toEqual(["drop-tool-noise", "dedupe-reads"]);
  });

  it("summarizes when cheap tiers leave residual over the bound", async () => {
    const hive = await freshHive();
    let cleared = false;
    const record = await runCompaction(hive, {
      ...baseCtx,
      residualTokens: 9000,
      engine: {
        async dropToolNoise(scratch) {
          return scratch;
        },
        async dedupeReads(scratch) {
          return scratch;
        },
        async summarize() {
          return { residualTokens: 100 };
        },
        async clear() {
          cleared = true;
          return true;
        },
      },
    });
    expect(cleared).toBe(false);
    expect(record.strategy).toBe("summarize");
    expect(record.strategiesAttempted).toEqual(["drop-tool-noise", "dedupe-reads", "summarize"]);
  });

  it("clears when cheap tiers and summarize leave residual over the bound", async () => {
    const hive = await freshHive();
    const record = await runCompaction(hive, {
      ...baseCtx,
      residualTokens: 9000,
      engine: {
        async dropToolNoise(scratch) {
          return scratch;
        },
        async dedupeReads(scratch) {
          return scratch;
        },
        async summarize() {
          return { residualTokens: 8500 };
        },
        async clear() {
          return true;
        },
      },
    });
    expect(record.strategy).toBe("clear");
    expect(record.strategiesAttempted).toEqual(["drop-tool-noise", "dedupe-reads", "summarize", "clear"]);
  });

  it("leaves spend, budgets, breakers, and pattern files byte-identical", async () => {
    const hive = await freshHive();
    const token = tokenRoot(hive);
    const spendPath = join(token, "spend.jsonl");
    const budgetsPath = join(token, "budgets.json");
    const breakersPath = join(token, "breakers.json");
    await writeFile(spendPath, "{\"id\":\"spend_keep\"}\n");
    const patternsDir = join(hive, "patterns");
    await mkdir(patternsDir);
    const patternPath = join(patternsDir, "keep.md");
    await writeFile(patternPath, "pattern-body\n");

    const before = {
      spend: await readFile(spendPath),
      budgets: await readFile(budgetsPath),
      breakers: await readFile(breakersPath),
      pattern: await readFile(patternPath),
    };

    await runCompaction(hive, { ...baseCtx, residualTokens: 50_000 });

    expect(await readFile(spendPath)).toEqual(before.spend);
    expect(await readFile(budgetsPath)).toEqual(before.budgets);
    expect(await readFile(breakersPath)).toEqual(before.breakers);
    expect(await readFile(patternPath)).toEqual(before.pattern);
    const lines = (await readFile(join(token, "compaction.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
  });
});
