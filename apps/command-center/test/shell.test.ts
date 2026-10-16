/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { BoardSnapshot } from "../src/shared/snapshot-types.js";
import { navHref, renderShell, type ShellView } from "../src/client/shell.js";

const GOD_VIEWS: ShellView[] = [
  "tasks",
  "fleet",
  "activity",
  "memory",
  "spend",
  "ask-me",
  "triggers",
];

function baseSnapshot(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
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
        taskCounts: { todo: 0, doing: 0, blocked: 0, done: 0 },
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

function totalOpenAskMe(snapshot: BoardSnapshot): number {
  return snapshot.features.reduce((sum, f) => sum + f.openAskMe, 0);
}

describe("navHref", () => {
  it("maps brief and GOD views to hash routes", () => {
    expect(navHref("brief")).toBe("#/brief");
    for (const view of GOD_VIEWS) {
      expect(navHref(view)).toBe(`#/${view}`);
    }
  });
});

describe("renderShell", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  it("renders navigation links for brief and all seven GOD views", () => {
    renderShell(root, baseSnapshot());

    const hrefs = [...root.querySelectorAll("nav a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(navHref("brief"));
    for (const view of GOD_VIEWS) {
      expect(hrefs).toContain(navHref(view));
    }
    expect(hrefs.length).toBe(8);
  });

  it("shows Ira callsign and expansion from snapshot persona", () => {
    const snapshot = baseSnapshot({
      persona: { callsign: "Ira", expansion: "Intelligent Resource Automation" },
    });
    renderShell(root, snapshot);

    const header = root.querySelector("header");
    expect(header?.textContent).toContain("Ira");
    expect(header?.textContent).toContain("Intelligent Resource Automation");
  });

  it("shows amber ask-me lamp when openAskMe is greater than zero", () => {
    const snapshot = baseSnapshot({
      features: [
        {
          featureId: "002-ira-command-center",
          taskCounts: { todo: 0, doing: 0, blocked: 0, done: 0 },
          openAskMe: 2,
          tasks: [],
          brief: null,
        },
      ],
    });
    renderShell(root, snapshot);

    const lamp = root.querySelector("[data-ask-me-lamp]");
    expect(lamp).not.toBeNull();
    expect(lamp?.classList.contains("ira-lamp-amber")).toBe(true);
    expect(lamp?.textContent).toContain(String(totalOpenAskMe(snapshot)));
  });

  it("does not show amber lamp when openAskMe is zero", () => {
    renderShell(root, baseSnapshot());
    expect(root.querySelector("[data-ask-me-lamp].ira-lamp-amber")).toBeNull();
  });

  it("shows engine degradation banner when hive is ready but engine rung is not", () => {
    const snapshot = baseSnapshot({
      doctor: {
        ok: true,
        hiveReady: true,
        engineRungReady: false,
        ready: true,
        findings: [],
      },
    });
    renderShell(root, snapshot);

    const banner = root.querySelector("[data-engine-banner]");
    expect(banner).not.toBeNull();
    expect(banner?.textContent?.toLowerCase()).toMatch(/engine/);
  });

  it("hides engine banner when engine rung is ready", () => {
    renderShell(root, baseSnapshot());
    expect(root.querySelector("[data-engine-banner]")).toBeNull();
  });

  it("includes exactly one presence arc mark in the header", () => {
    renderShell(root, baseSnapshot());
    expect(root.querySelectorAll("header [data-ira-arc]").length).toBe(1);
    expect(root.querySelectorAll("[data-ira-arc]").length).toBe(1);
  });

  it("applies tokens.css for Ira Glass variables", () => {
    renderShell(root, baseSnapshot());
    const link = document.querySelector('link[data-ira-tokens][href*="tokens.css"]');
    expect(link).not.toBeNull();
  });
});
