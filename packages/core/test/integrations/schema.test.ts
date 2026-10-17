import { describe, it, expect } from "vitest";
import { parseIntegrationConfig } from "../../src/integrations/schema.js";

describe("IntegrationConfig", () => {
  it("defaults all adapters disabled when empty object", () => {
    const c = parseIntegrationConfig({});
    expect(c.adapters.openclaw.enabled).toBe(false);
    expect(c.adapters.hermes.enabled).toBe(false);
  });
});
