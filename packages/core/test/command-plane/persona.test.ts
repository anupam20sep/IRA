import { describe, it, expect } from "vitest";
import { IRA_PERSONA } from "../../src/command-plane/persona.js";

describe("IRA_PERSONA", () => {
  it("uses Ira callsign and full expansion", () => {
    expect(IRA_PERSONA.callsign).toBe("Ira");
    expect(IRA_PERSONA.expansion).toBe("Intelligent Resource Automation");
  });
});
