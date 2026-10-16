import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  blackboardUpdate,
  evaluateCiGate,
  hiveCiSet,
} from "../../src/command-plane/blackboard.js";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { SCRIBE_BUSY, withLock } from "../../src/command-plane/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempHive(): Promise<{ root: string; hive: string }> {
  const root = await mkdtemp(join(tmpdir(), "cp-blackboard-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# p\n");
  const init = await hiveInit({ cwd: root });
  expect(init.ok).toBe(true);
  if (!init.ok) throw new Error("hive init failed");
  return { root, hive: init.hiveRoot };
}

async function waitForLock(lockPath: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await stat(lockPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`lock did not appear: ${lockPath}`);
}

describe("evaluateCiGate (OD-013)", () => {
  it("blocks absent when allowAbsentCi false", () => {
    expect(evaluateCiGate({ ci: null, allowAbsentCi: false })).toEqual({
      pass: false,
      reason: "ci_absent",
    });
    expect(evaluateCiGate({ ci: "absent", allowAbsentCi: false })).toEqual({
      pass: false,
      reason: "ci_absent",
    });
  });

  it("passes absent when allowAbsentCi true", () => {
    expect(evaluateCiGate({ ci: "absent", allowAbsentCi: true })).toEqual({
      pass: true,
      reason: null,
    });
    expect(evaluateCiGate({ ci: null, allowAbsentCi: true })).toEqual({
      pass: true,
      reason: null,
    });
  });

  it("passes green and blocks red regardless of allowAbsentCi", () => {
    expect(evaluateCiGate({ ci: "green", allowAbsentCi: false })).toEqual({
      pass: true,
      reason: null,
    });
    expect(evaluateCiGate({ ci: "red", allowAbsentCi: false })).toEqual({
      pass: false,
      reason: "ci_not_green",
    });
    expect(evaluateCiGate({ ci: "red", allowAbsentCi: true })).toEqual({
      pass: false,
      reason: "ci_not_green",
    });
  });
});

describe("blackboardUpdate", () => {
  it("writes under the scribe lock with 0 ms wait", async () => {
    const { hive } = await tempHive();
    const lockPath = join(hive, "locks", "blackboard.lock");

    const result = await blackboardUpdate(hive, (doc) => {
      doc.features["001-demo"] = {
        planPath: "specs/001-demo/plan.md",
        specDir: "specs/001-demo",
        ci: null,
      };
      return "updated";
    });

    expect(result).toEqual({ ok: true, value: "updated" });
    const raw = JSON.parse(await readFile(join(hive, "blackboard.json"), "utf8")) as {
      features: Record<string, { planPath: string }>;
    };
    expect(raw.features["001-demo"]?.planPath).toBe("specs/001-demo/plan.md");
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns SCRIBE_BUSY immediately when another scribe holds the lock", async () => {
    const { hive } = await tempHive();
    const lockPath = join(hive, "locks", "blackboard.lock");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withLock(lockPath, { waitMs: 0 }, async () => {
      await gate;
      return "first";
    });
    await waitForLock(lockPath);

    const started = Date.now();
    const second = await blackboardUpdate(hive, (doc) => {
      doc.features["001-demo"] = { ci: null };
      return doc;
    });
    expect(Date.now() - started).toBeLessThan(200);
    expect(second).toEqual({ ok: false, code: SCRIBE_BUSY });

    release();
    await first;
  });
});

describe("hiveCiSet", () => {
  it("stores CI state on the feature blackboard entry", async () => {
    const { hive } = await tempHive();

    const result = await hiveCiSet({
      hiveRoot: hive,
      featureId: "001-ira-command-plane",
      state: "green",
      source: "test-stub",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ci).toEqual({
      state: "green",
      source: "test-stub",
      at: result.ci.at,
    });
    expect(typeof result.ci.at).toBe("string");

    const raw = JSON.parse(await readFile(join(hive, "blackboard.json"), "utf8")) as {
      features: Record<string, { ci: { state: string; source: string } }>;
    };
    expect(raw.features["001-ira-command-plane"]?.ci).toEqual(result.ci);
  });
});
