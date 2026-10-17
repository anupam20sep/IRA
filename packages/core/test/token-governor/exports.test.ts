import { describe, it, expect } from "vitest";
import { registerTokenGovernor } from "@superspec-dev/core";

describe("package exports", () => {
  it("exports registerTokenGovernor", () => {
    expect(typeof registerTokenGovernor).toBe("function");
  });
});
