import { request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardSnapshot, SnapshotAgent, SnapshotTask } from "../src/shared/snapshot-types.js";

vi.mock("../src/server/cli.js", () => ({
  runSuperspec: vi.fn(),
}));

vi.mock("../src/server/snapshot.js", () => ({
  buildSnapshot: vi.fn(),
}));

import { runSuperspec } from "../src/server/cli.js";
import { createApp } from "../src/server/main.js";
import { buildSnapshot } from "../src/server/snapshot.js";

const FEATURE = "002-ira-command-center";
const TASK = "T012";
const TOKEN = "loopback-secret-do-not-echo";

let repo: string;
let hiveRoot: string;
const servers: Server[] = [];

function task(overrides: Partial<SnapshotTask> = {}): SnapshotTask {
  return {
    id: TASK,
    featureId: FEATURE,
    title: TASK,
    implementsFr: ["FR-010"],
    dependsOn: [],
    assigneeAgentId: null,
    status: "todo",
    kind: "code",
    complexity: "complex",
    reviewFailures: 0,
    hold: false,
    ceiling: 3,
    blockedByAskMeId: null,
    drift: "ok",
    capabilityTags: [],
    updatedAt: "2026-10-16T00:00:00.000Z",
    readiness: "ready",
    ...overrides,
  };
}

function agent(overrides: Partial<SnapshotAgent> = {}): SnapshotAgent {
  return {
    id: "agent-host",
    name: "Host",
    personaPath: null,
    capabilityTags: [],
    engine: "host",
    model: null,
    workspace: null,
    worktreePolicy: "shared",
    status: "idle",
    origin: "placeholder",
    currentTaskId: null,
    ...overrides,
  };
}

function snapshot(row: SnapshotTask = task(), agents: SnapshotAgent[] = []): BoardSnapshot {
  return {
    ok: true,
    generatedAt: "2026-10-16T00:00:00.000Z",
    stale: false,
    repositoryRoot: repo,
    hiveRoot,
    persona: { callsign: "Ira", expansion: "Intelligent Resource Automation" },
    doctor: { ok: true, hiveReady: true, engineRungReady: true, ready: true, findings: [] },
    autonomy: { autonomy: "supervised", awayMode: false, pollIntervalMs: 60000 },
    features: [
      {
        featureId: FEATURE,
        taskCounts: { todo: 1, doing: 0, blocked: 0, done: 0 },
        openAskMe: 0,
        tasks: [row],
        brief: null,
      },
    ],
    agents,
    askMe: [],
    events: [],
  };
}

async function writeLoopbackToken(root: string, token: string): Promise<void> {
  const authDir = join(root, "auth");
  await mkdir(authDir, { recursive: true });
  await chmod(authDir, 0o700);
  const tokenPath = join(authDir, "loopback.token");
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600);
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
    server.once("error", reject);
  });
}

async function boot(staticRoot?: string): Promise<number> {
  const server = createApp({
    host: "127.0.0.1",
    repositoryRoot: repo,
    hiveRoot,
    staticRoot,
  });
  servers.push(server);
  return listen(server);
}

type HttpResult = { status: number; body: string; headers: IncomingMessage["headers"] };

function send(
  port: number,
  init: { method?: string; path: string; headers?: Record<string, string>; body?: unknown },
): Promise<HttpResult> {
  const payload = init.body === undefined ? undefined : Buffer.from(JSON.stringify(init.body));
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: init.method ?? "GET",
        path: init.path,
        headers: {
          ...(payload
            ? { "content-type": "application/json", "content-length": String(payload.length) }
            : {}),
          ...init.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function authed(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}` };
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "cc-http-"));
  hiveRoot = join(repo, ".superspec", "hive");
  await mkdir(hiveRoot, { recursive: true });
  await writeLoopbackToken(hiveRoot, TOKEN);
  vi.mocked(runSuperspec).mockReset();
  vi.mocked(buildSnapshot).mockReset();
  vi.mocked(runSuperspec).mockResolvedValue({ ok: true, json: { ok: true } });
  vi.mocked(buildSnapshot).mockImplementation(async () => snapshot());
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("createApp bind", () => {
  it("refuses a non-loopback host", () => {
    for (const host of ["0.0.0.0", "192.168.1.9"]) {
      expect(() => createApp({ host, repositoryRoot: repo, hiveRoot })).toThrow(/127\.0\.0\.1/);
    }
  });

  it("accepts 127.0.0.1", () => {
    const server = createApp({ host: "127.0.0.1", repositoryRoot: repo, hiveRoot });
    servers.push(server);
    expect(server.listening).toBe(false);
  });
});

describe("mutation auth", () => {
  it("returns 401 TOKEN_REQUIRED for an unauthenticated dispatch and does not spawn CLI", async () => {
    const port = await boot();
    const res = await send(port, {
      method: "POST",
      path: "/api/tasks/dispatch",
      body: { featureId: FEATURE, taskId: TASK },
    });

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: false,
      error: "TOKEN_REQUIRED",
    });
    expect(res.body).not.toContain(TOKEN);
    expect(runSuperspec).not.toHaveBeenCalled();
    expect(buildSnapshot).not.toHaveBeenCalled();
  });

  it("rejects every other mutation without a bearer and does not spawn CLI", async () => {
    const port = await boot();
    for (const path of [
      "/api/brief",
      "/api/ask-me/answer",
      "/api/tasks/pause",
      "/api/tasks/abort",
      "/api/tasks/reassign",
    ]) {
      const res = await send(port, { method: "POST", path, body: { featureId: FEATURE } });
      expect(res.status, path).toBe(401);
      expect(JSON.parse(res.body).error).toBe("TOKEN_REQUIRED");
    }
    expect(runSuperspec).not.toHaveBeenCalled();
    expect(buildSnapshot).not.toHaveBeenCalled();
  });
});

describe("reads", () => {
  it("reports loopback health without reading the hive", async () => {
    const port = await boot();
    const res = await send(port, { path: "/api/health" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, bind: "127.0.0.1", port });
    expect(runSuperspec).not.toHaveBeenCalled();
    expect(res.body).not.toContain(TOKEN);
  });

  it("returns the snapshot and forwards the event page query", async () => {
    const board = snapshot();
    vi.mocked(buildSnapshot).mockResolvedValue(board);
    const port = await boot();
    const res = await send(port, { path: "/api/snapshot?eventsBefore=evt_9&limit=50" });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(board);
    expect(buildSnapshot).toHaveBeenCalledWith({
      repositoryRoot: repo,
      hiveRoot,
      eventsBefore: "evt_9",
      eventLimit: 50,
    });
    expect(res.body).not.toContain(TOKEN);
  });

  it("opens an SSE stream that does not echo the token", async () => {
    const port = await boot();
    const chunk = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        { host: "127.0.0.1", port, path: "/api/events", method: "GET" },
        (res) => {
          expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
          res.once("data", (data: Buffer) => {
            resolve(String(data));
            req.destroy();
          });
        },
      );
      req.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ECONNRESET") return;
        reject(err);
      });
      req.end();
    });

    expect(chunk).toContain("event: snapshot");
    expect(chunk).not.toContain(TOKEN);
  });

  it("serves static files and refuses paths that escape the root", async () => {
    const staticRoot = join(repo, "public");
    await mkdir(staticRoot);
    await writeFile(join(staticRoot, "index.html"), "<p>board</p>");
    await writeFile(join(repo, "secret.txt"), "TOP-SECRET-FILE");
    const port = await boot(staticRoot);

    const page = await send(port, { path: "/" });
    expect(page.status).toBe(200);
    expect(page.body).toContain("board");

    const escaped = await send(port, { path: "/../secret.txt" });
    expect(escaped.body).not.toContain("TOP-SECRET-FILE");
  });
});

describe("steer and plane mutations", () => {
  it("dispatches through dispatch-task after the bearer check", async () => {
    const port = await boot();
    const res = await send(port, {
      method: "POST",
      path: "/api/tasks/dispatch",
      headers: authed(),
      body: { featureId: FEATURE, taskId: TASK },
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(runSuperspec).toHaveBeenCalledWith(
      expect.arrayContaining(["dispatch-task", "--feature", FEATURE, "--task", TASK]),
      expect.objectContaining({ cwd: repo, timeoutMs: 30_000 }),
    );
  });

  it("passes a Plane error envelope through unchanged", async () => {
    vi.mocked(runSuperspec).mockResolvedValue({
      ok: true,
      json: {
        ok: false,
        error: "DISPATCH_HELD",
        message: "Task is held.",
        hint: "Clear hold before dispatch.",
      },
    });
    const port = await boot();
    const res = await send(port, {
      method: "POST",
      path: "/api/tasks/dispatch",
      headers: authed(),
      body: { featureId: FEATURE, taskId: TASK },
    });

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      ok: false,
      error: "DISPATCH_HELD",
      message: "Task is held.",
      hint: "Clear hold before dispatch.",
    });
  });

  it("pauses with task-hold and reassigns with task-reassign", async () => {
    const port = await boot();
    vi.mocked(buildSnapshot).mockResolvedValue(snapshot(task({ status: "doing" })));
    const pause = await send(port, {
      method: "POST",
      path: "/api/tasks/pause",
      headers: authed(),
      body: { featureId: FEATURE, taskId: TASK },
    });
    expect(pause.status).toBe(200);
    expect(runSuperspec).toHaveBeenCalledWith(
      expect.arrayContaining(["task-hold", "--hold", "true"]),
      expect.objectContaining({ cwd: repo }),
    );

    vi.mocked(runSuperspec).mockClear();
    vi.mocked(buildSnapshot).mockResolvedValue(
      snapshot(task({ status: "todo" }), [agent({ id: "agent-host", status: "idle" })]),
    );
    const reassign = await send(port, {
      method: "POST",
      path: "/api/tasks/reassign",
      headers: authed(),
      body: { featureId: FEATURE, taskId: TASK, agentId: "agent-host" },
    });
    expect(reassign.status).toBe(200);
    expect(runSuperspec).toHaveBeenCalledWith(
      expect.arrayContaining(["task-reassign", "--agent", "agent-host"]),
      expect.objectContaining({ cwd: repo }),
    );
  });

  it("sends task-abort with --reason and refuses an empty reason without spawning", async () => {
    const port = await boot();
    const missing = await send(port, {
      method: "POST",
      path: "/api/tasks/abort",
      headers: authed(),
      body: { featureId: FEATURE, taskId: TASK, confirm: true },
    });
    expect(missing.status).toBe(400);
    expect(JSON.parse(missing.body)).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
    });
    expect(String(JSON.parse(missing.body).message)).toMatch(/not sent/i);
    expect(runSuperspec).not.toHaveBeenCalled();

    const sent = await send(port, {
      method: "POST",
      path: "/api/tasks/abort",
      headers: authed(),
      body: { featureId: FEATURE, taskId: TASK, confirm: true, reason: "operator stop" },
    });
    expect(sent.status).toBe(200);
    expect(runSuperspec).toHaveBeenCalledWith(
      expect.arrayContaining(["task-abort", "--confirm", "true", "--reason", "operator stop"]),
      expect.objectContaining({ cwd: repo, timeoutMs: 30_000 }),
    );

    vi.mocked(runSuperspec).mockClear();
    const aliased = await send(port, {
      method: "POST",
      path: "/api/tasks/abort",
      headers: authed(),
      body: { featureId: FEATURE, taskId: TASK, confirm: true, abortReason: "plane field" },
    });
    expect(aliased.status).toBe(200);
    expect(runSuperspec).toHaveBeenCalledWith(
      expect.arrayContaining(["task-abort", "--reason", "plane field"]),
      expect.objectContaining({ cwd: repo }),
    );
  });

  it("refuses an empty brief locally and submits a valid brief through the CLI", async () => {
    const port = await boot();
    const refused = await send(port, {
      method: "POST",
      path: "/api/brief",
      headers: authed(),
      body: {
        featureId: FEATURE,
        outcome: "  ",
        deliverable: "specs/002-ira-command-center",
        constraints: [],
        budgetTokens: null,
        budgetUsd: null,
      },
    });
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body)).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(String(JSON.parse(refused.body).message)).toMatch(/not sent/i);
    expect(runSuperspec).not.toHaveBeenCalled();

    await mkdir(join(repo, "specs", FEATURE), { recursive: true });
    await writeFile(join(repo, "specs", FEATURE, "plan.md"), "# plan\n");
    vi.mocked(runSuperspec).mockResolvedValue({
      ok: true,
      json: { ok: true, brief: { id: "brief_1" }, tasks: [], assignment: [] },
    });
    const sent = await send(port, {
      method: "POST",
      path: "/api/brief",
      headers: authed(),
      body: {
        featureId: FEATURE,
        outcome: "Ship the command center shell",
        constraints: ["no voice"],
        budgetTokens: 0,
        budgetUsd: null,
        deliverable: "specs/002-ira-command-center",
      },
    });
    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body)).toMatchObject({ ok: true, brief: { id: "brief_1" } });
    const argv = vi.mocked(runSuperspec).mock.calls[0]?.[0] ?? [];
    expect(argv).toEqual([
      "brief",
      "submit",
      "--cwd",
      repo,
      "--feature",
      FEATURE,
      "--outcome",
      "Ship the command center shell",
      "--deliverable",
      "specs/002-ira-command-center",
      "--constraint",
      "no voice",
      "--budget-tokens",
      "0",
    ]);
  });

  it("answers Ask-Me only after confirm and non-empty text", async () => {
    const port = await boot();
    const refused = await send(port, {
      method: "POST",
      path: "/api/ask-me/answer",
      headers: authed(),
      body: { id: "ask_1", text: "Retry at the same ceiling", action: "retry", confirm: false },
    });
    expect(refused.status).toBe(400);
    expect(runSuperspec).not.toHaveBeenCalled();

    const sent = await send(port, {
      method: "POST",
      path: "/api/ask-me/answer",
      headers: authed(),
      body: { id: "ask_1", text: "Retry at the same ceiling", action: "retry", confirm: true },
    });
    expect(sent.status).toBe(200);
    expect(runSuperspec).toHaveBeenCalledWith(
      [
        "ask-me",
        "answer",
        "--id",
        "ask_1",
        "--text",
        "Retry at the same ceiling",
        "--action",
        "retry",
        "--cwd",
        repo,
      ],
      expect.objectContaining({ cwd: repo, timeoutMs: 30_000 }),
    );
  });
});

describe("module boundaries", () => {
  it("does not name forge writers or external agent runtimes", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/server/main.ts", import.meta.url)), "utf8");
    expect(source.includes("begin-task")).toBe(false);
    expect(source.includes("record-result")).toBe(false);
    expect(source.toLowerCase().includes("hermes")).toBe(false);
    expect(source.toLowerCase().includes("openclaw")).toBe(false);
  });
});
