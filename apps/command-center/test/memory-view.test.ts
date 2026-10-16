/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { BoardSnapshot, PatternsDirState } from "../src/shared/snapshot-types.js";
import { parseViewFromHash } from "../src/client/main.js";
import { renderMemoryView } from "../src/client/views/memory.js";

function snapshot(patternsDirState: PatternsDirState = "empty"): BoardSnapshot {
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
    features: [],
    agents: [],
    askMe: [],
    events: [],
    patternsDirState,
  };
}

describe("parseViewFromHash (memory route)", () => {
  it("maps #memory to the memory shell view", () => {
    expect(parseViewFromHash("#memory")).toBe("memory");
    expect(parseViewFromHash("#/memory")).toBe("memory");
  });
});

describe("renderMemoryView", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("shows empty copy when no pattern markdown is on disk", () => {
    renderMemoryView(host, snapshot("empty"));

    expect(host.querySelector('[data-view="memory"]')).not.toBeNull();
    expect(host.textContent).toContain("No patterns are stored yet.");
  });

  it("defers to P-003 when markdown files are present without a query surface", () => {
    renderMemoryView(host, snapshot("files-no-query"));

    expect(host.textContent).toContain(
      "Patterns are on disk. Summaries stay hidden until the learning-memory query surface is available.",
    );
  });

  it("does not reference sqlite or invent pattern rows", () => {
    renderMemoryView(host, snapshot("files-no-query"));

    const text = host.textContent ?? "";
    expect(text.toLowerCase()).not.toContain("sqlite");
    expect(text).not.toMatch(/\bsuccess\b/i);
    expect(text).not.toMatch(/\bfailure\b/i);
    expect(host.querySelector("[data-pattern-row]")).toBeNull();
  });
});
