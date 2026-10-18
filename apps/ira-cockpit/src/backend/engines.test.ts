import { describe, expect, it } from "vitest";
import { detectEngines } from "./engines.js";

describe("detectEngines", () => {
  it("returns catalog rows with host-spawn flags", async () => {
    const pack = await detectEngines();
    expect(pack.engines.map((e) => e.id)).toEqual([
      "claude",
      "cursor-agent",
      "codex",
      "opencode",
    ]);
    expect(pack.engines.find((e) => e.id === "claude")?.hostSpawnOnly).toBe(true);
    expect(pack.engines.find((e) => e.id === "opencode")?.hostSpawnOnly).toBe(false);
    expect(pack.note).toMatch(/never Ira-parented/i);
    for (const e of pack.engines) {
      expect(typeof e.installed).toBe("boolean");
    }
  });
});
