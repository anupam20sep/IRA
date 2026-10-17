import { describe, it, expect } from "vitest";
import { runAdapterSafe } from "../../src/integrations/fail-closed.js";

describe("runAdapterSafe", () => {
  it("returns fallback when adapter throws", async () => {
    const r = await runAdapterSafe("openclaw", async () => { throw new Error("boom"); }, { ok: false });
    expect(r).toEqual({ ok: false });
  });
});
