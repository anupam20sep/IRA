import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync, type Stats } from "node:fs";
import { join } from "node:path";
import { answerAskMe } from "../command-plane/ask-me.js";
import { IraEventSchema } from "../command-plane/schema.js";
import {
  EVENT_LOCK_WAIT_MS,
  appendJsonlLine,
  withLock,
} from "../command-plane/store.js";
import type { CommandPlaneErrorCode } from "../command-plane/types.js";
import { HireReviewError, loadReview, updateReview } from "./review.js";
import type { HireReview } from "./types.js";

const ASK_ME_PENDING = "pending";
const ASK_ID = /^ask_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class HireCancelError extends Error {
  readonly code: CommandPlaneErrorCode;

  constructor(code: CommandPlaneErrorCode, message: string) {
    super(message);
    this.name = "HireCancelError";
    this.code = code;
  }
}

/** Shared cancel writes for hire-spawn-cancel and Ask-Me acknowledge (OD-018). */
export async function cancelPendingHireReview(hiveRoot: string, reviewId: string): Promise<void> {
  const review = await loadReview(hiveRoot, reviewId);
  if (!review) {
    throw new HireReviewError("HIRE_REVIEW_NOT_FOUND", `Hire review ${reviewId} was not found.`);
  }
  if (review.state === "cancelled") {
    await resolveReviewAskMe(hiveRoot, review);
    return;
  }
  if (review.state !== "pending") {
    throw new HireReviewError(
      "HIRE_INVALID_TRANSITION",
      `Hire review ${reviewId} is ${review.state} and cannot be cancelled.`,
    );
  }

  await updateReview(hiveRoot, reviewId, { state: "cancelled" });
  await resolveReviewAskMe(hiveRoot, review);
  await appendHireCancelledEvent(hiveRoot, reviewId);
}

async function resolveReviewAskMe(hiveRoot: string, review: HireReview): Promise<void> {
  const askMeId = review.askMeId?.trim() ?? "";
  if (askMeId.length === 0 || askMeId === ASK_ME_PENDING || !ASK_ID.test(askMeId)) return;

  const result = await answerAskMe({
    hiveRoot,
    id: askMeId,
    text: "Hire import cancelled.",
    action: "acknowledge",
  });
  if (!result.ok && result.error === "ASK_ME_ALREADY_RESOLVED") return;
  if (!result.ok) throw new HireCancelError(result.error, result.message);
}

async function appendHireCancelledEvent(hiveRoot: string, reviewId: string): Promise<void> {
  const file = writableEventLog(hiveRoot);
  if (!file) return;

  const parsed = IraEventSchema.safeParse({
    id: `evt_${randomUUID()}`,
    type: "hire.cancelled",
    version: 1,
    ts: new Date().toISOString(),
    featureId: null,
    actor: { kind: "ira", id: "ira" },
    data: { reviewId },
  });
  if (!parsed.success) return;

  try {
    await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
      appendJsonlLine(file, parsed.data),
    );
  } catch {
    // A missing or unwritable log must not fail the cancel write.
  }
}

function writableEventLog(hiveRoot: string): string | null {
  const dir = join(hiveRoot, "events");
  const file = join(dir, "events.jsonl");
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    return null;
  }

  let info: Stats;
  try {
    info = statSync(file);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? file : null;
  }
  if (!info.isFile()) return null;
  try {
    accessSync(file, constants.W_OK);
    return file;
  } catch {
    return null;
  }
}
