import { constants, createReadStream, existsSync } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { BoardSnapshot, SnapshotTask } from "../shared/snapshot-types.js";
import { verifyBearerToken, type BearerAuthRequest } from "./auth.js";
import { runSuperspec, type RunSuperspecResult } from "./cli.js";
import { buildSnapshot } from "./snapshot.js";
import { handleSseRequest } from "./sse.js";
import { steerAbort, steerDispatch, steerPause, steerReassign, STEER_TIMEOUT_MS } from "./steer.js";

export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4731;

const MAX_BODY_BYTES = 1_048_576;
const OUTCOME_MAX = 4000;
const DELIVERABLE_MAX = 1000;
const CONSTRAINT_MAX = 500;
const FEATURE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const ASK_ACTIONS = new Set(["retry", "keep_blocked", "acknowledge"]);
const QUERY_TOKEN_NAMES = new Set(["token", "access_token", "bearer", "auth"]);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export class LoopbackBindError extends Error {
  constructor(host: string) {
    super(`Refusing to bind ${host}. Command Center listens on 127.0.0.1 only.`);
    this.name = "LoopbackBindError";
  }
}

export type ViteMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

export type CreateAppOptions = {
  host?: string;
  port?: number;
  repositoryRoot: string;
  hiveRoot?: string;
  staticRoot?: string;
  dev?: boolean;
  viteMiddlewares?: ViteMiddleware;
};

type AppContext = {
  port: number;
  repositoryRoot: string;
  hiveRoot: string;
  staticRoot?: string;
  vite: () => ViteMiddleware | undefined;
};

type JsonResult = { status: number; body: Record<string, unknown> };

/**
 * Loopback HTTP server. Refuses any host other than 127.0.0.1 before it listens.
 * Mutations call `verifyBearerToken` before snapshot reads or CLI spawns.
 */
export function createApp(options: CreateAppOptions): Server {
  const host = (options.host ?? LOOPBACK_HOST).trim();
  if (host !== LOOPBACK_HOST) throw new LoopbackBindError(host);
  if (!options.repositoryRoot?.trim()) {
    throw new Error("repositoryRoot is required.");
  }

  const repositoryRoot = resolve(options.repositoryRoot);
  const hiveRoot = resolve(options.hiveRoot ?? join(repositoryRoot, ".superspec", "hive"));
  const port = options.port ?? DEFAULT_PORT;
  const ctx: AppContext = {
    port,
    repositoryRoot,
    hiveRoot,
    staticRoot: options.staticRoot,
    vite: () => options.viteMiddlewares,
  };

  const server = createServer((req, res) => {
    void handleRequest(req, res, ctx).catch(() => {
      if (res.headersSent) return;
      sendJson(res, 500, { ok: false, error: "INVALID_INPUT", message: "Request failed." });
    });
  });
  server.on("listening", () => {
    const address = server.address();
    if (address && typeof address === "object") ctx.port = address.port;
  });
  return server;
}

export async function start(options: Partial<CreateAppOptions> = {}): Promise<Server> {
  const repositoryRoot = options.repositoryRoot?.trim() || (await findRepositoryRoot(process.cwd()));
  if (!repositoryRoot) {
    throw new Error("Could not resolve repository root (program.md not found).");
  }
  const port = options.port ?? readPort(process.env.COMMAND_CENTER_PORT);
  const dist = join(appRoot(), "dist");
  const staticRoot = options.staticRoot ?? (existsSync(dist) ? dist : undefined);
  const dev = options.dev ?? (process.env.COMMAND_CENTER_DEV === "1" || staticRoot === undefined);
  const settings: CreateAppOptions = {
    ...options,
    host: options.host ?? LOOPBACK_HOST,
    repositoryRoot,
    port,
    staticRoot,
    dev,
  };
  const server = createApp(settings);
  let vite: { close(): Promise<void> } | undefined;
  if (dev) {
    const { createServer: createViteServer } = await import("vite");
    const devServer = await createViteServer({
      root: appRoot(),
      configFile: join(appRoot(), "vite.config.ts"),
      appType: "spa",
      server: { middlewareMode: true, hmr: { server } },
    });
    vite = devServer;
    settings.viteMiddlewares = devServer.middlewares as ViteMiddleware;
    server.on("close", () => {
      void devServer.close();
    });
  }
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(port, LOOPBACK_HOST, () => resolveListen());
    });
  } catch (err) {
    await vite?.close();
    server.close();
    throw err;
  }
  return server;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const method = req.method ?? "GET";

  if (hasQueryToken(url)) {
    await drain(req);
    sendJson(res, 401, {
      ok: false,
      error: "TOKEN_REQUIRED",
      message: "Query-string tokens are not allowed.",
    });
    return;
  }

  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    await handleMutation(req, res, url, method, ctx);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 405, { ok: false, error: "INVALID_INPUT", message: "Method is not allowed." });
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, bind: LOOPBACK_HOST, port: ctx.port });
    return;
  }
  if (url.pathname === "/api/snapshot") {
    await handleSnapshot(res, url, ctx);
    return;
  }
  if (url.pathname === "/api/events") {
    handleSseRequest(req, res, { repositoryRoot: ctx.repositoryRoot, hiveRoot: ctx.hiveRoot });
    return;
  }
  if (url.pathname.startsWith("/api")) {
    sendJson(res, 404, { ok: false, error: "INVALID_INPUT", message: "Route was not found." });
    return;
  }

  const vite = ctx.vite();
  if (vite) {
    vite(req, res, () => {
      void serveStatic(req, res, ctx.staticRoot, url.pathname);
    });
    return;
  }
  await serveStatic(req, res, ctx.staticRoot, url.pathname);
}

async function handleMutation(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  ctx: AppContext,
): Promise<void> {
  const auth = await verifyBearerToken(authRequest(req), ctx.hiveRoot);
  if (!auth.ok) {
    await drain(req);
    sendJson(res, auth.status, { ok: false, error: auth.error, message: auth.message });
    return;
  }
  if (method !== "POST") {
    await drain(req);
    sendJson(res, 405, notSent("Method is not allowed"));
    return;
  }

  let payload: unknown;
  try {
    payload = await readJson(req);
  } catch (err) {
    const tooLarge = err instanceof Error && err.message === "body too large";
    sendJson(res, 400, notSent(tooLarge ? "Request body is too large" : "Request body is not JSON"));
    return;
  }

  const result = await dispatchMutation(url.pathname, payload, authRequest(req), ctx);
  sendJson(res, result.status, result.body);
}

async function dispatchMutation(
  pathname: string,
  payload: unknown,
  request: BearerAuthRequest,
  ctx: AppContext,
): Promise<JsonResult> {
  switch (pathname) {
    case "/api/brief":
      return submitBrief(payload, ctx);
    case "/api/ask-me/answer":
      return answerAskMe(payload, ctx);
    case "/api/tasks/dispatch":
      return steerTask("dispatch", payload, request, ctx);
    case "/api/tasks/pause":
      return steerTask("pause", payload, request, ctx);
    case "/api/tasks/abort":
      return steerTask("abort", payload, request, ctx);
    case "/api/tasks/reassign":
      return steerTask("reassign", payload, request, ctx);
    default:
      return { status: 404, body: notSent("Route was not found") };
  }
}

async function handleSnapshot(res: ServerResponse, url: URL, ctx: AppContext): Promise<void> {
  const eventsBefore = url.searchParams.get("eventsBefore")?.trim() || undefined;
  const limitRaw = url.searchParams.get("limit");
  let eventLimit: number | undefined;
  if (limitRaw !== null && limitRaw !== "") {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      sendJson(res, 400, { ok: false, error: "INVALID_INPUT", message: "Event limit is invalid." });
      return;
    }
    eventLimit = parsed;
  }

  try {
    const board = await buildSnapshot({
      repositoryRoot: ctx.repositoryRoot,
      hiveRoot: ctx.hiveRoot,
      ...(eventsBefore ? { eventsBefore } : {}),
      ...(eventLimit !== undefined ? { eventLimit } : {}),
    });
    sendJson(res, 200, board);
  } catch {
    sendJson(res, 500, { ok: false, error: "INVALID_INPUT", message: "Snapshot is unavailable." });
  }
}

async function steerTask(
  kind: "dispatch" | "pause" | "abort" | "reassign",
  payload: unknown,
  request: BearerAuthRequest,
  ctx: AppContext,
): Promise<JsonResult> {
  if (!isRecord(payload)) return { status: 400, body: notSent("Request body must be an object") };
  const featureId = typeof payload.featureId === "string" ? payload.featureId.trim() : "";
  const taskId = typeof payload.taskId === "string" ? payload.taskId.trim() : "";
  if (!featureId || !taskId) return { status: 400, body: notSent("Feature and task are required") };

  const reason = kind === "abort" ? readAbortReason(payload) : "";
  if (kind === "abort" && reason.length === 0) {
    return { status: 400, body: notSent("Abort reason is empty") };
  }

  let board: BoardSnapshot;
  try {
    board = await buildSnapshot({ repositoryRoot: ctx.repositoryRoot, hiveRoot: ctx.hiveRoot });
  } catch {
    return { status: 400, body: notSent("Snapshot is unavailable") };
  }

  const found = findTask(board, featureId, taskId);
  if (!found) return { status: 400, body: notSent("Task was not found") };

  const base = {
    request,
    hiveRoot: ctx.hiveRoot,
    cwd: ctx.repositoryRoot,
    featureId,
    taskId,
    task: found.task,
    tasksById: new Map(found.tasks.map((row) => [row.id, row])),
  };

  if (kind === "dispatch") {
    const assigneeId = found.task.assigneeAgentId;
    const assignee = assigneeId ? board.agents.find((agent) => agent.id === assigneeId) : undefined;
    return steerDispatch({
      ...base,
      hiveReady: board.doctor.hiveReady === true,
      assigneeStatus: assignee?.status ?? null,
    });
  }
  if (kind === "pause") return steerPause(base);
  if (kind === "abort") {
    return steerAbort({ ...base, confirm: payload.confirm === true, reason });
  }
  const agentId = typeof payload.agentId === "string" ? payload.agentId : null;
  const target = agentId ? board.agents.find((agent) => agent.id === agentId.trim()) : undefined;
  return steerReassign({
    ...base,
    agentId,
    targetStatus: target?.status ?? null,
  });
}

async function submitBrief(payload: unknown, ctx: AppContext): Promise<JsonResult> {
  if (!isRecord(payload)) return { status: 400, body: notSent("Brief body must be an object") };

  const featureId = typeof payload.featureId === "string" ? payload.featureId.trim() : "";
  if (!FEATURE_ID.test(featureId)) return { status: 400, body: notSent("Feature id is invalid") };

  const outcome = typeof payload.outcome === "string" ? payload.outcome.trim() : "";
  if (!outcome) return { status: 400, body: notSent("Outcome is required") };
  if (outcome.length > OUTCOME_MAX) return { status: 400, body: notSent("Outcome exceeds 4000 characters") };

  const deliverable = typeof payload.deliverable === "string" ? payload.deliverable.trim() : "";
  if (!deliverable) return { status: 400, body: notSent("Deliverable is required") };
  if (deliverable.length > DELIVERABLE_MAX) {
    return { status: 400, body: notSent("Deliverable exceeds 1000 characters") };
  }

  const constraints = parseConstraints(payload.constraints);
  if (!constraints.ok) return { status: 400, body: notSent(constraints.message) };
  const budgetTokens = parseBudget(payload.budgetTokens);
  if (!budgetTokens.ok) return { status: 400, body: notSent(budgetTokens.message) };
  const budgetUsd = parseBudget(payload.budgetUsd);
  if (!budgetUsd.ok) return { status: 400, body: notSent(budgetUsd.message) };

  const planPath = join(ctx.repositoryRoot, "specs", featureId, "plan.md");
  try {
    await access(planPath, constants.R_OK);
  } catch {
    return { status: 400, body: notSent("Feature plan.md was not found") };
  }

  const argv = [
    "brief",
    "submit",
    "--cwd",
    ctx.repositoryRoot,
    "--feature",
    featureId,
    "--outcome",
    outcome,
    "--deliverable",
    deliverable,
  ];
  for (const constraint of constraints.values) argv.push("--constraint", constraint);
  if (budgetUsd.value !== null) argv.push("--budget-usd", String(budgetUsd.value));
  if (budgetTokens.value !== null) argv.push("--budget-tokens", String(budgetTokens.value));

  return fromCli(await runSuperspec(argv, { cwd: ctx.repositoryRoot, timeoutMs: STEER_TIMEOUT_MS }));
}

async function answerAskMe(payload: unknown, ctx: AppContext): Promise<JsonResult> {
  if (!isRecord(payload)) return { status: 400, body: notSent("Ask-Me body must be an object") };
  if (payload.confirm !== true) return { status: 400, body: notSent("Ask-Me answer requires confirm: true") };
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) return { status: 400, body: notSent("Ask-Me answer text is required") };
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) return { status: 400, body: notSent("Ask-Me id is required") };
  const action = typeof payload.action === "string" ? payload.action : "";
  if (!ASK_ACTIONS.has(action)) return { status: 400, body: notSent("Ask-Me action is invalid") };

  return fromCli(
    await runSuperspec(
      ["ask-me", "answer", "--id", id, "--text", text, "--action", action, "--cwd", ctx.repositoryRoot],
      { cwd: ctx.repositoryRoot, timeoutMs: STEER_TIMEOUT_MS },
    ),
  );
}

function readAbortReason(payload: Record<string, unknown>): string {
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (reason.length > 0) return reason;
  return typeof payload.abortReason === "string" ? payload.abortReason.trim() : "";
}

function findTask(
  board: BoardSnapshot,
  featureId: string,
  taskId: string,
): { task: SnapshotTask; tasks: SnapshotTask[] } | null {
  const feature = board.features.find((row) => row.featureId === featureId);
  if (!feature) return null;
  const task = feature.tasks.find((row) => row.id === taskId);
  if (!task) return null;
  return { task, tasks: feature.tasks };
}

function parseConstraints(
  value: unknown,
): { ok: true; values: string[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, values: [] };
  if (!Array.isArray(value)) return { ok: false, message: "Constraints must be an array" };
  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return { ok: false, message: "Constraints must be strings" };
    const text = item.trim();
    if (!text) return { ok: false, message: "Constraints must be non-empty" };
    if (text.length > CONSTRAINT_MAX) return { ok: false, message: "A constraint exceeds 500 characters" };
    values.push(text);
  }
  return { ok: true, values };
}

function parseBudget(value: unknown): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === "string" && value.trim() === "") return { ok: true, value: null };
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return { ok: false, message: "Budget must be a number" };
  if (numeric < 0) return { ok: false, message: "Budget cannot be negative" };
  return { ok: true, value: numeric };
}

function fromCli(result: RunSuperspecResult): JsonResult {
  if (!result.ok) return { status: 400, body: { ok: false, error: "INVALID_INPUT", message: result.error } };
  if (!isRecord(result.json)) {
    return { status: 400, body: { ok: false, error: "INVALID_INPUT", message: "CLI stdout is not a single JSON object." } };
  }
  return { status: result.json.ok === false ? 400 : 200, body: result.json };
}

function notSent(reason: string): Record<string, unknown> {
  const text = reason.trim().replace(/\.+$/, "");
  return { ok: false, error: "INVALID_INPUT", message: `${text}. The action was not sent.` };
}

function authRequest(req: IncomingMessage): BearerAuthRequest {
  const headers: BearerAuthRequest["headers"] = {};
  for (const [key, value] of Object.entries(req.headers)) headers[key] = value;
  return { headers, url: req.url };
}

function hasQueryToken(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (QUERY_TOKEN_NAMES.has(key.toLowerCase())) return true;
  }
  return false;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = (await readBody(req)).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

async function drain(req: IncomingMessage): Promise<void> {
  try {
    await readBody(req);
  } catch {
    // Unauthenticated or rejected requests still consume the body.
  }
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticRoot: string | undefined,
  pathname: string,
): Promise<void> {
  if (!staticRoot) {
    sendJson(res, 404, { ok: false, error: "INVALID_INPUT", message: "Route was not found." });
    return;
  }
  let rootReal: string;
  try {
    rootReal = await realpath(staticRoot);
  } catch {
    sendJson(res, 404, { ok: false, error: "INVALID_INPUT", message: "Route was not found." });
    return;
  }
  const file = await resolveStaticFile(rootReal, pathname);
  if (!file) {
    sendJson(res, 404, { ok: false, error: "INVALID_INPUT", message: "Route was not found." });
    return;
  }
  const info = await stat(file);
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": String(info.size),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on("error", () => {
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: "INVALID_INPUT", message: "Static file is unavailable." });
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

async function resolveStaticFile(rootReal: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const rel = decoded.replace(/^\/+/, "");
  const extension = rel.length > 0 ? extname(rel) : "";
  const requested = rel.length === 0 ? join(rootReal, "index.html") : resolve(rootReal, rel);
  if (!isInside(rootReal, requested)) return null;

  const found = await existingFile(rootReal, requested);
  if (found) return found;
  if (extension || rel.length === 0) return null;
  return existingFile(rootReal, join(rootReal, "index.html"));
}

async function existingFile(rootReal: string, candidate: string): Promise<string | null> {
  try {
    let target = candidate;
    let info = await stat(target);
    if (info.isDirectory()) {
      target = join(target, "index.html");
      info = await stat(target);
    }
    if (!info.isFile()) return null;
    const real = await realpath(target);
    return isInside(rootReal, real) ? real : null;
  } catch {
    return null;
  }
}

function isInside(root: string, target: string): boolean {
  const base = resolve(root);
  const resolved = resolve(target);
  return resolved === base || resolved.startsWith(base + sep);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function appRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

function readPort(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("COMMAND_CENTER_PORT is invalid.");
  }
  return port;
}

async function findRepositoryRoot(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);
  for (;;) {
    try {
      await access(join(dir, "program.md"), constants.R_OK);
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

const entry = process.argv[1];
if (entry && resolve(entry) === fileURLToPath(import.meta.url)) {
  start().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "Command Center failed to start.";
    console.error(message);
    process.exitCode = 1;
  });
}
