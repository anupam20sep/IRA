/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { BoardSnapshot, SnapshotEvent } from "../src/shared/snapshot-types.js";
import { renderTriggersView } from "../src/client/views/triggers.js";
import { parseViewFromHash } from "../src/client/main.js";

function event(overrides: Partial<SnapshotEvent> & Pick<SnapshotEvent, "id" | "type">): SnapshotEvent {
  return {
    version: 1,
    ts: "2026-10-16T12:00:00.000Z",
    featureId: null,
    actor: { kind: "system", id: "ira" },
    data: {},
    ...overrides,
  };
}

function snapshot(
  autonomy: BoardSnapshot["autonomy"],
  events: SnapshotEvent[] = [],
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
    },
    autonomy,
    features: [],
    agents: [],
    askMe: [],
    events,
  };
}

describe("parseViewFromHash (triggers route)", () => {
  it("maps #triggers to the triggers shell view", () => {
    expect(parseViewFromHash("#triggers")).toBe("triggers");
    expect(parseViewFromHash("#/triggers")).toBe("triggers");
  });
});

describe("renderTriggersView", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("shows Nothing is scheduled when awayMode is false with away-poll row off", () => {
    renderTriggersView(host, snapshot({ autonomy: "supervised", awayMode: false, pollIntervalMs: 60_000 }));

    expect(host.textContent).toContain("Nothing is scheduled.");
    const row = host.querySelector('[data-trigger-id="away-poll"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-trigger-state")).toBe("off");
  });

  it("shows poll interval copy when awayMode is true and no away.tick in tail", () => {
    renderTriggersView(host, snapshot({ autonomy: "supervised", awayMode: true, pollIntervalMs: 45_000 }));

    expect(host.textContent).not.toContain("Nothing is scheduled.");
    const row = host.querySelector('[data-trigger-id="away-poll"]');
    expect(row?.getAttribute("data-trigger-state")).toBe("on");
    expect(host.textContent).toContain("Next poll on the away interval");
  });

  it("shows next poll within pollIntervalMs of last away tick when away.tick exists", () => {
    const events = [
      event({ id: "e1", type: "away.tick", ts: "2026-10-16T11:00:00.000Z" }),
      event({ id: "e2", type: "task.assigned", ts: "2026-10-16T11:30:00.000Z" }),
      event({ id: "e3", type: "away.tick", ts: "2026-10-16T12:00:00.000Z" }),
    ];

    renderTriggersView(
      host,
      snapshot({ autonomy: "autonomous", awayMode: true, pollIntervalMs: 30_000 }, events),
    );

    expect(host.textContent).toContain("Next poll within 30000 ms of the last away tick");
  });

  it("is read-only and exposes no away-set controls", () => {
    renderTriggersView(host, snapshot({ autonomy: "supervised", awayMode: true, pollIntervalMs: 60_000 }));

    expect(host.querySelector("[data-action]")).toBeNull();
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("button")).toBeNull();
  });
});
