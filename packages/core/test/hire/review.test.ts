import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HIRE_TRUST_BANNER } from "../../src/hire/constants.js";
import { createPendingReview, loadReview, updateReview } from "../../src/hire/review.js";
import type { HireManifest, SanitizationReport } from "../../src/hire/types.js";

const MANIFEST: HireManifest = {
  id: "x",
  displayName: "X",
  goal: "g",
  capabilityTags: ["qa"],
  suggestedEngine: "cursor",
  suggestedModelTier: "standard",
  budget: { tokens: 1, usd: 1 },
  allowlists: { skills: [], mcp: [] },
  persona: { harness: "cursor", scope: "project", body: "b" },
  schemaVersion: "hireManifest/v1",
};

function report(): SanitizationReport {
  return {
    droppedKeys: [],
    rejected: [],
    warnings: [],
    contentSha256: "abc",
    sanitizedAt: new Date().toISOString(),
  };
}

async function hive(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hire-review-"));
}

describe("createPendingReview", () => {
  it("persists pending review without roster side effects", async () => {
    const hiveRoot = await hive();
    const review = await createPendingReview({
      hiveRoot,
      sourceKind: "file",
      sourceRef: "/tmp/manifest.yaml",
      approvalCopyVariant: "standard",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: [],
      contentSha256: "abc",
    });
    expect(review.state).toBe("pending");
    expect(review.reviewId.startsWith("hrv_")).toBe(true);
    expect(review.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);

    const stored = JSON.parse(
      await readFile(join(hiveRoot, "hire", "reviews", `${review.reviewId}.json`), "utf8"),
    ) as { state: string; uiCopy: { trustBanner: string } };
    expect(stored.state).toBe("pending");
    expect(stored.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);
    await expect(access(join(hiveRoot, "roster.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(hiveRoot, "locks", "ledger-hire-reviews.lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stores the same trust banner for gallery imports", async () => {
    const hiveRoot = await hive();
    const review = await createPendingReview({
      hiveRoot,
      sourceKind: "gallery",
      sourceRef: "ios-developer",
      approvalCopyVariant: "curated_catalog",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: [],
      contentSha256: "abc",
    });
    expect(review.approvalCopyVariant).toBe("curated_catalog");
    expect(review.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);
    expect(review.uiCopy.trustBanner).toBe("Untrusted import — review all fields before spawn.");
  });

  it("appends hire.import_started when the hive event log is writable", async () => {
    const hiveRoot = await hive();
    await mkdir(join(hiveRoot, "events"), { recursive: true });
    const review = await createPendingReview({
      hiveRoot,
      sourceKind: "paste",
      sourceRef: "paste",
      approvalCopyVariant: "standard",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: [],
      contentSha256: "abc",
    });
    const lines = (await readFile(join(hiveRoot, "events", "events.jsonl"), "utf8")).trim().split("\n");
    const event = JSON.parse(lines[0]) as { type: string; data: Record<string, string> };
    expect(event.type).toBe("hire.import_started");
    expect(event.data).toMatchObject({
      reviewId: review.reviewId,
      sourceKind: "paste",
      contentSha256: "abc",
    });
  });

  it("does not create an event log when the events directory is absent", async () => {
    const hiveRoot = await hive();
    await createPendingReview({
      hiveRoot,
      sourceKind: "url",
      sourceRef: "https://example.test/m.yaml",
      approvalCopyVariant: "standard",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: [],
      contentSha256: "abc",
    });
    await expect(access(join(hiveRoot, "events", "events.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to write while another live process holds the review lock", async () => {
    const hiveRoot = await hive();
    const lockDir = join(hiveRoot, "locks");
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      join(lockDir, "ledger-hire-reviews.lock"),
      `${JSON.stringify({ pid: process.pid, nonce: "held", acquiredAt: new Date().toISOString() })}\n`,
    );
    await expect(
      createPendingReview({
        hiveRoot,
        sourceKind: "file",
        sourceRef: "/tmp/manifest.yaml",
        approvalCopyVariant: "standard",
        sanitizationReport: report(),
        parsedManifest: MANIFEST,
        skillConsents: [],
        contentSha256: "abc",
      }),
    ).rejects.toMatchObject({ code: "HIRE_REVIEW_LOCKED" });
  }, 10_000);
});

describe("loadReview", () => {
  it("returns the persisted review and null when missing", async () => {
    const hiveRoot = await hive();
    const review = await createPendingReview({
      hiveRoot,
      sourceKind: "file",
      sourceRef: "/tmp/manifest.yaml",
      approvalCopyVariant: "standard",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: [],
      contentSha256: "abc",
    });
    const loaded = await loadReview(hiveRoot, review.reviewId);
    expect(loaded).toEqual(review);
    expect(await loadReview(hiveRoot, "hrv_00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await loadReview(hiveRoot, "../roster")).toBeNull();
  });
});

describe("updateReview", () => {
  it("patches a pending review and appends hire.review_updated", async () => {
    const hiveRoot = await hive();
    await mkdir(join(hiveRoot, "events"), { recursive: true });
    const review = await createPendingReview({
      hiveRoot,
      sourceKind: "file",
      sourceRef: "/tmp/manifest.yaml",
      approvalCopyVariant: "standard",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: [],
      contentSha256: "abc",
    });
    const updated = await updateReview(hiveRoot, review.reviewId, {
      askMeId: "ask_123",
      state: "cancelled",
    });
    expect(updated.state).toBe("cancelled");
    expect(updated.askMeId).toBe("ask_123");
    expect(updated.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);
    expect(updated.createdAt).toBe(review.createdAt);
    expect(updated.reviewId).toBe(review.reviewId);

    const lines = (await readFile(join(hiveRoot, "events", "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; data: { reviewId: string } });
    expect(lines.map((event) => event.type)).toEqual(["hire.import_started", "hire.review_updated"]);
    expect(lines[1]?.data.reviewId).toBe(review.reviewId);
    await expect(access(join(hiveRoot, "roster.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects transitions out of a terminal state and missing ids", async () => {
    const hiveRoot = await hive();
    const review = await createPendingReview({
      hiveRoot,
      sourceKind: "file",
      sourceRef: "/tmp/manifest.yaml",
      approvalCopyVariant: "standard",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: [],
      contentSha256: "abc",
    });
    await updateReview(hiveRoot, review.reviewId, { state: "spawned" });
    await expect(updateReview(hiveRoot, review.reviewId, { state: "cancelled" })).rejects.toMatchObject({
      code: "HIRE_INVALID_TRANSITION",
    });
    await expect(updateReview(hiveRoot, "hrv_00000000-0000-4000-8000-000000000001", { state: "cancelled" })).rejects.toMatchObject({
      code: "HIRE_REVIEW_NOT_FOUND",
    });
  });
});
