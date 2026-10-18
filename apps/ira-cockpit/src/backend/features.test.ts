import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFeatureStages } from "./features.js";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("listFeatureStages", () => {
  it("infers stages from artifact presence", async () => {
    const root = await mkdtemp(join(tmpdir(), "ira-feat-"));
    temps.push(root);

    const early = join(root, "specs", "early-idea");
    await mkdir(early, { recursive: true });
    await writeFile(join(early, "spec.md"), "# Early", "utf8");

    const planned = join(root, "specs", "planned-work");
    await mkdir(planned, { recursive: true });
    await writeFile(join(planned, "spec.md"), "# Spec", "utf8");
    await writeFile(join(planned, "design.md"), "# Design", "utf8");
    await writeFile(join(planned, "plan.md"), "# Plan", "utf8");

    const shipping = join(root, "specs", "almost-done");
    await mkdir(shipping, { recursive: true });
    await writeFile(join(shipping, "spec.md"), "# Spec", "utf8");
    await writeFile(join(shipping, "plan.md"), "# Plan", "utf8");
    await writeFile(join(shipping, "status.md"), "Status: ship complete\n", "utf8");

    const stages = await listFeatureStages(root);
    expect(stages.map((s) => s.featureId).sort()).toEqual([
      "almost-done",
      "early-idea",
      "planned-work",
    ]);
    expect(stages.find((s) => s.featureId === "early-idea")?.stage).toBe("scope");
    expect(stages.find((s) => s.featureId === "planned-work")?.stage).toBe("plan");
    expect(stages.find((s) => s.featureId === "almost-done")?.stage).toBe("ship");
  });

  it("returns empty when specs/ missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "ira-feat-"));
    temps.push(root);
    expect(await listFeatureStages(root)).toEqual([]);
  });
});
