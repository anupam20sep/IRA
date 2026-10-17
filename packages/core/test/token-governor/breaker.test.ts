import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";
import { evaluateBreaker, resetBreaker } from "../../src/token-governor/breaker.js";
import { mailboxRead } from "../../src/command-plane/mailbox.js";

async function hive(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hive-"));
  await ensureTokenLayout(root);
  return root;
}

describe("breaker", () => {
  it("walks clear to steer to constrain to stop on repeated loop trigger", async () => {
    const hiveRoot = await hive();
    const wk = "a1:s1";
    let s = await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    expect(s.stage).toBe("steer");
    expect(s.haltReason).toBeNull();
    s = await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    expect(s.stage).toBe("constrain");
    s = await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    expect(s.stage).toBe("stop");
  });

  it("steps the model tier down on constrain and leaves economy in place", async () => {
    const frontier = await hive();
    await evaluateBreaker(frontier, "a1:s1", { trigger: "loop", toolHash: "read_file", currentTier: "frontier" });
    const constrained = await evaluateBreaker(frontier, "a1:s1", {
      trigger: "loop",
      toolHash: "read_file",
      currentTier: "frontier",
    });
    expect(constrained.stage).toBe("constrain");
    expect(constrained.effectiveTier).toBe("standard");
    expect(constrained.constrainContextGrowth).toBe(true);
    expect(constrained.haltReason).toBeNull();

    const standard = await hive();
    await evaluateBreaker(standard, "a1:s1", { trigger: "errors", currentTier: "standard" });
    const stepped = await evaluateBreaker(standard, "a1:s1", { trigger: "errors", currentTier: "standard" });
    expect(stepped.effectiveTier).toBe("economy");

    const economy = await hive();
    await evaluateBreaker(economy, "a1:s1", { trigger: "budget", currentTier: "economy" });
    const held = await evaluateBreaker(economy, "a1:s1", { trigger: "budget", currentTier: "economy" });
    expect(held.effectiveTier).toBe("economy");
  });

  it("persists a halt reason on stop and does not resume", async () => {
    const hiveRoot = await hive();
    const wk = "a1:s1";
    await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    const stopped = await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    expect(stopped.stage).toBe("stop");
    expect(stopped.haltReason).toContain("loop");
    expect(stopped.haltReason).toContain("read_file");
    expect(stopped.effectiveTier).toBe("standard");
    expect(stopped.constrainContextGrowth).toBe(true);

    const again = await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    expect(again.stage).toBe("stop");
    expect(again.haltReason).toBe(stopped.haltReason);

    const raw = JSON.parse(await readFile(join(hiveRoot, "token", "breakers.json"), "utf8")) as {
      items: Record<string, { stage: string; haltReason: string | null }>;
    };
    expect(raw.items[wk]?.stage).toBe("stop");
    expect(raw.items[wk]?.haltReason).toBe(stopped.haltReason);
  });

  it("returns the prior stage during Slice A without persisting the next window", async () => {
    const hiveRoot = await hive();
    const wk = "a1:s1";
    const steered = await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    expect(steered.stage).toBe("steer");

    const held = await evaluateBreaker(hiveRoot, wk, {
      trigger: "loop",
      toolHash: "read_file",
      sliceAActive: true,
    });
    expect(held.stage).toBe("steer");

    const raw = JSON.parse(await readFile(join(hiveRoot, "token", "breakers.json"), "utf8")) as {
      items: Record<string, { stage: string }>;
    };
    expect(raw.items[wk]?.stage).toBe("steer");
  });

  it("stays clear when a loop count is below the settings threshold", async () => {
    const hiveRoot = await hive();
    const s = await evaluateBreaker(hiveRoot, "a1:s1", { trigger: "loop", toolHash: "read_file", count: 1 });
    expect(s.stage).toBe("clear");
    expect(s.windowsFired).toBe(0);
  });

  it("restarts at steer when the trigger class changes", async () => {
    const hiveRoot = await hive();
    const wk = "a1:s1";
    await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    const next = await evaluateBreaker(hiveRoot, wk, { trigger: "errors" });
    expect(next.stage).toBe("steer");
    expect(next.trigger).toBe("errors");
    expect(next.windowsFired).toBe(1);
  });

  it("resetBreaker removes the worker from breakers.json", async () => {
    const hiveRoot = await hive();
    const wk = "a1:s1";
    await evaluateBreaker(hiveRoot, wk, { trigger: "budget" });
    await resetBreaker(hiveRoot, wk);
    const raw = JSON.parse(await readFile(join(hiveRoot, "token", "breakers.json"), "utf8")) as {
      items: Record<string, unknown>;
    };
    expect(raw.items[wk]).toBeUndefined();
  });

  it("posts a steer mailbox hint when the hive is available", async () => {
    const hiveRoot = await hive();
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
    await evaluateBreaker(hiveRoot, "a1:s1", { trigger: "loop", toolHash: "read_file" });
    const mail = await mailboxRead({ hiveRoot, role: "ira", agentId: "a1", box: "inbox" });
    expect(mail.ok).toBe(true);
    if (mail.ok) {
      expect(mail.messages).toHaveLength(1);
      expect(mail.messages[0]?.kind).toBe("handoff");
      expect(mail.messages[0]?.body.toLowerCase()).toContain("wrap");
    }
  });

  it("blocks the roster agent when stop fires", async () => {
    const hiveRoot = await hive();
    await writeFile(
      join(hiveRoot, "roster.json"),
      JSON.stringify([
        {
          id: "a1",
          name: "A",
          personaPath: null,
          capabilityTags: [],
          engine: null,
          model: null,
          workspace: null,
          worktreePolicy: "shared",
          status: "busy",
          origin: "manual",
        },
      ]),
    );
    const wk = "a1:s1";
    await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    await evaluateBreaker(hiveRoot, wk, { trigger: "loop", toolHash: "read_file" });
    const roster = JSON.parse(await readFile(join(hiveRoot, "roster.json"), "utf8")) as { status: string }[];
    expect(roster[0]?.status).toBe("blocked");
  });

  it("appends a breaker event when the events log is writable", async () => {
    const hiveRoot = await hive();
    await mkdir(join(hiveRoot, "events"), { recursive: true });
    await mkdir(join(hiveRoot, "locks"), { recursive: true });
    await evaluateBreaker(hiveRoot, "a1:s1", { trigger: "loop", toolHash: "read_file" });
    const log = await readFile(join(hiveRoot, "events", "events.jsonl"), "utf8");
    expect(log).toContain("token.breaker_steer");
  });
});
