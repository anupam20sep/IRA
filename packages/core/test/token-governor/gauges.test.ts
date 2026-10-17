import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";
import { reportGauge, queryGauges } from "../../src/token-governor/gauges.js";

describe("gauges", () => {
  it("stores unavailable without fabricating zero ratio", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    await reportGauge(hive, { workerKey: "a:s", unavailable: true, reason: "engine_no_metric" });
    const [g] = await queryGauges(hive, { workerKey: "a:s" });
    expect(g.state).toBe("unavailable");
    expect((g as any).ratio).toBeUndefined();
  });
});
