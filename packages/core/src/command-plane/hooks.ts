import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync, type Stats } from "node:fs";
import { join } from "node:path";
import { IraEventSchema, featureIdSchema } from "./schema.js";
import { EVENT_LOCK_WAIT_MS, appendJsonlLine, withLock } from "./store.js";
import type { AskMeReasonClass, IraEvent, RosterAgent } from "./types.js";

/** OD-015: a thrown hook denies the steer path and must not escape to MCP. */
export const HOOK_FAILED_CLOSED = "HOOK_FAILED_CLOSED" as const;

export type HookName =
  | "beforeDispatch"
  | "dispatch"
  | "normalizeEvent"
  | "onRecordResult"
  | "onUntrustedImport"
  | "matchCapabilities";

export interface InjectionSummary {
  text: string;
  patternIds: string[];
}

export interface DispatchIntent {
  featureId: string;
  taskId: string;
  agentId: string;
  personaPath: string | null;
  workspace: string | null;
  hiveRoot: string;
  specDir: string;
  attempt: number;
  tier: string;
  freshSubagent: boolean;
  patternSummary?: InjectionSummary;
}

export interface RetrieveContext {
  featureId: string;
  taskId: string;
  implementsFr: string[];
  kind: string;
  complexity: string;
  capabilityTags: string[];
}

export interface DistillContext {
  featureId: string;
  taskId: string;
  passed: boolean;
  reviewFailures: number;
}

export interface LearningHooks {
  retrieve?(ctx: RetrieveContext): Promise<InjectionSummary | null>;
  distill?(ctx: DistillContext): Promise<void>;
}

export interface SpendEventInput {
  ts: string;
  agentId: string;
  featureId: string | null;
  engine: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  usdEstimate: number | null;
  source: "transcript" | "api" | "estimate";
}

export interface DispatchContext {
  intent: DispatchIntent;
  brief: { budgetTokens: number | null; budgetUsd: number | null };
}

export type DispatchGate =
  | { allow: true }
  | { allow: false; reasonClass: AskMeReasonClass; detail: string };

export type HookFailClosed = { allow: false; reason: typeof HOOK_FAILED_CLOSED };

export type SafeBeforeDispatchResult = DispatchGate | HookFailClosed;

export interface TokenHooks {
  beforeDispatch?(ctx: DispatchContext): Promise<DispatchGate>;
  recordSpend?(event: SpendEventInput): Promise<void>;
  onRecordResult?(ctx: DistillContext): Promise<void>;
}

export interface HireHooks {
  matchCapabilities?(task: { capabilityTags: string[] }, roster: RosterAgent[]): RosterAgent | null;
  onUntrustedImport?(input: {
    featureId: string | null;
    agentId: string | null;
    detail: string;
  }): Promise<{ askMeId: string }>;
}

export interface EnginePresence {
  engineId: string;
  installed: boolean;
}

export interface NormalizeEventInput {
  type: string;
  agentId?: string;
  engineId?: string;
  data?: Record<string, unknown>;
}

export interface EngineHooks {
  detectInstalled?(): Promise<EnginePresence[]>;
  dispatch?(intent: DispatchIntent): Promise<{ accepted: boolean } | null>;
  normalizeEvent?(raw: NormalizeEventInput): Promise<IraEvent | null>;
}

export type EngineDispatchResult = { accepted: boolean } | null;

export type UntrustedImportResult = { askMeId: string } | { accepted: false } | null;

/** Where a hook may append `hook.failed` when that directory is writable. */
export type HookEventLog = {
  hiveRoot?: string | null;
  featureId?: string | null;
};

type Registry = {
  learning: LearningHooks;
  token: TokenHooks;
  hire: HireHooks;
  engine: EngineHooks;
};

const registry: Registry = {
  learning: {},
  token: {},
  hire: {},
  engine: {},
};

/**
 * Install learning, token, hire, and engine hooks.
 * Each provided slice replaces that slice. The six guarded hooks are invoked
 * through the `safe*` functions: hive root is a call-site argument for four of
 * them, so the try/catch lives there rather than on the registered function.
 */
export function registerCommandPlaneHooks(partial: {
  learning?: LearningHooks;
  token?: TokenHooks;
  hire?: HireHooks;
  engine?: EngineHooks;
}): void {
  if (partial.learning) registry.learning = partial.learning;
  if (partial.token) registry.token = partial.token;
  if (partial.hire) registry.hire = partial.hire;
  if (partial.engine) registry.engine = partial.engine;
}

/** Missing `beforeDispatch` is skipped and allowed. A throw denies with `HOOK_FAILED_CLOSED`. */
export async function safeBeforeDispatch(ctx: DispatchContext): Promise<SafeBeforeDispatchResult> {
  const hook = registry.token.beforeDispatch;
  return failClosed(
    "beforeDispatch",
    { hiveRoot: ctx.intent.hiveRoot, featureId: ctx.intent.featureId },
    { allow: false, reason: HOOK_FAILED_CLOSED },
    hook ? () => hook(ctx) : undefined,
    { allow: true },
  );
}

/** Missing `dispatch` returns null (skipped). That null is not a host-engine decision. */
export async function safeEngineDispatch(intent: DispatchIntent): Promise<EngineDispatchResult> {
  const hook = registry.engine.dispatch;
  return failClosed(
    "dispatch",
    { hiveRoot: intent.hiveRoot, featureId: intent.featureId },
    { accepted: false },
    hook ? () => hook(intent) : undefined,
    null,
  );
}

export async function safeNormalizeEvent(
  raw: NormalizeEventInput,
  log: HookEventLog = {},
): Promise<IraEvent | null> {
  const hook = registry.engine.normalizeEvent;
  return failClosed("normalizeEvent", log, null, hook ? () => hook(raw) : undefined, null);
}

export async function safeOnRecordResult(ctx: DistillContext, log: HookEventLog = {}): Promise<void> {
  const hook = registry.token.onRecordResult;
  await failClosed(
    "onRecordResult",
    { hiveRoot: log.hiveRoot, featureId: ctx.featureId },
    undefined,
    hook ? () => hook(ctx) : undefined,
    undefined,
  );
}

export async function safeOnUntrustedImport(
  input: { featureId: string | null; agentId: string | null; detail: string },
  log: HookEventLog = {},
): Promise<UntrustedImportResult> {
  const hook = registry.hire.onUntrustedImport;
  return failClosed(
    "onUntrustedImport",
    { hiveRoot: log.hiveRoot, featureId: input.featureId },
    { accepted: false },
    hook ? () => hook(input) : undefined,
    null,
  );
}

export async function safeMatchCapabilities(
  task: { capabilityTags: string[] },
  roster: RosterAgent[],
  log: HookEventLog = {},
): Promise<RosterAgent | null> {
  const hook = registry.hire.matchCapabilities;
  return failClosed(
    "matchCapabilities",
    log,
    null,
    hook ? () => hook(task, roster) : undefined,
    null,
  );
}

async function failClosed<T>(
  hook: HookName,
  log: HookEventLog,
  deny: T,
  call: (() => T | Promise<T>) | undefined,
  skipped: T,
): Promise<T> {
  if (!call) return skipped;
  try {
    return await call();
  } catch {
    await recordHookFailed(log.hiveRoot ?? null, log.featureId ?? null, hook);
    return deny;
  }
}

async function recordHookFailed(hiveRoot: string | null, featureId: string | null, hook: HookName): Promise<void> {
  try {
    if (!hiveRoot) return;
    const file = writableEventLog(hiveRoot);
    if (!file) return;
    const event = {
      id: `evt_${randomUUID()}`,
      type: "hook.failed",
      version: 1 as const,
      ts: new Date().toISOString(),
      featureId: eventFeatureId(featureId),
      actor: { kind: "ira" as const, id: "ira" },
      data: { hook, reason: HOOK_FAILED_CLOSED },
    };
    const parsed = IraEventSchema.safeParse(event);
    if (!parsed.success) return;
    const locked = await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
      appendJsonlLine(file, parsed.data),
    );
    if (!locked.ok) return;
  } catch {
    // A log or lock failure stays inside the fail-closed boundary.
  }
}

function eventFeatureId(featureId: string | null): string | null {
  if (featureId === null) return null;
  return featureIdSchema.safeParse(featureId).success ? featureId : null;
}

/** Path of `events/events.jsonl` when that file can be appended; otherwise null. */
function writableEventLog(hiveRoot: string): string | null {
  const dir = join(hiveRoot, "events");
  const file = join(dir, "events.jsonl");
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    return null;
  }
  const existing = statFile(file);
  if (existing === "missing") return file;
  if (existing === "error" || !existing.isFile()) return null;
  try {
    accessSync(file, constants.W_OK);
    return file;
  } catch {
    return null;
  }
}

function statFile(path: string): Stats | "missing" | "error" {
  try {
    return statSync(path);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "error";
  }
}
