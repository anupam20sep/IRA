/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardSnapshot } from "../src/shared/snapshot-types.js";
import { renderBriefView } from "../src/client/views/brief.js";

const FEATURE = "002-ira-command-center";

function snapshot(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
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
        taskCounts: { todo: 1, doing: 2, blocked: 1, done: 3 },
        openAskMe: 0,
        tasks: [],
        brief: null,
      },
    ],
    agents: [],
    askMe: [],
    events: [],
    ...overrides,
  };
}

describe("renderBriefView", () => {
  let host: HTMLElement;
  let postMutation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    postMutation = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it("renders morning brief lines from snapshot counts via buildMorningBriefLines", () => {
    renderBriefView(host, snapshot(), { postMutation });

    const morning = host.querySelector("[data-morning-brief]");
    expect(morning).not.toBeNull();
    expect(morning!.textContent).toContain("3 done. 1 blocked. 2 in progress.");
    expect(morning!.textContent).toContain("Needs you: nothing.");
    expect(morning!.textContent).toContain("Next trigger: nothing scheduled.");
  });

  it("does not POST when deliverable is omitted", async () => {
    renderBriefView(host, snapshot(), { postMutation });

    const outcome = host.querySelector('[data-brief-field="outcome"]') as HTMLTextAreaElement;
    outcome.value = "Ship the shell";

    const submit = host.querySelector('[data-action="brief-submit"]') as HTMLButtonElement;
    submit.click();

    await vi.waitFor(() => {
      expect(host.querySelector("[data-brief-validation]")).not.toBeNull();
    });
    expect(postMutation).not.toHaveBeenCalled();
  });

  it("POSTs /api/brief and shows acknowledgement from CLI JSON on success", async () => {
    postMutation.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          brief: { id: "brief_abc", featureId: FEATURE },
          tasks: [{ id: "T001" }, { id: "T002" }],
          assignment: [],
        }),
        { status: 200 },
      ),
    );

    renderBriefView(host, snapshot(), { postMutation });

    (host.querySelector('[data-brief-field="outcome"]') as HTMLTextAreaElement).value =
      "Ship the command center shell";
    (host.querySelector('[data-brief-field="deliverable"]') as HTMLInputElement).value =
      `specs/${FEATURE}`;

    (host.querySelector('[data-action="brief-submit"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(postMutation).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(host.querySelector("[data-brief-ack]")?.textContent).toContain("brief_abc"),
    );

    expect(postMutation).toHaveBeenCalledWith("/api/brief", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        featureId: FEATURE,
        outcome: "Ship the command center shell",
        constraints: [],
        budgetTokens: null,
        budgetUsd: null,
        deliverable: `specs/${FEATURE}`,
      }),
    });

    const ack = host.querySelector("[data-brief-ack]");
    expect(ack!.textContent).toContain(FEATURE);
    expect(ack!.textContent).toContain("2");
  });
});
