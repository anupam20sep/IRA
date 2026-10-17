import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { DispatchIntent } from "../../../src/command-plane/hooks.js";
import type { RosterAgent } from "../../../src/command-plane/types.js";
import { dispatchEngine, type EngineDispatchResult } from "../../../src/engines/dispatch.js";
import { resetEngineStartDedupe } from "../../../src/engines/normalize.js";
import { runSuperviseIntent } from "../../../src/engines/supervise-runner.js";
import type { FailoverPolicy } from "../../../src/engines/types.js";

const FEATURE_ID = "006-ira-engine-adapters";
const TASK_ID = "T023";
const WORKSPACE = "/work/post-slice-a";

const DIRTY_ENV: Record<string, string> = {
  PATH: "/usr/bin",
  HOME: "/Users/ira",
  USER: "ira",
  OPENAI_API_KEY: "sk-openai",
  ANTHROPIC_API_KEY: "sk-anthropic",
  GITHUB_TOKEN: "gho_secret",
  MY_SECRET: "s",
  DB_PASSWORD: "p",
  AWS_CREDENTIAL: "c",
  NODE_ENV: "test",
  HOST: "secret-host",
};

export type PostSliceAFixtureName =
  | "opencode-accepted"
  | "env-scrub-non-byok"
  | "failover-before-start"
  | "review-degraded";

export type HiveEvent = {
  type: string;
  data: Record<string, unknown>;
};

export type PostSliceAReport = {
  accepted: boolean;
  dispatchResult: EngineDispatchResult;
  supervisorPid: number;
  mcpPid: number;
  stdio: unknown;
  detached: boolean;
  shell: boolean;
  argv: string[];
  env: Record<string, string>;
  eventsAtSpawn: HiveEvent[];
  events: HiveEvent[];
};

type HealthRow = {
  engineId: string;
  authMode: string;
  health: string;
  reasonClass: string | null;
  binaryVersion: null;
  checkedAt: string;
};

type SpawnCall = {
  argv: string[];
  detached: boolean;
  shell: boolean;
  stdio: unknown;
  env: Record<string, string>;
  pid: number;
};

export async function runPostSliceAFixture(name: PostSliceAFixtureName): Promise<PostSliceAReport> {
  const mcpPid = process.pid;
  const supervisorPid = mcpPid === 4242 ? 4243 : 4242;
  const root = await mkdtemp(join(tmpdir(), "hive-post-slice-a-"));
  try {
    await writeScenario(root, name);
    const captured: { call: SpawnCall | null; eventsAtSpawn: HiveEvent[] } = {
      call: null,
      eventsAtSpawn: [],
    };
    const spawn = vi.fn((command: string, args: readonly string[], options: Record<string, unknown>) => {
      captured.eventsAtSpawn = readEventsSync(root);
      captured.call = {
        argv: [command, ...args],
        detached: options.detached === true,
        shell: options.shell === true,
        stdio: options.stdio,
        env: envRecord(options.env),
        pid: supervisorPid,
      };
      return { pid: supervisorPid, unref: () => {} };
    });
    const dispatchResult = await dispatchEngine(intent(root, personaFor(name), agentFor(name)), {
      sliceAValidated: true,
      spawnFn: spawn as never,
      processEnv: DIRTY_ENV,
      engineStarts: name === "review-degraded" ? implementerStart() : undefined,
    });
    if (name === "failover-before-start") {
      const intentPath = captured.call?.argv[3];
      if (!intentPath) throw new Error("detached supervisor was not spawned");
      resetEngineStartDedupe();
      const engineSpawn = vi.fn(() => scriptedChild({ exitCode: 0 }));
      await runSuperviseIntent(intentPath, { spawnFn: engineSpawn as never });
    }
    const call = captured.call;
    return {
      accepted: isAccepted(dispatchResult),
      dispatchResult,
      supervisorPid: call?.pid ?? mcpPid,
      mcpPid,
      stdio: call?.stdio,
      detached: call?.detached ?? false,
      shell: call?.shell ?? true,
      argv: call?.argv ?? [],
      env: call?.env ?? {},
      eventsAtSpawn: captured.eventsAtSpawn,
      events: await readEvents(root),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function personaFor(name: PostSliceAFixtureName): string {
  return name === "review-degraded" ? "/repo/agents/task-reviewer.md" : "/repo/agents/implementer.md";
}

function agentFor(name: PostSliceAFixtureName): string {
  return name === "review-degraded" ? "reviewer" : "implementer";
}

function implementerStart() {
  return [
    {
      engineId: "opencode",
      personaPath: "/repo/agents/implementer.md",
      at: "2026-10-16T00:00:00.000Z",
    },
  ];
}

function isAccepted(result: EngineDispatchResult): boolean {
  return result !== null && "accepted" in result && result.accepted === true;
}

async function writeScenario(root: string, name: PostSliceAFixtureName): Promise<void> {
  if (name === "opencode-accepted") {
    await writeHive(root, {
      roster: [agent({ id: "implementer", engine: "opencode" })],
      health: { opencode: healthRow("opencode", "byok") },
    });
    return;
  }
  if (name === "env-scrub-non-byok") {
    await writeHive(root, {
      roster: [agent({ id: "implementer", engine: "custom:local-1" })],
      health: { "custom:local-1": healthRow("custom:local-1", "local") },
      custom: {
        schemaVersion: 1,
        engines: [
          {
            instanceId: "local-1",
            displayName: "Local",
            command: ["local-bin"],
            rung: "local",
            eventMode: "sparse",
          },
        ],
      },
    });
    return;
  }
  if (name === "failover-before-start") {
    await writeHive(root, {
      roster: [agent({ id: "implementer", engine: "claude" })],
      health: {
        claude: healthRow("claude", "subscription", "missing", "missing"),
        aider: healthRow("aider", "byok"),
      },
    });
    return;
  }
  await writeHive(root, {
    roster: [
      agent({
        id: "reviewer",
        engine: "opencode",
        personaPath: "/repo/agents/task-reviewer.md",
      }),
    ],
    health: {
      opencode: healthRow("opencode", "byok"),
      claude: healthRow("claude", "subscription", "unauthorized", "unauthorized"),
    },
    policy: { crossEngineReview: true },
  });
}

function intent(hiveRoot: string, personaPath: string, agentId: string): DispatchIntent {
  return {
    featureId: FEATURE_ID,
    taskId: TASK_ID,
    agentId,
    personaPath,
    workspace: WORKSPACE,
    hiveRoot,
    specDir: "/repo/specs/006-ira-engine-adapters",
    attempt: 1,
    tier: "standard",
    freshSubagent: true,
  };
}

function agent(overrides: Partial<RosterAgent> & Pick<RosterAgent, "id">): RosterAgent {
  return {
    name: overrides.id,
    personaPath: "/repo/agents/implementer.md",
    capabilityTags: [],
    engine: "opencode",
    model: "standard",
    workspace: WORKSPACE,
    worktreePolicy: "isolated",
    status: "idle",
    origin: "manual",
    ...overrides,
  };
}

function healthRow(
  engineId: string,
  authMode: string,
  health = "ok",
  reasonClass: string | null = null,
): HealthRow {
  return {
    engineId,
    authMode,
    health,
    reasonClass,
    binaryVersion: null,
    checkedAt: "2026-10-16T00:00:00.000Z",
  };
}

async function writeHive(
  root: string,
  options: {
    roster: RosterAgent[];
    health: Record<string, HealthRow>;
    policy?: Partial<FailoverPolicy>;
    custom?: unknown;
  },
): Promise<void> {
  await mkdir(join(root, "engines"), { recursive: true });
  await mkdir(join(root, "locks"), { recursive: true });
  await mkdir(join(root, "events"), { recursive: true });
  await writeFile(join(root, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
  await writeFile(join(root, "events", "events.jsonl"), "");
  await writeFile(join(root, "roster.json"), JSON.stringify(options.roster));
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
  await writeFile(join(root, "engines", "health.json"), JSON.stringify(options.health));
  if (options.custom) {
    await writeFile(join(root, "engines", "custom.json"), JSON.stringify(options.custom));
  }
}

function readEventsSync(hiveRoot: string): HiveEvent[] {
  try {
    return parseEvents(readFileSync(join(hiveRoot, "events", "events.jsonl"), "utf8"));
  } catch {
    return [];
  }
}

async function readEvents(hiveRoot: string): Promise<HiveEvent[]> {
  try {
    return parseEvents(await readFile(join(hiveRoot, "events", "events.jsonl"), "utf8"));
  } catch {
    return [];
  }
}

function parseEvents(text: string): HiveEvent[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as HiveEvent);
}

function envRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") env[key] = entry;
  }
  return env;
}

function scriptedChild(script: { exitCode?: number; pid?: number }) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    unref: () => void;
  };
  child.pid = script.pid ?? 77;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = () => {};
  queueMicrotask(() => {
    child.emit("exit", script.exitCode ?? 0);
  });
  return child;
}
