import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout, tokenRoot } from "../../src/token-governor/paths.js";
import { appendSpendEvent } from "../../src/token-governor/spend-ledger.js";

describe("spend-ledger", () => {
  it("appends one JSONL line per event", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    const { id } = await appendSpendEvent(hive, {
      agentId: "a1",
      sessionId: "s1",
      featureId: "004-ira-token-context",
      taskId: "T003",
      inputTokens: 10,
      outputTokens: 5,
      usdEstimate: 0.001,
      source: "estimate",
      partial: true,
    });
    const lines = (await readFile(join(tokenRoot(hive), "spend.jsonl"), "utf8")).trim().split("\n");
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).id).toBe(id);
  });
});
