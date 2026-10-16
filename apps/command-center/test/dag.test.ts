import { describe, expect, it } from "vitest";
import { computeReadiness, isDagReadyForDispatch } from "../src/client/dag.js";
import type { SnapshotTask } from "../src/shared/snapshot-types.js";

function task(overrides: Partial<SnapshotTask> & Pick<SnapshotTask, "id">): SnapshotTask {
  return {
    featureId: "002-ira-command-center",
    title: overrides.id,
    implementsFr: ["FR-002"],
    dependsOn: [],
    assigneeAgentId: null,
    status: "todo",
    kind: "code",
    complexity: "moderate",
    reviewFailures: 0,
    hold: false,
    ceiling: 3,
    blockedByAskMeId: null,
    drift: "ok",
    capabilityTags: [],
    updatedAt: "2026-10-16T00:00:00.000Z",
    readiness: "waiting",
    ...overrides,
  };
}

function byId(tasks: SnapshotTask[]): ReadonlyMap<string, SnapshotTask> {
  return new Map(tasks.map((row) => [row.id, row]));
}

describe("computeReadiness", () => {
  it("is waiting when a dependency is not done", () => {
    const predecessor = task({ id: "T001", status: "todo", readiness: "ready" });
    const subject = task({
      id: "T002",
      dependsOn: ["T001"],
      readiness: "ready",
    });

    expect(computeReadiness(subject, byId([predecessor, subject]))).toBe("waiting");
  });

  it("is waiting when a dependency is missing from the ledger map", () => {
    const subject = task({ id: "T002", dependsOn: ["T001"], readiness: "ready" });

    expect(computeReadiness(subject, byId([subject]))).toBe("waiting");
  });

  it("is waiting when any one dependency is not done", () => {
    const done = task({ id: "T001", status: "done" });
    const stillDoing = task({ id: "T002", status: "doing" });
    const subject = task({
      id: "T003",
      dependsOn: ["T001", "T002"],
      readiness: "ready",
    });

    expect(computeReadiness(subject, byId([done, stillDoing, subject]))).toBe("waiting");
  });

  it("is ready when every dependency is done", () => {
    const done = task({ id: "T001", status: "done" });
    const subject = task({ id: "T002", dependsOn: ["T001"], readiness: "waiting" });

    expect(computeReadiness(subject, byId([done, subject]))).toBe("ready");
  });

  it("is ready when the task has no dependencies", () => {
    const subject = task({ id: "T001", dependsOn: [], readiness: "waiting" });

    expect(computeReadiness(subject, byId([subject]))).toBe("ready");
  });

  it("is waiting when hold is true even if dependencies are done", () => {
    const subject = task({ id: "T001", hold: true, readiness: "ready" });

    expect(computeReadiness(subject, byId([subject]))).toBe("waiting");
  });

  it("is waiting for a code task with an empty implementsFr", () => {
    const subject = task({
      id: "T001",
      kind: "code",
      implementsFr: [],
      readiness: "ready",
    });

    expect(computeReadiness(subject, byId([subject]))).toBe("waiting");
  });

  it("is ready for a non-code task with an empty implementsFr", () => {
    const subject = task({
      id: "T001",
      kind: "verify",
      implementsFr: [],
      readiness: "waiting",
    });

    expect(computeReadiness(subject, byId([subject]))).toBe("ready");
  });

  it("is waiting when blockedByAskMeId is set", () => {
    const subject = task({
      id: "T001",
      blockedByAskMeId: "ask_11111111-1111-4111-8111-111111111111",
      readiness: "ready",
    });

    expect(computeReadiness(subject, byId([subject]))).toBe("waiting");
  });

  it("is waiting when drift is removed", () => {
    const subject = task({ id: "T001", drift: "removed", readiness: "ready" });

    expect(computeReadiness(subject, byId([subject]))).toBe("waiting");
  });

  it("is waiting when status is not todo", () => {
    for (const status of ["doing", "blocked", "done"] as const) {
      const subject = task({ id: "T001", status, readiness: "ready" });
      expect(computeReadiness(subject, byId([subject]))).toBe("waiting");
    }
  });
});

describe("isDagReadyForDispatch", () => {
  it("is false when hold is true", () => {
    const subject = task({ id: "T001", hold: true });

    expect(isDagReadyForDispatch(subject, byId([subject]))).toBe(false);
  });

  it("is false when a code task has an empty implementsFr", () => {
    const subject = task({ id: "T001", kind: "code", implementsFr: [] });

    expect(isDagReadyForDispatch(subject, byId([subject]))).toBe(false);
  });

  it("is false when a dependency is not done", () => {
    const predecessor = task({ id: "T001", status: "todo" });
    const subject = task({ id: "T002", dependsOn: ["T001"] });

    expect(isDagReadyForDispatch(subject, byId([predecessor, subject]))).toBe(false);
  });

  it("is false when blockedByAskMeId is set", () => {
    const subject = task({
      id: "T001",
      blockedByAskMeId: "ask_11111111-1111-4111-8111-111111111111",
    });

    expect(isDagReadyForDispatch(subject, byId([subject]))).toBe(false);
  });

  it("is false when drift is removed", () => {
    const subject = task({ id: "T001", drift: "removed" });

    expect(isDagReadyForDispatch(subject, byId([subject]))).toBe(false);
  });

  it("is false when status is not todo", () => {
    const subject = task({ id: "T001", status: "doing" });

    expect(isDagReadyForDispatch(subject, byId([subject]))).toBe(false);
  });

  it("is true when dependencies are done and dispatch guards pass", () => {
    const done = task({ id: "T001", status: "done" });
    const subject = task({
      id: "T002",
      dependsOn: ["T001"],
      hold: false,
      kind: "code",
      implementsFr: ["FR-010"],
      blockedByAskMeId: null,
      drift: "ok",
      status: "todo",
    });

    expect(isDagReadyForDispatch(subject, byId([done, subject]))).toBe(true);
  });

  it("is true for a non-code task with an empty implementsFr", () => {
    const subject = task({ id: "T001", kind: "doc-sync", implementsFr: [] });

    expect(isDagReadyForDispatch(subject, byId([subject]))).toBe(true);
  });

  it("treats omitted hold and a null Ask-Me link as clear", () => {
    const subject = task({ id: "T001" });
    delete subject.hold;
    subject.blockedByAskMeId = null;

    expect(isDagReadyForDispatch(subject, byId([subject]))).toBe(true);
    expect(computeReadiness(subject, byId([subject]))).toBe("ready");
  });

  it("matches computeReadiness", () => {
    const blockedDep = task({ id: "T001", status: "blocked" });
    const held = task({ id: "T002", hold: true, dependsOn: ["T001"] });
    const ready = task({ id: "T003", dependsOn: [], drift: "added" });
    const tasks = byId([blockedDep, held, ready]);

    for (const row of [blockedDep, held, ready]) {
      expect(isDagReadyForDispatch(row, tasks)).toBe(computeReadiness(row, tasks) === "ready");
    }
  });
});
