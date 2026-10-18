import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { handleIraApi } from "../backend/http-api.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "../../fixtures/url-shortener");

export type StagingStack = {
  iraBase: string;
  appBase: string;
  cockpitCwd: string;
  projectPath: string;
  projectId: string;
  close: () => Promise<void>;
};

async function listen(
  handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void,
): Promise<{ server: Server; port: number; base: string }> {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return {
    server,
    port: addr.port,
    base: `http://127.0.0.1:${addr.port}`,
  };
}

/**
 * Boot a real staging stack on ephemeral ports:
 * - Isolated cockpit config (ira.config.json)
 * - Live Ira HTTP API (production handler)
 * - Live URL-shortener HTTP app
 */
export async function startStagingStack(): Promise<StagingStack> {
  const cockpitCwd = await mkdtemp(join(tmpdir(), "ira-staging-cockpit-"));
  const projectPath = await mkdtemp(join(tmpdir(), "ira-staging-shortener-"));
  await cp(FIXTURE, projectPath, { recursive: true });
  await writeFile(
    join(cockpitCwd, "ira.config.json"),
    JSON.stringify(
      {
        repositoryRoot: projectPath,
        projects: [
          {
            id: "url-shortener-staging",
            name: "URL Shortener Staging",
            path: projectPath,
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const ira = await listen((req, res) => {
    void (async () => {
      const handled = await handleIraApi(req, res, { cwd: cockpitCwd });
      if (!handled) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "NOT_FOUND" }));
      }
    })().catch((err: unknown) => {
      res.statusCode = 500;
      res.end(err instanceof Error ? err.message : String(err));
    });
  });

  const appMod = (await import(
    pathToFileURL(join(projectPath, "src/app.js")).href
  )) as {
    createApp: () => {
      handler: (
        req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => Promise<void> | void;
    };
  };
  const { handler } = appMod.createApp();
  const app = await listen((req, res) => {
    void Promise.resolve(handler(req, res)).catch((err: unknown) => {
      res.statusCode = 500;
      res.end(err instanceof Error ? err.message : String(err));
    });
  });

  return {
    iraBase: ira.base,
    appBase: app.base,
    cockpitCwd,
    projectPath,
    projectId: "url-shortener-staging",
    close: async () => {
      await new Promise<void>((r) => ira.server.close(() => r()));
      await new Promise<void>((r) => app.server.close(() => r()));
      await rm(cockpitCwd, { recursive: true, force: true });
      await rm(projectPath, { recursive: true, force: true });
    },
  };
}

export async function iraFetch<T>(
  base: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

export async function which(cmd: string): Promise<string | null> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("which", [cmd]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
