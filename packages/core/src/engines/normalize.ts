/**
 * Map vendor hook, ACP, PTY, and jsonl observations onto hive `engine.*` events.
 * Token counts are copied only when the payload already has numeric values.
 */

import { randomUUID } from "node:crypto";
import { IraEventSchema } from "../command-plane/schema.js";
import type { IraEvent } from "../command-plane/types.js";
import { redactMessage } from "./redact.js";

export type NormalizeEngineContext = {
  agentId: string;
  engineId: string;
  taskId: string;
  sessionId: string;
  featureId?: string | null;
};

type EngineKind = "start" | "tool" | "stop" | "error" | "tokens";
type VendorChannel = "hooks" | "acp" | "pty" | "jsonl";

type ResolvedEvent = {
  kind: EngineKind;
  channel: VendorChannel;
  nonZeroExit: boolean;
};

const MESSAGE_MAX = 500;
const FEATURE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const AIDER_TOKENS = /^Tokens: (\d+) sent, (\d+) received\.?$/;

const REASON_CLASSES = new Set([
  "rate_limited",
  "quota_exhausted",
  "missing",
  "unauthorized",
  "context_below_floor",
  "model_rejected",
  "spawn_failed",
  "adapter_crash",
  "unknown",
]);

const ALIASES: Record<string, { kind: EngineKind; channel: VendorChannel }> = {
  start: { kind: "start", channel: "jsonl" },
  tool: { kind: "tool", channel: "jsonl" },
  stop: { kind: "stop", channel: "jsonl" },
  error: { kind: "error", channel: "jsonl" },
  tokens: { kind: "tokens", channel: "jsonl" },
  "engine.start": { kind: "start", channel: "jsonl" },
  "engine.tool": { kind: "tool", channel: "jsonl" },
  "engine.stop": { kind: "stop", channel: "jsonl" },
  "engine.error": { kind: "error", channel: "jsonl" },
  "engine.tokens": { kind: "tokens", channel: "jsonl" },
  SessionStart: { kind: "start", channel: "hooks" },
  sessionStart: { kind: "start", channel: "hooks" },
  session_start: { kind: "start", channel: "hooks" },
  PreToolUse: { kind: "tool", channel: "hooks" },
  PostToolUse: { kind: "tool", channel: "hooks" },
  preToolUse: { kind: "tool", channel: "hooks" },
  postToolUse: { kind: "tool", channel: "hooks" },
  beforeShellExecution: { kind: "tool", channel: "hooks" },
  afterShellExecution: { kind: "tool", channel: "hooks" },
  beforeMCPExecution: { kind: "tool", channel: "hooks" },
  afterMCPExecution: { kind: "tool", channel: "hooks" },
  Stop: { kind: "stop", channel: "hooks" },
  sessionEnd: { kind: "stop", channel: "hooks" },
  "session/new": { kind: "start", channel: "acp" },
  "session/load": { kind: "start", channel: "acp" },
  tool_call: { kind: "tool", channel: "acp" },
  tool_call_update: { kind: "tool", channel: "acp" },
  usage: { kind: "tokens", channel: "acp" },
  shutdown: { kind: "stop", channel: "acp" },
  "session/shutdown": { kind: "stop", channel: "acp" },
  "session/close": { kind: "stop", channel: "acp" },
};

/** Session ids that already emitted `engine.start` in this process. */
const startedSessionIds = new Set<string>();

/** Clears in-process start dedupe so a session id can start again. */
export function resetEngineStartDedupe(): void {
  startedSessionIds.clear();
}

export function normalizeEngineEvent(raw: unknown, ctx: NormalizeEngineContext): IraEvent | null {
  const record = asRecord(raw);
  if (!record || !validContext(ctx)) return null;

  const resolved = resolveEvent(record);
  if (!resolved) return null;
  if (resolved.kind === "start" && startedSessionIds.has(ctx.sessionId)) return null;

  const data = eventData(resolved, record, ctx);
  if (!data) return null;

  const featureId = ctx.featureId && FEATURE_ID.test(ctx.featureId) ? ctx.featureId : null;
  const parsed = IraEventSchema.safeParse({
    id: `evt_${randomUUID()}`,
    type: `engine.${resolved.kind}`,
    version: 1,
    ts: new Date().toISOString(),
    featureId,
    actor: { kind: "worker", id: ctx.agentId },
    data,
  });
  if (!parsed.success) return null;
  if (resolved.kind === "start") startedSessionIds.add(ctx.sessionId);
  return parsed.data;
}

function validContext(ctx: NormalizeEngineContext): boolean {
  return [ctx.agentId, ctx.engineId, ctx.taskId, ctx.sessionId].every(
    (value) => typeof value === "string" && value.length > 0,
  );
}

function resolveEvent(raw: Record<string, unknown>): ResolvedEvent | null {
  for (const name of aliasCandidates(raw)) {
    if (name === "exit") {
      const code = readExitCode(raw);
      if (code === null) return null;
      return {
        kind: code === 0 ? "stop" : "error",
        channel: "pty",
        nonZeroExit: code !== 0,
      };
    }
    const alias = ALIASES[name];
    if (alias) return { ...alias, nonZeroExit: false };
  }
  if (aiderCounts(raw)) return { kind: "tokens", channel: "pty", nonZeroExit: false };
  if (asRecord(raw.error) || typeof raw.error === "string") {
    return { kind: "error", channel: "acp", nonZeroExit: false };
  }
  return null;
}

function aliasCandidates(raw: Record<string, unknown>): string[] {
  const data = asRecord(raw.data);
  const params = asRecord(raw.params);
  const update = asRecord(params?.update);
  const names = [
    update?.sessionUpdate,
    data?.sessionUpdate,
    raw.hook_event_name,
    raw.type,
    data?.type,
    raw.method,
  ];
  return names.filter((name): name is string => typeof name === "string" && name.length > 0);
}

function eventData(
  resolved: ResolvedEvent,
  raw: Record<string, unknown>,
  ctx: NormalizeEngineContext,
): Record<string, unknown> | null {
  const view = viewOf(raw);
  const identity = {
    agentId: ctx.agentId,
    engineId: ctx.engineId,
    taskId: ctx.taskId,
    sessionId: ctx.sessionId,
  };

  switch (resolved.kind) {
    case "start":
      return identity;
    case "tool": {
      const toolName = readToolName(view);
      if (!toolName) return null;
      return { ...identity, toolName, status: readToolStatus(view) };
    }
    case "stop": {
      const exitCode = readExitCode(raw);
      if (exitCode === null) return null;
      return { ...identity, exitCode };
    }
    case "error":
      return {
        ...identity,
        reasonClass: readReason(view, resolved.nonZeroExit),
        message: readMessage(view),
      };
    case "tokens": {
      const counts = readTokenCounts(raw);
      if (!counts) return null;
      return {
        ...identity,
        inputTokens: counts.input,
        outputTokens: counts.output,
        source: tokenSource(view, resolved.channel),
      };
    }
  }
}

function viewOf(raw: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(raw.data) ?? {};
  const params = asRecord(raw.params) ?? {};
  const update = asRecord(params.update) ?? {};
  const usage =
    asRecord(data.usage) ?? asRecord(params.usage) ?? asRecord(update.usage) ?? asRecord(raw.usage) ?? {};
  return { ...raw, ...params, ...update, ...data, ...usage };
}

function readToolName(view: Record<string, unknown>): string | null {
  for (const key of ["toolName", "tool_name", "title"]) {
    const value = view[key];
    if (typeof value === "string" && value.trim().length > 0 && value.length <= 200) return value;
  }
  return null;
}

function readToolStatus(view: Record<string, unknown>): "ok" | "error" {
  const status = view.status ?? view.tool_status;
  if (status === "error" || status === "failed" || status === "failure") return "error";
  if (view.is_error === true || view.isError === true) return "error";
  const response = asRecord(view.tool_response);
  if (response && (response.is_error === true || response.isError === true)) return "error";
  return "ok";
}

function readExitCode(raw: Record<string, unknown>): number | null {
  const view = viewOf(raw);
  if ("exitCode" in view || "exit_code" in view) {
    const value = view.exitCode ?? view.exit_code;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  // Vendor Stop / shutdown observations often omit a code. That is an orderly exit.
  return 0;
}

function readReason(view: Record<string, unknown>, nonZeroExit: boolean): string {
  const value = view.reasonClass;
  if (typeof value === "string" && REASON_CLASSES.has(value)) return value;
  return nonZeroExit ? "adapter_crash" : "unknown";
}

function readMessage(view: Record<string, unknown>): string {
  if (typeof view.message === "string") return redactMessage(view.message).slice(0, MESSAGE_MAX);
  if (typeof view.error === "string") return redactMessage(view.error).slice(0, MESSAGE_MAX);
  const nested = asRecord(view.error);
  if (nested && typeof nested.message === "string") {
    return redactMessage(nested.message).slice(0, MESSAGE_MAX);
  }
  return "";
}

function readTokenCounts(raw: Record<string, unknown>): { input: number; output: number } | null {
  const view = viewOf(raw);
  const hasExplicit =
    "inputTokens" in view ||
    "outputTokens" in view ||
    "input_tokens" in view ||
    "output_tokens" in view;
  if (hasExplicit) {
    const input = finiteCount(view.inputTokens ?? view.input_tokens);
    const output = finiteCount(view.outputTokens ?? view.output_tokens);
    if (input === null || output === null) return null;
    return { input, output };
  }
  return aiderCounts(raw);
}

function finiteCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function aiderCounts(raw: Record<string, unknown>): { input: number; output: number } | null {
  const data = asRecord(raw.data);
  const line = typeof raw.line === "string" ? raw.line : typeof data?.line === "string" ? data.line : null;
  if (!line) return null;
  const match = AIDER_TOKENS.exec(line.trim());
  if (!match) return null;
  return { input: Number(match[1]), output: Number(match[2]) };
}

function tokenSource(view: Record<string, unknown>, channel: VendorChannel): "transcript" | "api" {
  if (view.source === "transcript" || view.source === "api") return view.source;
  return channel === "acp" ? "api" : "transcript";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
