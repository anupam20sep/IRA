import { describe, expect, it } from "vitest";
import type { CockpitSnapshot, ProjectSnapshot } from "@/backend/types";
import { mapSnapshotToLive } from "./live-map";

function projectSnap(over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    id: "superspec",
    name: "SuperSpec",
    path: "/Users/macky/IRA/superspec",
    hiveRoot: "/hive",
    doctor: {
      ok: true,
      hiveReady: true,
      engineRungReady: false,
      hiveRoot: "/hive",
      repositoryRoot: "/Users/macky/IRA/superspec",
      findings: [],
    },
    askMe: [
      {
        id: "am-1",
        featureId: "auth",
        taskId: null,
        agentId: null,
        reasonClass: "budget_exceeded",
        question: "Raise budget?",
        answer: null,
      },
    ],
    roster: [
      {
        id: "agent-1",
        displayName: "Python Dev",
        status: "busy",
        engine: "claude",
        capabilityTags: ["python"],
      },
    ],
    personas: [],
    specs: [
      {
        featureId: "auth",
        title: "auth",
        stage: "forge",
        hasSpec: true,
        hasDesign: true,
        hasPlan: true,
        hasStatus: true,
      },
      {
        featureId: "billing",
        title: "billing",
        stage: "plan",
        hasSpec: true,
        hasDesign: true,
        hasPlan: true,
        hasStatus: false,
      },
    ],
    patterns: [{ id: "pat_1", path: ".superspec/patterns/pat_1.md", title: "pat_1" }],
    events: [{ ts: "2026-10-18T01:00:00Z", type: "dispatch", message: "queued" }],
    settings: null,
    ...over,
  };
}

function baseSnapshot(over: Partial<CockpitSnapshot> = {}): CockpitSnapshot {
  const primary = projectSnap();
  return {
    generatedAt: "2026-10-18T00:00:00.000Z",
    repositoryRoot: primary.path,
    hiveRoot: primary.hiveRoot,
    doctor: primary.doctor,
    engines: [],
    projects: [primary],
    ...over,
  };
}

describe("mapSnapshotToLive", () => {
  it("maps one repo root to one project with nested specs", () => {
    const mapped = mapSnapshotToLive(baseSnapshot());
    expect(mapped.projects).toHaveLength(1);
    expect(mapped.projects[0]?.id).toBe("superspec");
    expect(mapped.projects[0]?.path).toBe("/Users/macky/IRA/superspec");
    expect(mapped.projects[0]?.specs).toHaveLength(2);
    expect(mapped.projects[0]?.specs.map((s) => s.id)).toEqual(["auth", "billing"]);
    expect(mapped.interventions).toHaveLength(1);
    expect(mapped.interventions[0]?.projectId).toBe("superspec");
    expect(mapped.interventions[0]?.detail).toContain("[auth]");
    expect(mapped.liveMeta.projectCount).toBe(1);
  });

  it("does not treat each spec as its own project", () => {
    const mapped = mapSnapshotToLive(baseSnapshot());
    expect(mapped.projects.map((p) => p.id)).not.toContain("auth");
    expect(mapped.projects.map((p) => p.id)).not.toContain("billing");
  });

  it("supports multiple local repo paths as projects", () => {
    const a = projectSnap({ id: "repo-a", name: "Repo A", path: "/tmp/a", specs: [] });
    const b = projectSnap({
      id: "repo-b",
      name: "Repo B",
      path: "/tmp/b",
      askMe: [],
      roster: [],
      specs: [
        {
          featureId: "only-spec",
          title: "only-spec",
          stage: "scope",
          hasSpec: true,
          hasDesign: false,
          hasPlan: false,
          hasStatus: false,
        },
      ],
    });
    const mapped = mapSnapshotToLive(
      baseSnapshot({
        projects: [a, b],
        repositoryRoot: a.path,
        doctor: a.doctor,
        hiveRoot: a.hiveRoot,
      }),
    );
    expect(mapped.projects).toHaveLength(2);
    expect(mapped.projects[0]?.specs).toHaveLength(0);
    expect(mapped.projects[1]?.specs).toHaveLength(1);
    expect(mapped.liveMeta.projectCount).toBe(2);
  });

  it("keeps an empty-spec project (repo still valid)", () => {
    const mapped = mapSnapshotToLive(
      baseSnapshot({
        projects: [projectSnap({ specs: [], askMe: [] })],
      }),
    );
    expect(mapped.projects).toHaveLength(1);
    expect(mapped.projects[0]?.specs).toEqual([]);
  });

  it("uses personas when roster empty", () => {
    const mapped = mapSnapshotToLive(
      baseSnapshot({
        projects: [
          projectSnap({
            roster: [],
            personas: [
              {
                name: "ira-chief",
                description: "Chief of staff",
                source: "cursor",
                path: ".cursor/agents/ira.md",
              },
            ],
          }),
        ],
      }),
    );
    expect(mapped.projects[0]?.agents.some((a) => a.name === "ira-chief")).toBe(true);
    expect(mapped.catalogAgents.some((a) => a.name === "ira-chief")).toBe(true);
  });
});
