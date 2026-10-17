import { describe, it, expect } from "vitest";
import { probeHermesAdapter } from "../../src/integrations/hermes.js";

describe("probeHermesAdapter", () => {
  it("reports unavailable when enabled but endpoint missing", async () => {
    const r = await probeHermesAdapter({ enabled: true, mcpEndpoint: undefined });
    expect(r.ok).toBe(false);
  });

  it("reports healthy when disabled (standalone degrade)", async () => {
    const r = await probeHermesAdapter({ enabled: false, mcpEndpoint: undefined });
    expect(r.ok).toBe(true);
  });

  it("reports configured when enabled with endpoint", async () => {
    const r = await probeHermesAdapter({
      enabled: true,
      mcpEndpoint: "https://hermes.example/mcp",
    });
    expect(r.ok).toBe(true);
    expect(r.detail).toBeDefined();
  });
});
