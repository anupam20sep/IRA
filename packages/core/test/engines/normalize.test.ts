import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { IraEventSchema } from "../../src/command-plane/schema.js";
import { normalizeEngineEvent, resetEngineStartDedupe } from "../../src/engines/normalize.js";

const sessionStart = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "hook-session-start.json"), "utf8"),
);

const ctx = { agentId: "a1", engineId: "codex", taskId: "T001", sessionId: "ses_1" };

function withSession(sessionId: string, engineId = ctx.engineId) {
  return { ...ctx, engineId, sessionId };
}

beforeEach(() => {
  resetEngineStartDedupe();
});

describe("normalizeEngineEvent", () => {
  it("returns null for tokens payload without numeric counts", () => {
    const ev = normalizeEngineEvent(
      { type: "tokens", data: { inputTokens: "nope" } },
      { agentId: "a1", engineId: "codex", taskId: "T001", sessionId: "ses_1" },
    );
    expect(ev).toBeNull();
  });

  it("returns null when a token count is missing or not a number", () => {
    expect(
      normalizeEngineEvent({ type: "tokens", data: { inputTokens: 4 } }, withSession("ses_missing")),
    ).toBeNull();
    expect(
      normalizeEngineEvent(
        { type: "tokens", data: { inputTokens: "12", outputTokens: "3" } },
        withSession("ses_strings"),
      ),
    ).toBeNull();
    expect(normalizeEngineEvent({ type: "tokens", data: {} }, withSession("ses_empty"))).toBeNull();
  });

  it("keeps reported numeric token counts including zero", () => {
    const ev = normalizeEngineEvent(
      { type: "tokens", data: { inputTokens: 0, outputTokens: 8, source: "transcript" } },
      withSession("ses_zero"),
    );
    expect(ev?.type).toBe("engine.tokens");
    expect(ev?.data).toMatchObject({
      agentId: "a1",
      engineId: "codex",
      taskId: "T001",
      sessionId: "ses_zero",
      inputTokens: 0,
      outputTokens: 8,
      source: "transcript",
    });
    expect(IraEventSchema.parse(ev).version).toBe(1);
  });

  it("maps the hook session-start fixture and strips non-allowlisted fields", () => {
    const ev = normalizeEngineEvent(sessionStart, withSession("ses_hook", "claude"));
    expect(ev?.type).toBe("engine.start");
    expect(ev?.actor).toEqual({ kind: "worker", id: "a1" });
    expect(ev?.data).toEqual({
      agentId: "a1",
      engineId: "claude",
      taskId: "T001",
      sessionId: "ses_hook",
    });
    expect(IraEventSchema.parse(ev)).toMatchObject({ type: "engine.start", version: 1 });
  });

  it("maps hook, ACP, PTY, and jsonl vendor aliases", () => {
    expect(
      normalizeEngineEvent({ hook_event_name: "sessionStart" }, withSession("ses_cursor", "cursor-agent"))
        ?.type,
    ).toBe("engine.start");

    const tool = normalizeEngineEvent(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls" },
        prompt: "hidden",
        stdout: "listing",
      },
      withSession("ses_tool"),
    );
    expect(tool?.type).toBe("engine.tool");
    expect(tool?.data).toEqual({
      agentId: "a1",
      engineId: "codex",
      taskId: "T001",
      sessionId: "ses_tool",
      toolName: "Bash",
      status: "ok",
    });

    const acp = normalizeEngineEvent(
      {
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call_update",
            title: "Read",
            status: "failed",
            rawInput: { path: "/etc/passwd" },
          },
        },
      },
      withSession("ses_acp", "opencode"),
    );
    expect(acp?.data).toMatchObject({ toolName: "Read", status: "error", engineId: "opencode" });
    expect(acp?.data).not.toHaveProperty("rawInput");

    const usage = normalizeEngineEvent(
      { method: "usage", params: { usage: { input_tokens: 3, output_tokens: 9 } } },
      withSession("ses_usage", "crush"),
    );
    expect(usage?.type).toBe("engine.tokens");
    expect(usage?.data).toMatchObject({ inputTokens: 3, outputTokens: 9, source: "api" });

    const aider = normalizeEngineEvent(
      { line: "Tokens: 12 sent, 34 received" },
      withSession("ses_aider", "aider"),
    );
    expect(aider?.data).toMatchObject({
      inputTokens: 12,
      outputTokens: 34,
      source: "transcript",
      engineId: "aider",
    });

    const jsonl = normalizeEngineEvent(
      { type: "engine.stop", data: { exitCode: 0, prompt: "nope", diff: "+++ " } },
      withSession("ses_jsonl", "custom"),
    );
    expect(jsonl?.type).toBe("engine.stop");
    expect(jsonl?.data).toEqual({
      agentId: "a1",
      engineId: "custom",
      taskId: "T001",
      sessionId: "ses_jsonl",
      exitCode: 0,
    });
  });

  it("returns null for a second start on the same session and for unknown types", () => {
    const session = withSession("ses_dup");
    expect(normalizeEngineEvent({ type: "start" }, session)?.type).toBe("engine.start");
    expect(normalizeEngineEvent({ hook_event_name: "SessionStart" }, session)).toBeNull();
    expect(normalizeEngineEvent({ type: "engine.failover" }, withSession("ses_other"))).toBeNull();
    expect(normalizeEngineEvent({ type: "spinner" }, withSession("ses_spin"))).toBeNull();
  });

  it("redacts error text, caps it at 500 characters, and keeps reasonClass on the enum", () => {
    const leaked = `boom sk-abc123secret ${"x".repeat(600)}`;
    const ev = normalizeEngineEvent(
      { type: "error", data: { reasonClass: "a raw vendor paragraph", message: leaked } },
      withSession("ses_err"),
    );
    expect(ev?.type).toBe("engine.error");
    expect(ev?.data.reasonClass).toBe("unknown");
    expect(ev?.data.message).not.toContain("sk-abc");
    expect(String(ev?.data.message)).toContain("[redacted]");
    expect(String(ev?.data.message).length).toBeLessThanOrEqual(500);

    const known = normalizeEngineEvent(
      { type: "error", data: { reasonClass: "rate_limited", message: "api_key=supersecret slow" } },
      withSession("ses_rate"),
    );
    expect(known?.data.reasonClass).toBe("rate_limited");
    expect(known?.data.message).not.toContain("supersecret");
  });

  it("maps a JSON-RPC error object to engine.error without copying the payload", () => {
    const ev = normalizeEngineEvent(
      { jsonrpc: "2.0", id: 4, error: { code: -32000, message: "nope token=abc", data: { prompt: "hidden" } } },
      withSession("ses_rpc", "opencode"),
    );
    expect(ev?.type).toBe("engine.error");
    expect(ev?.data.reasonClass).toBe("unknown");
    expect(ev?.data.message).not.toContain("abc");
    expect(ev?.data).not.toHaveProperty("prompt");
    expect(ev?.data).not.toHaveProperty("data");
  });

  it("maps a non-zero exit to engine.error and does not invent token zeros", () => {
    const crashed = normalizeEngineEvent(
      { type: "exit", data: { exitCode: 2, message: "ghp_abcdefghijklmnopqrstuvwxyz" } },
      withSession("ses_crash", "aider"),
    );
    expect(crashed?.type).toBe("engine.error");
    expect(crashed?.data.reasonClass).toBe("adapter_crash");
    expect(crashed?.data.message).not.toContain("ghp_");

    const clean = normalizeEngineEvent({ type: "exit", data: { exitCode: 0 } }, withSession("ses_ok", "aider"));
    expect(clean?.type).toBe("engine.stop");
    expect(clean?.data.exitCode).toBe(0);
  });
});
