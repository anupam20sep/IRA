import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { createPendingReview } from "../../src/hire/review.js";
import { hireSpawnConfirm } from "../../src/hire/spawn.js";
import type { HireManifest, SanitizationReport } from "../../src/hire/types.js";
import { buildToolDefinitions } from "../../src/mcp-server.js";
import { discoverPersonas, type Persona } from "../../src/persona-discovery.js";

const HIRE_NAME = "ios-developer";
const SC003_MS = 5_000;

const MANIFEST: HireManifest = {
  id: HIRE_NAME,
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

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("list-personas after hire spawn", () => {
  it("includes new hire persona name within SC-003 window", async () => {
    const { hiveRoot, repositoryRoot } = await hive();
    const personaPath = join(repositoryRoot, ".cursor", "agents", `${HIRE_NAME}.md`);
    const review = await pendingReview(hiveRoot);

    const before = await listHire(repositoryRoot);
    expect(before.discover).not.toContain(HIRE_NAME);
    expect(before.mcp).not.toContain(HIRE_NAME);
    expect(before.cli).not.toContain(HIRE_NAME);
    await expect(access(personaPath)).rejects.toMatchObject({ code: "ENOENT" });

    const spawned = await hireSpawnConfirm({
      reviewId: review.reviewId,
      hiveRoot,
      repositoryRoot,
      sliceAValidated: true,
    });
    expect(spawned.ok).toBe(true);
    if (!spawned.ok) return;
    expect(spawned.agent.personaPath).toBe(personaPath);
    await access(personaPath);

    const listed = await listHireWithin(repositoryRoot, SC003_MS);
    expect(listed.elapsedMs).toBeLessThan(SC003_MS);
    expect(listed.discover).toContain(HIRE_NAME);
    expect(listed.mcp).toContain(HIRE_NAME);
    expect(listed.cli).toContain(HIRE_NAME);
    expect(listed.persona).toMatchObject({
      name: HIRE_NAME,
      description: "Ship iOS features",
      source: "cursor",
      path: personaPath,
    });
    expect(listed.mcpPath).toBe(personaPath);
    expect(listed.cliPath).toBe(personaPath);
  }, 15_000);
});

async function hive(): Promise<{ hiveRoot: string; repositoryRoot: string }> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "hire-list-personas-repo-"));
  roots.push(repositoryRoot);
  const hiveRoot = await mkdtemp(join(tmpdir(), "hire-list-personas-hive-"));
  roots.push(hiveRoot);
  await writeFile(
    join(hiveRoot, "hive.json"),
    `${JSON.stringify({ schemaVersion: 1, repositoryRoot, createdAt: new Date().toISOString() })}\n`,
  );
  await mkdir(join(hiveRoot, "events"), { recursive: true });
  return { hiveRoot, repositoryRoot };
}

function report(): SanitizationReport {
  return {
    droppedKeys: [],
    rejected: [],
    warnings: [],
    contentSha256: "abc",
    sanitizedAt: new Date().toISOString(),
  };
}

function pendingReview(hiveRoot: string) {
  return createPendingReview({
    hiveRoot,
    sourceKind: "file",
    sourceRef: "file:/tmp/ios.yaml",
    approvalCopyVariant: "standard",
    sanitizationReport: report(),
    parsedManifest: MANIFEST,
    skillConsents: [
      { skillId: "swift-ui", source: "./skills/swift-ui", scanResult: null, decision: "accepted" },
    ],
    contentSha256: "abc",
  });
}

type PersonaRow = { name: string; path: string };

type ListedHire = {
  discover: string[];
  mcp: string[];
  cli: string[];
  persona: Persona | undefined;
  mcpPath: string | undefined;
  cliPath: string | undefined;
};

async function listHire(projectRoot: string): Promise<ListedHire> {
  const discovered = await discoverPersonas({ projectRoot, includeHome: false });
  const tool = buildToolDefinitions().find((entry) => entry.name === "list-personas");
  if (!tool) throw new Error("list-personas MCP tool is not registered");
  const mcpResult = await tool.handler({ projectRoot, includeHome: false });
  const mcpPersonas = JSON.parse(mcpResult.content[0]?.text ?? "[]") as PersonaRow[];
  const cliResult = await runCli(["list-personas", "--root", projectRoot, "--no-home"]);
  const cliPersonas = JSON.parse(cliResult.stdout) as PersonaRow[];
  return {
    discover: discovered.map((persona) => persona.name),
    mcp: mcpPersonas.map((persona) => persona.name),
    cli: cliPersonas.map((persona) => persona.name),
    persona: discovered.find((persona) => persona.name === HIRE_NAME),
    mcpPath: mcpPersonas.find((persona) => persona.name === HIRE_NAME)?.path,
    cliPath: cliPersonas.find((persona) => persona.name === HIRE_NAME)?.path,
  };
}

async function listHireWithin(
  projectRoot: string,
  windowMs: number,
): Promise<ListedHire & { elapsedMs: number }> {
  const started = Date.now();
  let latest = await listHire(projectRoot);
  while (!seesHire(latest) && Date.now() - started < windowMs) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    latest = await listHire(projectRoot);
  }
  return { ...latest, elapsedMs: Date.now() - started };
}

function seesHire(listed: ListedHire): boolean {
  return (
    listed.discover.includes(HIRE_NAME) &&
    listed.mcp.includes(HIRE_NAME) &&
    listed.cli.includes(HIRE_NAME)
  );
}
