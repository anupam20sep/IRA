/**
 * URL Shortener — Ira + Cursor end-to-end
 *
 * Drives SuperSpec stages through Ira APIs, seeds a Cursor team,
 * queues host-spawn dispatches, verifies status updates + app tests.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  advanceLifecycle,
  forgeStatus,
  getProjectStages,
  syncFeatureStatus,
  writeValidationReport,
  type LifecycleStage,
} from "./lifecycle.js";
import {
  queueCursorDispatch,
  readQueuedDispatch,
  seedCursorRoster,
} from "./cursor-dispatch.js";
import { onboardProject, resolveConfiguredProjects } from "./projects.js";
import { buildCockpitSnapshot } from "./snapshot.js";
import { mapSnapshotToLive } from "../store/live-map.js";
import { runSuperspecJson } from "./cli.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "../../fixtures/url-shortener");
const FEATURE = "001-url-shortener";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function cloneProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ira-url-shortener-"));
  temps.push(dir);
  await cp(FIXTURE, dir, { recursive: true });
  return dir;
}

async function cockpitFor(projectPath: string) {
  const cockpit = await mkdtemp(join(tmpdir(), "ira-us-cfg-"));
  temps.push(cockpit);
  await writeFile(join(cockpit, "ira.config.json"), '{"projects":[]}', "utf8");
  const project = await onboardProject(cockpit, {
    path: projectPath,
    id: "url-shortener",
    name: "URL Shortener",
  });
  return { cockpit, project };
}

const TEAM = [
  {
    id: "us-architect",
    displayName: "Architect",
    personaPath: ".cursor/agents/us-architect.md",
    capabilityTags: ["architecture", "superspec"],
  },
  {
    id: "us-backend",
    displayName: "Backend",
    personaPath: ".cursor/agents/us-backend.md",
    capabilityTags: ["node", "http", "api"],
  },
  {
    id: "us-frontend",
    displayName: "Frontend",
    personaPath: ".cursor/agents/us-frontend.md",
    capabilityTags: ["html", "ui"],
  },
  {
    id: "us-qa",
    displayName: "QA",
    personaPath: ".cursor/agents/us-qa.md",
    capabilityTags: ["qa", "testing"],
  },
] as const;

const STAGES: LifecycleStage[] = [
  "explore",
  "scope",
  "refine",
  "architect",
  "plan",
  "route",
  "forge",
  "validate",
  "ship",
];

describe("URL Shortener — Ira + Cursor E2E", () => {
  it("has Cursor team personas on disk", async () => {
    for (const a of TEAM) {
      const text = await readFile(join(FIXTURE, a.personaPath), "utf8");
      expect(text).toContain(`name: ${a.id}`);
    }
    const personas = await runSuperspecJson(FIXTURE, ["list-personas", "--no-home"]);
    expect(personas.ok).toBe(true);
    const list = Array.isArray(personas.json)
      ? personas.json
      : [];
    const names = list.map((p: { name?: string }) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(["us-architect", "us-backend", "us-frontend", "us-qa"]),
    );
    expect(list.every((p: { source?: string }) => p.source === "cursor")).toBe(true);
  });

  it("onboards project, seeds roster, runs all SuperSpec stages via Ira", async () => {
    const root = await cloneProject();
    const { cockpit, project } = await cockpitFor(root);

    const rosterPath = await seedCursorRoster(root, [...TEAM]);
    expect(rosterPath).toContain(".superspec/hive/roster.json");
    const roster = JSON.parse(await readFile(rosterPath, "utf8")) as unknown[];
    expect(roster).toHaveLength(4);

    const inferredAlong: string[] = [];
    for (const stage of STAGES) {
      const advanced = await advanceLifecycle(root, FEATURE, stage);
      expect(advanced.stage).toBe(stage);
      inferredAlong.push(advanced.inferred);
      const status = await readFile(
        join(root, "specs", FEATURE, "status.md"),
        "utf8",
      );
      expect(status.toLowerCase()).toContain(stage === "ship" ? "ship" : stage);
    }

    // Final inferred stage from artifact scan should be ship
    const stages = await getProjectStages(root);
    const feature = stages.find((s) => s.featureId === FEATURE);
    expect(feature?.stage).toBe("ship");
    expect(inferredAlong.at(-1)).toBe("ship");

    // Snapshot through Ira sees one project with nested spec at ship
    const snapshot = await buildCockpitSnapshot(
      await resolveConfiguredProjects(cockpit),
    );
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.projects[0]?.id).toBe(project.id);
    expect(snapshot.projects[0]?.specs.some((s) => s.featureId === FEATURE)).toBe(
      true,
    );
    const mapped = mapSnapshotToLive(snapshot);
    expect(mapped.projects[0]?.specs[0]?.stage).toBe("ship");
    expect(mapped.catalogAgents.length).toBeGreaterThanOrEqual(4);
  });

  it("queues Cursor host-spawn commands from Ira and updates events", async () => {
    const root = await cloneProject();
    await seedCursorRoster(root, [...TEAM]);

    const tasks = ["T001", "T002", "T003", "T004"];
    for (const taskId of tasks) {
      const agent =
        taskId === "T004"
          ? TEAM.find((t) => t.id === "us-qa")!
          : TEAM.find((t) => t.id === "us-backend")!;
      const queued = await queueCursorDispatch({
        repoRoot: root,
        featureId: FEATURE,
        taskId,
        agentId: agent.id,
        personaPath: agent.personaPath,
        brief: `Ira command → Cursor: run ${taskId}`,
      });
      expect(queued.ok).toBe(true);
      expect(queued.note).toMatch(/did not parent cursor-agent/i);
      expect(queued.intent.engine).toBe("cursor-agent");
      expect(queued.intent.freshSubagent).toBe(true);

      const read = await readQueuedDispatch(root, FEATURE, taskId);
      expect(read?.taskId).toBe(taskId);
      expect(read?.agentId).toBe(agent.id);
    }

    const events = await readFile(
      join(root, ".superspec/hive/events/events.jsonl"),
      "utf8",
    );
    expect(events).toContain("cursor_dispatch_queued");
    expect(events.split("\n").filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });

  it("sync-status + forge-status update from Ira CLI bridge", async () => {
    const root = await cloneProject();
    await advanceLifecycle(root, FEATURE, "forge");

    const synced = await syncFeatureStatus(root, FEATURE);
    expect(synced.ok).toBe(true);
    expect(synced.raw).toMatch(/001-url-shortener|status\.md|FR-001/i);

    const statusAfter = await readFile(
      join(root, "specs", FEATURE, "status.md"),
      "utf8",
    );
    expect(statusAfter.length).toBeGreaterThan(20);
    // sync-status rewrote status.md with FR snapshot
    expect(statusAfter).toMatch(/FR-001|Feature|Status/i);

    const forge = await forgeStatus(root, FEATURE);
    expect(forge.ok).toBe(true);
    expect(forge.raw).toMatch(/ok|task|summary|T00|pending|done/i);
  });

  it("app tests pass (validate) and Ira records ship validation report", async () => {
    const root = await cloneProject();
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--test", "tests/shortener.test.js"],
      { cwd: root, timeout: 20_000 },
    );
    expect(stdout).toMatch(/pass 4|tests 4/i);

    const report = await writeValidationReport(
      root,
      FEATURE,
      true,
      ["SC-001 unit tests passed", "SC-002 redirect works in-process", stdout.slice(0, 500)].join(
        "\n",
      ),
    );
    expect(report).toContain("validation-report.md");

    const shipped = await advanceLifecycle(root, FEATURE, "ship");
    expect(shipped.inferred).toBe("ship");

    await writeFile(
      join(root, "program.md"),
      `# Program Backlog

| Item | Spec path | Depends on | Status |
|------|-----------|------------|--------|
| URL Shortener | specs/001-url-shortener | — | shipped |

## Learnings

Ira queued Cursor host intents (OD-009); status.md advanced explore→ship via Ira lifecycle API.
`,
      "utf8",
    );

    const stages = await getProjectStages(root);
    expect(stages.find((s) => s.featureId === FEATURE)?.stage).toBe("ship");
  });
});
