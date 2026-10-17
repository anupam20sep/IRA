import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { DispatchIntent } from "../command-plane/hooks.js";
import { resolveRepositoryRoot } from "../command-plane/paths.js";
import { RosterAgentSchema } from "../command-plane/schema.js";
import type { RosterAgent } from "../command-plane/types.js";
import { getEnforcedRemaining } from "../token-governor/budgets.js";
import {
  catalogEmitsTokenSignals,
  reGateBeforeSpawn,
  selectSignalCapableRung,
} from "../token-governor/failover-gate.js";
import { getBuiltinPreset, parseCustomEngineId } from "./catalog.js";
import { persistDispatchIntent } from "./dispatch-queue.js";
import * as envScrub from "./env-scrub.js";
import { selectEffectiveEngine, type FailoverHealthSnap } from "./failover.js";
import {
  canonicalEngineId,
  guardHostSpawn,
  isHostEngineId,
  type HostSpawnGuardContext,
} from "./host-spawn-guard.js";
import {
  applyCrossEngineReview,
  isReviewerPersona,
  type EngineStartRecord,
} from "./review-policy.js";
import { resolveDispatchModel } from "./resolve-model.js";
import { CustomEnginesFileSchema, EngineHealthSchema, LocalPackProfileSchema } from "./schema.js";
import { hiveInitialized, readPolicy } from "./store.js";
import * as supervisor from "./supervisor.js";
import type { CustomEngine, EngineHealth, FailoverPolicy, LadderRung, LocalPackProfile } from "./types.js";

export type EngineDispatchResult =
  | null
  | { accepted: boolean }
  | { ok: false; code: "SLICE_A_ONLY" }
  | { ok: false; code: "HOST_SPAWN_FORBIDDEN" };

export type DispatchEngineOptions = {
  sliceAValidated?: boolean;
  awayPidMatches?: boolean;
  hooksInstalled?: boolean;
  delegateToHost?: HostSpawnGuardContext["delegateToHost"];
  spawnAttempt?: { argv0: string };
  engineStarts?: EngineStartRecord[];
  processEnv?: Readonly<Record<string, string | undefined>>;
};

const SUPERVISOR_IDS = new Set(["opencode", "crush", "aider", "custom"]);

const CLAIM_FILES = [
  "slice-a.json",
  "slice-a-validated.json",
  join("engines", "slice-a.json"),
  join("engines", "slice-a-validated.json"),
];

/**
 * Non-host spawn is SLICE_A_ONLY until doctor reports sliceAValidated.
 * Host ids are not this gate — dispatch returns null for them.
 */
export function sliceAGuardNonHostSpawn(input: {
  sliceAValidated: boolean;
  effectiveEngineId: string;
}): { ok: false; code: "SLICE_A_ONLY" } | null {
  if (isHostEngineId(input.effectiveEngineId)) return null;
  if (!input.sliceAValidated) return { ok: false, code: "SLICE_A_ONLY" };
  return null;
}

/**
 * Hand-edited claim files are read and ignored.
 * True only when doctor resolves this same hive and reports sliceAValidated.
 */
export async function readSliceAValidated(hiveRoot: string): Promise<boolean> {
  for (const name of CLAIM_FILES) {
    try {
      await readFile(join(hiveRoot, name), "utf8");
    } catch {
      // A missing claim is not validation.
    }
  }
  const resolved = resolveRepositoryRoot(hiveRoot);
  if (!resolved.ok || resolve(resolved.hiveRoot) !== resolve(hiveRoot)) return false;
  const { runDoctor } = await import("../command-plane/doctor.js");
  const report = await runDoctor({ cwd: hiveRoot });
  return report.sliceAValidated === true && resolve(report.hiveRoot ?? "") === resolve(hiveRoot);
}

export async function dispatchEngine(
  intent: DispatchIntent,
  options: DispatchEngineOptions = {},
): Promise<EngineDispatchResult> {
  if (intent.freshSubagent !== true) return { accepted: false };

  const loaded = await loadDispatchState(intent.hiveRoot);
  if (!loaded) return { accepted: false };

  const row = loaded.roster.find((agent) => agent.id === intent.agentId);
  const preferred = row?.engine
    ? canonicalEngineId(row.engine)
    : loaded.policy.delegateToHost;
  if (!preferred) return { accepted: false };

  const snaps = healthSnaps(loaded.health);
  const remaining = await getEnforcedRemaining(intent.hiveRoot, {
    agentId: intent.agentId,
    featureId: intent.featureId,
  });
  const numericBudgetCapSet = remaining.tokens !== null || remaining.usd !== null;
  const decision = selectEffectiveEngine({
    preferredEngineId: preferred,
    health: snaps,
    policy: {
      failoverEnabled: loaded.policy.failoverEnabled,
      ladder: loaded.policy.ladder,
      hitl: loaded.policy.hitl,
      quotaGroups: loaded.policy.quotaGroups,
    },
    localGateOk: localContextOk(loaded.health),
    budgetTokens: enforcedBudget(row?.budgetTokens, remaining.tokens, numericBudgetCapSet),
    budgetUsd: enforcedBudget(row?.budgetUsd, remaining.usd, numericBudgetCapSet),
    model: row?.model ?? null,
    tier: intent.tier,
    agentId: intent.agentId,
    taskId: intent.taskId,
    freshSubagent: true,
  });
  if (!decision.accepted || !decision.engineId) return { accepted: false };

  const starts = options.engineStarts ?? (await readEngineStarts(intent.hiveRoot));
  const review = applyCrossEngineReview({
    crossEngineReview: loaded.policy.crossEngineReview,
    personaPath: intent.personaPath ?? row?.personaPath ?? "",
    proposedEngineId: decision.engineId,
    taskId: intent.taskId,
    engineStarts: starts,
    busyNonReviewerEngineId: busyNonReviewer(loaded.roster),
    healthByEngineId: Object.fromEntries(
      Object.entries(snaps).map(([id, snap]) => [id, { health: snap.health }]),
    ),
  });
  const effectiveId = canonicalEngineId(review.engineId);

  const model = resolveDispatchModel(intent, { model: row?.model ?? null }, effectiveId, {
    localPack: loaded.localPack,
    customEngine: customFor(loaded.custom, effectiveId),
  });
  if (!model.ok) return { accepted: false };

  if (effectiveId !== preferred) {
    const selected = selectSignalCapableRung(
      [{ engineId: effectiveId, emitsTokenSignals: catalogEmitsTokenSignals(effectiveId) }],
      { numericBudgetCapSet },
    );
    if (!("rung" in selected)) return { accepted: false };

    const gate = await reGateBeforeSpawn(effectiveId, model.vendorModel, {
      intent,
      brief: {
        budgetTokens: row?.budgetTokens ?? null,
        budgetUsd: row?.budgetUsd ?? null,
      },
    });
    if (!gate.allow) return { accepted: false };
  }

  if (options.spawnAttempt) {
    const guard = guardHostSpawn(effectiveId, {
      argv0: options.spawnAttempt.argv0,
      delegateToHost: options.delegateToHost ?? loaded.policy.delegateToHost,
      awayPidMatches: options.awayPidMatches === true,
      hooksInstalled: options.hooksInstalled === true,
    });
    if (!guard.ok) return guard;
  }

  if (isHostEngineId(effectiveId)) {
    try {
      await persistDispatchIntent(intent);
    } catch {
      return { accepted: false };
    }
    return null;
  }

  const worktreePolicy = row?.worktreePolicy ?? "isolated";
  if (workspaceBlocksSpawn(intent.workspace, intent.hiveRoot, worktreePolicy)) {
    return { accepted: false };
  }

  const sliceAValidated = options.sliceAValidated ?? (await readSliceAValidated(intent.hiveRoot));
  const blocked = sliceAGuardNonHostSpawn({ sliceAValidated, effectiveEngineId: effectiveId });
  if (blocked) return blocked;
  if (!isSupervisorEngine(effectiveId)) return { accepted: false };

  // T022 starts the child. Until then the spec is built (scrubbed env, detached argv) and dropped.
  prepareSupervisorSpec(intent, effectiveId, loaded.custom, options.processEnv ?? process.env);
  return { accepted: false };
}

function enforcedBudget(
  roster: number | null | undefined,
  remaining: number | null,
  numericBudgetCapSet: boolean,
): number | null {
  if (typeof roster === "number") return roster;
  if (!numericBudgetCapSet) return null;
  return remaining ?? 0;
}

function isSupervisorEngine(engineId: string): boolean {
  const id = canonicalEngineId(engineId);
  if (SUPERVISOR_IDS.has(id)) return true;
  return parseCustomEngineId(id)?.kind === "custom";
}

function prepareSupervisorSpec(
  intent: DispatchIntent,
  engineId: string,
  custom: CustomEngine[],
  processEnv: Readonly<Record<string, string | undefined>>,
) {
  const { rung, byokAllowlist } = rungFor(engineId, customFor(custom, engineId));
  const env = envScrub.buildSupervisorEnv({ rung, processEnv, byokAllowlist });
  const intentPath = join(intent.hiveRoot, "dispatch-queue", intent.featureId, `${intent.taskId}.json`);
  return supervisor.buildDetachedSupervisorSpawnSpec(intentPath, env);
}

function rungFor(
  engineId: string,
  custom: CustomEngine | null,
): { rung: LadderRung; byokAllowlist: readonly string[] } {
  const parsed = parseCustomEngineId(engineId);
  if (!parsed || parsed.kind === "custom") {
    return { rung: custom?.rung ?? "byok", byokAllowlist: [] };
  }
  const preset = getBuiltinPreset(parsed.id);
  return { rung: preset?.rung ?? "byok", byokAllowlist: preset?.byokEnvAllowlist ?? [] };
}

function customFor(custom: CustomEngine[], engineId: string): CustomEngine | null {
  const parsed = parseCustomEngineId(engineId);
  if (parsed?.kind !== "custom") return null;
  return custom.find((row) => row.instanceId === parsed.instanceId) ?? null;
}

function workspaceBlocksSpawn(
  workspace: string | null,
  hiveRoot: string,
  policy: "isolated" | "shared",
): boolean {
  if (policy === "isolated" && (workspace === null || workspace.trim() === "")) return true;
  if (!workspace || workspace.trim() === "") return false;
  const abs = resolve(workspace);
  const hive = resolve(hiveRoot);
  const rel = relative(hive, abs);
  if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) return true;
  const parts = abs.split(sep);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === ".superspec" && parts[i + 1] === "hive") return true;
  }
  return false;
}

function healthSnaps(health: Record<string, EngineHealth>): Record<string, FailoverHealthSnap> {
  const snaps: Record<string, FailoverHealthSnap> = {};
  for (const [id, row] of Object.entries(health)) {
    snaps[canonicalEngineId(id)] = {
      health: row.health,
      authMode: row.authMode,
      reasonClass: row.reasonClass,
    };
  }
  return snaps;
}

function localContextOk(health: Record<string, EngineHealth>): boolean {
  for (const id of ["opencode", "crush", "aider"]) {
    if (health[id]?.reasonClass === "context_below_floor") return false;
  }
  return true;
}

function busyNonReviewer(roster: RosterAgent[]): string | null {
  const busy = roster.find(
    (row) =>
      row.status === "busy" &&
      row.engine !== null &&
      row.personaPath !== null &&
      !isReviewerPersona(row.personaPath),
  );
  return busy?.engine ?? null;
}

async function readEngineStarts(hiveRoot: string): Promise<EngineStartRecord[]> {
  let text: string;
  try {
    text = await readFile(join(hiveRoot, "events", "events.jsonl"), "utf8");
  } catch {
    return [];
  }
  const starts: EngineStartRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as {
        type?: string;
        ts?: string;
        data?: { engineId?: string; personaPath?: string };
      };
      if (row.type !== "engine.start" || !row.data?.engineId || !row.data.personaPath) continue;
      starts.push({
        engineId: row.data.engineId,
        personaPath: row.data.personaPath,
        at: row.ts ?? "",
      });
    } catch {
      // Skip a corrupt line. One bad event must not invent an engine.
    }
  }
  return starts;
}

type DispatchState = {
  roster: RosterAgent[];
  policy: FailoverPolicy;
  health: Record<string, EngineHealth>;
  localPack: LocalPackProfile | null;
  custom: CustomEngine[];
};

async function loadDispatchState(hiveRoot: string): Promise<DispatchState | null> {
  if (!(await hiveInitialized(hiveRoot))) return null;
  let policy: FailoverPolicy;
  try {
    const read = await readPolicy(hiveRoot);
    if (!read.ok) return null;
    policy = read.policy;
  } catch {
    return null;
  }

  const roster = await readRoster(hiveRoot);
  if (!roster) return null;
  const [health, localPack, custom] = await Promise.all([
    readHealth(hiveRoot),
    readLocalPack(hiveRoot),
    readCustom(hiveRoot),
  ]);
  return { roster, policy, health, localPack, custom };
}

async function readRoster(hiveRoot: string): Promise<RosterAgent[] | null> {
  try {
    const parsed = RosterAgentSchema.array().safeParse(
      JSON.parse(await readFile(join(hiveRoot, "roster.json"), "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    return null;
  }
}

async function readHealth(hiveRoot: string): Promise<Record<string, EngineHealth>> {
  try {
    const parsed = z.record(EngineHealthSchema).safeParse(
      JSON.parse(await readFile(join(hiveRoot, "engines", "health.json"), "utf8")),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

async function readLocalPack(hiveRoot: string): Promise<LocalPackProfile | null> {
  try {
    const parsed = LocalPackProfileSchema.safeParse(
      JSON.parse(await readFile(join(hiveRoot, "engines", "local-pack.json"), "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readCustom(hiveRoot: string): Promise<CustomEngine[]> {
  try {
    const parsed = CustomEnginesFileSchema.safeParse(
      JSON.parse(await readFile(join(hiveRoot, "engines", "custom.json"), "utf8")),
    );
    return parsed.success ? parsed.data.engines : [];
  } catch {
    return [];
  }
}
