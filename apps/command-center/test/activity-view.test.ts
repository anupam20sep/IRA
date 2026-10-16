/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotEvent } from "../src/shared/snapshot-types.js";
import { renderActivityView } from "../src/client/views/activity.js";

function event(overrides: Partial<SnapshotEvent> & Pick<SnapshotEvent, "id">): SnapshotEvent {
  return {
    type: "task.started",
    version: 1,
    ts: "2026-10-16T00:00:00.000Z",
    featureId: "002-ira-command-center",
    actor: { kind: "ira", id: "ira" },
    data: {},
    ...overrides,
  };
}

describe("renderActivityView", () => {
  let host: HTMLElement;
  let fetchEventsBefore: ReturnType<typeof vi.fn>;
  let state: { prepended: SnapshotEvent[] };

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    state = { prepended: [] };
    fetchEventsBefore = vi.fn(async () => []);
  });

  it("renders three events in append order (older above newer)", () => {
    const rows = [
      event({ id: "evt_a", ts: "2026-10-16T00:00:01.000Z", type: "note.kept" }),
      event({ id: "evt_b", ts: "2026-10-16T00:00:02.000Z", type: "task.started" }),
      event({ id: "evt_c", ts: "2026-10-16T00:00:03.000Z", type: "task.done" }),
    ];

    renderActivityView(host, rows, { fetchEventsBefore, state });

    const ids = [...host.querySelectorAll("[data-event-id]")].map(
      (el) => el.getAttribute("data-event-id"),
    );
    expect(ids).toEqual(["evt_a", "evt_b", "evt_c"]);
  });

  it("shows No events recorded. when the log is empty with no demo rows", () => {
    renderActivityView(host, [], { fetchEventsBefore, state });

    expect(host.textContent).toContain("No events recorded.");
    expect(host.querySelector("[data-event-id]")).toBeNull();
    expect(host.querySelector("[data-load-earlier]")).toBeNull();
  });

  it("prepends an earlier page when Load earlier is clicked", async () => {
    const tail = [
      event({ id: "evt_2", type: "task.started" }),
      event({ id: "evt_3", type: "task.done" }),
    ];
    fetchEventsBefore.mockResolvedValueOnce([
      event({ id: "evt_0", type: "note.kept" }),
      event({ id: "evt_1", type: "task.assigned" }),
    ]);

    renderActivityView(host, tail, { fetchEventsBefore, state });

    const loadBtn = host.querySelector("[data-load-earlier]") as HTMLButtonElement;
    expect(loadBtn).not.toBeNull();
    loadBtn.click();

    await vi.waitFor(() => expect(fetchEventsBefore).toHaveBeenCalledOnce());
    expect(fetchEventsBefore).toHaveBeenCalledWith("evt_2");

    const ids = [...host.querySelectorAll("[data-event-id]")].map(
      (el) => el.getAttribute("data-event-id"),
    );
    expect(ids).toEqual(["evt_0", "evt_1", "evt_2", "evt_3"]);
  });
});
