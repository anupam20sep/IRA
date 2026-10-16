import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { briefSubmit } from "../../src/command-plane/brief.js";
import { HOOK_FAILED_CLOSED, registerCommandPlaneHooks } from "../../src/command-plane/hooks.js";
import { HiveLedgerSchema } from "../../src/command-plane/schema.js";
import { runCli } from "../../src/cli.js";
import { loadState } from "../../src/forge-loop.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;
const FEATURE = "001-demo";

const PLAN = [
  "### Task T001: Alpha",
  "**Implements:** FR-003",
  "**Depends on:** none",
  "**Kind:** code",
  "**Complexity:** mechanical",
  "",
].join("\n");

beforeEach(() => {
  delete process.env.SUPERSPEC_ROOT;
});

afterEach(async () => {
  registerCommandPlaneHooks({ token: {}, engine: {}, learning: {}, hire: {} });
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(
    roots.splice(0).map(async (dir) => {
      await chmod(join(dir, ".superspec", "hive"), 0o700).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("forge-hive integration", () => {
  it("covers dispatch, direct begin-task, hold, and away CI on one hive", async () => {
    const root = await mkdtemp(join(tmpdir(), "cp-forge-hive-"));
    roots.push(root);
    const specDir = join(root, "specs", FEATURE);
    const planPath = join(specDir, "plan.md");
    const hive = join(root, ".superspec", "hive");
    await writeFile(join(root, "program.md"), "# p\n");
    await mkdir(specDir, { recursive: true });
    await writeFile(planPath, PLAN);
    process.env.SUPERSPEC_ROOT = root;

    const init = await cli(["hive", "init", "--cwd", root]);
    expect(init.code).toBe(0);
    expect(init.body).toMatchObject({
      ok: true,
      created: true,
      hiveRoot: hive,
      persona: { callsign: "Ira" },
    });
    const settingsPath = join(hive, "settings.json");
    const initialSettings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(initialSettings.allowAbsentCi).toBeUndefined();

    const brief = await briefSubmit({
      cwd: root,
      featureId: FEATURE,
      outcome: "Keep the forge ledger in step with dispatch",
      deliverable: `specs/${FEATURE}`,
    });
    expect(brief.ok).toBe(true);
    if (!brief.ok) return;
    expect(brief.assignment).toEqual({ taskId: "T001", agentId: "agent-host" });
    expect(brief.tasks[0]).toMatchObject({
      id: "T001",
      implementsFr: ["FR-003"],
      status: "todo",
      reviewFailures: 0,
      hold: false,
    });

    const direct = await cli(["begin-task", "--plan", planPath, "--dir", specDir, "--task", "T001"]);
    expect(direct.code).toBe(1);
    expect(direct.body).toMatchObject({ ok: false, error: "DISPATCH_PATH_REQUIRED" });
    expect(await loadState(specDir)).toBeNull();
    expect((await readLedger(hive)).tasks[0]).toMatchObject({
      id: "T001",
      status: "todo",
      reviewFailures: 0,
    });

    await chmod(hive, 0o500);
    try {
      const blockedBeat = await cli(["away", "tick", "--cwd", root, "--feature", FEATURE]);
      expect(blockedBeat.code).toBe(0);
      expect(blockedBeat.body).toMatchObject({
        ok: true,
        ticks: [{ featureId: null, dispatched: false, reason: "heartbeat_failed", intent: null }],
      });
    } finally {
      await chmod(hive, 0o700);
    }
    expect(await loadState(specDir)).toBeNull();
    await expect(queueExists(hive)).resolves.toBe(false);

    await patchSettings(hive, { awayMode: true, autonomy: "autonomous" });
    expect(JSON.parse(await readFile(settingsPath, "utf8")).allowAbsentCi).toBeUndefined();

    const missingCi = await cli(["away", "tick", "--cwd", root, "--feature", FEATURE]);
    expect(missingCi.code).toBe(0);
    expect(missingCi.body).toMatchObject({
      ok: true,
      ticks: [{ featureId: FEATURE, dispatched: false, reason: "ci_absent", intent: null }],
    });

    const absent = await cli([
      "hive",
      "ci-set",
      "--cwd",
      root,
      "--feature",
      FEATURE,
      "--state",
      "absent",
      "--source",
      "test",
    ]);
    expect(absent.code).toBe(0);
    expect(absent.body).toMatchObject({ ok: true, ci: { state: "absent" } });
    await patchSettings(hive, { allowAbsentCi: false });
    const explicitAbsent = await cli(["away", "tick", "--cwd", root, "--feature", FEATURE]);
    expect(explicitAbsent.code).toBe(0);
    expect(explicitAbsent.body).toMatchObject({
      ok: true,
      ticks: [{ featureId: FEATURE, dispatched: false, reason: "ci_absent", intent: null }],
    });
    expect(await loadState(specDir)).toBeNull();
    await expect(queueExists(hive)).resolves.toBe(false);

    await patchSettings(hive, { awayMode: false });
    const green = await cli([
      "hive",
      "ci-set",
      "--cwd",
      root,
      "--feature",
      FEATURE,
      "--state",
      "green",
      "--source",
      "test",
    ]);
    expect(green.code).toBe(0);
    expect(green.body).toMatchObject({ ok: true, ci: { state: "green" } });

    const order: string[] = [];
    const gate: { mode: "deny" | "reject" | "allow" } = { mode: "deny" };
    registerCommandPlaneHooks({
      token: {
        beforeDispatch: async () => {
          order.push("beforeDispatch");
          if (gate.mode === "deny") {
            // Fail-closed is outside DispatchGate and must not open Ask-Me.
            return { allow: false, reason: HOOK_FAILED_CLOSED } as never;
          }
          return { allow: true };
        },
      },
      engine: {
        dispatch: async () => {
          order.push("engine.dispatch");
          if (gate.mode === "reject") return { accepted: false };
          return null;
        },
      },
    });

    const denied = await cli(["dispatch-task", "--cwd", root, "--feature", FEATURE, "--task", "T001"]);
    expect(denied.code).toBe(1);
    expect(denied.body).toMatchObject({ ok: false, error: "HOOK_FAILED_CLOSED" });
    expect(order).toEqual(["beforeDispatch"]);
    expect(await loadState(specDir)).toBeNull();

    gate.mode = "reject";
    const rejected = await cli(["dispatch-task", "--cwd", root, "--feature", FEATURE, "--task", "T001"]);
    expect(rejected.code).toBe(1);
    expect(rejected.body).toMatchObject({ ok: false, error: "ENGINE_REJECTED", accepted: false });
    expect(order).toEqual(["beforeDispatch", "beforeDispatch", "engine.dispatch"]);
    expect(await loadState(specDir)).toBeNull();
    await expect(queueExists(hive)).resolves.toBe(false);

    gate.mode = "allow";
    const dispatched = await cli(["dispatch-task", "--cwd", root, "--feature", FEATURE, "--task", "T001"]);
    expect(dispatched.code).toBe(0);
    expect(dispatched.body).toMatchObject({
      ok: true,
      accepted: null,
      began: true,
      hiveStatus: "doing",
      intent: { featureId: FEATURE, taskId: "T001", freshSubagent: true },
    });
    expect(order).toEqual([
      "beforeDispatch",
      "beforeDispatch",
      "engine.dispatch",
      "beforeDispatch",
      "engine.dispatch",
    ]);
    expect(await loadState(specDir)).toMatchObject({
      tasks: { T001: { status: "in_progress", reviewFailures: 0 } },
    });
    expect((await readLedger(hive)).tasks[0]).toMatchObject({
      id: "T001",
      status: "doing",
      reviewFailures: 0,
      hold: false,
    });
    await expect(queueExists(hive)).resolves.toBe(true);

    const forgeBeforeHold = await readFile(join(specDir, ".superspec", "state.json"), "utf8");
    const held = await cli([
      "task",
      "hold",
      "--cwd",
      root,
      "--feature",
      FEATURE,
      "--task",
      "T001",
      "--hold",
      "true",
    ]);
    expect(held.code).toBe(0);
    expect(held.body).toMatchObject({
      ok: true,
      task: { id: "T001", hold: true, reviewFailures: 0, status: "doing" },
    });
    expect(await readFile(join(specDir, ".superspec", "state.json"), "utf8")).toBe(forgeBeforeHold);
    expect((await loadState(specDir))?.tasks.T001).toEqual({ status: "in_progress", reviewFailures: 0 });
    expect((await readLedger(hive)).tasks[0]).toMatchObject({
      status: "doing",
      hold: true,
      reviewFailures: 0,
    });

    const pidPath = join(hive, "away.pid");
    const stalePid = "2147483646\n";
    await writeFile(pidPath, stalePid, { mode: 0o600 });
    const doctor = await cli(["doctor", "--cwd", root]);
    expect(doctor.code).toBe(0);
    expect(doctor.body).toMatchObject({ ok: true, hiveReady: false });
    const findings = doctor.body.findings as Array<{ code: string; severity: string }>;
    expect(findings).toContainEqual(expect.objectContaining({ code: "AWAY_PID_STALE", severity: "error" }));
    expect(await readFile(pidPath, "utf8")).toBe(stalePid);
  });
});

async function cli(args: string[]): Promise<{ code: number; stdout: string; body: Record<string, unknown> }> {
  const result = await runCli(args);
  return { ...result, body: JSON.parse(result.stdout) as Record<string, unknown> };
}

async function readLedger(hive: string) {
  const raw = await readFile(join(hive, "ledger", `${FEATURE}.json`), "utf8");
  return HiveLedgerSchema.parse(JSON.parse(raw));
}

async function patchSettings(hive: string, patch: Record<string, unknown>): Promise<void> {
  const path = join(hive, "settings.json");
  const settings = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  Object.assign(settings, patch);
  await writeFile(path, `${JSON.stringify(settings)}\n`);
}

async function queueExists(hive: string): Promise<boolean> {
  try {
    await access(join(hive, "dispatch-queue", FEATURE, "T001.json"));
    return true;
  } catch {
    return false;
  }
}
