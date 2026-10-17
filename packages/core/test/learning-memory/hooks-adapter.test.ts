import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLearningHooks } from "../../src/learning-memory/hooks.js";
import { installLearningMemory } from "../../src/learning-memory/install.js";
import { registerCommandPlaneHooks } from "../../src/command-plane/hooks.js";

const roots: string[] = [];

afterEach(async () => {
  registerCommandPlaneHooks({ learning: {}, token: {}, hire: {}, engine: {} });
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRepoRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lm-hooks-"));
  roots.push(dir);
  return dir;
}

describe("createLearningHooks", () => {
  it("exposes retrieve and distill functions", async () => {
    const hooks = createLearningHooks(await tempRepoRoot());
    expect(typeof hooks.retrieve).toBe("function");
    expect(typeof hooks.distill).toBe("function");
  });
});

describe("installLearningMemory", () => {
  it("registers doctor probes without breaking when doctor ctx provided", () => {
    const findings: { code: string }[] = [];
    expect(() =>
      installLearningMemory({
        projectRoot: "/tmp/repo",
        doctor: { indexAvailable: false, pushFinding: (f) => findings.push(f) },
      }),
    ).not.toThrow();
    expect(findings.some((f) => f.code === "PATTERNS_INDEX_UNAVAILABLE")).toBe(true);
  });
});
