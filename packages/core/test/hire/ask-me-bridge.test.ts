import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listAskMe } from "../../src/command-plane/ask-me.js";
import { openUntrustedImportAskMe } from "../../src/hire/ask-me-bridge.js";
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
  const hiveRoot = await mkdtemp(join(tmpdir(), "hire-ask-"));
  await writeFile(
    join(hiveRoot, "hive.json"),
    `${JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString() })}\n`,
  );
  return hiveRoot;
}

describe("openUntrustedImportAskMe", () => {
  it("creates untrusted_import Ask-Me item linked to review", async () => {
    const hiveRoot = await hive();
    const { askMeId } = await openUntrustedImportAskMe({
      hiveRoot,
      reviewId: "hrv_test",
      sourceSummary: "file:/tmp/m.yaml",
    });
    expect(askMeId.startsWith("ask_")).toBe(true);

    const listed = await listAskMe({ hiveRoot, state: "open" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const item = listed.items.find((row) => row.id === askMeId);
    expect(item?.reasonClass).toBe("untrusted_import");
    expect(item?.question).toContain("hrv_test");
    expect(item?.question).toContain("file:/tmp/m.yaml");
  });

  it("returns the existing open item when the same review is opened again", async () => {
    const hiveRoot = await hive();
    const first = await openUntrustedImportAskMe({
      hiveRoot,
      reviewId: "hrv_same",
      sourceSummary: "file:/tmp/m.yaml",
    });
    const second = await openUntrustedImportAskMe({
      hiveRoot,
      reviewId: "hrv_same",
      sourceSummary: "url:https://example.test/other.yaml",
    });
    const other = await openUntrustedImportAskMe({
      hiveRoot,
      reviewId: "hrv_other",
      sourceSummary: "file:/tmp/m.yaml",
    });
    expect(second.askMeId).toBe(first.askMeId);
    expect(other.askMeId).not.toBe(first.askMeId);

    const listed = await listAskMe({ hiveRoot, state: "open" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const linked = listed.items.filter((row) => row.reasonClass === "untrusted_import");
    expect(linked).toHaveLength(2);
  });

  it("stores askMeId on an existing pending review", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hire-ask-"));
    const review = await createPendingReview({
      hiveRoot,
      sourceKind: "file",
      sourceRef: "file:/tmp/m.yaml",
      approvalCopyVariant: "standard",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: [],
      contentSha256: "abc",
    });
    expect(review.askMeId).toBe("pending");
    await writeFile(
      join(hiveRoot, "hive.json"),
      `${JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString() })}\n`,
    );

    const { askMeId } = await openUntrustedImportAskMe({
      hiveRoot,
      reviewId: review.reviewId,
      sourceSummary: review.sourceRef,
    });
    expect(askMeId.startsWith("ask_")).toBe(true);
    expect((await loadReview(hiveRoot, review.reviewId))?.askMeId).toBe(askMeId);

    await updateReview(hiveRoot, review.reviewId, { askMeId: "pending" });
    const again = await openUntrustedImportAskMe({
      hiveRoot,
      reviewId: review.reviewId,
      sourceSummary: "paste",
    });
    expect(again.askMeId).toBe(askMeId);
    expect((await loadReview(hiveRoot, review.reviewId))?.askMeId).toBe(askMeId);
  });
});

describe("createPendingReview Ask-Me", () => {
  it("opens untrusted_import for file and gallery reviews", async () => {
    const hiveRoot = await hive();
    await mkdir(join(hiveRoot, "events"), { recursive: true });
    const fileReview = await createPendingReview({
      hiveRoot,
      sourceKind: "file",
      sourceRef: "file:/tmp/m.yaml",
      approvalCopyVariant: "standard",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: [],
      contentSha256: "abc",
    });
    const galleryReview = await createPendingReview({
      hiveRoot,
      sourceKind: "gallery",
      sourceRef: "ios-developer",
      approvalCopyVariant: "curated_catalog",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: [],
      contentSha256: "def",
    });
    expect(fileReview.askMeId.startsWith("ask_")).toBe(true);
    expect(galleryReview.askMeId.startsWith("ask_")).toBe(true);
    expect(galleryReview.askMeId).not.toBe(fileReview.askMeId);

    const listed = await listAskMe({ hiveRoot, state: "open" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const byId = new Map(listed.items.map((item) => [item.id, item]));
    expect(byId.get(fileReview.askMeId)?.reasonClass).toBe("untrusted_import");
    expect(byId.get(fileReview.askMeId)?.question).toContain(fileReview.reviewId);
    expect(byId.get(fileReview.askMeId)?.question).toContain("file:/tmp/m.yaml");
    expect(byId.get(galleryReview.askMeId)?.reasonClass).toBe("untrusted_import");
    expect(byId.get(galleryReview.askMeId)?.question).toContain("ios-developer");

    const types = (await readFile(join(hiveRoot, "events", "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { type: string }).type);
    expect(types.filter((type) => type === "hire.import_started")).toHaveLength(2);
  });
});
