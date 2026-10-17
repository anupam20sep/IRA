import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { routeModel } from "../model-router.js";
import type { LearningConfig } from "./config.js";
import type { PatternIndex } from "./index-sqlite.js";
import { writePatternAtomic, type PatternRecord } from "./pattern-io.js";
import { upsertPattern } from "./pattern-index.js";
import { redactPatternSummary } from "./redact.js";
import { resolvePatternWriteGate } from "./slice-gate.js";
import type { DistillContext } from "./types.js";

export type DistillPatternStore = {
  patternsDir: string;
  index: PatternIndex | null;
  indexAvailable: boolean;
  sliceAValidated: boolean;
};

export type DistillPatternResult = {
  written: boolean;
  patternId?: string;
  skipReason?: string;
};

const BULLET_LINE = /^\s*[-*]\s+(\S.*?)\s*$/;

/**
 * DISTILL one forge outcome into a heuristic pattern (FR-001, FR-004, FR-007, FR-013).
 *
 * `resolvePatternWriteGate` runs before any pattern file I/O (OD-020). Secrets skip
 * the write. The derived index is updated only when `indexAvailable` (FR-010).
 */
export async function distillPattern(
  ctx: DistillContext,
  store: DistillPatternStore,
  config: LearningConfig,
): Promise<DistillPatternResult> {
  const gate = resolvePatternWriteGate({ sliceAValidated: store.sliceAValidated });
  if (!gate.allowed) {
    return { written: false, skipReason: gate.code };
  }

  // Optional model path is config-gated. v1 has no completion client (NG4):
  // mechanical tasks select the economy tier, then heuristic bullets are stored.
  if (config.distill.mode === "model") {
    routeModel({ complexity: "mechanical" });
  }

  const implementerBullets = extractBullets(await readReportText(ctx.implementerReport));
  const reviewerBullets = extractBullets(await readReportText(ctx.reviewerReport));
  const bullets = [...implementerBullets, ...reviewerBullets];
  const lesson = lessonText(ctx, bullets);
  const redacted = redactPatternSummary(lesson);
  if (!redacted.ok) {
    return { written: false, skipReason: redacted.reason };
  }

  const summary = boundUtf8(redacted.text, config.maxSummaryBytes);
  const now = new Date().toISOString();
  const record = buildRecord(ctx, bullets, summary, now);
  await writePatternAtomic(store.patternsDir, record);
  if (store.indexAvailable && store.index) {
    upsertPattern(store.index, record);
  } else if (!store.indexAvailable) {
    console.error("PATTERNS_INDEX_UNAVAILABLE upsert skipped");
  }
  return { written: true, patternId: record.frontmatter.id };
}

function extractBullets(markdown: string): string[] {
  const bullets: string[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = BULLET_LINE.exec(line);
    if (!match?.[1]) continue;
    const text = match[1].replace(/^\[[ xX]\]\s+/, "").trim();
    if (text.length > 0) bullets.push(text);
  }
  return bullets;
}

function lessonText(ctx: DistillContext, bullets: string[]): string {
  if (bullets.length > 0) {
    return bullets.map((bullet) => `- ${bullet}`).join("\n");
  }
  const fr = ctx.implementsFr.length > 0 ? ctx.implementsFr.join(", ") : "the task";
  const outcome = ctx.passed ? "passed" : "failed";
  const reviews =
    !ctx.passed && (ctx.reviewFailures ?? 0) > 0
      ? ` Review failures: ${ctx.reviewFailures}.`
      : "";
  return `Task ${ctx.taskId} ${outcome} (${ctx.kind}) for ${fr}.${reviews}`;
}

function deriveErrorClass(ctx: DistillContext, bullets: string[]): string | undefined {
  if (ctx.passed) return undefined;
  for (const bullet of bullets) {
    const match = /\berrorClass:\s*([A-Za-z][A-Za-z0-9_.-]*)/.exec(bullet);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function buildRecord(
  ctx: DistillContext,
  bullets: string[],
  summary: string,
  now: string,
): PatternRecord {
  const errorClass = deriveErrorClass(ctx, bullets);
  const signals: PatternRecord["frontmatter"]["signals"] = {
    frTags: ctx.implementsFr.filter((tag) => tag.length > 0),
    taskKind: ctx.kind,
    featureId: ctx.featureId,
  };
  if (ctx.engine) signals.engine = ctx.engine;
  if (errorClass) signals.errorClass = errorClass;

  const evidenceRefs = [`task:${ctx.taskId}`];
  if (ctx.implementerReport) evidenceRefs.push(`report:${ctx.implementerReport}`);
  if (ctx.reviewerReport) evidenceRefs.push(`report:${ctx.reviewerReport}`);

  return {
    frontmatter: {
      id: `pat_${randomBytes(12).toString("hex")}`,
      kind: ctx.passed ? "success" : "failure",
      createdAt: now,
      updatedAt: now,
      signals,
      evidenceRefs,
      useCount: 0,
      status: "active",
    },
    summary,
  };
}

async function readReportText(path: string | null | undefined): Promise<string> {
  if (!path) return "";
  try {
    return await readFile(path, "utf8");
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return "";
    }
    throw err;
  }
}

function boundUtf8(text: string, maxBytes: number): string {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return "";
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = maxBytes;
  while (end > 0) {
    try {
      return decoder.decode(bytes.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return "";
}
