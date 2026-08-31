import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendCoordinatorLog,
  buildCoordinatorBrief,
  reportFilePath,
  writeCoordinatorBrief,
} from "../src/coordinator-ledger.js";
import { initState, saveState } from "../src/forge-loop.js";

const PLAN = [
  "### Task T001: First task",
  "**Implements:** FR-001",
  "**Depends on:** none",
  "**Complexity:** mechanical",
  "",
  "### Task T002: Second task",
  "**Implements:** FR-002",
  "**Depends on:** T001",
  "**Complexity:** mechanical",
].join("\n");

describe("coordinator ledger", () => {
  let root: string;
  let specDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "superspec-coord-"));
    specDir = join(root, "specs", "feat");
    await mkdir(join(specDir, ".superspec"), { recursive: true });
    await writeFile(join(specDir, "plan.md"), PLAN, "utf8");
    const state = initState([
      { id: "T001", title: "First", frRefs: ["FR-001"], dependsOn: [], complexity: "mechanical", kind: "code" },
      { id: "T002", title: "Second", frRefs: ["FR-002"], dependsOn: ["T001"], complexity: "mechanical", kind: "code" },
    ]);
    await saveState(specDir, state);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes a lean coordinator brief with next task", async () => {
    const path = await writeCoordinatorBrief({ specDir, planPath: join(specDir, "plan.md") });
    const body = await readFile(path, "utf8");
    expect(body).toMatch(/lean loop/i);
    expect(body).toMatch(/T001/);
    expect(body).toMatch(/0\/2 done/);
    expect(body).toMatch(/CLI only/);
  });

  it("appends log entries and trims to limit", async () => {
    await writeCoordinatorBrief({ specDir, planPath: join(specDir, "plan.md") });
    await appendCoordinatorLog({
      specDir,
      planPath: join(specDir, "plan.md"),
      entry: {
        taskId: "T001",
        verdict: "pass",
        commits: "abc1234",
        implementerReport: ".superspec/reports/T001-implementer.md",
        reviewerReport: ".superspec/reports/T001-reviewer.md",
        at: "2026-01-01T00:00:00.000Z",
      },
    });
    const body = await buildCoordinatorBrief({ specDir, planPath: join(specDir, "plan.md") });
    expect(body).toMatch(/T001 \| pass \| abc1234/);
    expect(body).toMatch(/T001-implementer\.md/);
  });

  it("resolves standard report paths", () => {
    expect(reportFilePath(specDir, "T003", "implementer")).toMatch(/T003-implementer\.md$/);
    expect(reportFilePath(specDir, "T003", "reviewer")).toMatch(/T003-reviewer\.md$/);
  });
});
