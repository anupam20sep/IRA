import { describe, expect, it } from "vitest";
import { buildMorningBriefLines } from "../src/client/brief-copy.js";

describe("buildMorningBriefLines", () => {
  it("leads with counts, spend, quota, needs you, and trigger when work exists", () => {
    const lines = buildMorningBriefLines({
      done: 3,
      blocked: 1,
      doing: 2,
      openAskMe: 0,
      pollIntervalMs: 60_000,
      awayMode: false,
    });

    expect(lines).toEqual([
      "3 done. 1 blocked. 2 in progress.",
      "Spend: none recorded. Quota: unknown.",
      "Needs you: nothing.",
      "Next trigger: nothing scheduled.",
    ]);
  });

  it("prefixes Nothing in flight when all work counts are zero", () => {
    const lines = buildMorningBriefLines({
      done: 0,
      blocked: 0,
      doing: 0,
      openAskMe: 0,
      pollIntervalMs: 30_000,
      awayMode: false,
    });

    expect(lines[0]).toBe("Nothing in flight.");
    expect(lines[1]).toBe("0 done. 0 blocked. 0 in progress.");
    expect(lines).toContain("Spend: none recorded. Quota: unknown.");
    expect(lines).toContain("Needs you: nothing.");
  });

  it("shows open ask-me count when escalations exist", () => {
    const lines = buildMorningBriefLines({
      done: 0,
      blocked: 0,
      doing: 1,
      openAskMe: 2,
      pollIntervalMs: 60_000,
      awayMode: false,
    });

    expect(lines).toContain("Needs you: 2.");
  });

  it("shows away poll trigger when away mode is on", () => {
    const lines = buildMorningBriefLines({
      done: 1,
      blocked: 0,
      doing: 0,
      openAskMe: 0,
      pollIntervalMs: 45_000,
      awayMode: true,
    });

    expect(lines).toContain("Next trigger: away poll every 45000 ms.");
  });
});
