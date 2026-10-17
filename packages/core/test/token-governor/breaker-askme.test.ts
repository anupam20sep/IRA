import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AskMeReasonClassSchema } from "../../src/command-plane/schema.js";
import { listAskMe } from "../../src/command-plane/ask-me.js";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";
import { evaluateBreaker } from "../../src/token-governor/breaker.js";

async function hiveWithManifest(): Promise<string> {
  const hiveRoot = await mkdtemp(join(tmpdir(), "breaker-askme-"));
  await ensureTokenLayout(hiveRoot);
  const now = new Date().toISOString();
  await writeFile(
    join(hiveRoot, "hive.json"),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: hiveRoot,
      createdAt: now,
      persona: { callsign: "Ira", expansion: "Intelligent Resource Automation" },
    }),
  );
  return hiveRoot;
}

describe("Ask-Me reason classes", () => {
  it("includes circuit_breaker_stop", () => {
    expect(AskMeReasonClassSchema.parse("circuit_breaker_stop")).toBe("circuit_breaker_stop");
  });
});

describe("breaker stop → Ask-Me (FR-008)", () => {
  it("opens a listable Ask-Me item with reasonClass circuit_breaker_stop", async () => {
    const hiveRoot = await hiveWithManifest();
    const wk = "a1:s1";
    await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    const stopped = await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    expect(stopped.stage).toBe("stop");

    const listed = await listAskMe({ hiveRoot, state: "open" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    const breakerItems = listed.items.filter((item) => item.reasonClass === "circuit_breaker_stop");
    expect(breakerItems.length).toBeGreaterThanOrEqual(1);
    expect(breakerItems[0]?.agentId).toBe("a1");
    expect(breakerItems[0]?.state).toBe("open");
  });
});
