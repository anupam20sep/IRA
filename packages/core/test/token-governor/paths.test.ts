import { describe, it, expect } from "vitest";
import { mkdtemp, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout, tokenRoot } from "../../src/token-governor/paths.js";

describe("token paths", () => {
  it("creates hive/token layout with settings.json", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    const r = await ensureTokenLayout(hive);
    expect(r.ok).toBe(true);
    await access(join(tokenRoot(hive), "settings.json"));
  });
});
