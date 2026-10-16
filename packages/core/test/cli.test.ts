import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";
import * as mcpServer from "../src/mcp-server.js";
import { hiveInit } from "../src/command-plane/hive-init.js";
import { HiveLedgerSchema, RosterAgentSchema } from "../src/command-plane/schema.js";
import { awaySet } from "../src/command-plane/away.js";
import type { HiveTask, RosterAgent } from "../src/command-plane/types.js";
import { saveState } from "../src/forge-loop.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "superspec-cli-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("runCli matrix", () => {
  it("prints a coverage matrix with gaps and exits 0", async () => {
    const specPath = join(root, "spec.md");
    const planPath = join(root, "plan.md");
    await writeFile(specPath, "- **FR-001**: a\n- **FR-002**: b\n", "utf8");
    await writeFile(planPath, "### Task T001: x\n**Implements:** FR-001\n", "utf8");

    const { code, stdout } = await runCli(["matrix", "--spec", specPath, "--plan", planPath]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.gaps).toEqual(["FR-002"]);
    expect(parsed.matrix.complete).toBe(false);
  });
});

describe("runCli matrix missing args", () => {
  it("reports a missing --spec argument but still exits 0 (advise-only)", async () => {
    const planPath = join(root, "plan.md");
    await writeFile(planPath, "### Task T001: x\n**Implements:** FR-001\n", "utf8");

    const { code, stdout } = await runCli(["matrix", "--plan", planPath]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/--spec/);
  });

  it("reports a read error for a nonexistent spec file but still exits 0 (advise-only)", async () => {
    const planPath = join(root, "plan.md");
    await writeFile(planPath, "### Task T001: x\n**Implements:** FR-001\n", "utf8");

    const { code, stdout } = await runCli([
      "matrix",
      "--spec",
      "/nonexistent/path/spec.md",
      "--plan",
      planPath,
    ]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/error/i);
  });

  it("reports an error for --spec given with no value but still exits 0 (advise-only)", async () => {
    const { code, stdout } = await runCli(["matrix", "--spec"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/error/i);
  });

  it("reports an error for an unrecognized flag but still exits 0 (advise-only)", async () => {
    const { code, stdout } = await runCli(["matrix", "--bogus-flag", "x"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/error/i);
  });
});

describe("runCli lint", () => {
  it("prints findings for a placeholder", async () => {
    const planPath = join(root, "plan.md");
    await writeFile(planPath, "### Task T001: x\n- [ ] Step 1: TODO later\n", "utf8");

    const { code, stdout } = await runCli(["lint", "--plan", planPath]);
    expect(code).toBe(0);
    const findings = JSON.parse(stdout);
    expect(findings.some((f: { rule: string }) => f.rule === "no-tbd")).toBe(true);
  });
});

describe("runCli forge loop persisted round-trip", () => {
  let planPath: string;
  let stateDir: string;

  const FORGE_PLAN =
    "### Task T001: First\n**Implements:** FR-001\n\n### Task T002: Second\n**Implements:** FR-002\n**Depends on:** T001\n";

  beforeEach(async () => {
    stateDir = join(root, "project");
    planPath = join(stateDir, "plan.md");
    await mkdir(stateDir, { recursive: true });
    await writeFile(planPath, FORGE_PLAN, "utf8");
  });

  it("next-task, record-result, and forge-status persist state across calls", async () => {
    const first = await runCli(["next-task", "--plan", planPath, "--dir", stateDir]);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout).task.id).toBe("T001");

    const record = await runCli([
      "record-result",
      "--plan",
      planPath,
      "--dir",
      stateDir,
      "--task",
      "T001",
      "--passed",
      "true",
    ]);
    expect(record.code).toBe(0);
    expect(JSON.parse(record.stdout)).toMatchObject({ ok: true, taskId: "T001", passed: true });

    const second = await runCli(["next-task", "--plan", planPath, "--dir", stateDir]);
    expect(JSON.parse(second.stdout).task.id).toBe("T002");

    const status = await runCli(["forge-status", "--plan", planPath, "--dir", stateDir]);
    expect(JSON.parse(status.stdout)).toMatchObject({
      total: 2,
      done: 1,
      blocked: 0,
      pending: 1,
      inProgress: 0,
      complete: false,
    });
  });
});

describe("runCli forge loop verbose", () => {
  const FORGE_PLAN =
    "### Task T001: First\n**Implements:** FR-001\n\n### Task T002: Second\n**Implements:** FR-002\n**Depends on:** T001\n";

  it("next-task, begin-task, record-result print verbose summaries via bin path", async () => {
    const stateDir = join(root, "forge-verbose");
    const planPath = join(stateDir, "plan.md");
    await mkdir(stateDir, { recursive: true });
    await writeFile(planPath, FORGE_PLAN, "utf8");

    const next = await runCli(["next-task", "--plan", planPath, "--dir", stateDir, "--verbose"]);
    expect(next.stdout).toContain("SuperSpec next-task: T001");

    const begin = await runCli([
      "begin-task",
      "--plan",
      planPath,
      "--dir",
      stateDir,
      "--task",
      "T001",
      "--verbose",
    ]);
    expect(begin.stdout).toContain("T001 marked in progress");

    const record = await runCli([
      "record-result",
      "--plan",
      planPath,
      "--dir",
      stateDir,
      "--task",
      "T001",
      "--passed",
      "true",
      "--verbose",
    ]);
    expect(record.stdout).toContain("T001 passed");
  });
});

describe("runCli sync-status", () => {
  it("writes status.md and prints JSON snapshot", async () => {
    const specDir = join(root, "feature");
    const specPath = join(specDir, "spec.md");
    const planPath = join(specDir, "plan.md");
    await mkdir(specDir, { recursive: true });
    await writeFile(specPath, "- **FR-001**: shorten\n", "utf8");
    await writeFile(
      planPath,
      "### Task T001: api\n**Implements:** FR-001\n**Depends on:** none\n",
      "utf8",
    );

    const { code, stdout } = await runCli([
      "sync-status",
      "--spec",
      specPath,
      "--plan",
      planPath,
      "--dir",
      specDir,
      "--verbose",
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("wrote");
    expect(stdout).toContain("status.md");
    const jsonStart = stdout.indexOf("{");
    expect(jsonStart).toBeGreaterThan(-1);
    const parsed = JSON.parse(stdout.slice(jsonStart));
    expect(parsed.path).toContain("status.md");
    expect(parsed.snapshot.frRows[0].fr).toBe("FR-001");
  });
});

describe("runCli unknown command", () => {
  it("reports an error but still exits 0 (advise-only)", async () => {
    const { code, stdout } = await runCli(["frobnicate"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/unknown command/i);
    expect(stdout).toMatch(/next-task/);
  });
});

describe("runCli mcp", () => {
  it("wires the mcp command to the real runMcpServer from mcp-server.ts", async () => {
    const spy = vi.spyOn(mcpServer, "runMcpServer").mockResolvedValue(undefined);
    try {
      const { code } = await runCli(["mcp"]);
      expect(code).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("cli dispatch-task help", () => {
  it("registers dispatch-task subcommand", async () => {
    const out = await runCli(["dispatch-task", "--help"]);
    expect(out.stdout).toMatch(/dispatch-task/);
  });
});

describe("runCli command-plane JSON", () => {
  const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;
  const NOW = "2026-10-16T12:00:00.000Z";
  const FEATURE = "001-demo";
  const PLAN =
    "### Task T001: Alpha\n**Implements:** FR-030\n**Depends on:** none\n**Kind:** code\n**Complexity:** mechanical\n";

  afterEach(async () => {
    if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
    else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
    const hive = join(root, ".superspec", "hive");
    await awaySet({ hiveRoot: hive, awayMode: false }).catch(() => undefined);
  });

  it("task hold prints a JSON envelope", async () => {
    await seedHive();
    const { code, stdout } = await runCli([
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
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toMatchObject({ ok: true, task: { id: "T001", hold: true } });
  });

  it("task abort without confirm returns ok false JSON", async () => {
    await seedHive();
    const { code, stdout } = await runCli([
      "task",
      "abort",
      "--cwd",
      root,
      "--feature",
      FEATURE,
      "--task",
      "T001",
      "--reason",
      "stop",
    ]);
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed).toMatchObject({ ok: false, error: "INVALID_INPUT" });
  });

  it("away on accepts --allow-absent-ci true in JSON settings", async () => {
    await seedHive();
    const { code, stdout } = await runCli([
      "away",
      "on",
      "--cwd",
      root,
      "--allow-absent-ci",
      "true",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.settings.allowAbsentCi).toBe(true);
  });

  it("doctor prints JSON with persona", async () => {
    await seedHive();
    const { code, stdout } = await runCli(["doctor", "--cwd", root]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.persona).toMatchObject({ callsign: "Ira" });
  });

  async function seedHive(): Promise<void> {
    await writeFile(join(root, "program.md"), "# p\n", "utf8");
    process.env.SUPERSPEC_ROOT = root;
    const init = await hiveInit({ cwd: root });
    expect(init.ok).toBe(true);
    const specDir = join(root, "specs", FEATURE);
    await mkdir(specDir, { recursive: true });
    await writeFile(join(specDir, "plan.md"), PLAN, "utf8");
    await saveState(specDir, { tasks: { T001: { status: "pending", reviewFailures: 0 } } });
    const hive = join(root, ".superspec", "hive");
    const roster: RosterAgent[] = [
      {
        id: "agent-host",
        name: "agent-host",
        personaPath: null,
        capabilityTags: [],
        engine: null,
        model: null,
        workspace: null,
        worktreePolicy: "shared",
        status: "idle",
        origin: "manual",
      },
    ];
    await writeFile(join(hive, "roster.json"), `${JSON.stringify(RosterAgentSchema.array().parse(roster))}\n`);
    const task: HiveTask = {
      id: "T001",
      featureId: FEATURE,
      title: "Alpha",
      implementsFr: ["FR-030"],
      dependsOn: [],
      assigneeAgentId: "agent-host",
      status: "todo",
      kind: "code",
      complexity: "mechanical",
      reviewFailures: 0,
      hold: false,
      ceiling: 3,
      drift: "ok",
      replan: null,
      capabilityTags: [],
      updatedAt: NOW,
    };
    const ledger = HiveLedgerSchema.parse({
      featureId: FEATURE,
      planPath: `specs/${FEATURE}/plan.md`,
      specDir: `specs/${FEATURE}`,
      maxReviewFailures: 3,
      updatedAt: NOW,
      tasks: [task],
    });
    await mkdir(join(hive, "ledger"), { recursive: true });
    await writeFile(join(hive, "ledger", `${FEATURE}.json`), `${JSON.stringify(ledger)}\n`);
  }
});

describe("runCli list-personas", () => {
  it("prints discovered personas from --claude-agents-dir", async () => {
    const dir = join(root, ".claude", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "backend-developer.md"),
      "---\nname: backend-developer\ndescription: Server-side work.\n---\n\nBody\n",
      "utf8",
    );

    const { code, stdout } = await runCli(["list-personas", "--claude-agents-dir", dir]);
    expect(code).toBe(0);
    const personas = JSON.parse(stdout);
    expect(personas).toHaveLength(1);
    expect(personas[0].name).toBe("backend-developer");
  });

  it("returns [] when defaults are disabled", async () => {
    const { code, stdout } = await runCli(["list-personas", "--no-defaults"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
  });

  it("discovers project agents via --root", async () => {
    const dir = join(root, ".claude", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "backend-developer.md"),
      "---\nname: backend-developer\ndescription: Server-side work.\n---\n\nBody\n",
      "utf8",
    );

    const { code, stdout } = await runCli([
      "list-personas",
      "--root",
      root,
      "--no-home",
    ]);
    expect(code).toBe(0);
    const personas = JSON.parse(stdout);
    expect(personas.some((p: { name: string }) => p.name === "backend-developer")).toBe(true);
  });
});
