/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { BoardSnapshot, SnapshotAgent, SnapshotTask } from "../src/shared/snapshot-types.js";
import { contextGaugeLabel, renderFleetView, resolveDoingTaskForAgent } from "../src/client/views/fleet.js";

const FEATURE = "002-ira-command-center";

function task(overrides: Partial<SnapshotTask> & Pick<SnapshotTask, "id">): SnapshotTask {
  return {
    featureId: FEATURE,
    title: overrides.id,
    implementsFr: ["FR-003"],
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
    name: overrides.name ?? overrides.id,
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

function snapshot(
  agents: SnapshotAgent[],
  tasks: SnapshotTask[] = [],
  doctor: Partial<BoardSnapshot["doctor"]> = {},
): BoardSnapshot {
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
      ...doctor,
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

describe("contextGaugeLabel", () => {
  it("returns unknown when ratio is absent", () => {
    expect(contextGaugeLabel(undefined)).toBe("unknown");
  });

  it("returns a label for a present ratio including zero", () => {
    expect(contextGaugeLabel(0)).not.toBe("unknown");
    expect(contextGaugeLabel(0.42)).toContain("42");
  });
});

describe("resolveDoingTaskForAgent", () => {
  it("picks the doing task with the latest updatedAt", () => {
    const older = task({
      id: "T-old",
      status: "doing",
      assigneeAgentId: "a1",
      updatedAt: "2026-10-16T00:00:00.000Z",
    });
    const newer = task({
      id: "T-new",
      status: "doing",
      assigneeAgentId: "a1",
      updatedAt: "2026-10-16T01:00:00.000Z",
    });

    expect(resolveDoingTaskForAgent("a1", [older, newer])?.id).toBe("T-new");
  });
});

describe("renderFleetView", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders worker cards for each agent", () => {
    renderFleetView(
      host,
      snapshot([
        agent({ id: "a1", name: "Alpha" }),
        agent({ id: "a2", name: "Beta" }),
      ]),
    );

    expect(host.querySelector('[data-view="fleet"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-agent-id]")).toHaveLength(2);
    expect(host.textContent).toContain("Alpha");
    expect(host.textContent).toContain("Beta");
  });

  it("shows gauge label unknown for a busy agent without contextUsedRatio", () => {
    renderFleetView(
      host,
      snapshot([agent({ id: "busy-1", status: "busy" })]),
    );

    const gauge = host.querySelector('[data-agent-id="busy-1"] [data-context-gauge]');
    expect(gauge).not.toBeNull();
    expect(gauge?.textContent?.trim()).toBe("unknown");
  });

  it("shows engine and model as unknown when null", () => {
    renderFleetView(host, snapshot([agent({ id: "a1", engine: null, model: null })]));

    const card = host.querySelector('[data-agent-id="a1"]');
    expect(card?.textContent).toContain("unknown");
  });

  it("joins the current doing task from the ledger", () => {
    const doing = task({
      id: "T-doing",
      title: "Fleet join task",
      status: "doing",
      assigneeAgentId: "worker",
      updatedAt: "2026-10-16T02:00:00.000Z",
    });

    renderFleetView(
      host,
      snapshot([agent({ id: "worker", status: "busy" })], [doing]),
    );

    const card = host.querySelector('[data-agent-id="worker"]');
    expect(card?.textContent).toContain("Fleet join task");
  });

  it("shows none recorded when no doing task is assigned", () => {
    renderFleetView(host, snapshot([agent({ id: "idle-1", status: "idle" })], []));

    const card = host.querySelector('[data-agent-id="idle-1"]');
    expect(card?.textContent).toContain("none recorded");
  });

  it("renders engine degradation copy when engineRungReady is false and hive is healthy", () => {
    renderFleetView(
      host,
      snapshot([agent({ id: "a1" })], [], { hiveReady: true, engineRungReady: false }),
    );

    expect(host.querySelector("[data-fleet-engine-degradation]")).not.toBeNull();
    expect(host.textContent).toMatch(/no healthy engine rung/i);
    expect(host.querySelector('[data-view="fleet"]')).not.toBeNull();
  });
});
