/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardSnapshot, SnapshotAgent, SnapshotTask } from "../src/shared/snapshot-types.js";
import { renderTasksView } from "../src/client/views/tasks.js";

const FEATURE = "002-ira-command-center";

function task(overrides: Partial<SnapshotTask> & Pick<SnapshotTask, "id">): SnapshotTask {
  return {
    featureId: FEATURE,
    title: overrides.id,
    implementsFr: ["FR-010"],
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

function agent(overrides: Partial<SnapshotAgent> & Pick<SnapshotAgent, "id">): SnapshotAgent {
  return {
    name: overrides.id,
    personaPath: null,
    capabilityTags: [],
    engine: null,
    model: null,
    workspace: null,
    worktreePolicy: "isolated",
    status: "idle",
    origin: "placeholder",
    currentTaskId: null,
    ...overrides,
  };
}

function snapshot(tasks: SnapshotTask[], agents: SnapshotAgent[] = []): BoardSnapshot {
  return {
    ok: true,
    generatedAt: "2026-10-16T00:00:00.000Z",
    stale: false,
    repositoryRoot: "/repo",
    hiveRoot: "/repo/.superspec/hive",
    persona: { callsign: "Ira", expansion: "Intelligent Resource Automation" },
    doctor: {
      ok: true,
      hiveReady: true,
      engineRungReady: true,
      ready: true,
      findings: [],
    },
    autonomy: { autonomy: "supervised", awayMode: false, pollIntervalMs: 60_000 },
    features: [
      {
        featureId: FEATURE,
        taskCounts: { todo: 0, doing: 0, blocked: 0, done: 0 },
        openAskMe: 0,
        tasks,
        brief: null,
      },
    ],
    agents,
    askMe: [],
    events: [],
  };
}

describe("renderTasksView", () => {
  let host: HTMLElement;
  let postMutation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    postMutation = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it("renders kanban columns Ready, Waiting, Doing, Blocked, and Done", () => {
    renderTasksView(host, snapshot([]), { postMutation, steerDisabled: false });

    for (const column of ["Ready", "Waiting", "Doing", "Blocked", "Done"]) {
      expect(host.querySelector(`[data-kanban-column="${column}"]`)).not.toBeNull();
    }
  });

  it("places a todo task in Waiting when dependencies are incomplete and shows no Dispatch button", () => {
    const predecessor = task({ id: "T001", status: "todo" });
    const waiting = task({ id: "T002", dependsOn: ["T001"], readiness: "waiting" });

    renderTasksView(host, snapshot([predecessor, waiting]), { postMutation, steerDisabled: false });

    expect(host.querySelector('[data-kanban-column="Waiting"] [data-task-id="T002"]')).not.toBeNull();
    expect(host.querySelector('[data-task-id="T002"] [data-action="dispatch"]')).toBeNull();
  });

  it("places a DAG-ready todo in Ready and posts dispatch when Dispatch is clicked", async () => {
    const ready = task({ id: "T-ready", readiness: "ready", assigneeAgentId: "agent-1" });
    const agents = [agent({ id: "agent-1", status: "idle" })];

    renderTasksView(host, snapshot([ready], agents), { postMutation, steerDisabled: false });

    expect(host.querySelector('[data-kanban-column="Ready"] [data-task-id="T-ready"]')).not.toBeNull();
    const dispatch = host.querySelector('[data-task-id="T-ready"] [data-action="dispatch"]') as HTMLButtonElement;
    expect(dispatch).not.toBeNull();
    expect(dispatch.disabled).toBe(false);

    dispatch.click();
    await vi.waitFor(() => expect(postMutation).toHaveBeenCalledOnce());

    expect(postMutation).toHaveBeenCalledWith("/api/tasks/dispatch", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featureId: FEATURE, taskId: "T-ready" }),
    });
  });

  it("does not POST abort until confirm returns true", async () => {
    const doing = task({ id: "T-doing", status: "doing", readiness: "waiting" });
    const confirm = vi.fn(() => false);
    const prompt = vi.fn(() => "operator stop");

    renderTasksView(host, snapshot([doing]), {
      postMutation,
      steerDisabled: false,
      confirm,
      prompt,
    });

    const abortBtn = host.querySelector('[data-task-id="T-doing"] [data-action="abort"]') as HTMLButtonElement;
    abortBtn.click();

    expect(prompt).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalled();
    expect(postMutation).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    abortBtn.click();
    await vi.waitFor(() => expect(postMutation).toHaveBeenCalledOnce());

    expect(postMutation).toHaveBeenCalledWith("/api/tasks/abort", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        featureId: FEATURE,
        taskId: "T-doing",
        confirm: true,
        reason: "operator stop",
      }),
    });
  });

  it("shows a held badge when hold is true and pause helper text on doing cards", () => {
    const held = task({ id: "T-held", status: "doing", hold: true, readiness: "waiting" });

    renderTasksView(host, snapshot([held]), { postMutation, steerDisabled: false });

    expect(host.querySelector('[data-task-id="T-held"] [data-held-badge]')).not.toBeNull();
    expect(host.textContent).toContain("Sets hold on the task; does not record a failed review.");
  });

  it("disables steer controls when steerDisabled is true", () => {
    const ready = task({ id: "T-ready", readiness: "ready" });

    renderTasksView(host, snapshot([ready]), { postMutation, steerDisabled: true });

    const dispatch = host.querySelector('[data-task-id="T-ready"] [data-action="dispatch"]') as HTMLButtonElement;
    expect(dispatch.disabled).toBe(true);
  });
});
