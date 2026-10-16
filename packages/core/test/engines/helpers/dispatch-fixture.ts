import { spawn, execFile, fork } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import * as doctor from "../../../src/command-plane/doctor.js";
import { computeHiveReady, type DoctorReport } from "../../../src/command-plane/doctor.js";
import { safeEngineDispatch, type DispatchIntent } from "../../../src/command-plane/hooks.js";
import { personaField } from "../../../src/command-plane/persona.js";
import { dispatchEngine, type EngineDispatchResult } from "../../../src/engines/dispatch.js";
import { collectEngineDoctorFindings, mergeDoctorReadiness } from "../../../src/engines/doctor-findings.js";
import { registerEngineHooksIfHive } from "../../../src/engines/register.js";
import { FailoverPolicySchema } from "../../../src/engines/schema.js";

const FEATURE_ID = "006-ira-engine-adapters";
const TASK_ID = "T020";
const WORKSPACE = "/tmp/slice-a-workspace";
const HOST_SPAWN_ARGV0 = ["claude", "codex", "cursor-agent", "agent"] as const;
const HOST_ARGV0 = new Set<string>(HOST_SPAWN_ARGV0);

const policyPath = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "policy-failover.json");

export type DispatchFixtureName =
  | "opencode-pre-slice-a"
  | "host-delegate"
  | "host-spawn-forbidden"
  | "local-gate-refusal";

export type DispatchFixtureOptions = {
  engineId?: "claude" | "codex" | "cursor-agent" | "cursor";
};

export type DispatchFixtureReport = {
  result: EngineDispatchResult;
  queueMode: number | null;
  hostChildCount: number;
  hiveReadyBefore: boolean;
  hiveReadyAfter: boolean;
  localContextFinding: boolean;
  doctorStubCalls: number;
};

let latest: DispatchFixtureReport = {
  result: { accepted: false },
  queueMode: null,
  hostChildCount: 0,
  hiveReadyBefore: false,
  hiveReadyAfter: false,
  localContextFinding: false,
  doctorStubCalls: 0,
};

export function lastDispatchFixture(): DispatchFixtureReport {
  return latest;
}

type SpawnMock = {
  mock: { calls: unknown[][] };
  mockClear: () => void;
};

function asSpawnMock(fn: unknown): SpawnMock {
  const mocked = fn as Partial<SpawnMock>;
  if (!mocked.mock || typeof mocked.mockClear !== "function") {
    throw new Error("spawn spy missing");
  }
  return mocked as SpawnMock;
}

function argv0Name(value: unknown): string {
  return basename(String(value ?? "")).replace(/\.(exe|cmd)$/i, "");
}

function armSpawnSpy(): void {
  for (const fn of [spawn, execFile, fork]) {
    asSpawnMock(fn).mockClear();
  }
}

function hostChildCount(): number {
  let count = 0;
  for (const fn of [spawn, execFile, fork]) {
    for (const args of asSpawnMock(fn).mock.calls) {
      if (HOST_ARGV0.has(argv0Name(args[0]))) count += 1;
    }
  }
  return count;
}

function canonicalEngineId(engineId: string): string {
  return engineId === "cursor" ? "cursor-agent" : engineId;
}

function engineFor(name: DispatchFixtureName, options: DispatchFixtureOptions): string {
  if (name === "opencode-pre-slice-a" || name === "local-gate-refusal") return "opencode";
  if (name === "host-spawn-forbidden") return "claude";
  return options.engineId ?? "claude";
}

function healthRow(
  engineId: string,
  authMode: "subscription" | "byok" | "local",
  health: "ok",
  reasonClass: string | null,
) {
  return {
    engineId,
    authMode,
    health,
    reasonClass,
    binaryVersion: null,
    checkedAt: "2026-10-16T12:00:00.000Z",
  };
}

function sliceADoctorStub(hiveRoot: string): DoctorReport {
  return {
    ok: true,
    hiveReady: true,
    engineRungReady: false,
    sliceAValidated: false,
    ready: true,
    repositoryRoot: dirname(dirname(hiveRoot)),
    hiveRoot,
    cwd: hiveRoot,
    hivePresent: true,
    writable: true,
    gitignore: true,
    worktreeKind: "main",
    sandboxed: false,
    superspecRootOverride: null,
    mcpTools: ["hive-init", "dispatch-task", "doctor"],
    findings: [],
    nextSteps: [],
    telemetry: "off",
    persona: personaField(),
    checks: {
      hiveReady: true,
      hostDispatchQueuesIntent: false,
      boardDispatchInvokesDispatchTask: false,
      askMeRoundTrip: false,
    },
  };
}

async function hiveReadySnapshot(hiveRoot: string): Promise<{ hiveReady: boolean; localContextFinding: boolean }> {
  const findings = await collectEngineDoctorFindings(hiveRoot);
  const base = computeHiveReady({ hiveFindings: [], engineFindings: findings });
  return {
    hiveReady: mergeDoctorReadiness(base, findings).hiveReady,
    localContextFinding: findings.some(
      (item) => item.code === "LOCAL_CONTEXT_BELOW_FLOOR" || item.code === "LOCAL_CONTEXT_UNKNOWN",
    ),
  };
}

async function writeHive(repo: string, hiveRoot: string, engineId: string): Promise<void> {
  const policy = FailoverPolicySchema.parse(JSON.parse(await readFile(policyPath, "utf8")));
  const healthId = canonicalEngineId(engineId);
  const authMode = healthId === "opencode" ? "byok" : "subscription";
  await mkdir(join(repo, ".git"), { recursive: true });
  await mkdir(join(hiveRoot, "engines"), { recursive: true });
  await writeFile(join(repo, "program.md"), "# slice A fixture\n");
  await writeFile(join(hiveRoot, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
  await writeFile(join(hiveRoot, "engines", "policy.json"), JSON.stringify(policy));
  await writeFile(
    join(hiveRoot, "roster.json"),
    JSON.stringify([
      {
        id: "implementer",
        name: "Implementer",
        personaPath: "/repo/agents/implementer.md",
        capabilityTags: [],
        engine: engineId,
        model: "standard",
        workspace: WORKSPACE,
        worktreePolicy: "isolated",
        status: "idle",
        origin: "manual",
      },
    ]),
  );
  await writeFile(
    join(hiveRoot, "engines", "health.json"),
    JSON.stringify({ [healthId]: healthRow(healthId, authMode, "ok", null) }),
  );
}

async function writeLocalContextFailure(hiveRoot: string): Promise<void> {
  await writeFile(
    join(hiveRoot, "engines", "health.json"),
    JSON.stringify({
      opencode: healthRow("opencode", "local", "ok", "context_below_floor"),
    }),
  );
  await writeFile(
    join(hiveRoot, "engines", "local-pack.json"),
    JSON.stringify({
      engineId: "opencode",
      backend: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "small",
      advertisedContext: 8192,
      contextSource: "declared",
    }),
  );
}

function intentFor(hiveRoot: string): DispatchIntent {
  return {
    featureId: FEATURE_ID,
    taskId: TASK_ID,
    agentId: "implementer",
    personaPath: "/repo/agents/implementer.md",
    workspace: WORKSPACE,
    hiveRoot,
    specDir: "/tmp/slice-a-spec",
    attempt: 1,
    tier: "standard",
    freshSubagent: true,
  };
}

function asDispatchResult(value: unknown): EngineDispatchResult {
  if (value === null) return null;
  if (!value || typeof value !== "object") return { accepted: false };
  const row = value as { ok?: boolean; code?: string; accepted?: boolean };
  if (row.ok === false && (row.code === "SLICE_A_ONLY" || row.code === "HOST_SPAWN_FORBIDDEN")) {
    return { ok: false, code: row.code };
  }
  if (typeof row.accepted === "boolean") return { accepted: row.accepted };
  return { accepted: false };
}

async function dispatchScenario(
  name: DispatchFixtureName,
  intent: DispatchIntent,
): Promise<EngineDispatchResult> {
  if (name !== "host-spawn-forbidden") {
    return asDispatchResult(await safeEngineDispatch(intent));
  }

  // Host argv0 is refused by dispatchEngine, the function the registered hook calls.

  let result: EngineDispatchResult = { ok: false, code: "HOST_SPAWN_FORBIDDEN" };
  for (const argv0 of HOST_SPAWN_ARGV0) {
    result = await dispatchEngine(intent, {
      sliceAValidated: false,
      delegateToHost: null,
      awayPidMatches: true,
      hooksInstalled: true,
      spawnAttempt: { argv0 },
    });
    if (!result || !("code" in result) || result.code !== "HOST_SPAWN_FORBIDDEN") return result;
  }
  return result;
}

async function queueMode(hiveRoot: string): Promise<number | null> {
  try {
    const info = await stat(join(hiveRoot, "dispatch-queue", FEATURE_ID, `${TASK_ID}.json`));
    return info.mode & 0o777;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Temp hive, failover policy fixture, registered engine hooks, and a doctor
 * stub that reports sliceAValidated false. Spawn is the test spy.
 */
export async function runDispatchFixture(
  name: DispatchFixtureName,
  options: DispatchFixtureOptions = {},
): Promise<EngineDispatchResult> {
  armSpawnSpy();
  const previousRoot = process.env.SUPERSPEC_ROOT;
  delete process.env.SUPERSPEC_ROOT;
  const repo = await mkdtemp(join(tmpdir(), "slice-a-repo-"));
  const hiveRoot = join(repo, ".superspec", "hive");
  const doctorSpy = vi.spyOn(doctor, "runDoctor").mockResolvedValue(sliceADoctorStub(hiveRoot));

  try {
    await writeHive(repo, hiveRoot, engineFor(name, options));
    const before = await hiveReadySnapshot(hiveRoot);
    if (name === "local-gate-refusal") await writeLocalContextFailure(hiveRoot);
    registerEngineHooksIfHive(hiveRoot);
    const result = await dispatchScenario(name, intentFor(hiveRoot));
    const after = await hiveReadySnapshot(hiveRoot);
    latest = {
      result,
      queueMode: await queueMode(hiveRoot),
      hostChildCount: hostChildCount(),
      hiveReadyBefore: before.hiveReady,
      hiveReadyAfter: after.hiveReady,
      localContextFinding: after.localContextFinding,
      doctorStubCalls: doctorSpy.mock.calls.length,
    };
    return result;
  } finally {
    doctorSpy.mockRestore();
    if (previousRoot === undefined) delete process.env.SUPERSPEC_ROOT;
    else process.env.SUPERSPEC_ROOT = previousRoot;
    await rm(repo, { recursive: true, force: true });
  }
}
