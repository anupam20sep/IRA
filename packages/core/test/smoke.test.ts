import { describe, it, expect } from "vitest";
import { registerCommandPlaneHooks, IRA_PERSONA } from "@superspec-dev/core";

describe("core exports", () => {
  it("exports command plane surface", () => {
    expect(IRA_PERSONA.callsign).toBe("Ira");
    expect(typeof registerCommandPlaneHooks).toBe("function");
  });
});

describe("workspace smoke", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
