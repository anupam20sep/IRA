import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { buildToolDefinitions } from "../src/mcp-server.js";

describe("MCP tool definitions", () => {
  it("exposes the expected tool names", () => {
    const names = buildToolDefinitions().map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "ask-me-answer",
        "ask-me-list",
        "ask-me-show",
        "autonomy-set",
        "autonomy-show",
        "away-set",
        "away-tick",
        "begin-task",
        "brief-show",
        "brief-submit",
        "build-matrix",
        "coordinator-brief",
        "dispatch-task",
        "doctor",
        "forge-status",
        "hive-ci-set",
        "hive-init",
        "hive-status",
        "hive-sync",
        "init",
        "lint-design",
        "lint-plan",
        "lint-spec",
        "list-personas",
        "mailbox-post",
        "mailbox-read",
        "next-task",
        "record-result",
        "roster-list",
        "route-model",
        "scaffold",
        "sync-status",
        "task-abort",
        "task-hold",
      ].sort(),
    );
  });

  it("build-matrix handler returns matrix + gaps as JSON text", async () => {
    const tool = buildToolDefinitions().find((t) => t.name === "build-matrix")!;
    const res = await tool.handler({
      specText: "- **FR-001**: a\n- **FR-002**: b",
      planText: "### Task T001: x\n**Implements:** FR-001",
    });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.gaps).toEqual(["FR-002"]);
  });

  it("route-model handler routes complex to frontier with strong shim", async () => {
    const tool = buildToolDefinitions().find((t) => t.name === "route-model")!;
    const res = await tool.handler({ complexity: "complex" });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.tier).toBe("frontier");
    expect(payload.model).toBe("strong");
    expect(payload.slug).toBeTruthy();
    expect(payload.thinkingHint).toBe("high");
    expect(payload.source).toBe("builtin");
  });

  it("route-model handler routes moderate to standard (shim strong)", async () => {
    const tool = buildToolDefinitions().find((t) => t.name === "route-model")!;
    const res = await tool.handler({ complexity: "moderate" });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.tier).toBe("standard");
    expect(payload.model).toBe("strong");
  });

  it("route-model handler routes mechanical to economy (shim fast)", async () => {
    const tool = buildToolDefinitions().find((t) => t.name === "route-model")!;
    const res = await tool.handler({ complexity: "mechanical", harness: "claude" });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.tier).toBe("economy");
    expect(payload.model).toBe("fast");
    expect(payload.harness).toBe("claude");
    expect(payload.slug).toBe("haiku");
  });

  it("route-model schema accepts role, attempt, kind, harness, projectRoot", () => {
    const tool = buildToolDefinitions().find((t) => t.name === "route-model")!;
    const schema = z.object(tool.schema);
    expect(() =>
      schema.parse({
        complexity: "moderate",
        role: "reviewer",
        attempt: 2,
        kind: "code",
        harness: "codex",
        projectRoot: "/tmp/proj",
      }),
    ).not.toThrow();
    expect(() => schema.parse({ complexity: "complex" })).not.toThrow();
  });
});

const FORGE_PLAN =
  "### Task T001: First\n**Implements:** FR-001\n\n### Task T002: Second\n**Implements:** FR-002\n**Depends on:** T001\n";

describe("forge loop MCP tools persisted round-trip", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "superspec-mcp-forge-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("next-task, record-result, and forge-status persist state across calls", async () => {
    const nextTool = buildToolDefinitions().find((t) => t.name === "next-task")!;
    const recordTool = buildToolDefinitions().find((t) => t.name === "record-result")!;
    const statusTool = buildToolDefinitions().find((t) => t.name === "forge-status")!;

    const first = JSON.parse(
      (await nextTool.handler({ planText: FORGE_PLAN, stateDir: root, verbose: false })).content[0].text,
    );
    expect(first.task.id).toBe("T001");

    await recordTool.handler({
      planText: FORGE_PLAN,
      stateDir: root,
      taskId: "T001",
      passed: true,
    });

    const second = JSON.parse(
      (await nextTool.handler({ planText: FORGE_PLAN, stateDir: root, verbose: false })).content[0].text,
    );
    expect(second.task.id).toBe("T002");

    const status = JSON.parse(
      (await statusTool.handler({ planText: FORGE_PLAN, stateDir: root, verbose: false })).content[0]
        .text,
    );
    expect(status).toMatchObject({
      total: 2,
      done: 1,
      blocked: 0,
      pending: 1,
      inProgress: 0,
      complete: false,
    });
  });

  it("forge-status without stateDir uses fresh state", async () => {
    const statusTool = buildToolDefinitions().find((t) => t.name === "forge-status")!;
    const status = JSON.parse(
      (await statusTool.handler({ planText: FORGE_PLAN, verbose: false })).content[0].text,
    );
    expect(status).toMatchObject({
      total: 2,
      done: 0,
      blocked: 0,
      pending: 2,
      inProgress: 0,
      complete: false,
    });
  });
});

describe("list-personas MCP tool", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "superspec-mcp-persona-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("discovers personas from claude and cursor agents dirs", async () => {
    const claudeDir = join(root, ".claude", "agents");
    const cursorDir = join(root, ".cursor", "agents");
    await mkdir(claudeDir, { recursive: true });
    await mkdir(cursorDir, { recursive: true });
    await writeFile(
      join(claudeDir, "backend-developer.md"),
      "---\nname: backend-developer\ndescription: Server-side work.\n---\n\nBody",
      "utf8",
    );
    await writeFile(
      join(cursorDir, "frontend-developer.md"),
      "---\nname: frontend-developer\ndescription: UI work.\n---\n\nBody",
      "utf8",
    );

    const tool = buildToolDefinitions().find((t) => t.name === "list-personas")!;
    const res = await tool.handler({
      claudeAgentsDir: claudeDir,
      cursorAgentsDir: cursorDir,
      includeDefaults: false,
    });
    const payload = JSON.parse(res.content[0].text);

    expect(payload).toHaveLength(2);
    expect(payload.map((p: { name: string }) => p.name).sort()).toEqual([
      "backend-developer",
      "frontend-developer",
    ]);
  });

  it("defaults to projectRoot agent dirs without explicit paths", async () => {
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeFile(
      join(root, ".claude", "agents", "backend.md"),
      "---\nname: backend\ndescription: API.\n---\n\nBody",
      "utf8",
    );

    const tool = buildToolDefinitions().find((t) => t.name === "list-personas")!;
    const res = await tool.handler({ projectRoot: root, includeHome: false });
    const payload = JSON.parse(res.content[0].text);

    expect(payload.some((p: { name: string }) => p.name === "backend")).toBe(true);
  });

  it("returns [] when defaults are disabled and no dirs passed", async () => {
    const tool = buildToolDefinitions().find((t) => t.name === "list-personas")!;
    const res = await tool.handler({ includeDefaults: false });
    expect(JSON.parse(res.content[0].text)).toEqual([]);
  });
});

describe("mcp command-plane tools", () => {
  it("registers dispatch-task, task-hold, task-abort, doctor, and hive-init", () => {
    const names = buildToolDefinitions().map((t) => t.name);
    for (const name of ["dispatch-task", "task-hold", "task-abort", "doctor", "hive-init"] as const) {
      expect(names).toContain(name);
    }
  });

  it("dispatch-task schema matches design request fields", () => {
    const tool = buildToolDefinitions().find((t) => t.name === "dispatch-task")!;
    const schema = z.object(tool.schema);
    expect(() =>
      schema.parse({
        featureId: "001-demo",
        taskId: "T001",
        cwd: "/tmp/proj",
      }),
    ).not.toThrow();
  });

  it("task-hold and task-abort schemas match design", () => {
    const hold = buildToolDefinitions().find((t) => t.name === "task-hold")!;
    const abort = buildToolDefinitions().find((t) => t.name === "task-abort")!;
    expect(() =>
      z.object(hold.schema).parse({ featureId: "001-demo", taskId: "T001", hold: true }),
    ).not.toThrow();
    expect(() =>
      z
        .object(abort.schema)
        .parse({ featureId: "001-demo", taskId: "T001", confirm: true, abortReason: "stop" }),
    ).not.toThrow();
  });

  it("build-matrix still works when hive is absent (forge tools preserved)", async () => {
    const tool = buildToolDefinitions().find((t) => t.name === "build-matrix")!;
    const res = await tool.handler({
      specText: "- **FR-001**: a",
      planText: "### Task T001: x\n**Implements:** FR-001",
    });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.gaps).toEqual([]);
  });
});
