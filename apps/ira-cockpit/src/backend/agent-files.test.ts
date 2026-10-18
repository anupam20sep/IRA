import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentPath,
  renderAgentDocument,
  sanitizeId,
  skillPath,
  writeAgentFile,
  writeSkillFile,
} from "./agent-files.js";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ira-agent-"));
  temps.push(dir);
  return dir;
}

describe("sanitizeId", () => {
  it("accepts alphanumeric ids", () => {
    expect(sanitizeId("python-dev")).toBe("python-dev");
  });

  it("rejects path traversal", () => {
    expect(() => sanitizeId("../evil")).toThrow();
  });

  it("rejects empty", () => {
    expect(() => sanitizeId("  ")).toThrow();
  });
});

describe("writeAgentFile", () => {
  it("writes cursor agent markdown with frontmatter", async () => {
    const root = await tempRepo();
    const path = await writeAgentFile({
      repoRoot: root,
      harness: "cursor",
      id: "python-dev",
      name: "Python Dev",
      description: "Backend specialist",
      capabilityTags: "python, backend",
      body: "Follow Ira briefs.",
    });
    expect(path).toBe(agentPath(root, "cursor", "python-dev"));
    const text = await readFile(path, "utf8");
    expect(text).toContain("name: python-dev");
    expect(text).toContain("# Python Dev");
    expect(text).toContain("Follow Ira briefs.");
  });

  it("writes codex toml", async () => {
    const root = await tempRepo();
    const path = await writeAgentFile({
      repoRoot: root,
      harness: "codex",
      id: "reviewer",
      name: "Reviewer",
      description: "Reviews PRs",
      capabilityTags: "review",
      body: "Be strict.",
    });
    expect(path.endsWith(".toml")).toBe(true);
    const text = await readFile(path, "utf8");
    expect(text).toContain('name = "reviewer"');
  });

  it("renders markdown without writing", () => {
    const doc = renderAgentDocument({
      repoRoot: "/tmp",
      harness: "claude",
      id: "ops",
      name: "Ops",
      description: "Ops agent",
      capabilityTags: "ops",
      body: "Hello",
    });
    expect(doc).toMatch(/^---/);
    expect(doc).toContain("capabilityTags: ops");
  });
});

describe("writeSkillFile", () => {
  it("writes skills/<id>/SKILL.md", async () => {
    const root = await tempRepo();
    const path = await writeSkillFile({
      repoRoot: root,
      id: "security-review",
      name: "Security Review",
      description: "Review for vulns",
      body: "## Steps\n1. Scan",
    });
    expect(path).toBe(skillPath(root, "security-review"));
    const text = await readFile(path, "utf8");
    expect(text).toContain("name: security-review");
    expect(text).toContain("## Steps");
  });
});
