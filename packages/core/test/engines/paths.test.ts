import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureEnginesLayout, enginesRoot } from "../../src/engines/paths.js";

describe("engines paths", () => {
  it("writes default policy.json with three-rung ladder", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    const r = await ensureEnginesLayout(hive);
    expect(r.ok).toBe(true);
    const raw = await readFile(join(enginesRoot(hive), "policy.json"), "utf8");
    expect(raw).toContain('"subscription"');
    expect(raw).toContain('"local"');
  });
});
