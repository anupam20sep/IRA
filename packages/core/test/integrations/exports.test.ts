import { describe, it, expect } from "vitest";

describe("package exports integrations", () => {
  it("exports loadIntegrationConfig from package root", async () => {
    const mod = await import("../../src/index.js");
    expect(typeof mod.loadIntegrationConfig).toBe("function");
  });
});
