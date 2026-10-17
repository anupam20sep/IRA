import { describe, it, expect } from "vitest";
import { sliceABeforeDispatchGate, guardSideEffectWrite } from "../../src/token-governor/slice-a.js";

describe("slice-a", () => {
  it("denies byok/local beforeDispatch with SLICE_A_ONLY when slice active", () => {
    const gate = sliceABeforeDispatchGate({ engineRung: "local", sliceAActive: true } as any);
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect(gate.reason).toBe("SLICE_A_ONLY");
  });

  it("skips spend append when slice active", async () => {
    let wrote = false;
    const r = await guardSideEffectWrite(
      "/tmp/hive",
      async () => {
        wrote = true;
        return { ok: true };
      },
      { sliceAActive: true } as any,
    );
    expect(wrote).toBe(false);
    expect(r).toEqual({ ok: false, code: "SLICE_A_ONLY" });
  });
});
