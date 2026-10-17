import { describe, it, expect, vi, afterEach } from "vitest";
import { access, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { redactPatternSummary } from "../../src/learning-memory/redact.js";
import { distillPattern } from "../../src/learning-memory/distill.js";
import {
  DEFAULT_LEARNING_CONFIG,
  type LearningConfig,
} from "../../src/learning-memory/config.js";
import { readPatternFile } from "../../src/learning-memory/pattern-io.js";
import type { PatternIndex } from "../../src/learning-memory/index-sqlite.js";
import type { DistillContext } from "../../src/learning-memory/types.js";
import * as modelRouter from "../../src/model-router.js";

describe("redactPatternSummary", () => {
  it("rejects api-key-like strings", () => {
    const r = redactPatternSummary("Use sk-live-abcdefghijklmnopqrstuvwxyz1234567890");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("SECRET_DETECTED");
  });

  it("passes clean lesson text", () => {
    const r = redactPatternSummary("Prefer atomic writes when updating forge state.");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain("atomic writes");
  });
});

function defaultConfig(overrides: Partial<LearningConfig> = {}): LearningConfig {
  return {
    ...DEFAULT_LEARNING_CONFIG,
    features: {},
    ...overrides,
    distill: overrides.distill ?? { mode: "heuristic" },
  };
}

function mockIndex(): PatternIndex & { upsert: ReturnType<typeof vi.fn> } {
  return {
    search: () => [],
    upsert: vi.fn(),
    close: () => undefined,
  };
}

async function makeTempStoreFixture(
  overrides: {
    index?: PatternIndex | null;
    indexAvailable?: boolean;
    sliceAValidated?: boolean;
  } = {},
) {
  const patternsDir = await mkdtemp(join(tmpdir(), "lm-distill-"));
  const index = overrides.index === undefined ? mockIndex() : overrides.index;
  return {
    patternsDir,
    index,
    indexAvailable: overrides.indexAvailable ?? true,
    sliceAValidated: overrides.sliceAValidated ?? true,
  };
}

function passingContext(overrides: Partial<DistillContext> = {}): DistillContext {
  return {
    featureId: "003-ira-learning-memory",
    taskId: "T011",
    passed: true,
    reviewFailures: 0,
    kind: "code",
    implementsFr: ["FR-001"],
    implementerReport: undefined,
    reviewerReport: undefined,
    ...overrides,
  };
}

async function writeReport(name: string, body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lm-distill-report-"));
  const path = join(dir, name);
  await writeFile(path, body, "utf8");
  return path;
}

async function writtenRecord(patternsDir: string) {
  const names = (await readdir(patternsDir)).filter((name) => name.startsWith("pat_") && name.endsWith(".md"));
  expect(names).toHaveLength(1);
  return readPatternFile(join(patternsDir, names[0]!));
}

describe("distillPattern", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes success pattern from passing task context", async () => {
    const store = await makeTempStoreFixture();
    const result = await distillPattern(
      {
        featureId: "003-ira-learning-memory",
        taskId: "T011",
        passed: true,
        reviewFailures: 0,
        kind: "code",
        implementsFr: ["FR-001"],
        implementerReport: undefined,
        reviewerReport: undefined,
      },
      store,
      defaultConfig(),
    );
    expect(result.written).toBe(true);
    expect(result.patternId).toMatch(/^pat_/);
  });

  it("returns SLICE_A_ONLY with no pattern file I/O when the write gate is closed", async () => {
    const patternsDir = join(tmpdir(), `lm-distill-gate-${randomBytes(4).toString("hex")}`);
    const index = mockIndex();
    const result = await distillPattern(
      passingContext({ implementerReport: join(patternsDir, "missing-report.md") }),
      {
        patternsDir,
        index,
        indexAvailable: true,
        sliceAValidated: false,
      },
      defaultConfig(),
    );
    expect(result).toEqual({ written: false, skipReason: "SLICE_A_ONLY" });
    expect(index.upsert).not.toHaveBeenCalled();
    await expect(access(patternsDir)).rejects.toThrow();
  });

  it("classifies a failed outcome as a failure pattern with evidence refs", async () => {
    const store = await makeTempStoreFixture();
    const reviewerReport = await writeReport(
      "T011-reviewer.md",
      ["Transcript of the review session must stay out of the store.", "- errorClass: ZodError", "- Reject unsafe pattern ids."].join("\n"),
    );
    const result = await distillPattern(
      passingContext({
        passed: false,
        reviewFailures: 2,
        reviewerReport,
        implementsFr: ["FR-013", "FR-010"],
        engine: "cursor",
      }),
      store,
      defaultConfig(),
    );
    expect(result.written).toBe(true);
    const record = await writtenRecord(store.patternsDir);
    expect(record.frontmatter.id).toBe(result.patternId);
    expect(record.frontmatter.kind).toBe("failure");
    expect(record.frontmatter.signals.taskKind).toBe("code");
    expect(record.frontmatter.signals.frTags).toEqual(["FR-013", "FR-010"]);
    expect(record.frontmatter.signals.featureId).toBe("003-ira-learning-memory");
    expect(record.frontmatter.signals.engine).toBe("cursor");
    expect(record.frontmatter.signals.errorClass).toBe("ZodError");
    expect(record.frontmatter.evidenceRefs).toEqual([
      "task:T011",
      `report:${reviewerReport}`,
    ]);
    expect(record.summary).toContain("errorClass: ZodError");
    expect(record.summary).toContain("Reject unsafe pattern ids.");
    expect(record.summary).not.toContain("Transcript of the review session");
    expect(record.frontmatter.useCount).toBe(0);
    expect(record.frontmatter.status).toBe("active");
  });

  it("keeps heuristic bullets from reports and drops transcript prose", async () => {
    const store = await makeTempStoreFixture();
    const implementerReport = await writeReport(
      "T011-implementer.md",
      [
        "Full raw transcript follows and must not be persisted.",
        "```",
        "- this fenced bullet is transcript noise",
        "```",
        "- Prefer atomic writes when updating forge state.",
      ].join("\n"),
    );
    const result = await distillPattern(
      passingContext({ implementerReport }),
      store,
      defaultConfig(),
    );
    expect(result.written).toBe(true);
    const record = await writtenRecord(store.patternsDir);
    expect(record.frontmatter.kind).toBe("success");
    expect(record.summary).toContain("Prefer atomic writes when updating forge state.");
    expect(record.summary).not.toContain("Full raw transcript");
    expect(record.summary).not.toContain("fenced bullet");
    expect(record.frontmatter.evidenceRefs).toContain(`report:${implementerReport}`);
    expect(record.frontmatter.evidenceRefs).toContain("task:T011");
  });

  it("skips the write when a lesson bullet contains a secret", async () => {
    const index = mockIndex();
    const store = await makeTempStoreFixture({ index });
    const implementerReport = await writeReport(
      "T011-implementer.md",
      "- Use sk-live-abcdefghijklmnopqrstuvwxyz1234567890 in the client.\n",
    );
    const result = await distillPattern(
      passingContext({ implementerReport }),
      store,
      defaultConfig(),
    );
    expect(result).toEqual({ written: false, skipReason: "SECRET_DETECTED" });
    const names = (await readdir(store.patternsDir)).filter((name) => name.endsWith(".md"));
    expect(names).toEqual([]);
    expect(index.upsert).not.toHaveBeenCalled();
  });

  it("upserts the index only when the index is available", async () => {
    const available = mockIndex();
    const availableStore = await makeTempStoreFixture({ index: available, indexAvailable: true });
    const written = await distillPattern(passingContext(), availableStore, defaultConfig());
    expect(written.written).toBe(true);
    expect(available.upsert).toHaveBeenCalledTimes(1);
    expect(available.upsert.mock.calls[0]?.[0].frontmatter.id).toBe(written.patternId);

    const unavailable = mockIndex();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unavailableStore = await makeTempStoreFixture({
      index: unavailable,
      indexAvailable: false,
    });
    const skipped = await distillPattern(passingContext({ taskId: "T012" }), unavailableStore, defaultConfig());
    expect(skipped.written).toBe(true);
    expect(skipped.patternId).toMatch(/^pat_/);
    expect(unavailable.upsert).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    const record = await writtenRecord(unavailableStore.patternsDir);
    expect(record.frontmatter.id).toBe(skipped.patternId);
  });

  it("bounds the persisted summary to maxSummaryBytes", async () => {
    const store = await makeTempStoreFixture();
    const implementerReport = await writeReport(
      "T011-implementer.md",
      [
        "- Prefer atomic writes when updating forge state in every package.",
        "- Keep pattern markdown as the canonical record.",
      ].join("\n"),
    );
    const result = await distillPattern(
      passingContext({ implementerReport }),
      store,
      defaultConfig({ maxSummaryBytes: 48 }),
    );
    expect(result.written).toBe(true);
    const record = await writtenRecord(store.patternsDir);
    expect(Buffer.byteLength(record.summary, "utf8")).toBeLessThanOrEqual(48);
    expect(record.summary).toContain("atomic writes");
    expect(record.summary).not.toContain("canonical record");
  });

  it("selects the economy tier only when distill.mode is model and still stores heuristic bullets", async () => {
    const routeSpy = vi.spyOn(modelRouter, "routeModel");
    const store = await makeTempStoreFixture();
    const implementerReport = await writeReport(
      "T011-implementer.md",
      "- Prefer atomic writes when updating forge state.\n",
    );

    const heuristic = await distillPattern(
      passingContext({ implementerReport }),
      store,
      defaultConfig({ distill: { mode: "heuristic" } }),
    );
    expect(heuristic.written).toBe(true);
    expect(routeSpy).not.toHaveBeenCalled();

    const modelStore = await makeTempStoreFixture();
    const modelReport = await writeReport(
      "T011-implementer.md",
      "- Prefer atomic writes when updating forge state.\n",
    );
    const modeled = await distillPattern(
      passingContext({ implementerReport: modelReport }),
      modelStore,
      defaultConfig({ distill: { mode: "model" } }),
    );
    expect(modeled.written).toBe(true);
    expect(routeSpy).toHaveBeenCalledTimes(1);
    expect(routeSpy).toHaveBeenCalledWith({ complexity: "mechanical" });
    expect(routeSpy.mock.results[0]?.value.tier).toBe("economy");
    const record = await writtenRecord(modelStore.patternsDir);
    expect(record.summary).toContain("Prefer atomic writes when updating forge state.");
  });
});
