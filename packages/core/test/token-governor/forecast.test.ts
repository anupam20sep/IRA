import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";
import { forecastCost } from "../../src/token-governor/forecast.js";

describe("forecast", () => {
  it("returns insufficient-history when fewer than two peer tasks", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    const f = await forecastCost(hive, { featureId: "004-ira-token-context", taskKind: "code" });
    expect(f.status).toBe("insufficient-history");
  });
});
