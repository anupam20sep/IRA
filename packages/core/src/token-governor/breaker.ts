import { randomUUID } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { openAskMeItem } from "../command-plane/ask-me.js";
import { mailboxPost } from "../command-plane/mailbox.js";
import {
  IraEventSchema,
  RosterAgentSchema,
  agentIdSchema,
  featureIdSchema,
} from "../command-plane/schema.js";
import {
  EVENT_LOCK_WAIT_MS,
  LEDGER_LOCK_WAIT_MS,
  appendJsonlLine,
  withLock,
  writeJsonAtomic,
} from "../command-plane/store.js";
import type { AskMeReasonClass } from "../command-plane/types.js";
import type { ModelTier } from "../model-router.js";
import { tokenRoot } from "./paths.js";
import { BreakersFileSchema, CircuitBreakerStateSchema, TokenSettingsSchema } from "./schema.js";
import { guardSideEffectWrite, isSliceAActive } from "./slice-a.js";
import type { BreakerStage, BreakerTrigger, CircuitBreakerState, BreakersFile, TokenSettings } from "./types.js";

/** One fired breaker window, or a raw observation counted against settings thresholds. */
export type BreakerSignal = {
  trigger: BreakerTrigger;
  toolHash?: string;
  /** Tier in effect before this window. Constrain steps down from it; default frontier. */
  currentTier?: ModelTier;
  /**
   * Observations already seen in the rolling window.
   * Omit when the caller has already decided the window fired.
   */
  count?: number;
  featureId?: string | null;
  taskId?: string | null;
  /** When set, skips the doctor lookup (tests and callers that already know). */
  sliceAActive?: boolean;
};

type Transition = {
  changed: boolean;
  state: CircuitBreakerState;
};

const memory = new Map<string, CircuitBreakerState>();

const rosterFileSchema = z.array(RosterAgentSchema);

function memoryKey(hiveRoot: string, workerKey: string): string {
  return `${hiveRoot}\0${workerKey}`;
}

function breakersPath(hiveRoot: string): string {
  return join(tokenRoot(hiveRoot), "breakers.json");
}

function breakersLockPath(hiveRoot: string): string {
  return join(tokenRoot(hiveRoot), "locks", "breakers.lock");
}

function nowIso(): string {
  return new Date().toISOString();
}

function clearState(workerKey: string): CircuitBreakerState {
  return CircuitBreakerStateSchema.parse({
    workerKey,
    stage: "clear",
    trigger: null,
    windowsFired: 0,
    constrainContextGrowth: false,
    effectiveTier: null,
    haltReason: null,
    updatedAt: nowIso(),
  });
}

/** One step within economy | standard | frontier. Economy stays economy. */
export function stepDownTier(tier: ModelTier): ModelTier {
  if (tier === "frontier") return "standard";
  if (tier === "standard") return "economy";
  return "economy";
}

function nextStage(stage: BreakerStage): BreakerStage {
  if (stage === "clear") return "steer";
  if (stage === "steer") return "constrain";
  if (stage === "constrain") return "stop";
  return "stop";
}

function haltReasonFor(signal: BreakerSignal): string {
  const tool = signal.toolHash ? ` (${signal.toolHash})` : "";
  return `circuit breaker stop: ${signal.trigger}${tool}`;
}

function agentIdFrom(workerKey: string): string {
  const colon = workerKey.indexOf(":");
  return colon === -1 ? workerKey : workerKey.slice(0, colon);
}

function validAgentId(agentId: string): string | null {
  return agentIdSchema.safeParse(agentId).success ? agentId : null;
}

function validFeatureId(featureId: string | null | undefined): string | null {
  if (featureId == null) return null;
  return featureIdSchema.safeParse(featureId).success ? featureId : null;
}

function isSliceAOnly(value: unknown): value is { ok: false; code: "SLICE_A_ONLY" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (value as { code?: unknown }).code === "SLICE_A_ONLY"
  );
}

async function readSettings(hiveRoot: string): Promise<TokenSettings> {
  const fallback = TokenSettingsSchema.parse({ schemaVersion: 1 });
  try {
    const raw = await readFile(join(tokenRoot(hiveRoot), "settings.json"), "utf8");
    return TokenSettingsSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function readBreakers(hiveRoot: string): Promise<BreakersFile> {
  try {
    const raw = await readFile(breakersPath(hiveRoot), "utf8");
    return BreakersFileSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, items: {} };
    }
    throw err;
  }
}

async function readPrior(hiveRoot: string, workerKey: string): Promise<CircuitBreakerState> {
  const key = memoryKey(hiveRoot, workerKey);
  const cached = memory.get(key);
  if (cached) return cached;
  const file = await readBreakers(hiveRoot);
  return file.items[workerKey] ?? clearState(workerKey);
}

function windowFired(signal: BreakerSignal, settings: TokenSettings): boolean {
  if (signal.trigger === "budget") return true;
  if (signal.count === undefined) return true;
  const threshold = signal.trigger === "loop" ? settings.loopThreshold : settings.errorThreshold;
  return signal.count >= threshold;
}

function advance(prior: CircuitBreakerState, signal: BreakerSignal): CircuitBreakerState {
  const sameTrigger = prior.trigger === null || prior.trigger === signal.trigger;
  const stage = sameTrigger ? nextStage(prior.stage) : "steer";
  const windowsFired = sameTrigger ? prior.windowsFired + 1 : 1;

  let constrainContextGrowth = false;
  let effectiveTier: ModelTier | null = null;
  let haltReason: string | null = null;

  if (stage === "constrain") {
    constrainContextGrowth = true;
    effectiveTier = stepDownTier(signal.currentTier ?? "frontier");
  } else if (stage === "stop") {
    constrainContextGrowth = true;
    effectiveTier = prior.effectiveTier ?? stepDownTier(signal.currentTier ?? "frontier");
    haltReason = haltReasonFor(signal);
  }

  return CircuitBreakerStateSchema.parse({
    workerKey: prior.workerKey,
    stage,
    trigger: signal.trigger,
    windowsFired,
    constrainContextGrowth,
    effectiveTier,
    haltReason,
    updatedAt: nowIso(),
  });
}

function remember(hiveRoot: string, workerKey: string, state: CircuitBreakerState): void {
  memory.set(memoryKey(hiveRoot, workerKey), state);
}

/**
 * Advance one worker's breaker on a fired window: steer, then constrain, then stop.
 * Slice A returns the prior in-memory stage and does not persist side effects.
 */
export async function evaluateBreaker(
  hiveRoot: string,
  workerKey: string,
  signal: BreakerSignal,
): Promise<CircuitBreakerState> {
  const sliceA = signal.sliceAActive ?? (await isSliceAActive(hiveRoot));
  if (sliceA) {
    const prior = await readPrior(hiveRoot, workerKey);
    remember(hiveRoot, workerKey, prior);
    return prior;
  }

  const settings = await readSettings(hiveRoot);
  const guarded = await guardSideEffectWrite(
    hiveRoot,
    () => persistTransition(hiveRoot, workerKey, signal, settings),
    signal.sliceAActive === undefined ? undefined : { sliceAActive: signal.sliceAActive },
  );
  if (isSliceAOnly(guarded)) {
    const prior = await readPrior(hiveRoot, workerKey);
    remember(hiveRoot, workerKey, prior);
    return prior;
  }

  remember(hiveRoot, workerKey, guarded.state);
  if (guarded.changed) await applySideEffects(hiveRoot, workerKey, guarded.state, signal);
  return guarded.state;
}

async function persistTransition(
  hiveRoot: string,
  workerKey: string,
  signal: BreakerSignal,
  settings: TokenSettings,
): Promise<Transition> {
  const locked = await withLock(breakersLockPath(hiveRoot), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    const file = await readBreakers(hiveRoot);
    const prior = file.items[workerKey] ?? clearState(workerKey);
    if (!windowFired(signal, settings) || prior.stage === "stop") {
      return { changed: false, state: prior };
    }
    const state = advance(prior, signal);
    await writeJsonAtomic(breakersPath(hiveRoot), {
      schemaVersion: 1,
      items: { ...file.items, [workerKey]: state },
    });
    return { changed: true, state };
  });
  if (!locked.ok) throw new Error("LEDGER_BUSY");
  return locked.value;
}

/** Operator clear. No-op while Slice A side effects are disabled. */
export async function resetBreaker(hiveRoot: string, workerKey: string): Promise<void> {
  const guarded = await guardSideEffectWrite(hiveRoot, async () => {
    const locked = await withLock(breakersLockPath(hiveRoot), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
      const file = await readBreakers(hiveRoot);
      if (!(workerKey in file.items)) return;
      const items = { ...file.items };
      delete items[workerKey];
      await writeJsonAtomic(breakersPath(hiveRoot), { schemaVersion: 1, items });
    });
    if (!locked.ok) throw new Error("LEDGER_BUSY");
  });
  if (isSliceAOnly(guarded)) return;
  memory.delete(memoryKey(hiveRoot, workerKey));
}

async function applySideEffects(
  hiveRoot: string,
  workerKey: string,
  state: CircuitBreakerState,
  signal: BreakerSignal,
): Promise<void> {
  if (state.stage === "steer") await postSteerHint(hiveRoot, workerKey, signal);
  if (state.stage === "stop") {
    await blockRosterAgent(hiveRoot, workerKey);
    const askMeId = await openStopAskMe(hiveRoot, workerKey, state, signal);
    await emitBreakerEvent(hiveRoot, state, signal, askMeId);
    return;
  }
  await emitBreakerEvent(hiveRoot, state, signal, null);
}

async function postSteerHint(hiveRoot: string, workerKey: string, signal: BreakerSignal): Promise<void> {
  const agentId = validAgentId(agentIdFrom(workerKey));
  if (!agentId) return;
  await mailboxPost({
    hiveRoot,
    role: "ira",
    agentId,
    box: "inbox",
    message: {
      toAgentId: agentId,
      kind: "handoff",
      body: "Circuit breaker steer: change approach or wrap up. The current task is still running.",
      relatedTaskId: signal.taskId ?? null,
      featureId: validFeatureId(signal.featureId),
    },
  });
}

async function blockRosterAgent(hiveRoot: string, workerKey: string): Promise<void> {
  const agentId = validAgentId(agentIdFrom(workerKey));
  if (!agentId) return;
  const rosterPath = join(hiveRoot, "roster.json");
  try {
    await access(rosterPath, constants.R_OK);
  } catch {
    return;
  }

  await mkdir(join(hiveRoot, "locks"), { recursive: true, mode: 0o700 });
  const locked = await withLock(join(hiveRoot, "locks", "roster.lock"), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    const parsed = rosterFileSchema.safeParse(JSON.parse(await readFile(rosterPath, "utf8")));
    if (!parsed.success) return;
    let changed = false;
    const next = parsed.data.map((agent) => {
      if (agent.id !== agentId || agent.status === "blocked") return agent;
      changed = true;
      return { ...agent, status: "blocked" as const };
    });
    if (changed) await writeJsonAtomic(rosterPath, next);
  });
  if (!locked.ok) throw new Error("ROSTER_BUSY");
}

/**
 * T012 adds `circuit_breaker_stop` to the Ask-Me enum. Until then the opener
 * rejects the class and stop still persists.
 */
async function openStopAskMe(
  hiveRoot: string,
  workerKey: string,
  state: CircuitBreakerState,
  signal: BreakerSignal,
): Promise<string | null> {
  const opened = await openAskMeItem({
    hiveRoot,
    featureId: validFeatureId(signal.featureId),
    taskId: signal.taskId && signal.taskId.trim().length > 0 ? signal.taskId : null,
    agentId: validAgentId(agentIdFrom(workerKey)),
    reasonClass: "circuit_breaker_stop" as AskMeReasonClass,
    question: `Circuit breaker stop (${state.trigger ?? signal.trigger}) for ${workerKey}. ${state.haltReason ?? haltReasonFor(signal)}`,
  });
  return opened.ok ? opened.item.id : null;
}

async function emitBreakerEvent(
  hiveRoot: string,
  state: CircuitBreakerState,
  signal: BreakerSignal,
  askMeId: string | null,
): Promise<void> {
  try {
    await access(join(hiveRoot, "events"), constants.W_OK);
  } catch {
    return;
  }

  const type =
    state.stage === "steer"
      ? "token.breaker_steer"
      : state.stage === "constrain"
        ? "token.breaker_constrain"
        : "token.breaker_stop";
  const data =
    state.stage === "constrain"
      ? { workerKey: state.workerKey, effectiveTier: state.effectiveTier }
      : state.stage === "stop"
        ? { workerKey: state.workerKey, trigger: state.trigger, askMeId }
        : { workerKey: state.workerKey, trigger: signal.trigger };

  const featureId = validFeatureId(signal.featureId);
  const event = IraEventSchema.safeParse({
    id: `evt_${randomUUID()}`,
    type,
    version: 1,
    ts: nowIso(),
    featureId,
    actor: { kind: "ira", id: "ira" },
    data,
  });
  if (!event.success) return;
  await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
    appendJsonlLine(join(hiveRoot, "events", "events.jsonl"), event.data),
  );
}
