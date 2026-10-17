import { access, chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPendingReview, loadReview } from "../../src/hire/review.js";
import { hireSpawnConfirm } from "../../src/hire/spawn.js";
import type { HireManifest, SanitizationReport } from "../../src/hire/types.js";
import type { RosterAgent } from "../../src/command-plane/types.js";

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

const EXISTING_HIRE: RosterAgent = {
  id: "ios-developer",
  name: "Existing iOS",
  personaPath: "/tmp/existing-ios.md",
  capabilityTags: ["ios"],
  engine: "codex",
  model: "economy",
  budgetTokens: 10,
  budgetUsd: 1,
  workspace: null,
  worktreePolicy: "shared",
  allowedSkills: ["old-skill"],
  allowedMcp: ["old-mcp"],
  status: "busy",
  origin: "hire",
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

async function hive(): Promise<{ hiveRoot: string; repositoryRoot: string }> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "hire-rollback-repo-"));
  const hiveRoot = await mkdtemp(join(tmpdir(), "hire-rollback-hive-"));
  await writeFile(
    join(hiveRoot, "hive.json"),
    `${JSON.stringify({ schemaVersion: 1, repositoryRoot, createdAt: new Date().toISOString() })}\n`,
  );
  await mkdir(join(hiveRoot, "events"), { recursive: true });
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

function personaPath(repositoryRoot: string): string {
  return join(repositoryRoot, ".cursor", "agents", "ios-developer.md");
}

async function readRoster(hiveRoot: string): Promise<RosterAgent[]> {
  return JSON.parse(await readFile(join(hiveRoot, "roster.json"), "utf8")) as RosterAgent[];
}

async function tempNames(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return names.filter((name) => name.includes(".tmp") || name.includes(".bak"));
}

type SpawnFailure = {
  ok: false;
  code: string;
  message: string;
  error?: string;
  actions?: string[];
};

function asFailure(res: { ok: false }): SpawnFailure {
  return res as SpawnFailure;
}

describe("hireSpawnConfirm rollback", () => {
  it("returns HIRE_NAME_CONFLICT when hire id already on roster", async () => {
    const roots = await hive();
    const review = await pendingReview(roots);
    await writeFile(join(roots.hiveRoot, "roster.json"), `${JSON.stringify([EXISTING_HIRE])}\n`);

    const res = await hireSpawnConfirm({
      reviewId: review.reviewId,
      hiveRoot: roots.hiveRoot,
      repositoryRoot: roots.repositoryRoot,
      sliceAValidated: true,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      const failure = asFailure(res);
      expect(failure.error).toBe("HIRE_NAME_CONFLICT");
      expect(failure.code).toBe("HIRE_NAME_CONFLICT");
      expect(failure.actions).toEqual(["merge", "replace", "cancel"]);
    }

    await expect(access(personaPath(roots.repositoryRoot))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readRoster(roots.hiveRoot)).toEqual([EXISTING_HIRE]);
    expect((await loadReview(roots.hiveRoot, review.reviewId))?.state).toBe("pending");

    const events = (await readFile(join(roots.hiveRoot, "events", "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    expect(events.some((event) => event.type === "hire.spawned")).toBe(false);
  });

  it("cancel leaves the existing hire unchanged", async () => {
    const roots = await hive();
    const review = await pendingReview(roots);
    await writeFile(join(roots.hiveRoot, "roster.json"), `${JSON.stringify([EXISTING_HIRE])}\n`);

    const res = await hireSpawnConfirm({
      reviewId: review.reviewId,
      hiveRoot: roots.hiveRoot,
      repositoryRoot: roots.repositoryRoot,
      sliceAValidated: true,
      nameConflictAction: "cancel",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(asFailure(res).error).toBe("HIRE_NAME_CONFLICT");
    await expect(access(personaPath(roots.repositoryRoot))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readRoster(roots.hiveRoot)).toEqual([EXISTING_HIRE]);
    expect((await loadReview(roots.hiveRoot, review.reviewId))?.state).toBe("pending");
  });

  it("replace overwrites the existing hire roster row", async () => {
    const roots = await hive();
    const review = await pendingReview(roots);
    await writeFile(join(roots.hiveRoot, "roster.json"), `${JSON.stringify([EXISTING_HIRE])}\n`);

    const res = await hireSpawnConfirm({
      reviewId: review.reviewId,
      hiveRoot: roots.hiveRoot,
      repositoryRoot: roots.repositoryRoot,
      sliceAValidated: true,
      nameConflictAction: "replace",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const roster = await readRoster(roots.hiveRoot);
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      id: "ios-developer",
      origin: "hire",
      name: "iOS Dev",
      engine: "cursor",
      status: "idle",
      allowedSkills: ["swift-ui"],
      allowedMcp: ["xcode"],
      personaPath: personaPath(roots.repositoryRoot),
    });
    expect(await readFile(personaPath(roots.repositoryRoot), "utf8")).toContain("Build with SwiftUI.");
  });

  it("merge unions allowlists and keeps the active roster config", async () => {
    const roots = await hive();
    const review = await pendingReview(roots);
    await writeFile(join(roots.hiveRoot, "roster.json"), `${JSON.stringify([EXISTING_HIRE])}\n`);

    const res = await hireSpawnConfirm({
      reviewId: review.reviewId,
      hiveRoot: roots.hiveRoot,
      repositoryRoot: roots.repositoryRoot,
      sliceAValidated: true,
      nameConflictAction: "merge",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const roster = await readRoster(roots.hiveRoot);
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      id: "ios-developer",
      origin: "hire",
      name: "Existing iOS",
      engine: "codex",
      model: "economy",
      budgetTokens: 10,
      budgetUsd: 1,
      status: "busy",
      worktreePolicy: "shared",
      personaPath: personaPath(roots.repositoryRoot),
    });
    expect(roster[0]?.capabilityTags.sort()).toEqual(["ios", "swift"]);
    expect(roster[0]?.allowedSkills?.sort()).toEqual(["old-skill", "swift-ui"]);
    expect(roster[0]?.allowedMcp?.sort()).toEqual(["old-mcp", "xcode"]);
    expect(await readFile(personaPath(roots.repositoryRoot), "utf8")).toContain("name: ios-developer");
  });

  it("does not treat a non-hire roster id as a name conflict", async () => {
    const roots = await hive();
    const review = await pendingReview(roots);
    const manual: RosterAgent = { ...EXISTING_HIRE, origin: "manual", status: "idle" };
    await writeFile(join(roots.hiveRoot, "roster.json"), `${JSON.stringify([manual])}\n`);

    const res = await hireSpawnConfirm({
      reviewId: review.reviewId,
      hiveRoot: roots.hiveRoot,
      repositoryRoot: roots.repositoryRoot,
      sliceAValidated: true,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await readRoster(roots.hiveRoot))[0]?.origin).toBe("hire");
  });

  it("removes temp personas and skips roster append when disk write fails mid-flight", async () => {
    const roots = await hive();
    const review = await pendingReview(roots);
    const agentsDir = join(roots.repositoryRoot, ".cursor", "agents");
    await mkdir(join(agentsDir, "ios-developer.md", "blocker"), { recursive: true });
    const rosterBefore = `${JSON.stringify([EXISTING_HIRE])}\n`;
    await writeFile(join(roots.hiveRoot, "roster.json"), rosterBefore);

    const res = await hireSpawnConfirm({
      reviewId: review.reviewId,
      hiveRoot: roots.hiveRoot,
      repositoryRoot: roots.repositoryRoot,
      sliceAValidated: true,
      nameConflictAction: "replace",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      const failure = asFailure(res);
      expect(failure.code).toBe("HIRE_SPAWN_FAILED");
      expect(failure.message.toLowerCase()).toContain("rolled back");
    }
    expect((await stat(personaPath(roots.repositoryRoot))).isDirectory()).toBe(true);
    expect(await tempNames(agentsDir)).toEqual([]);
    expect(await readFile(join(roots.hiveRoot, "roster.json"), "utf8")).toBe(rosterBefore);
    expect((await loadReview(roots.hiveRoot, review.reviewId))?.state).toBe("pending");
  });

  it("rolls back a written persona when the roster file cannot be replaced", async () => {
    const roots = await hive();
    const review = await pendingReview(roots);
    const rosterPath = join(roots.hiveRoot, "roster.json");
    const rosterBefore = "[]\n";
    await writeFile(rosterPath, rosterBefore);
    await mkdir(join(roots.hiveRoot, "locks"), { recursive: true });
    await chmod(roots.hiveRoot, 0o555);

    try {
      const res = await hireSpawnConfirm({
        reviewId: review.reviewId,
        hiveRoot: roots.hiveRoot,
        repositoryRoot: roots.repositoryRoot,
        sliceAValidated: true,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(asFailure(res).code).toBe("HIRE_SPAWN_FAILED");
    } finally {
      await chmod(roots.hiveRoot, 0o755);
    }

    await expect(access(personaPath(roots.repositoryRoot))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await tempNames(join(roots.repositoryRoot, ".cursor", "agents"))).toEqual([]);
    expect(await readFile(rosterPath, "utf8")).toBe(rosterBefore);
    expect((await loadReview(roots.hiveRoot, review.reviewId))?.state).toBe("pending");
  });

  it("restores a replaced persona file when the roster write fails", async () => {
    const roots = await hive();
    const review = await pendingReview(roots);
    const path = personaPath(roots.repositoryRoot);
    await mkdir(join(roots.repositoryRoot, ".cursor", "agents"), { recursive: true });
    await writeFile(path, "OLD PERSONA\n");
    const rosterPath = join(roots.hiveRoot, "roster.json");
    const rosterBefore = `${JSON.stringify([EXISTING_HIRE])}\n`;
    await writeFile(rosterPath, rosterBefore);
    await mkdir(join(roots.hiveRoot, "locks"), { recursive: true });
    await chmod(roots.hiveRoot, 0o555);

    try {
      const res = await hireSpawnConfirm({
        reviewId: review.reviewId,
        hiveRoot: roots.hiveRoot,
        repositoryRoot: roots.repositoryRoot,
        sliceAValidated: true,
        nameConflictAction: "replace",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(asFailure(res).code).toBe("HIRE_SPAWN_FAILED");
    } finally {
      await chmod(roots.hiveRoot, 0o755);
    }

    expect(await readFile(path, "utf8")).toBe("OLD PERSONA\n");
    expect(await tempNames(join(roots.repositoryRoot, ".cursor", "agents"))).toEqual([]);
    expect(await readFile(rosterPath, "utf8")).toBe(rosterBefore);
    expect((await loadReview(roots.hiveRoot, review.reviewId))?.state).toBe("pending");
  });
});
