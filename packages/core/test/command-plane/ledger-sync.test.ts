import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { saveState, type ForgeState } from "../../src/forge-loop.js";
import { HiveLedgerSchema } from "../../src/command-plane/schema.js";
import { withLock } from "../../src/command-plane/store.js";
import {
  mapForgeStatusToHive,
  syncHiveFromForge,
} from "../../src/command-plane/ledger-sync.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;

const PLAN = [
  "### Task T001: Alpha",
  "**Implements:** FR-003, FR-019",
  "**Depends on:** none",
  "**Kind:** code",
  "**Complexity:** complex",
  "",
  "### Task T002: Beta",
  "**Implements:** FR-003",
  "**Depends on:** T001",
  "**Kind:** code",
  "**Complexity:** mechanical",
  "",
].join("\n");

beforeEach(() => {
  delete process.env.SUPERSPEC_ROOT;
});

afterEach(async () => {
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRepo(): Promise<{
  root: string;
  specDir: string;
  planPath: string;
  hive: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "cp-ledger-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# p\n");
  const specDir = join(root, "specs", "001-demo");
  const planPath = join(specDir, "plan.md");
  await mkdir(specDir, { recursive: true });
  await writeFile(planPath, PLAN);
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  expect(init.ok).toBe(true);
  return {
    root,
    specDir,
    planPath,
    hive: join(root, ".superspec", "hive"),
  };
}

function forgeState(): ForgeState {
  return {
    tasks: {
      T001: { status: "in_progress", reviewFailures: 2 },
      T002: { status: "pending", reviewFailures: 0 },
    },
  };
}

async function readLedger(hive: string, featureId = "001-demo") {
  const raw = await readFile(join(hive, "ledger", `${featureId}.json`), "utf8");
  return HiveLedgerSchema.parse(JSON.parse(raw));
}

async function readEvents(hive: string): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
  const raw = await readFile(join(hive, "events", "events.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
}

describe("mapForgeStatusToHive", () => {
  it("maps in_progress to doing", () => {
    expect(mapForgeStatusToHive("in_progress")).toBe("doing");
  });

  it("maps the rest of the forge vocabulary", () => {
    expect(mapForgeStatusToHive("pending")).toBe("todo");
    expect(mapForgeStatusToHive("blocked")).toBe("blocked");
    expect(mapForgeStatusToHive("done")).toBe("done");
  });
});

describe("syncHiveFromForge", () => {
  it("copies implementsFr from the plan and mirrors forge status", async () => {
    const { root, specDir, planPath, hive } = await tempRepo();
    const state = forgeState();
    await saveState(specDir, state);
    const before = await readFile(join(specDir, ".superspec", "state.json"), "utf8");

    const result = await syncHiveFromForge({
      featureId: "001-demo",
      repositoryRoot: root,
      specDir,
      planPath,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ledger = await readLedger(hive);
    const alpha = ledger.tasks.find((task) => task.id === "T001");
    const beta = ledger.tasks.find((task) => task.id === "T002");
    expect(alpha).toMatchObject({
      featureId: "001-demo",
      status: "doing",
      reviewFailures: 2,
      implementsFr: ["FR-003", "FR-019"],
      dependsOn: [],
      kind: "code",
      complexity: "complex",
      drift: "added",
      hold: false,
      assigneeAgentId: null,
    });
    expect(beta).toMatchObject({
      status: "todo",
      reviewFailures: 0,
      implementsFr: ["FR-003"],
      dependsOn: ["T001"],
      drift: "added",
    });
    expect(ledger.maxReviewFailures).toBe(3);
    expect(alpha?.ceiling).toBe(3);
    expect(result.drift.map((row) => row.taskId).sort()).toEqual(["T001", "T002"]);
    expect(await readFile(join(specDir, ".superspec", "state.json"), "utf8")).toBe(before);
  });

  it("copies the feature review ceiling onto the ledger", async () => {
    const { root, specDir, planPath, hive } = await tempRepo();
    const settingsPath = join(hive, "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { featureCeilings: Record<string, number> };
    settings.featureCeilings["001-demo"] = 5;
    await writeFile(settingsPath, JSON.stringify(settings));
    await saveState(specDir, forgeState());

    const result = await syncHiveFromForge({
      featureId: "001-demo",
      repositoryRoot: root,
      specDir,
      planPath,
    });

    expect(result.ok).toBe(true);
    const ledger = await readLedger(hive);
    expect(ledger.maxReviewFailures).toBe(5);
    expect(ledger.tasks.every((task) => task.ceiling === 5)).toBe(true);
  });

  it("lets forge win on status and reviewFailures and keeps hive-only fields", async () => {
    const { root, specDir, planPath, hive } = await tempRepo();
    await saveState(specDir, forgeState());
    await syncHiveFromForge({
      featureId: "001-demo",
      repositoryRoot: root,
      specDir,
      planPath,
    });

    const ledger = await readLedger(hive);
    const alpha = ledger.tasks.find((task) => task.id === "T001");
    if (!alpha) throw new Error("missing T001");
    alpha.status = "done";
    alpha.reviewFailures = 9;
    alpha.hold = true;
    alpha.assigneeAgentId = "agent-host";
    alpha.capabilityTags = ["review"];
    alpha.abortReason = "keep";
    await writeFile(join(hive, "ledger", "001-demo.json"), JSON.stringify(ledger));

    const result = await syncHiveFromForge({
      featureId: "001-demo",
      repositoryRoot: root,
      specDir,
      planPath,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const next = await readLedger(hive);
    expect(next.tasks.find((task) => task.id === "T001")).toMatchObject({
      status: "doing",
      reviewFailures: 2,
      hold: true,
      assigneeAgentId: "agent-host",
      capabilityTags: ["review"],
      abortReason: "keep",
      implementsFr: ["FR-003", "FR-019"],
      drift: "ok",
    });
    const events = await readEvents(hive);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "hive.reconciled",
          data: { taskId: "T001", field: "status", forgeValue: "in_progress", hiveValue: "done" },
        }),
        expect.objectContaining({
          type: "hive.reconciled",
          data: { taskId: "T001", field: "reviewFailures", forgeValue: 2, hiveValue: 9 },
        }),
      ]),
    );
  });

  it("detects plan drift and opens Ask-Me only for removed open tasks", async () => {
    const { root, specDir, planPath, hive } = await tempRepo();
    await saveState(specDir, {
      tasks: {
        T001: { status: "done", reviewFailures: 0 },
        T002: { status: "pending", reviewFailures: 0 },
        T003: { status: "done", reviewFailures: 1 },
        T004: { status: "done", reviewFailures: 0 },
      },
    });
    await writeFile(
      planPath,
      [
        PLAN,
        "### Task T003: Gamma",
        "**Implements:** FR-019",
        "**Kind:** verify",
        "**Complexity:** moderate",
        "",
        "### Task T004: Done row",
        "**Implements:** FR-003",
        "**Kind:** code",
        "**Complexity:** mechanical",
        "",
      ].join("\n"),
    );
    await syncHiveFromForge({
      featureId: "001-demo",
      repositoryRoot: root,
      specDir,
      planPath,
    });

    const other = join(hive, "ledger", "002-other.json");
    await writeFile(other, '{"featureId":"002-other"}\n');

    await writeFile(
      planPath,
      [
        "### Task T001: Alpha renamed",
        "**Implements:** FR-019",
        "**Kind:** code",
        "**Complexity:** complex",
        "",
        "### Task T003: Gamma",
        "**Implements:** FR-019",
        "**Kind:** verify",
        "**Complexity:** moderate",
        "",
      ].join("\n"),
    );

    const result = await syncHiveFromForge({
      featureId: "001-demo",
      repositoryRoot: root,
      specDir,
      planPath,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ledger = await readLedger(hive);
    expect(ledger.tasks.find((task) => task.id === "T001")).toMatchObject({
      title: "Alpha renamed",
      implementsFr: ["FR-019"],
      drift: "changed",
      status: "done",
    });
    expect(ledger.tasks.find((task) => task.id === "T002")).toMatchObject({
      drift: "removed",
      status: "todo",
      title: "Beta",
    });
    expect(ledger.tasks.find((task) => task.id === "T003")).toMatchObject({
      drift: "ok",
      status: "done",
      kind: "verify",
    });
    expect(ledger.tasks.find((task) => task.id === "T004")).toMatchObject({
      drift: "removed",
      status: "done",
      title: "Done row",
    });
    expect(result.drift).toEqual(
      expect.arrayContaining([
        { taskId: "T001", drift: "changed" },
        { taskId: "T002", drift: "removed" },
        { taskId: "T004", drift: "removed" },
      ]),
    );

    const askFiles = (await readdir(join(hive, "ask-me"))).filter((name) => name.endsWith(".json"));
    expect(askFiles).toHaveLength(1);
    const item = JSON.parse(await readFile(join(hive, "ask-me", askFiles[0]), "utf8")) as {
      reasonClass: string;
      taskId: string;
      state: string;
      featureId: string;
    };
    expect(item).toMatchObject({
      reasonClass: "ambiguous_requirement",
      taskId: "T002",
      state: "open",
      featureId: "001-demo",
    });

    await syncHiveFromForge({
      featureId: "001-demo",
      repositoryRoot: root,
      specDir,
      planPath,
    });
    const askAgain = (await readdir(join(hive, "ask-me"))).filter((name) => name.endsWith(".json"));
    expect(askAgain).toEqual(askFiles);
    expect(await readFile(other, "utf8")).toBe('{"featureId":"002-other"}\n');
  });

  it("appends hive.sync_failed and does not roll back forge state", async () => {
    const { root, specDir, hive } = await tempRepo();
    await saveState(specDir, forgeState());
    const statePath = join(specDir, ".superspec", "state.json");
    const before = await readFile(statePath, "utf8");

    const result = await syncHiveFromForge({
      featureId: "001-demo",
      repositoryRoot: root,
      specDir,
      planPath: join(specDir, "missing-plan.md"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.syncFailedRecorded).toBe(true);
    expect(await readFile(statePath, "utf8")).toBe(before);
    const events = await readEvents(hive);
    expect(events.some((event) => event.type === "hive.sync_failed" && typeof event.data.message === "string")).toBe(
      true,
    );
    await expect(readFile(join(hive, "ledger", "001-demo.json"), "utf8")).rejects.toThrow();
  });

  it("skips the failure event when the log is not writable and still leaves forge state", async () => {
    const { root, specDir, hive } = await tempRepo();
    await saveState(specDir, forgeState());
    const statePath = join(specDir, ".superspec", "state.json");
    const before = await readFile(statePath, "utf8");
    const logPath = join(hive, "events", "events.jsonl");
    await chmod(logPath, 0o444);
    try {
      const result = await syncHiveFromForge({
        featureId: "001-demo",
        repositoryRoot: root,
        specDir,
        planPath: join(specDir, "missing-plan.md"),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.syncFailedRecorded).toBe(false);
      expect(await readFile(statePath, "utf8")).toBe(before);
      expect(await readFile(logPath, "utf8")).toBe("");
    } finally {
      await chmod(logPath, 0o600);
    }
  });

  it("does not write the ledger when the ledger lock is held", async () => {
    const { root, specDir, planPath, hive } = await tempRepo();
    await saveState(specDir, forgeState());
    const statePath = join(specDir, ".superspec", "state.json");
    const before = await readFile(statePath, "utf8");
    const held = await withLock(join(hive, "locks", "ledger-001-demo.lock"), { waitMs: 3000 }, async () => {
      return syncHiveFromForge({
        featureId: "001-demo",
        repositoryRoot: root,
        specDir,
        planPath,
      });
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.value.ok).toBe(false);
    if (held.value.ok) return;
    expect(held.value.error).toBe("LEDGER_BUSY");
    expect(held.value.syncFailedRecorded).toBe(true);
    expect(await readFile(statePath, "utf8")).toBe(before);
    await expect(readFile(join(hive, "ledger", "001-demo.json"), "utf8")).rejects.toThrow();
  }, 10000);
});
