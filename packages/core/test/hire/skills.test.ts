import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyReviewEdits, createPendingReview } from "../../src/hire/review.js";
import { allowedSkillsAfterConsent, mergeSkillConsentDecisions, scanSkill } from "../../src/hire/skills.js";
import type { HireManifest, SanitizationReport, SkillConsent } from "../../src/hire/types.js";

const MANIFEST: HireManifest = {
  id: "x",
  displayName: "X",
  goal: "g",
  capabilityTags: ["qa"],
  suggestedEngine: "cursor",
  suggestedModelTier: "standard",
  budget: { tokens: 1, usd: 1 },
  allowlists: { skills: ["swift-ui", "lint"], mcp: [] },
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

const SKILL_CONSENTS: SkillConsent[] = [
  { skillId: "swift-ui", source: "./skills/swift-ui", scanResult: null, decision: "pending" },
  { skillId: "lint", source: "npm:eslint", scanResult: null, decision: "pending" },
];

async function hive(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hire-skills-"));
}

describe("scanSkill", () => {
  it("returns skipped stub for v1", async () => {
    await expect(scanSkill("/any/path")).resolves.toEqual({ status: "skipped", findings: [] });
  });
});

describe("mergeSkillConsentDecisions", () => {
  it("updates matching skill decisions", () => {
    const merged = mergeSkillConsentDecisions(SKILL_CONSENTS, [
      { skillId: "swift-ui", decision: "accepted" },
      { skillId: "lint", decision: "declined" },
    ]);
    expect(merged.find((s) => s.skillId === "swift-ui")?.decision).toBe("accepted");
    expect(merged.find((s) => s.skillId === "lint")?.decision).toBe("declined");
  });
});

describe("allowedSkillsAfterConsent", () => {
  it("omits declined skills from the allowed list", () => {
    const allowed = allowedSkillsAfterConsent(["swift-ui", "lint"], [
      { skillId: "swift-ui", source: "x", scanResult: null, decision: "accepted" },
      { skillId: "lint", source: "y", scanResult: null, decision: "declined" },
    ]);
    expect(allowed).toEqual(["swift-ui"]);
  });
});

describe("applyReviewEdits", () => {
  it("stores operator overrides for engine and budget", async () => {
    const hiveRoot = await hive();
    const review = await createPendingReview({
      hiveRoot,
      sourceKind: "file",
      sourceRef: "/tmp/manifest.yaml",
      approvalCopyVariant: "standard",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: SKILL_CONSENTS,
      contentSha256: "abc",
    });

    const updated = await applyReviewEdits(
      review.reviewId,
      {
        engine: "cursor",
        modelTier: "frontier",
        budgetUsd: 40,
      },
      { hiveRoot },
    );
    expect(updated.operatorEdits?.modelTier).toBe("frontier");
    expect(updated.operatorEdits?.engine).toBe("cursor");
    expect(updated.operatorEdits?.budgetUsd).toBe(40);
  });

  it("merges skill consent decisions and filters declined from allowedSkills", async () => {
    const hiveRoot = await hive();
    const review = await createPendingReview({
      hiveRoot,
      sourceKind: "file",
      sourceRef: "/tmp/manifest.yaml",
      approvalCopyVariant: "standard",
      sanitizationReport: report(),
      parsedManifest: MANIFEST,
      skillConsents: SKILL_CONSENTS,
      contentSha256: "abc",
    });

    const updated = await applyReviewEdits(
      review.reviewId,
      {
        allowedSkills: ["swift-ui", "lint"],
      },
      {
        hiveRoot,
        skillConsents: [
          { skillId: "swift-ui", decision: "accepted" },
          { skillId: "lint", decision: "declined" },
        ],
      },
    );

    expect(updated.skillConsents.find((s) => s.skillId === "lint")?.decision).toBe("declined");
    expect(updated.operatorEdits?.allowedSkills).toEqual(["swift-ui"]);
  });
});
