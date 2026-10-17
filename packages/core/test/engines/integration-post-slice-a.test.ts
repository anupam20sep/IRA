import { describe, expect, it } from "vitest";
import { SUPERVISOR_ENV_BASE_ALLOWLIST } from "../../src/engines/env-scrub.js";
import { runPostSliceAFixture, type HiveEvent } from "./helpers/post-slice-a-fixture.js";

const CREDENTIAL_NAME = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/;
const BASE_ALLOWLIST = new Set<string>(SUPERVISOR_ENV_BASE_ALLOWLIST);

describe("integration post Slice A", () => {
  it("accepts opencode dispatch when sliceAValidated is true", async () => {
    const { runPostSliceAFixture: loadFixture } = await import("./helpers/post-slice-a-fixture.js");
    const r = await loadFixture("opencode-accepted");
    expect(r.accepted).toBe(true);
    expect(r.dispatchResult).toEqual({ accepted: true });
    expect(r.supervisorPid).not.toBe(r.mcpPid);
    expect(r.detached).toBe(true);
    expect(r.shell).toBe(false);
    expect(r.stdio).toBe("ignore");
    expect(usesMcpPipes(r.stdio)).toBe(false);
    expect(r.argv).toEqual(["superspec", "engines", "supervise", expect.any(String)]);
    expect(Object.keys(r.env).every((name) => BASE_ALLOWLIST.has(name) || name === "OPENAI_API_KEY")).toBe(true);
    expect(r.env.PATH).toBe("/usr/bin");
    expect(r.env.OPENAI_API_KEY).toBe("sk-openai");
    expect(r.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(r.env.GITHUB_TOKEN).toBeUndefined();
    expect(r.env.MY_SECRET).toBeUndefined();
    expect(r.env.DB_PASSWORD).toBeUndefined();
    expect(r.env.AWS_CREDENTIAL).toBeUndefined();
    expect(r.env.NODE_ENV).toBeUndefined();
    expect(r.env.HOST).toBeUndefined();
  });

  it("drops credential-like env names on a non-BYOK rung", async () => {
    const r = await runPostSliceAFixture("env-scrub-non-byok");
    expect(r.accepted).toBe(true);
    expect(r.supervisorPid).not.toBe(r.mcpPid);
    expect(r.stdio).toBe("ignore");
    expect(usesMcpPipes(r.stdio)).toBe(false);
    expect(r.env.PATH).toBe("/usr/bin");
    expect(r.env.HOME).toBe("/Users/ira");
    for (const name of Object.keys(r.env)) {
      expect(BASE_ALLOWLIST.has(name)).toBe(true);
      expect(name).not.toMatch(CREDENTIAL_NAME);
    }
    expect(r.env.OPENAI_API_KEY).toBeUndefined();
    expect(r.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(r.env.GITHUB_TOKEN).toBeUndefined();
    expect(r.env.DB_PASSWORD).toBeUndefined();
    expect(r.env.AWS_CREDENTIAL).toBeUndefined();
  });

  it("writes engine.failover before engine.start", async () => {
    const r = await runPostSliceAFixture("failover-before-start");
    expect(r.accepted).toBe(true);
    expect(r.supervisorPid).not.toBe(r.mcpPid);
    expect(usesMcpPipes(r.stdio)).toBe(false);
    const failoverAtSpawn = r.eventsAtSpawn.find((event) => event.type === "engine.failover");
    expect(failoverAtSpawn?.data).toMatchObject({
      fromEngine: "claude",
      toEngine: "aider",
      reasonClass: "missing",
      rung: "byok",
    });
    expect(r.eventsAtSpawn.some((event) => event.type === "engine.start")).toBe(false);
    const failoverIndex = eventIndex(r.events, "engine.failover");
    const startIndex = eventIndex(r.events, "engine.start");
    expect(failoverIndex).toBeGreaterThanOrEqual(0);
    expect(startIndex).toBeGreaterThan(failoverIndex);
  });

  it("records cross-engine review degrade when only one engine is healthy", async () => {
    const r = await runPostSliceAFixture("review-degraded");
    expect(r.accepted).toBe(true);
    expect(r.supervisorPid).not.toBe(r.mcpPid);
    expect(r.stdio).toBe("ignore");
    const degraded = r.events.find((event) => event.type === "engine.policy_degraded");
    expect(degraded?.data).toMatchObject({
      taskId: "T023",
      policy: "cross_engine_review",
      reason: "single_healthy_engine",
      engineId: "opencode",
    });
  });
});

function usesMcpPipes(stdio: unknown): boolean {
  if (stdio === "pipe" || stdio === "inherit" || stdio === "overlapped") return true;
  if (stdio === process.stdin || stdio === process.stdout || stdio === process.stderr) return true;
  if (!Array.isArray(stdio)) return false;
  return stdio.some(
    (entry) =>
      entry === "pipe" || entry === process.stdin || entry === process.stdout || entry === process.stderr,
  );
}

function eventIndex(events: HiveEvent[], type: string): number {
  return events.findIndex((event) => event.type === type);
}
