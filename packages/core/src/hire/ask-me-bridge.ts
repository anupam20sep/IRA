import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { listAskMe, openAskMeItem } from "../command-plane/ask-me.js";
import type { CommandPlaneErrorCode } from "../command-plane/types.js";
import { loadReview, updateReview } from "./review.js";

const QUESTION_LIMIT = 4000;

export class HireAskMeError extends Error {
  readonly code: CommandPlaneErrorCode;

  constructor(code: CommandPlaneErrorCode, message: string) {
    super(message);
    this.name = "HireAskMeError";
    this.code = code;
  }
}

export type OpenUntrustedImportInput = {
  hiveRoot: string;
  reviewId: string;
  sourceSummary: string;
};

/**
 * Open the weight-60 `untrusted_import` Ask-Me item for one hire review.
 * Repeating the same `reviewId` returns the open item already linked to it.
 * `taskId` stores that review id so command-plane dedupe does not merge
 * unrelated imports that share an empty forge task.
 */
export async function openUntrustedImportAskMe(
  input: OpenUntrustedImportInput,
): Promise<{ askMeId: string }> {
  const reviewId = input.reviewId.trim();
  if (reviewId.length === 0) {
    throw new HireAskMeError("INVALID_INPUT", "Review id is missing.");
  }

  const listed = await listAskMe({ hiveRoot: input.hiveRoot, state: "open" });
  if (!listed.ok) throw new HireAskMeError(listed.error, listed.message);

  const existing = listed.items.find(
    (item) => item.reasonClass === "untrusted_import" && linksReview(item, reviewId),
  );
  if (existing) {
    await storeAskMeId(input.hiveRoot, reviewId, existing.id);
    return { askMeId: existing.id };
  }

  await mkdir(join(input.hiveRoot, "locks"), { recursive: true, mode: 0o700 });
  const opened = await openAskMeItem({
    hiveRoot: input.hiveRoot,
    featureId: null,
    taskId: reviewId,
    agentId: null,
    reasonClass: "untrusted_import",
    question: importQuestion(reviewId, input.sourceSummary),
  });
  if (!opened.ok) throw new HireAskMeError(opened.error, opened.message);
  if (!linksReview(opened.item, reviewId)) {
    throw new HireAskMeError("INVALID_INPUT", "Ask-Me item is not linked to this review.");
  }

  await storeAskMeId(input.hiveRoot, reviewId, opened.item.id);
  return { askMeId: opened.item.id };
}

function linksReview(item: { taskId: string | null; question: string }, reviewId: string): boolean {
  if (item.taskId === reviewId) return true;
  return item.question.split(/\s+/).includes(reviewId);
}

function importQuestion(reviewId: string, sourceSummary: string): string {
  const summary = sourceSummary.trim() || "unknown source";
  const prefix = `Untrusted hire import ${reviewId} from `;
  if (prefix.length >= QUESTION_LIMIT) return prefix.slice(0, QUESTION_LIMIT);
  return `${prefix}${summary.slice(0, QUESTION_LIMIT - prefix.length)}`;
}

async function storeAskMeId(hiveRoot: string, reviewId: string, askMeId: string): Promise<void> {
  const review = await loadReview(hiveRoot, reviewId);
  if (!review || review.askMeId === askMeId || review.state !== "pending") return;
  await updateReview(hiveRoot, reviewId, { askMeId });
}
