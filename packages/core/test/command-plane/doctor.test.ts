import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeHiveReady,
  computeSliceAValidated,
  resolveReportedSandbox,
  runDoctor,
} from "../../src/command-plane/doctor.js";
import { hiveInit } from "../../src/command-plane/hive-init.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;
const TOOLS = ["hive-init", "dispatch-task", "doctor"] as const;
const HOST_ARGV0 = new Set(["claude", "codex", "cursor-agent", "agent"]);

const child = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  exec: vi.fn(),
  fork: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, ...child };
});

beforeEach(() => {
  delete process.env.SUPERSPEC_ROOT;
  child.spawn.mockClear();
  child.execFile.mockClear();
  child.exec.mockClear();
  child.fork.mockClear();
});

afterEach(async () => {
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("computeHiveReady", () => {
  it("stays true when only engine finding present", () => {
    expect(computeHiveReady({ hiveFindings: [], engineFindings: [{ code: "ENGINE_NONE_HEALTHY" }] })).toBe(true);
  });

  it("false when AWAY_PID_STALE present", () => {
    expect(computeHiveReady({ hiveFindings: [{ code: "AWAY_PID_STALE" }], engineFindings: [] })).toBe(false);
  });

  it("ignores engine findings and constitution drift", () => {
    expect(
      computeHiveReady({
        hiveFindings: [{ code: "ENGINE_NONE_HEALTHY" }, { code: "CONSTITUTION_DRIFT" }, { code: "WORKTREE_IS_NOT_SANDBOX" }],
        engineFindings: [{ code: "ENGINE_SPAWN_UNSUPPORTED" }],
      }),
    ).toBe(true);
  });

  it("is false for each coordination-store blocker", () => {
    for (const code of [
      "LEDGER_UNREADABLE",
      "PROGRAM_MD_MISSING",
      "HIVE_NOT_WRITABLE",
      "HIVE_NOT_GITIGNORED",
      "HIVE_SCHEMA_MISMATCH",
      "MCP_TOOL_MISSING",
      "AWAY_PID_STALE",
      "TOKEN_FILE_MODE",
      "LOCK_MODULE_MISSING",
    ]) {
      expect(computeHiveReady({ hiveFindings: [{ code }], engineFindings: [] })).toBe(false);
    }
  });
});

describe("computeSliceAValidated", () => {
  const pass = {
    hiveReady: true,
    hostDispatchQueuesIntent: true,
    boardDispatchInvokesDispatchTask: true,
    askMeRoundTrip: true,
  };

  it("is true only when all four checks pass", () => {
    expect(computeSliceAValidated(pass)).toBe(true);
    for (const key of Object.keys(pass) as (keyof typeof pass)[]) {
      expect(computeSliceAValidated({ ...pass, [key]: false })).toBe(false);
    }
  });
});

describe("resolveReportedSandbox", () => {
  it("corrects a worktree-derived sandbox flag to false", () => {
    const reported = resolveReportedSandbox({
      proposedSandboxed: true,
      proposedFrom: "worktreeKind",
      sliceA: true,
    });
    expect(reported.sandboxed).toBe(false);
    expect(reported.finding?.code).toBe("WORKTREE_IS_NOT_SANDBOX");
    expect(reported.finding?.severity).toBe("error");
  });

  it("reports sandboxed false in Slice A", () => {
    expect(
      resolveReportedSandbox({ proposedSandboxed: true, proposedFrom: "os-wrapper", sliceA: true }).sandboxed,
    ).toBe(false);
  });
});

describe("runDoctor", () => {
  it("sets sliceAValidated only from the four checks on a healthy hive", async () => {
    const { root, hive } = await repo("main");
    const claim = join(hive, "slice-a.json");
    await writeFile(claim, `${JSON.stringify({ validated: false, sliceAValidated: false })}\n`);

    const report = await runDoctor({ cwd: root, mcpToolNames: TOOLS });

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual({
      hiveReady: true,
      hostDispatchQueuesIntent: true,
      boardDispatchInvokesDispatchTask: true,
      askMeRoundTrip: true,
    });
    expect(report.sliceAValidated).toBe(true);
    expect(report.hiveReady).toBe(true);
    expect(report.engineRungReady).toBe(true);
    expect(report.ready).toBe(report.hiveReady);
    expect(report.worktreeKind).toBe("main");
    expect(report.sandboxed).toBe(false);
    expect(report.repositoryRoot).toBe(root);
    expect(report.hiveRoot).toBe(hive);
    expect(report.hivePresent).toBe(true);
    expect(report.writable).toBe(true);
    expect(report.gitignore).toBe(true);
    expect(report.telemetry).toBe("off");
    expect(report.persona).toEqual({
      callsign: "Ira",
      expansion: "Intelligent Resource Automation",
    });
    expect(report.mcpTools).toEqual([...TOOLS]);
    expect(report.nextSteps.some((step) => step.includes(hive))).toBe(true);
    expect(report.nextSteps.some((step) => step.includes("supervised"))).toBe(true);
    expect(report.nextSteps.some((step) => step.toLowerCase().includes("superspec"))).toBe(true);
    expect(hostSpawnCalls()).toEqual([]);
    expect(await readdir(join(hive, "ask-me"))).toEqual([]);
    expect(await readdir(join(hive, "dispatch-queue"))).toEqual([]);
    expect(JSON.parse(await readFile(claim, "utf8"))).toEqual({ validated: false, sliceAValidated: false });

    const drift = report.findings.filter(
      (finding) => finding.code === "CONSTITUTION_DRIFT" || finding.code === "TEMPLATE_DRIFT",
    );
    expect(drift.length).toBeGreaterThan(0);
    expect(drift.every((finding) => finding.severity === "warning")).toBe(true);
  });

  it("keeps hiveReady when an engine finding is present", async () => {
    const { root } = await repo("main");
    const report = await runDoctor({
      cwd: root,
      mcpToolNames: TOOLS,
      engineFindings: [
        {
          code: "ENGINE_NONE_HEALTHY",
          severity: "error",
          message: "No engine rung is healthy.",
          remedy: "Install or log in to an engine.",
        },
      ],
    });
    expect(report.hiveReady).toBe(true);
    expect(report.engineRungReady).toBe(false);
    expect(report.ready).toBe(true);
    expect(report.ready).toBe(report.hiveReady);
    expect(report.sliceAValidated).toBe(true);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "ENGINE_NONE_HEALTHY", severity: "error" }),
    );
  });

  it("recomputes sliceAValidated and ignores a stale validated claim", async () => {
    const { root, hive } = await repo("main");
    const claim = join(hive, "slice-a.json");
    await writeFile(claim, `${JSON.stringify({ validated: true, sliceAValidated: true })}\n`);
    await writeFile(join(root, ".gitignore"), "# empty\n");

    const report = await runDoctor({ cwd: root, mcpToolNames: TOOLS });

    expect(report.findings).toContainEqual(expect.objectContaining({ code: "HIVE_NOT_GITIGNORED", severity: "error" }));
    expect(report.hiveReady).toBe(false);
    expect(report.ready).toBe(false);
    expect(report.checks.hiveReady).toBe(false);
    expect(report.checks.hostDispatchQueuesIntent).toBe(true);
    expect(report.checks.boardDispatchInvokesDispatchTask).toBe(true);
    expect(report.checks.askMeRoundTrip).toBe(true);
    expect(report.sliceAValidated).toBe(false);
    expect(JSON.parse(await readFile(claim, "utf8")).validated).toBe(true);
  });

  it("includes command-plane MCP tools from buildToolDefinitions by default", async () => {
    const { root } = await repo("main");
    const report = await runDoctor({ cwd: root });
    expect(report.mcpTools).toEqual(expect.arrayContaining([...TOOLS]));
    expect(report.findings.some((item) => item.code === "MCP_TOOL_MISSING")).toBe(false);
  });

  it("reports MCP_TOOL_MISSING when required tools are omitted from mcpToolNames", async () => {
    const { root, hive } = await repo("main");
    await writeFile(
      join(hive, "slice-a.json"),
      `${JSON.stringify({ validated: true, sliceAValidated: true })}\n`,
    );
    const report = await runDoctor({ cwd: root, mcpToolNames: ["build-matrix"] });
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "MCP_TOOL_MISSING", severity: "error" }));
    expect(report.hiveReady).toBe(false);
    expect(report.ready).toBe(report.hiveReady);
    expect(report.sliceAValidated).toBe(false);
  });

  it("reports AWAY_PID_STALE for a dead pid and does not delete away.pid", async () => {
    const { root, hive } = await repo("main");
    const pidPath = join(hive, "away.pid");
    const body = "2147483646\n";
    await writeFile(pidPath, body, { mode: 0o600 });

    const report = await runDoctor({ cwd: root, mcpToolNames: TOOLS });

    const finding = report.findings.find((item) => item.code === "AWAY_PID_STALE");
    expect(finding?.severity).toBe("error");
    expect(finding?.remedy).toContain("superspec away off");
    expect(report.hiveReady).toBe(false);
    expect(report.ready).toBe(false);
    expect(report.sliceAValidated).toBe(false);
    expect(await readFile(pidPath, "utf8")).toBe(body);
  });

  it("reports AWAY_PID_STALE when awayMode is on and the heartbeat is older than two intervals", async () => {
    const { root, hive } = await repo("main");
    const settingsPath = join(hive, "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { pollIntervalMs: number; awayMode: boolean };
    settings.awayMode = true;
    await writeFile(settingsPath, `${JSON.stringify(settings)}\n`);
    const pidPath = join(hive, "away.pid");
    const body = `${process.pid}\n`;
    await writeFile(pidPath, body, { mode: 0o600 });
    const now = Date.parse("2026-10-16T12:00:00.000Z");
    await writeFile(
      join(hive, "away.heartbeat"),
      `${JSON.stringify({ pid: process.pid, at: new Date(now - 2 * settings.pollIntervalMs - 1000).toISOString() })}\n`,
      { mode: 0o600 },
    );

    const report = await runDoctor({ cwd: root, mcpToolNames: TOOLS, now });

    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "AWAY_PID_STALE", severity: "error" }),
    );
    expect(report.findings.find((item) => item.code === "AWAY_PID_STALE")?.remedy).toContain("superspec away off");
    expect(report.hiveReady).toBe(false);
    expect(await readFile(pidPath, "utf8")).toBe(body);
  });

  it("leaves a live away pid with a fresh heartbeat ready", async () => {
    const { root, hive } = await repo("main");
    const settingsPath = join(hive, "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { pollIntervalMs: number; awayMode: boolean };
    settings.awayMode = true;
    await writeFile(settingsPath, `${JSON.stringify(settings)}\n`);
    const now = Date.parse("2026-10-16T12:00:00.000Z");
    await writeFile(join(hive, "away.pid"), `${process.pid}\n`, { mode: 0o600 });
    await writeFile(
      join(hive, "away.heartbeat"),
      `${JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() })}\n`,
      { mode: 0o600 },
    );

    const report = await runDoctor({ cwd: root, mcpToolNames: TOOLS, now });

    expect(report.findings.some((item) => item.code === "AWAY_PID_STALE")).toBe(false);
    expect(report.hiveReady).toBe(true);
    expect(report.ready).toBe(true);
  });

  it("reports a linked worktree as not sandboxed", async () => {
    const { root } = await repo("linked");
    const report = await runDoctor({ cwd: root, mcpToolNames: TOOLS });
    expect(report.worktreeKind).toBe("linked");
    expect(report.sandboxed).toBe(false);
    expect(report.findings.some((item) => item.code === "WORKTREE_IS_NOT_SANDBOX")).toBe(false);
    expect(report.hiveReady).toBe(true);
    expect(report.superspecRootOverride).toBe(root);
  });

  it("clears hiveReady for schema mismatch, unreadable ledger, token mode, and a missing lock directory", async () => {
    const schema = await repo("main");
    await writeFile(join(schema.hive, "hive.json"), `${JSON.stringify({ schemaVersion: 2 })}\n`);
    const schemaReport = await runDoctor({ cwd: schema.root, mcpToolNames: TOOLS });
    expect(schemaReport.findings).toContainEqual(expect.objectContaining({ code: "HIVE_SCHEMA_MISMATCH" }));
    expect(schemaReport.hiveReady).toBe(false);
    expect(schemaReport.ready).toBe(false);

    const ledger = await repo("main");
    await writeFile(join(ledger.hive, "ledger", "001-demo.json"), "{");
    const ledgerReport = await runDoctor({ cwd: ledger.root, mcpToolNames: TOOLS });
    expect(ledgerReport.findings).toContainEqual(expect.objectContaining({ code: "LEDGER_UNREADABLE" }));
    expect(ledgerReport.hiveReady).toBe(false);

    const token = await repo("main");
    const auth = join(token.hive, "auth");
    await mkdir(auth, { recursive: true });
    await chmod(auth, 0o700);
    const tokenPath = join(auth, "loopback.token");
    await writeFile(tokenPath, "probe-token\n", { mode: 0o644 });
    await chmod(tokenPath, 0o644);
    const tokenReport = await runDoctor({ cwd: token.root, mcpToolNames: TOOLS });
    expect(tokenReport.findings).toContainEqual(
      expect.objectContaining({ code: "TOKEN_FILE_MODE", severity: "error" }),
    );
    expect(tokenReport.hiveReady).toBe(false);

    const locks = await repo("main");
    await rm(join(locks.hive, "locks"), { recursive: true });
    const lockReport = await runDoctor({ cwd: locks.root, mcpToolNames: TOOLS });
    expect(lockReport.findings).toContainEqual(expect.objectContaining({ code: "LOCK_MODULE_MISSING" }));
    expect(lockReport.hiveReady).toBe(false);
  });

  it("clears hiveReady when the hive directory is not writable", async () => {
    const { root, hive } = await repo("main");
    await chmod(hive, 0o500);
    try {
      const report = await runDoctor({ cwd: root, mcpToolNames: TOOLS });
      expect(report.writable).toBe(false);
      expect(report.findings).toContainEqual(
        expect.objectContaining({ code: "HIVE_NOT_WRITABLE", severity: "error" }),
      );
      expect(report.hiveReady).toBe(false);
      expect(report.ready).toBe(false);
    } finally {
      await chmod(hive, 0o700);
    }
  });

  it("accepts a loopback token at mode 0600", async () => {
    const { root, hive } = await repo("main");
    const auth = join(hive, "auth");
    await mkdir(auth, { recursive: true });
    await chmod(auth, 0o700);
    const tokenPath = join(auth, "loopback.token");
    await writeFile(tokenPath, "probe-token\n", { mode: 0o600 });
    await chmod(tokenPath, 0o600);
    const report = await runDoctor({ cwd: root, mcpToolNames: TOOLS });
    expect(report.findings.some((item) => item.code === "TOKEN_FILE_MODE")).toBe(false);
    expect(report.hiveReady).toBe(true);
  });

  it("warns budget_unmetered without clearing hiveReady", async () => {
    const { root, hive } = await repo("main");
    await writeFile(
      join(hive, "briefs", "001-demo.json"),
      `${JSON.stringify({ budgetTokens: 100, budgetUsd: null })}\n`,
    );
    const report = await runDoctor({ cwd: root, mcpToolNames: TOOLS });
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "budget_unmetered", severity: "warning" }));
    expect(report.hiveReady).toBe(true);
    expect(report.ready).toBe(true);
  });

  it("reports a missing program.md as not hive ready", async () => {
    const root = await mkdtemp(join(tmpdir(), "cp-doctor-bare-"));
    roots.push(root);
    const report = await runDoctor({ cwd: root, mcpToolNames: TOOLS });
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PROGRAM_MD_MISSING", severity: "error" }));
    expect(report.hiveReady).toBe(false);
    expect(report.ready).toBe(false);
    expect(report.sliceAValidated).toBe(false);
    expect(report.sandboxed).toBe(false);
    expect(report.hivePresent).toBe(false);
  });

  it("does not spawn a host CLI from doctor", async () => {
    const src = await readFile(new URL("../../src/command-plane/doctor.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\b(spawn|execFile|exec|fork)\s*\(/);
  });
});

function hostSpawnCalls(): string[] {
  const calls = [
    ...child.spawn.mock.calls,
    ...child.execFile.mock.calls,
    ...child.exec.mock.calls,
    ...child.fork.mock.calls,
  ];
  return calls.map((call) => String(call[0])).filter((argv0) => HOST_ARGV0.has(argv0));
}

async function repo(kind: "main" | "linked"): Promise<{ root: string; hive: string }> {
  const root = await mkdtemp(join(tmpdir(), "cp-doctor-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# program\n");
  if (kind === "main") await mkdir(join(root, ".git"));
  else await writeFile(join(root, ".git"), "gitdir: /tmp/doctor-fake-git\n");
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  if (!init.ok) throw new Error(init.error);
  return { root, hive: init.hiveRoot };
}
