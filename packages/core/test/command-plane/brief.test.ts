import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { pickFirstAssignment, briefSubmit } from "../../src/command-plane/brief.js";
import { ensurePlaceholderRoster, AGENT_HOST_ID } from "../../src/command-plane/roster.js";
import { BriefSchema, HiveLedgerSchema, RosterAgentSchema } from "../../src/command-plane/schema.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;

const PLAN = [
  "### Task T001: Alpha",
  "**Implements:** FR-001",
  "**Depends on:** none",
  "**Kind:** code",
  "**Complexity:** moderate",
  "",
  "### Task T002: Beta",
  "**Implements:** FR-002",
  "**Depends on:** T001",
  "**Kind:** code",
  "**Complexity:** mechanical",
  "",
].join("\n");

beforeEach(() => {
  delete process.env.SUPERSPEC_ROOT;
});

afterEach(async () => {
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRepo(featureId = "001-demo"): Promise<{ root: string; hive: string; featureId: string }> {
  const root = await mkdtemp(join(tmpdir(), "cp-brief-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# p\n");
  const specDir = join(root, "specs", featureId);
  await mkdir(specDir, { recursive: true });
  await writeFile(join(specDir, "plan.md"), PLAN);
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  expect(init.ok).toBe(true);
  return { root, hive: join(root, ".superspec", "hive"), featureId };
}

describe("pickFirstAssignment", () => {
  it("assigns agent-host when roster empty", () => {
    expect(pickFirstAssignment([], "T001")?.agentId).toBe("agent-host");
  });

  it("assigns first idle agent when roster has members", () => {
    const roster = RosterAgentSchema.array().parse([
      {
        id: "worker-a",
        name: "A",
        personaPath: null,
        capabilityTags: [],
        engine: null,
        model: null,
        workspace: null,
        worktreePolicy: "shared",
        status: "idle",
        origin: "manual",
      },
    ]);
    expect(pickFirstAssignment(roster, "T001")?.agentId).toBe("worker-a");
  });
});

describe("ensurePlaceholderRoster", () => {
  it("inserts agent-host placeholder when roster empty", () => {
    const { roster, inserted } = ensurePlaceholderRoster([], null);
    expect(inserted).toBe(true);
    expect(roster).toHaveLength(1);
    expect(roster[0].id).toBe(AGENT_HOST_ID);
    expect(roster[0].origin).toBe("placeholder");
  });

  it("does not replace an existing agent-host row", () => {
    const hire = {
      id: AGENT_HOST_ID,
      name: "Real host",
      personaPath: "/x",
      capabilityTags: ["rust"],
      engine: "cursor",
      model: null,
      workspace: "/wt",
      worktreePolicy: "isolated" as const,
      status: "idle" as const,
      origin: "hire" as const,
    };
    const { roster, inserted } = ensurePlaceholderRoster([hire], null);
    expect(inserted).toBe(false);
    expect(roster[0].origin).toBe("hire");
  });
});

describe("briefSubmit", () => {
  it("persists brief, staffs ledger, placeholder roster, and assignment", async () => {
    const { root, hive, featureId } = await tempRepo();
    const result = await briefSubmit({
      cwd: root,
      featureId,
      outcome: "Ship the command plane API",
      constraints: ["no UI"],
      budgetTokens: null,
      budgetUsd: 25,
      deliverable: `specs/${featureId}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.brief.featureId).toBe(featureId);
    expect(result.brief.budgetUsd).toBe(25);
    expect(result.assignment).toEqual({ taskId: "T001", agentId: AGENT_HOST_ID });
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].implementsFr).toEqual(["FR-001"]);
    expect(result.tasks[0].dependsOn).toEqual([]);
    expect(result.tasks[0].assigneeAgentId).toBe(AGENT_HOST_ID);
    expect(result.tasks[1].assigneeAgentId).toBeNull();

    const briefRaw = await readFile(join(hive, "briefs", `${featureId}.json`), "utf8");
    BriefSchema.parse(JSON.parse(briefRaw));

    const ledger = HiveLedgerSchema.parse(
      JSON.parse(await readFile(join(hive, "ledger", `${featureId}.json`), "utf8")),
    );
    expect(ledger.tasks).toHaveLength(2);

    const roster = RosterAgentSchema.array().parse(
      JSON.parse(await readFile(join(hive, "roster.json"), "utf8")),
    );
    expect(roster.some((a) => a.id === AGENT_HOST_ID && a.origin === "placeholder")).toBe(true);

    const events = (await readFile(join(hive, "events", "events.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
    expect(events.some((e) => e.type === "brief.submitted")).toBe(true);
    expect(events.some((e) => e.type === "task.assigned" && e.data.taskId === "T001")).toBe(true);
  });
});
