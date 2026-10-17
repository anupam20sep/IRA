import { describe, it, expect } from "vitest";
import { resolvePatternWriteGate } from "../../src/learning-memory/slice-gate.js";

describe("resolvePatternWriteGate", () => {
  it("denies writes until sliceAValidated", () => {
    const r = resolvePatternWriteGate({ sliceAValidated: false });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("SLICE_A_ONLY");
  });

  it("allows writes after sliceAValidated", () => {
    expect(resolvePatternWriteGate({ sliceAValidated: true }).allowed).toBe(true);
  });
});
