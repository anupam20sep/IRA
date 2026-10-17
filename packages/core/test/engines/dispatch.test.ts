import { stat, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DispatchIntent } from "../../src/command-plane/hooks.js";
import type { RosterAgent } from "../../src/command-plane/types.js";
import { sliceAGuardNonHostSpawn, dispatchEngine, readSliceAValidated } from "../../src/engines/dispatch.js";
import { persistDispatchIntent } from "../../src/engines/dispatch-queue.js";
import { guardHostSpawn } from "../../src/engines/host-spawn-guard.js";
import { createEngineHooks } from "../../src/engines/hooks-impl.js";
import * as envScrub from "../../src/engines/env-scrub.js";
import * as supervisor from "../../src/engines/supervisor.js";
import type { FailoverPolicy } from "../../src/engines/types.js";

describe("sliceAGuardNonHostSpawn", () => {
  it("returns SLICE_A_ONLY for opencode when sliceAValidated is false", () => {
    expect(
      sliceAGuardNonHostSpawn({ sliceAValidated: false, effectiveEngineId: "opencode" }),
    ).toEqual({ ok: false, code: "SLICE_A_ONLY" });
    expect(
      sliceAGuardNonHostSpawn({ sliceAValidated: false, effectiveEngineId: "claude" }),
    ).toBeNull();
  });

  it("blocks every non-host id until Slice A and lets host ids through", () => {
    for (const id of ["crush", "aider", "custom", "custom:local-1"]) {
      expect(sliceAGuardNonHostSpawn({ sliceAValidated: false, effectiveEngineId: id })).toEqual({
        ok: false,
        code: "SLICE_A_ONLY",
      });
    }
    for (const id of ["codex", "cursor-agent", "cursor"]) {
      expect(sliceAGuardNonHostSpawn({ sliceAValidated: false, effectiveEngineId: id })).toBeNull();
    }
    expect(sliceAGuardNonHostSpawn({ sliceAValidated: true, effectiveEngineId: "opencode" })).toBeNull();
  });
});

describe("guardHostSpawn", () => {
  it("forbids parenting host CLIs even when delegate, away, or hooks would seem to allow it", () => {
    const ctx = { delegateToHost: null, awayPidMatches: true, hooksInstalled: true } as const;
    for (const engineId of ["claude", "codex", "cursor-agent", "cursor"]) {
      expect(guardHostSpawn(engineId, ctx)).toEqual({ ok: false, code: "HOST_SPAWN_FORBIDDEN" });
    }
    expect(guardHostSpawn("opencode", { ...ctx, argv0: "/usr/local/bin/claude" })).toEqual({
      ok: false,
      code: "HOST_SPAWN_FORBIDDEN",
    });
    expect(guardHostSpawn("opencode", { argv0: "agent" })).toEqual({
      ok: false,
      code: "HOST_SPAWN_FORBIDDEN",
    });
    expect(guardHostSpawn("aider", { argv0: "cursor-agent" })).toEqual({
      ok: false,
      code: "HOST_SPAWN_FORBIDDEN",
    });
    expect(guardHostSpawn("opencode", ctx)).toEqual({ ok: true });
  });
});

function intent(hiveRoot: string, overrides: Partial<DispatchIntent> = {}): DispatchIntent {
  return {
    featureId: "006-ira-engine-adapters",
    taskId: "T014",
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
    engine: "claude",
    model: "standard",
    workspace: "/work/implementer",
    worktreePolicy: "isolated",
    status: "idle",
    origin: "manual",
    ...overrides,
  };
}

function healthRow(engineId: string, authMode: string, health = "ok") {
  return {
    engineId,
    authMode,
    health,
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
  const root = await mkdtemp(join(tmpdir(), "hive-dispatch-"));
  await mkdir(join(root, "engines"), { recursive: true });
  await mkdir(join(root, "locks"), { recursive: true });
  await writeFile(join(root, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
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

async function queueMode(path: string): Promise<number> {
  const info = await stat(path);
  return info.mode & 0o777;
}

describe("host dispatch", () => {
  it("returns null, queues the intent mode 0600, and does not spawn", async () => {
    for (const engine of ["claude", "codex", "cursor-agent"] as const) {
      const root = await hive({
        roster: [agent({ id: "implementer", engine, model: "economy" })],
        health: { [engine]: healthRow(engine, "subscription") },
      });
      const spec = vi.spyOn(supervisor, "buildDetachedSupervisorSpawnSpec");
      const scrub = vi.spyOn(envScrub, "buildSupervisorEnv");
      const result = await dispatchEngine(intent(root), { sliceAValidated: false });
      expect(result).toBeNull();
      expect(spec).not.toHaveBeenCalled();
      expect(scrub).not.toHaveBeenCalled();
      const queued = join(root, "dispatch-queue", "006-ira-engine-adapters", "T014.json");
      expect(JSON.parse(await readFile(queued, "utf8"))).toMatchObject({
        featureId: "006-ira-engine-adapters",
        taskId: "T014",
        freshSubagent: true,
      });
      expect(await queueMode(queued)).toBe(0o600);
      spec.mockRestore();
      scrub.mockRestore();
    }
  });

  it("still returns null when delegateToHost is null, away pid matches, and hooks are installed", async () => {
    const root = await hive({
      roster: [agent({ id: "implementer", engine: "cursor" })],
      health: { "cursor-agent": healthRow("cursor-agent", "subscription") },
      policy: { delegateToHost: null },
    });
    const result = await dispatchEngine(intent(root), {
      sliceAValidated: false,
      awayPidMatches: true,
      hooksInstalled: true,
    });
    expect(result).toBeNull();
    const queued = join(root, "dispatch-queue", "006-ira-engine-adapters", "T014.json");
    expect(await queueMode(queued)).toBe(0o600);
  });

  it("returns HOST_SPAWN_FORBIDDEN and starts no child when a host parent is attempted", async () => {
    const root = await hive({
      roster: [agent({ id: "implementer", engine: "claude" })],
      health: { claude: healthRow("claude", "subscription") },
    });
    const result = await dispatchEngine(intent(root), {
      sliceAValidated: true,
      delegateToHost: null,
      awayPidMatches: true,
      hooksInstalled: true,
      spawnAttempt: { argv0: "claude" },
    });
    expect(result).toEqual({ ok: false, code: "HOST_SPAWN_FORBIDDEN" });
    await expect(
      readFile(join(root, "dispatch-queue", "006-ira-engine-adapters", "T014.json"), "utf8"),
    ).rejects.toThrow();
  });
});

describe("non-host dispatch before Slice A", () => {
  it("returns SLICE_A_ONLY and does not build a supervisor child", async () => {
    const root = await hive({
      roster: [agent({ id: "implementer", engine: "opencode", model: "standard", workspace: "/work/implementer" })],
      health: { opencode: healthRow("opencode", "byok") },
    });
    const spec = vi.spyOn(supervisor, "buildDetachedSupervisorSpawnSpec");
    const result = await createEngineHooks(root).dispatch(intent(root));
    expect(result).toEqual({ ok: false, code: "SLICE_A_ONLY" });
    expect(spec).not.toHaveBeenCalled();
    spec.mockRestore();
  });

  it("rejects an unfresh subagent and an isolated worker with no workspace", async () => {
    const root = await hive({
      roster: [agent({ id: "implementer", engine: "aider", workspace: null, worktreePolicy: "isolated" })],
      health: { aider: healthRow("aider", "byok") },
    });
    expect(await dispatchEngine(intent(root, { freshSubagent: false }), { sliceAValidated: true })).toEqual({
      accepted: false,
    });
    expect(
      await dispatchEngine(intent(root, { workspace: null }), { sliceAValidated: true }),
    ).toEqual({ accepted: false });
    expect(
      await dispatchEngine(intent(root, { workspace: join(root, "inside") }), { sliceAValidated: true }),
    ).toEqual({ accepted: false });
  });
});

describe("dispatch integrates failover, review, and model resolution", () => {
  it("fails over from an unhealthy host onto opencode and still returns SLICE_A_ONLY", async () => {
    const root = await hive({
      roster: [agent({ id: "implementer", engine: "claude" })],
      health: {
        claude: healthRow("claude", "subscription", "missing"),
        opencode: healthRow("opencode", "byok"),
      },
    });
    const result = await dispatchEngine(intent(root), { sliceAValidated: false });
    expect(result).toEqual({ ok: false, code: "SLICE_A_ONLY" });
  });

  it("moves a reviewer off the implementer engine and then host-delegates", async () => {
    const root = await hive({
      roster: [
        agent({
          id: "reviewer",
          engine: "opencode",
          personaPath: "/repo/agents/task-reviewer.md",
          workspace: "/work/reviewer",
        }),
      ],
      health: {
        opencode: healthRow("opencode", "byok"),
        claude: healthRow("claude", "subscription"),
      },
      policy: { crossEngineReview: true },
    });
    const result = await dispatchEngine(
      intent(root, { agentId: "reviewer", personaPath: "/repo/agents/task-reviewer.md", workspace: "/work/reviewer" }),
      {
        sliceAValidated: false,
        engineStarts: [
          {
            engineId: "opencode",
            personaPath: "/repo/agents/implementer.md",
            at: "2026-10-16T00:00:00.000Z",
          },
        ],
      },
    );
    expect(result).toBeNull();
    const queued = join(root, "dispatch-queue", "006-ira-engine-adapters", "T014.json");
    expect(await queueMode(queued)).toBe(0o600);
  });

  it("rejects a vendor model that is not on the preset allowlist", async () => {
    const root = await hive({
      roster: [agent({ id: "implementer", engine: "codex", model: "not-a-codex-model" })],
      health: { codex: healthRow("codex", "subscription") },
    });
    expect(await dispatchEngine(intent(root), { sliceAValidated: true })).toEqual({ accepted: false });
  });

  it("spawns a detached supervisor after Slice A with a scrubbed env", async () => {
    const root = await hive({
      roster: [agent({ id: "implementer", engine: "opencode", model: "standard" })],
      health: { opencode: healthRow("opencode", "byok") },
    });
    const spec = vi.spyOn(supervisor, "buildDetachedSupervisorSpawnSpec");
    const scrub = vi.spyOn(envScrub, "buildSupervisorEnv");
    const spawn = vi.fn(() => ({ pid: 4242, unref: () => {} }));
    const result = await dispatchEngine(intent(root), {
      sliceAValidated: true,
      spawnFn: spawn as never,
      processEnv: {
        PATH: "/usr/bin",
        HOME: "/Users/ira",
        OPENAI_API_KEY: "sk-oc",
        ANTHROPIC_API_KEY: "sk-ant",
        HOST: "secret-host",
      },
    });
    expect(result).toEqual({ accepted: true });
    expect(spawn).toHaveBeenCalledWith(
      "superspec",
      ["engines", "supervise", expect.any(String)],
      expect.objectContaining({ detached: true, shell: false, stdio: "ignore" }),
    );
    expect(scrub).toHaveBeenCalled();
    expect(spec).toHaveBeenCalled();
    const built = spec.mock.results.at(-1)?.value as { env: Record<string, string>; shell: boolean; detached: boolean };
    expect(built.shell).toBe(false);
    expect(built.detached).toBe(true);
    expect(built.env.PATH).toBe("/usr/bin");
    expect(built.env.OPENAI_API_KEY).toBe("sk-oc");
    expect(built.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(built.env.HOST).toBeUndefined();
    spec.mockRestore();
    scrub.mockRestore();
  });
});

describe("readSliceAValidated", () => {
  it("ignores a hand-edited sliceAValidated flag", async () => {
    const root = await hive({});
    await writeFile(join(root, "slice-a.json"), JSON.stringify({ sliceAValidated: true, validated: true }));
    await writeFile(
      join(root, "engines", "slice-a-validated.json"),
      JSON.stringify({ sliceAValidated: true }),
    );
    expect(await readSliceAValidated(root)).toBe(false);
  });
});

describe("persistDispatchIntent", () => {
  it("writes the intent at dispatch-queue/<featureId>/<taskId>.json mode 0600", async () => {
    const root = await hive({});
    const saved = intent(root);
    const path = await persistDispatchIntent(saved);
    expect(path).toBe(join(root, "dispatch-queue", saved.featureId, `${saved.taskId}.json`));
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ taskId: "T014", freshSubagent: true });
    expect(await queueMode(path)).toBe(0o600);
  });
});
