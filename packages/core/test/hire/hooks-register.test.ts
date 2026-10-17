import { describe, it, expect } from "vitest";
import { getRegisteredHireHooks } from "../../src/command-plane/hooks.js";
import "../../src/hire/index.js";

describe("hire hook registration", () => {
  it("registers matchCapabilities and onUntrustedImport", () => {
    const h = getRegisteredHireHooks();
    expect(typeof h?.matchCapabilities).toBe("function");
    expect(typeof h?.onUntrustedImport).toBe("function");
  });
});
