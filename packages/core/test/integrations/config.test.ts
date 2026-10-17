import { describe, it, expect } from "vitest";
import { loadIntegrationConfig } from "../../src/integrations/config.js";

describe("loadIntegrationConfig", () => {
  it("returns defaults when file missing", async () => {
    const c = await loadIntegrationConfig("/tmp/no-hive-integrations");
    expect(c.adapters.boardShare.enabled).toBe(false);
  });
});
