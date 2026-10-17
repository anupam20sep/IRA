import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DispatchIntent } from "../../src/command-plane/hooks.js";
import { runCli } from "../../src/cli.js";
import type { RosterAgent } from "../../src/command-plane/types.js";
import { dispatchEngine } from "../../src/engines/dispatch.js";
import { resetEngineStartDedupe } from "../../src/engines/normalize.js";
import {
  mapAcpNotification,
  runSuperviseIntent,
  spawnDetachedSupervisor,
} from "../../src/engines/supervise-runner.js";
import type { FailoverPolicy } from "../../src/engines/types.js";

describe("spawnDetachedSupervisor", () => {
  it("uses detached true and shell false", async () => {
    const spawn = vi.fn(() => ({ pid: 4242, unref: () => {}, stdio: ["ignore", "ignore", "ignore"] }));
    const r = await spawnDetachedSupervisor({ intentPath: "/tmp/intent.json", spawnFn: spawn as never });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pid).toBe(4242);
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ detached: true, shell: false }),
    );
  });

  it("returns a failure code when spawn throws and does not throw out", async () => {
    const spawn = vi.fn(() => {
      throw new Error("spawn exploded");
    });
    await expect(
      spawnDetachedSupervisor({ intentPath: "/tmp/intent.json", spawnFn: spawn as never }),
    ).resolves.toEqual({ ok: false, code: "spawn_failed" });
  });
});

describe("mapAcpNotification", () => {
  it("maps an ACP tool_call onto engine.tool", () => {
    resetEngineStartDedupe();
    const event = mapAcpNotification(
      { jsonrpc: "2.0", method: "tool_call", params: { tool_name: "read", status: "ok" } },
      {
        agentId: "implementer",
        engineId: "opencode",
        taskId: "T022",
        sessionId: "ses_acp",
        featureId: "006-ira-engine-adapters",
      },
    );
    expect(event?.type).toBe("engine.tool");
    expect(event?.data).toMatchObject({ toolName: "read", status: "ok", engineId: "opencode" });
  });
});

describe("MCP dispatch spawn gate", () => {
  it("spawns only after Slice A for an allowlisted engine and keeps host delegate null", async () => {
    const blocked = await hive({
      roster: [agent({ id: "implementer", engine: "opencode", model: "standard" })],
      health: { opencode: healthRow("opencode", "byok") },
    });
    const blockedSpawn = vi.fn();
    expect(
      await dispatchEngine(intent(blocked), { sliceAValidated: false, spawnFn: blockedSpawn as never }),
    ).toEqual({ ok: false, code: "SLICE_A_ONLY" });
    expect(blockedSpawn).not.toHaveBeenCalled();

    const host = await hive({
      roster: [agent({ id: "implementer", engine: "cursor" })],
      health: { "cursor-agent": healthRow("cursor-agent", "subscription") },
      policy: { delegateToHost: null },
    });
    const hostSpawn = vi.fn();
    expect(
      await dispatchEngine(intent(host), {
        sliceAValidated: true,
        awayPidMatches: true,
        hooksInstalled: true,
        delegateToHost: null,
        spawnFn: hostSpawn as never,
      }),
    ).toBeNull();
    expect(hostSpawn).not.toHaveBeenCalled();

    const open = await hive({
      roster: [agent({ id: "implementer", engine: "crush", model: "standard" })],
      health: { crush: healthRow("crush", "byok") },
    });
    const spawn = vi.fn(() => ({ pid: 5150, unref: () => {} }));
    expect(
      await dispatchEngine(intent(open), {
        sliceAValidated: true,
        spawnFn: spawn as never,
        processEnv: { PATH: "/usr/bin", HOME: "/Users/ira", OPENAI_API_KEY: "sk-oc" },
      }),
    ).toEqual({ accepted: true });
    expect(spawn).toHaveBeenCalledWith(
      "superspec",
      ["engines", "supervise", expect.any(String)],
      expect.objectContaining({ detached: true, shell: false, stdio: "ignore" }),
    );
  });
});

describe("runSuperviseIntent", () => {
  it("observes an Aider token line inside the supervise process", async () => {
    resetEngineStartDedupe();
    const root = await hive({
      roster: [agent({ id: "implementer", engine: "aider", model: "standard" })],
    });
    const intentPath = await writeIntent(root, "aider");
    const spawn = vi.fn(() =>
      scriptedChild({ lines: ["Tokens: 3 sent, 4 received"], exitCode: 0 }),
    );
    const result = await runSuperviseIntent(intentPath, { spawnFn: spawn as never });
    expect(result).toEqual({ ok: true, pid: 77 });
    expect(spawn).toHaveBeenCalledWith(
      "aider",
      expect.arrayContaining(["--message-file", "--yes-always", "--no-pretty"]),
      expect.objectContaining({ shell: false }),
    );
    const events = await readEvents(root);
    expect(events.map((row) => row.type)).toEqual(["engine.start", "engine.tokens", "engine.stop"]);
    expect(events[1]?.data).toMatchObject({ inputTokens: 3, outputTokens: 4, source: "transcript" });
  });

  it("marks the crashed child offline with adapter_crash and leaves the other agent", async () => {
    resetEngineStartDedupe();
    const root = await hive({
      roster: [
        agent({ id: "implementer", engine: "aider", model: "standard", status: "busy" }),
        agent({ id: "reviewer", engine: "opencode", status: "idle" }),
      ],
    });
    const intentPath = await writeIntent(root, "aider");
    const spawn = vi.fn(() => scriptedChild({ exitCode: 2 }));
    await expect(runSuperviseIntent(intentPath, { spawnFn: spawn as never })).resolves.toEqual({
      ok: false,
      code: "adapter_crash",
    });
    const roster = JSON.parse(await readFile(join(root, "roster.json"), "utf8")) as Array<{
      id: string;
      status: string;
    }>;
    expect(roster.find((row) => row.id === "implementer")?.status).toBe("offline");
    expect(roster.find((row) => row.id === "reviewer")?.status).toBe("idle");
    const events = await readEvents(root);
    expect(events.at(-1)).toMatchObject({
      type: "engine.error",
      data: { reasonClass: "adapter_crash", engineId: "aider" },
    });
  });

  it("observes a custom command as PTY start and stop", async () => {
    resetEngineStartDedupe();
    const root = await hive({
      roster: [agent({ id: "implementer", engine: "custom:local-1", model: null })],
    });
    await writeFile(
      join(root, "engines", "custom.json"),
      JSON.stringify({
        schemaVersion: 1,
        engines: [
          {
            instanceId: "local-1",
            displayName: "Local",
            command: ["my-custom", "--once"],
            eventMode: "sparse",
          },
        ],
      }),
    );
    const intentPath = await writeIntent(root, "custom:local-1");
    const spawn = vi.fn(() => scriptedChild({ lines: ["hello from the command"], exitCode: 0 }));
    expect(await runSuperviseIntent(intentPath, { spawnFn: spawn as never })).toEqual({ ok: true, pid: 77 });
    expect(spawn).toHaveBeenCalledWith(
      "my-custom",
      ["--once"],
      expect.objectContaining({ shell: false }),
    );
    const events = await readEvents(root);
    expect(events.map((row) => row.type)).toEqual(["engine.start", "engine.stop"]);
  });

  it("does not spawn a host engine from the supervise process", async () => {
    const root = await hive({
      roster: [agent({ id: "implementer", engine: "claude" })],
    });
    const intentPath = await writeIntent(root, "claude");
    const spawn = vi.fn();
    expect(await runSuperviseIntent(intentPath, { spawnFn: spawn as never })).toEqual({
      ok: false,
      code: "HOST_SPAWN_FORBIDDEN",
    });
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("engines supervise CLI", () => {
  it("requires an intent path and reports an unreadable intent without throwing", async () => {
    const missing = await runCli(["engines", "supervise"]);
    expect(missing.code).toBe(1);
    const bad = await runCli(["engines", "supervise", join(tmpdir(), "missing-t022-intent.json")]);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain("INTENT_UNREADABLE");
  });
});

function scriptedChild(script: { lines?: string[]; exitCode?: number | null; pid?: number }) {
  const stdout = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    unref: () => void;
  };
  child.pid = script.pid ?? 77;
  child.stdout = stdout;
  child.stderr = new EventEmitter();
  child.unref = () => {};
  queueMicrotask(() => {
    for (const line of script.lines ?? []) stdout.emit("data", `${line}\n`);
    child.emit("exit", script.exitCode ?? 0);
  });
  return child;
}

function intent(hiveRoot: string, overrides: Partial<DispatchIntent> = {}): DispatchIntent {
  return {
    featureId: "006-ira-engine-adapters",
    taskId: "T022",
    agentId: "implementer",
    personaPath: "/repo/agents/implementer.md",
    workspace: "/work/implementer",
    hiveRoot,
    specDir: "/repo/specs/006-ira-engine-adapters",
    attempt: 1,
    tier: "standard",
    freshSubagent: true,
    ...overrides,
  };
}

function agent(overrides: Partial<RosterAgent> & Pick<RosterAgent, "id">): RosterAgent {
  return {
    name: overrides.id,
    personaPath: "/repo/agents/implementer.md",
    capabilityTags: [],
    engine: "aider",
    model: "standard",
    workspace: "/work/implementer",
    worktreePolicy: "isolated",
    status: "idle",
    origin: "manual",
    ...overrides,
  };
}

function healthRow(engineId: string, authMode: string) {
  return {
    engineId,
    authMode,
    health: "ok",
    reasonClass: null,
    binaryVersion: null,
    checkedAt: "2026-10-16T00:00:00.000Z",
  };
}

async function hive(options: {
  roster?: RosterAgent[];
  health?: Record<string, ReturnType<typeof healthRow>>;
  policy?: Partial<FailoverPolicy>;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hive-supervise-"));
  await mkdir(join(root, "engines"), { recursive: true });
  await mkdir(join(root, "locks"), { recursive: true });
  await mkdir(join(root, "events"), { recursive: true });
  await writeFile(join(root, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
  await writeFile(join(root, "events", "events.jsonl"), "");
  await writeFile(join(root, "roster.json"), JSON.stringify(options.roster ?? []));
  const policy: FailoverPolicy = {
    schemaVersion: 1,
    failoverEnabled: true,
    ladder: ["subscription", "byok", "local"],
    crossEngineReview: false,
    delegateToHost: null,
    hitl: ["budget_exceed", "destructive_git"],
    quotaGroups: [],
    ...options.policy,
  };
  await writeFile(join(root, "engines", "policy.json"), JSON.stringify(policy));
  await writeFile(join(root, "engines", "health.json"), JSON.stringify(options.health ?? {}));
  return root;
}

async function writeIntent(hiveRoot: string, engineId: string): Promise<string> {
  const path = join(hiveRoot, "dispatch-queue", "006-ira-engine-adapters", "T022.json");
  await mkdir(join(hiveRoot, "dispatch-queue", "006-ira-engine-adapters"), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ ...intent(hiveRoot), engineId }),
    { mode: 0o600 },
  );
  return path;
}

async function readEvents(hiveRoot: string): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
  const text = await readFile(join(hiveRoot, "events", "events.jsonl"), "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
}
