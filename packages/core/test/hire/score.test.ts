import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeHireScore, loadHireScore, updateHireScore } from "../../src/hire/score.js";

describe("computeHireScore", () => {
  it("sets demotionHint when score below threshold", () => {
    const s = computeHireScore({ passRate: 0.2, reviewFailures: 5, spendUsd: 100, budgetUsd: 50 });
    expect(s.demotionHint).toBe(true);
    expect(s.score).toBeLessThan(40);
    expect(s.demotionReasons.length).toBeGreaterThan(0);
  });

  it("clears demotionHint when score is healthy", () => {
    const s = computeHireScore({
      passRate: 0.95,
      reviewFailures: 0,
      spendUsd: 10,
      budgetUsd: 50,
      tasksCompleted: 20,
    });
    expect(s.demotionHint).toBe(false);
    expect(s.score).toBeGreaterThanOrEqual(40);
  });
});

describe("updateHireScore", () => {
  it("persists score under hive hire/scores", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hire-score-"));
    const score = await updateHireScore(hiveRoot, "ios-dev", {
      passRate: 0.2,
      reviewFailures: 5,
      spendUsd: 100,
      budgetUsd: 50,
    });
    expect(score.agentId).toBe("ios-dev");
    expect(score.demotionHint).toBe(true);

    const stored = JSON.parse(
      await readFile(join(hiveRoot, "hire", "scores", "ios-dev.json"), "utf8"),
    ) as { agentId: string; demotionHint: boolean; score: number };
    expect(stored.agentId).toBe("ios-dev");
    expect(stored.demotionHint).toBe(true);
    expect(stored.score).toBe(score.score);

    const loaded = await loadHireScore(hiveRoot, "ios-dev");
    expect(loaded).toEqual(score);
  });

  it("merges incremental task outcomes on record-result path", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hire-score-"));
    await updateHireScore(hiveRoot, "qa-bot", {
      passRate: 1,
      reviewFailures: 0,
      spendUsd: 5,
      budgetUsd: 50,
      tasksCompleted: 4,
    });

    const afterFail = await updateHireScore(hiveRoot, "qa-bot", {
      taskOutcome: { passed: false, reviewFailures: 2 },
      spendUsd: 8,
      budgetUsd: 50,
    });
    expect(afterFail.passRate).toBeLessThan(1);
    expect(afterFail.reviewFailures).toBe(2);
  });
});
