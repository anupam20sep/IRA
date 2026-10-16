/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardSnapshot, SnapshotAskMe, SnapshotEvent } from "../src/shared/snapshot-types.js";
import { renderAskMeView } from "../src/client/views/ask-me.js";

const FEATURE = "002-ira-command-center";

function askItem(overrides: Partial<SnapshotAskMe> & Pick<SnapshotAskMe, "id">): SnapshotAskMe {
  return {
    featureId: FEATURE,
    taskId: null,
    agentId: null,
    reasonClass: "ambiguous_requirement",
    question: overrides.id,
    answer: null,
    action: null,
    state: "open",
    createdAt: "2026-10-16T00:00:00.000Z",
    resolvedAt: null,
    ageSeconds: 42,
    ...overrides,
  };
}

function snapshot(
  askMe: SnapshotAskMe[],
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
    autonomy: { autonomy: "supervised", awayMode: false, pollIntervalMs: 60_000 },
    features: [
      {
        featureId: FEATURE,
        taskCounts: { todo: 0, doing: 0, blocked: 0, done: 0 },
        openAskMe: askMe.filter((row) => row.state === "open").length,
        tasks: [],
        brief: null,
      },
    ],
    agents: [],
    askMe,
    events,
  };
}

describe("renderAskMeView", () => {
  let host: HTMLElement;
  let postMutation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    postMutation = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it("lists only open ask-me items and renders the selected question", () => {
    const open = askItem({ id: "ask_open", question: "Should we retry the review?" });
    const resolved = askItem({
      id: "ask_done",
      question: "Old question",
      state: "resolved",
      resolvedAt: "2026-10-16T01:00:00.000Z",
    });

    renderAskMeView(host, snapshot([open, resolved]), { postMutation });

    expect(host.querySelector('[data-ask-me-id="ask_open"]')).not.toBeNull();
    expect(host.querySelector('[data-ask-me-id="ask_done"]')).toBeNull();

    const row = host.querySelector('[data-ask-me-id="ask_open"]') as HTMLButtonElement;
    row.click();

    expect(host.querySelector("[data-ask-me-question]")?.textContent).toBe("Should we retry the review?");
  });

  it("does not synthesize inbox rows from routine hive events", () => {
    const events: SnapshotEvent[] = [
      {
        id: "evt-1",
        type: "engine.tokens",
        version: 1,
        ts: "2026-10-16T00:00:00.000Z",
        featureId: FEATURE,
        actor: { kind: "system", id: "ira" },
        data: {},
      },
      {
        id: "evt-2",
        type: "ask_me.opened",
        version: 1,
        ts: "2026-10-16T00:01:00.000Z",
        featureId: FEATURE,
        actor: { kind: "system", id: "ira" },
        data: { question: "Synthetic from event" },
      },
    ];

    renderAskMeView(host, snapshot([], events), { postMutation });

    expect(host.querySelector("[data-ask-me-inbox]")?.querySelectorAll("[data-ask-me-id]").length).toBe(0);
  });

  it("does not POST answer until confirm returns true", async () => {
    const open = askItem({ id: "ask_1", question: "Approve scope change?" });
    const confirm = vi.fn(() => false);

    renderAskMeView(host, snapshot([open]), { postMutation, confirm });

    const row = host.querySelector('[data-ask-me-id="ask_1"]') as HTMLButtonElement;
    row.click();

    const text = host.querySelector('[data-ask-me-answer-text]') as HTMLTextAreaElement;
    text.value = "Proceed with narrowed scope";
    const action = host.querySelector('[data-ask-me-action]') as HTMLSelectElement;
    action.value = "acknowledge";

    const submit = host.querySelector('[data-action="ask-me-submit"]') as HTMLButtonElement;
    submit.click();

    expect(confirm).toHaveBeenCalled();
    expect(postMutation).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    submit.click();
    await vi.waitFor(() => expect(postMutation).toHaveBeenCalledOnce());

    expect(postMutation).toHaveBeenCalledWith("/api/ask-me/answer", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "ask_1",
        text: "Proceed with narrowed scope",
        action: "acknowledge",
        confirm: true,
      }),
    });
  });

  it("refuses submit client-side when answer text is empty", () => {
    const open = askItem({ id: "ask_2", question: "Need input?" });
    const confirm = vi.fn(() => true);

    renderAskMeView(host, snapshot([open]), { postMutation, confirm });

    const row = host.querySelector('[data-ask-me-id="ask_2"]') as HTMLButtonElement;
    row.click();

    const submit = host.querySelector('[data-action="ask-me-submit"]') as HTMLButtonElement;
    submit.click();

    expect(confirm).not.toHaveBeenCalled();
    expect(postMutation).not.toHaveBeenCalled();
  });
});
