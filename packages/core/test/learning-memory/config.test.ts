import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadLearningConfig, isFeatureDistillEnabled } from "../../src/learning-memory/config.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lm-cfg-"));
  roots.push(root);
  return root;
}

describe("loadLearningConfig", () => {
  it("defaults enabled when file missing", async () => {
    const root = await tempRoot();
    const cfg = await loadLearningConfig(root);
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxInjectionBytes).toBe(2048);
  });

  it("honors per-feature distill disable", async () => {
    const root = await tempRoot();
    await mkdir(join(root, ".superspec"), { recursive: true });
    await writeFile(
      join(root, ".superspec", "learning.json"),
      JSON.stringify({ features: { "003-ira-learning-memory": { distillEnabled: false } } }),
    );
    const cfg = await loadLearningConfig(root);
    expect(isFeatureDistillEnabled(cfg, "003-ira-learning-memory")).toBe(false);
  });
});
