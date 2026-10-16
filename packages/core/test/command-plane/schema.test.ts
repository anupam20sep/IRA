import { describe, it, expect } from "vitest";
import {
  AutonomySettingsSchema,
  HiveManifestSchema,
  HiveTaskSchema,
  AskMeItemSchema,
  IraEventSchema,
} from "../../src/command-plane/schema.js";
import { COMMAND_PLANE_ERROR_CODES } from "../../src/command-plane/types.js";

describe("AutonomySettingsSchema", () => {
  it("treats missing allowAbsentCi as false at read time", () => {
    const parsed = AutonomySettingsSchema.parse({
      schemaVersion: 1,
      autonomy: "supervised",
      awayMode: false,
      pollIntervalMs: 60000,
      maxReviewFailures: 3,
      featureCeilings: {},
      telemetry: "off",
      updatedAt: "2026-10-15T00:00:00.000Z",
    });
    expect(parsed.allowAbsentCi).toBe(false);
  });
});

describe("HiveTaskSchema", () => {
  it("defaults hold false", () => {
    const t = HiveTaskSchema.parse({
      id: "T001",
      featureId: "f",
      title: "x",
      implementsFr: ["FR-001"],
      dependsOn: [],
      assigneeAgentId: null,
      status: "todo",
      kind: "code",
      complexity: "moderate",
      reviewFailures: 0,
      ceiling: 3,
      drift: "ok",
      capabilityTags: [],
      updatedAt: "2026-10-15T00:00:00.000Z",
    });
    expect(t.hold).toBe(false);
  });

  it("accepts abortReason", () => {
    const t = HiveTaskSchema.parse({
      id: "T001",
      featureId: "f",
      title: "x",
      implementsFr: ["FR-001"],
      dependsOn: [],
      assigneeAgentId: null,
      status: "blocked",
      kind: "code",
      complexity: "moderate",
      reviewFailures: 0,
      hold: false,
      abortReason: "operator stop",
      ceiling: 3,
      drift: "ok",
      capabilityTags: [],
      updatedAt: "2026-10-15T00:00:00.000Z",
    });
    expect(t.abortReason).toBe("operator stop");
  });
});

describe("HiveManifestSchema", () => {
  it("parses hive.json manifest", () => {
    const m = HiveManifestSchema.parse({
      schemaVersion: 1,
      repositoryRoot: "/abs/main",
      createdAt: "2026-10-15T00:00:00.000Z",
      persona: {
        callsign: "Ira",
        expansion: "Intelligent Resource Automation",
      },
    });
    expect(m.persona.callsign).toBe("Ira");
  });
});

describe("AskMeItemSchema", () => {
  it("parses open ask-me item", () => {
    const item = AskMeItemSchema.parse({
      id: "ask_00000000-0000-4000-8000-000000000000",
      featureId: "001-ira-command-plane",
      taskId: "T002",
      agentId: "agent-host",
      reasonClass: "budget_exceed",
      question: "Budget would be exceeded",
      answer: null,
      action: null,
      state: "open",
      createdAt: "2026-10-15T00:00:00.000Z",
      resolvedAt: null,
    });
    expect(item.state).toBe("open");
  });
});

describe("IraEventSchema", () => {
  it("parses task.held event", () => {
    const evt = IraEventSchema.parse({
      id: "evt_00000000-0000-4000-8000-000000000000",
      type: "task.held",
      version: 1,
      ts: "2026-10-15T16:20:00.000Z",
      featureId: "001-ira-command-plane",
      actor: { kind: "ira", id: "ira" },
      data: { taskId: "T002", hold: true },
    });
    expect(evt.type).toBe("task.held");
  });
});

describe("COMMAND_PLANE_ERROR_CODES", () => {
  it("includes amendment-critical dispatch and gate codes", () => {
    expect(COMMAND_PLANE_ERROR_CODES).toContain("DISPATCH_PATH_REQUIRED");
    expect(COMMAND_PLANE_ERROR_CODES).toContain("DISPATCH_HELD");
    expect(COMMAND_PLANE_ERROR_CODES).toContain("HIVE_NOT_READY");
    expect(COMMAND_PLANE_ERROR_CODES).toContain("SLICE_A_ONLY");
    expect(COMMAND_PLANE_ERROR_CODES).toContain("HOOK_FAILED_CLOSED");
  });
});
