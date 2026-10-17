import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listAskMe } from "../../src/command-plane/ask-me.js";
import { handleUntrustedImportAskMeAnswer } from "../../src/hire/ask-me-bridge.js";
import { createPendingReview, loadReview } from "../../src/hire/review.js";
import { hireSpawnCancel } from "../../src/hire/spawn.js";
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
  const hiveRoot = await mkdtemp(join(tmpdir(), "hire-cancel-"));
  await writeFile(
    join(hiveRoot, "hive.json"),
    `${JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString() })}\n`,
  );
  await mkdir(join(hiveRoot, "events"), { recursive: true });
  return hiveRoot;
}

describe("hire cancel paths (OD-018)", () => {
  it("hire-spawn-cancel marks review cancelled without roster changes", async () => {
    const hiveRoot = await hive();
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

    const res = await hireSpawnCancel(review.reviewId, { hiveRoot });
    expect(res.ok).toBe(true);
    expect(res.state).toBe("cancelled");
    expect((await loadReview(hiveRoot, review.reviewId))?.state).toBe("cancelled");
    await expect(access(join(hiveRoot, "roster.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const listed = await listAskMe({ hiveRoot, state: "open" });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.items.find((item) => item.id === review.askMeId)).toBeUndefined();
    }

    const events = (await readFile(join(hiveRoot, "events", "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; data: { reviewId?: string } });
    expect(events.some((event) => event.type === "hire.cancelled" && event.data.reviewId === review.reviewId)).toBe(
      true,
    );
  });

  it("acknowledge on untrusted_import returns HIRE_ACK_CANCELS and does not spawn", async () => {
    const hiveRoot = await hive();
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

    const res = await handleUntrustedImportAskMeAnswer({
      reviewId: review.reviewId,
      action: "acknowledge",
      reasonClass: "untrusted_import",
      hiveRoot,
    });
    expect(res.ok).toBe(true);
    if (res.ok && "code" in res) expect(res.code).toBe("HIRE_ACK_CANCELS");
    expect((await loadReview(hiveRoot, review.reviewId))?.state).toBe("cancelled");
    await expect(access(join(hiveRoot, "roster.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keep_blocked leaves review pending", async () => {
    const hiveRoot = await hive();
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

    const res = await handleUntrustedImportAskMeAnswer({
      reviewId: review.reviewId,
      action: "keep_blocked",
      reasonClass: "untrusted_import",
      hiveRoot,
    });
    expect(res.ok).toBe(true);
    expect((await loadReview(hiveRoot, review.reviewId))?.state).toBe("pending");
  });
});
