/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { BoardSnapshot } from "../src/shared/snapshot-types.js";
import { parseViewFromHash } from "../src/client/main.js";
import { renderSpendView } from "../src/client/views/spend.js";

function snapshot(doctor: Partial<BoardSnapshot["doctor"]> = {}): BoardSnapshot {
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
    features: [],
    agents: [],
    askMe: [],
    events: [],
  };
}

describe("parseViewFromHash (spend route)", () => {
  it("maps #spend to the spend shell view", () => {
    expect(parseViewFromHash("#spend")).toBe("spend");
    expect(parseViewFromHash("#/spend")).toBe("spend");
  });
});

describe("renderSpendView", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("shows absent spend and unset budgets copy", () => {
    renderSpendView(host, snapshot());

    expect(host.querySelector('[data-view="spend"]')).not.toBeNull();
    expect(host.textContent).toContain("No spend recorded.");
    expect(host.textContent).toContain("Budgets: unset.");
  });

  it("does not synthesize currency totals", () => {
    renderSpendView(host, snapshot());

    const text = host.textContent ?? "";
    expect(text).not.toMatch(/\$/);
    expect(text).not.toMatch(/\bUSD\b/i);
    expect(text).not.toMatch(/\b0\.00\b/);
  });

  it("omits circuit-breaker UI", () => {
    renderSpendView(host, snapshot());

    expect(host.querySelector("[data-circuit-breaker]")).toBeNull();
    expect(host.querySelector("[data-breaker-stage]")).toBeNull();
    expect(host.textContent).not.toMatch(/\bsteer\b/i);
    expect(host.textContent).not.toMatch(/\bconstrain\b/i);
    expect(host.textContent).not.toMatch(/\bstop\b/i);
  });

  it("shows budget_unmetered doctor finding messages when present", () => {
    renderSpendView(
      host,
      snapshot({
        findings: [
          {
            code: "budget_unmetered",
            severity: "warning",
            message: "Token hook is absent, so budgets are unmetered.",
          },
        ],
      }),
    );

    const finding = host.querySelector('[data-doctor-finding="budget_unmetered"]');
    expect(finding).not.toBeNull();
    expect(finding?.textContent).toBe("Token hook is absent, so budgets are unmetered.");
  });
});
