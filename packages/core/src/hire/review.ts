import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync, type Stats } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { IraEventSchema } from "../command-plane/schema.js";
import {
  EVENT_LOCK_WAIT_MS,
  LEDGER_LOCK_WAIT_MS,
  appendJsonlLine,
  withLock,
  writeJsonAtomic,
} from "../command-plane/store.js";
import { HIRE_TRUST_BANNER } from "./constants.js";
import { HireReviewSchema } from "./schema.js";
import type {
  ApprovalCopyVariant,
  HireManifest,
  HireReview,
  HireReviewState,
  HireSourceKind,
  SanitizationReport,
  SkillConsent,
} from "./types.js";

/** Set until Ask-Me open stores a real `ask_` id. Schema requires a non-empty string. */
const ASK_ME_UNASSIGNED = "pending";

/** `ledger-*.lock` is a known hive lock name, so `withLock` can take it. */
const REVIEW_LOCK_NAME = "ledger-hire-reviews.lock";

const REVIEW_ID_RE = /^hrv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HireReviewErrorCode = "HIRE_REVIEW_NOT_FOUND" | "HIRE_REVIEW_LOCKED" | "HIRE_INVALID_TRANSITION";

export class HireReviewError extends Error {
  readonly code: HireReviewErrorCode;

  constructor(code: HireReviewErrorCode, message: string) {
    super(message);
    this.name = "HireReviewError";
    this.code = code;
  }
}

export type CreatePendingReviewInput = {
  hiveRoot: string;
  sourceKind: HireSourceKind;
  sourceRef: string;
  approvalCopyVariant: ApprovalCopyVariant;
  sanitizationReport: SanitizationReport;
  parsedManifest: HireManifest;
  skillConsents: SkillConsent[];
  contentSha256: string;
};

/** Fields a later review step may change. `uiCopy.trustBanner` is not patchable. */
export type HireReviewPatch = {
  state?: HireReviewState;
  askMeId?: string;
  operatorEdits?: Record<string, unknown>;
  skillConsents?: SkillConsent[];
  parsedManifest?: HireManifest;
  sanitizationReport?: SanitizationReport;
  contentSha256?: string;
  approvalCopyVariant?: ApprovalCopyVariant;
  sourceKind?: HireSourceKind;
  sourceRef?: string;
};

export async function createPendingReview(input: CreatePendingReviewInput): Promise<HireReview> {
  const now = new Date().toISOString();
  const review = HireReviewSchema.parse({
    reviewId: `hrv_${randomUUID()}`,
    state: "pending",
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    approvalCopyVariant: input.approvalCopyVariant,
    contentSha256: input.contentSha256,
    sanitizationReport: input.sanitizationReport,
    parsedManifest: input.parsedManifest,
    skillConsents: input.skillConsents,
    askMeId: ASK_ME_UNASSIGNED,
    uiCopy: trustCopy(),
    createdAt: now,
    updatedAt: now,
  });

  await ensureReviewDirs(input.hiveRoot);
  const locked = await withLock(reviewLockPath(input.hiveRoot), { waitMs: LEDGER_LOCK_WAIT_MS }, () =>
    writeJsonAtomic(reviewFile(input.hiveRoot, review.reviewId), review),
  );
  if (!locked.ok) {
    throw new HireReviewError("HIRE_REVIEW_LOCKED", "Hire review store is locked.");
  }

  await appendHireEvent(input.hiveRoot, "hire.import_started", {
    reviewId: review.reviewId,
    sourceKind: review.sourceKind,
    contentSha256: review.contentSha256,
  });
  return review;
}

export async function loadReview(hiveRoot: string, reviewId: string): Promise<HireReview | null> {
  return readStored(hiveRoot, reviewId);
}

export async function updateReview(
  hiveRoot: string,
  reviewId: string,
  patch: HireReviewPatch,
): Promise<HireReview> {
  await ensureReviewDirs(hiveRoot);
  const locked = await withLock(reviewLockPath(hiveRoot), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    const current = await readStored(hiveRoot, reviewId);
    if (!current) {
      throw new HireReviewError("HIRE_REVIEW_NOT_FOUND", `Hire review ${reviewId} was not found.`);
    }
    const next = applyPatch(current, patch);
    await writeJsonAtomic(reviewFile(hiveRoot, next.reviewId), next);
    return next;
  });
  if (!locked.ok) {
    throw new HireReviewError("HIRE_REVIEW_LOCKED", "Hire review store is locked.");
  }

  await appendHireEvent(hiveRoot, "hire.review_updated", { reviewId: locked.value.reviewId });
  return locked.value;
}

function applyPatch(current: HireReview, patch: HireReviewPatch): HireReview {
  if (current.state !== "pending") {
    throw new HireReviewError(
      "HIRE_INVALID_TRANSITION",
      `Hire review ${current.reviewId} is ${current.state} and cannot be updated.`,
    );
  }

  return HireReviewSchema.parse({
    ...current,
    ...definedPatch(patch),
    reviewId: current.reviewId,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    uiCopy: trustCopy(),
  });
}

function definedPatch(patch: HireReviewPatch): HireReviewPatch {
  const next: HireReviewPatch = {};
  if (patch.state !== undefined) next.state = patch.state;
  if (patch.askMeId !== undefined) next.askMeId = patch.askMeId;
  if (patch.operatorEdits !== undefined) next.operatorEdits = patch.operatorEdits;
  if (patch.skillConsents !== undefined) next.skillConsents = patch.skillConsents;
  if (patch.parsedManifest !== undefined) next.parsedManifest = patch.parsedManifest;
  if (patch.sanitizationReport !== undefined) next.sanitizationReport = patch.sanitizationReport;
  if (patch.contentSha256 !== undefined) next.contentSha256 = patch.contentSha256;
  if (patch.approvalCopyVariant !== undefined) next.approvalCopyVariant = patch.approvalCopyVariant;
  if (patch.sourceKind !== undefined) next.sourceKind = patch.sourceKind;
  if (patch.sourceRef !== undefined) next.sourceRef = patch.sourceRef;
  return next;
}

function trustCopy(): HireReview["uiCopy"] {
  return {
    trustBanner: HIRE_TRUST_BANNER,
    showFullSanitizationReport: true,
  };
}

async function readStored(hiveRoot: string, reviewId: string): Promise<HireReview | null> {
  if (!REVIEW_ID_RE.test(reviewId)) return null;
  try {
    const text = await readFile(reviewFile(hiveRoot, reviewId), "utf8");
    return HireReviewSchema.parse(JSON.parse(text));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function ensureReviewDirs(hiveRoot: string): Promise<void> {
  await mkdir(join(hiveRoot, "locks"), { recursive: true, mode: 0o700 });
  await mkdir(join(hiveRoot, "hire", "reviews"), { recursive: true, mode: 0o700 });
}

function reviewLockPath(hiveRoot: string): string {
  return join(hiveRoot, "locks", REVIEW_LOCK_NAME);
}

function reviewFile(hiveRoot: string, reviewId: string): string {
  return join(hiveRoot, "hire", "reviews", `${reviewId}.json`);
}

async function appendHireEvent(
  hiveRoot: string,
  type: "hire.import_started" | "hire.review_updated",
  data: Record<string, string>,
): Promise<void> {
  const file = writableEventLog(hiveRoot);
  if (!file) return;

  const parsed = IraEventSchema.safeParse({
    id: `evt_${randomUUID()}`,
    type,
    version: 1,
    ts: new Date().toISOString(),
    featureId: null,
    actor: { kind: "ira", id: "ira" },
    data,
  });
  if (!parsed.success) return;

  try {
    await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
      appendJsonlLine(file, parsed.data),
    );
  } catch {
    // A missing or unwritable log must not fail the review write.
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
