import { describe, it, expect } from "vitest";
import { redactPatternSummary } from "../../src/learning-memory/redact.js";

describe("redactPatternSummary", () => {
  it("rejects api-key-like strings", () => {
    const r = redactPatternSummary("Use sk-live-abcdefghijklmnopqrstuvwxyz1234567890");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("SECRET_DETECTED");
  });

  it("passes clean lesson text", () => {
    const r = redactPatternSummary("Prefer atomic writes when updating forge state.");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain("atomic writes");
  });
});
