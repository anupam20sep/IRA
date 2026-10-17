import { describe, it, expect } from "vitest";

describe("package exports hire", () => {
  it("exports hireImport from package root", async () => {
    const mod = await import("../../src/index.js");
    expect(typeof mod.hireImport).toBe("function");
  });
});
