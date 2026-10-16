import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_TYPES_VERSION,
  type BoardSnapshot,
  type DoctorSlice,
  type SnapshotTask,
} from "../src/shared/snapshot-types.js";

describe("snapshot-types module", () => {
  it("is versioned for the board contract", () => {
    expect(SNAPSHOT_TYPES_VERSION).toBe(1);
  });
});

describe("SnapshotTask", () => {
  it("allows readiness on todo tasks", () => {
    const ready: SnapshotTask = {
      id: "T001",
      featureId: "002-ira-command-center",
      title: "Bootstrap",
      implementsFr: ["FR-018"],
      dependsOn: [],
      assigneeAgentId: "agent-host",
      status: "todo",
      kind: "code",
      complexity: "moderate",
      reviewFailures: 0,
      hold: false,
      ceiling: 3,
      drift: "ok",
      capabilityTags: [],
      updatedAt: "2026-10-15T16:20:00.000Z",
      readiness: "ready",
    };

    const waiting: SnapshotTask = {
      ...ready,
      id: "T002",
      dependsOn: ["T001"],
      readiness: "waiting",
    };

    expect(ready.status).toBe("todo");
    expect(ready.readiness).toBe("ready");
    expect(waiting.readiness).toBe("waiting");
  });

  it("allows hold on todo tasks", () => {
    const held: SnapshotTask = {
      id: "T003",
      featureId: "002-ira-command-center",
      title: "Held work",
      implementsFr: ["FR-010"],
      dependsOn: [],
      assigneeAgentId: null,
      status: "todo",
      kind: "code",
      complexity: "mechanical",
      reviewFailures: 0,
      hold: true,
      ceiling: 3,
      drift: "ok",
      capabilityTags: [],
      updatedAt: "2026-10-15T16:20:00.000Z",
      readiness: "waiting",
    };

    expect(held.hold).toBe(true);
  });
});

describe("DoctorSlice", () => {
  it("includes separate hiveReady and engineRungReady booleans", () => {
    const doctor: DoctorSlice = {
      ok: true,
      hiveReady: true,
      engineRungReady: false,
      ready: true,
      findings: [],
    };

    expect(doctor.hiveReady).toBe(true);
    expect(doctor.engineRungReady).toBe(false);
    expect(doctor.ready).toBe(doctor.hiveReady);
  });
});

describe("BoardSnapshot", () => {
  it("matches the GET /api/snapshot example shape", () => {
    const snapshot: BoardSnapshot = {
      ok: true,
      generatedAt: "2026-10-15T16:20:00.000Z",
      stale: false,
      repositoryRoot: "/abs/main",
      hiveRoot: "/abs/main/.superspec/hive",
      persona: { callsign: "Ira", expansion: "Intelligent Resource Automation" },
      doctor: {
        ok: true,
        hiveReady: true,
        engineRungReady: true,
        ready: true,
        findings: [],
      },
      autonomy: { autonomy: "supervised", awayMode: false, pollIntervalMs: 60000 },
      features: [
        {
          featureId: "002-ira-command-center",
          taskCounts: { todo: 1, doing: 0, blocked: 0, done: 0 },
          openAskMe: 0,
          tasks: [],
          brief: null,
        },
      ],
      agents: [],
      askMe: [],
      events: [],
      patternsDirState: "empty",
    };

    expect(snapshot.ok).toBe(true);
    expect(snapshot.features[0]?.taskCounts.todo).toBe(1);
  });
});
