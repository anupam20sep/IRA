import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listAskMe } from "../../src/command-plane/ask-me.js";
import { HIRE_TRUST_BANNER } from "../../src/hire/constants.js";
import { applyReviewEdits, createPendingReview, loadReview } from "../../src/hire/review.js";
import { hireSpawnConfirm } from "../../src/hire/spawn.js";
import type { HireManifest, SanitizationReport } from "../../src/hire/types.js";
import { discoverPersonas } from "../../src/persona-discovery.js";

const MANIFEST: HireManifest = {
  id: "ios-developer",
  displayName: "iOS Dev",
  goal: "Ship iOS features",
  capabilityTags: ["ios", "swift"],
  suggestedEngine: "cursor",
  suggestedModelTier: "standard",
  budget: { tokens: 1000, usd: 20 },
  allowlists: { skills: ["swift-ui"], mcp: ["xcode"] },
  persona: { harness: "cursor", scope: "project", body: "Build with SwiftUI." },
  schemaVersion: "hireManifest/v1",
};

function report(rejected: SanitizationReport["rejected"] = []): SanitizationReport {
  return {
    droppedKeys: [],
    rejected,
    warnings: [],
    contentSha256: "abc",
    sanitizedAt: new Date().toISOString(),
  };
}

async function hive(): Promise<{ hiveRoot: string; repositoryRoot: string }> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "hire-spawn-repo-"));
  const hiveRoot = await mkdtemp(join(tmpdir(), "hire-spawn-hive-"));
  await writeFile(
    join(hiveRoot, "hive.json"),
    `${JSON.stringify({ schemaVersion: 1, repositoryRoot, createdAt: new Date().toISOString() })}\n`,
  );
  await mkdir(join(hiveRoot, "events"), { recursive: true });
  await mkdir(join(hiveRoot, "dispatch-queue"), { recursive: true });
  return { hiveRoot, repositoryRoot };
}

async function pendingReview(roots: { hiveRoot: string }, manifest: HireManifest = MANIFEST) {
  return createPendingReview({
    hiveRoot: roots.hiveRoot,
    sourceKind: "file",
    sourceRef: "file:/tmp/ios.yaml",
    approvalCopyVariant: "standard",
    sanitizationReport: report(),
    parsedManifest: manifest,
    skillConsents: [
      { skillId: "swift-ui", source: "./skills/swift-ui", scanResult: null, decision: "accepted" },
    ],
    contentSha256: "abc",
  });
}

describe("hireSpawnConfirm", () => {
  it("writes persona and roster only when Slice A validated", async () => {
    const roots = await hive();
    const review = await pendingReview(roots);
    await applyReviewEdits(
      review.reviewId,
      {
        displayName: "iOS Dev",
        capabilityTags: ["ios", "swift"],
        engine: "claude",
        modelTier: "frontier",
        budgetUsd: 40,
        budgetTokens: 2000,
        allowedSkills: ["swift-ui"],
        allowedMcp: [],
      },
      { hiveRoot: roots.hiveRoot },
    );

    const res = await hireSpawnConfirm({
      reviewId: review.reviewId,
      hiveRoot: roots.hiveRoot,
      repositoryRoot: roots.repositoryRoot,
      sliceAValidated: true,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.agent.origin).toBe("hire");
    expect(res.agent.id).toBe("ios-developer");
    expect(res.agent.status).toBe("idle");
    expect(res.agent.capabilityTags).toEqual(["ios", "swift"]);
    expect(res.askMeResolved).toBe(true);
    expect(res.agent.personaPath).toBe(join(roots.repositoryRoot, ".cursor", "agents", "ios-developer.md"));

    const persona = await readFile(res.agent.personaPath, "utf8");
    expect(persona).toContain("name: ios-developer");
    expect(persona).toContain("Build with SwiftUI.");

    const roster = JSON.parse(await readFile(join(roots.hiveRoot, "roster.json"), "utf8")) as {
      id: string;
      origin: string;
      engine: string;
      model: string;
      budgetUsd: number;
      budgetTokens: number;
      allowedSkills: string[];
      allowedMcp: string[];
      personaPath: string;
      status: string;
      worktreePolicy: string;
    }[];
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      id: "ios-developer",
      origin: "hire",
      name: "iOS Dev",
      engine: "claude",
      model: "frontier",
      budgetUsd: 40,
      budgetTokens: 2000,
      allowedSkills: ["swift-ui"],
      allowedMcp: [],
      personaPath: res.agent.personaPath,
      status: "idle",
      worktreePolicy: "isolated",
    });

    expect((await loadReview(roots.hiveRoot, review.reviewId))?.state).toBe("spawned");

    const listed = await listAskMe({ hiveRoot: roots.hiveRoot, state: "resolved" });
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.items.some((item) => item.id === review.askMeId)).toBe(true);

    const events = (await readFile(join(roots.hiveRoot, "events", "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
    const spawned = events.find((event) => event.type === "hire.spawned");
    expect(spawned?.data).toMatchObject({
      reviewId: review.reviewId,
      agentId: "ios-developer",
      personaPath: res.agent.personaPath,
      capabilityTags: ["ios", "swift"],
    });

    const discovered = await discoverPersonas({
      projectRoot: roots.repositoryRoot,
      includeHome: false,
    });
    expect(discovered.some((personaRow) => personaRow.name === "ios-developer")).toBe(true);
    expect(await readdir(join(roots.hiveRoot, "dispatch-queue"))).toEqual([]);
  });

  it("no-ops with SLICE_A_ONLY before Slice A (OD-020)", async () => {
    const roots = await hive();
    const review = await pendingReview(roots);
    const rosterBefore = await access(join(roots.hiveRoot, "roster.json")).then(
      () => "present",
      () => "absent",
    );

    const res = await hireSpawnConfirm({
      reviewId: review.reviewId,
      hiveRoot: roots.hiveRoot,
      repositoryRoot: roots.repositoryRoot,
      sliceAValidated: false,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("SLICE_A_ONLY");
    expect((await loadReview(roots.hiveRoot, review.reviewId))?.state).toBe("pending");
    await expect(access(join(roots.repositoryRoot, ".cursor", "agents", "ios-developer.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const rosterAfter = await access(join(roots.hiveRoot, "roster.json")).then(
      () => "present",
      () => "absent",
    );
    expect(rosterAfter).toBe(rosterBefore);

    const listed = await listAskMe({ hiveRoot: roots.hiveRoot, state: "open" });
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.items.some((item) => item.id === review.askMeId)).toBe(true);
  });

  it("rejects a mismatched trust banner without writes (OD-018)", async () => {
    const roots = await hive();
    const review = await pendingReview(roots);
    const path = join(roots.hiveRoot, "hire", "reviews", `${review.reviewId}.json`);
    const raw = JSON.parse(await readFile(path, "utf8")) as { uiCopy: { trustBanner: string } };
    raw.uiCopy.trustBanner = "Curated — shorter warning.";
    await writeFile(path, `${JSON.stringify(raw)}\n`);

    const res = await hireSpawnConfirm({
      reviewId: review.reviewId,
      hiveRoot: roots.hiveRoot,
      repositoryRoot: roots.repositoryRoot,
      sliceAValidated: true,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("HIRE_WARNING_LENGTH_MISMATCH");
    expect(raw.uiCopy.trustBanner).not.toBe(HIRE_TRUST_BANNER);
    await expect(access(join(roots.hiveRoot, "roster.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(roots.repositoryRoot, ".cursor", "agents", "ios-developer.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
