import type { IncomingMessage, ServerResponse } from "node:http";
import { writeAgentFile, writeSkillFile } from "./agent-files.js";
import { searchDocs } from "./docs-search.js";
import { answerAskMe } from "./hive.js";
import { buildCockpitSnapshot } from "./snapshot.js";
import { detectEngines } from "./engines.js";
import {
  findProject,
  onboardProject,
  removeConfiguredProject,
  resolveConfiguredProjects,
} from "./projects.js";
import {
  advanceLifecycle,
  forgeStatus,
  syncFeatureStatus,
  type LifecycleStage,
} from "./lifecycle.js";
import {
  queueCursorDispatch,
  readQueuedDispatch,
  seedCursorRoster,
  tryCliDispatchTask,
} from "./cursor-dispatch.js";
import type { Harness } from "./types.js";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}

export type ApiContext = {
  cwd: string;
};

/**
 * Vite middleware / Node handler for live cockpit backend.
 * Routes under /api/ira/*
 */
export async function handleIraApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/ira")) return false;

  try {
    const projects = await resolveConfiguredProjects(ctx.cwd);

    if (req.method === "GET" && url.pathname === "/api/ira/snapshot") {
      const snapshot = await buildCockpitSnapshot(projects);
      sendJson(res, 200, snapshot);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/ira/engines") {
      sendJson(res, 200, await detectEngines());
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/ira/projects") {
      sendJson(res, 200, { ok: true, projects });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/ira/projects") {
      const raw = JSON.parse(await readBody(req)) as {
        path?: string;
        name?: string;
        id?: string;
      };
      if (!raw.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "path is required" });
        return true;
      }
      const project = await onboardProject(ctx.cwd, {
        path: raw.path,
        name: raw.name,
        id: raw.id,
      });
      sendJson(res, 200, { ok: true, project });
      return true;
    }

    if (req.method === "DELETE" && url.pathname === "/api/ira/projects") {
      const id =
        url.searchParams.get("id") ??
        (JSON.parse((await readBody(req)) || "{}") as { id?: string }).id;
      if (!id?.trim()) {
        sendJson(res, 400, { ok: false, error: "id is required" });
        return true;
      }
      const result = await removeConfiguredProject(ctx.cwd, id);
      sendJson(res, result.removed ? 200 : 404, {
        ok: result.removed,
        projects: result.projects,
        error: result.removed ? undefined : "Project not found",
      });
      return true;
    }

    const projectId =
      url.searchParams.get("project") ??
      (req.method === "POST" ? undefined : null);

    if (req.method === "GET" && url.pathname === "/api/ira/docs") {
      const target = findProject(projects, projectId);
      if (!target) {
        sendJson(res, 400, { ok: false, error: "No project configured" });
        return true;
      }
      const q = url.searchParams.get("q") ?? "";
      const hits = await searchDocs(target.path, q);
      sendJson(res, 200, { ok: true, projectId: target.id, hits });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/ira/agents") {
      const raw = JSON.parse(await readBody(req)) as Record<string, string>;
      const target = findProject(projects, raw.projectId ?? projectId);
      if (!target) {
        sendJson(res, 400, { ok: false, error: "No project configured" });
        return true;
      }
      const path = await writeAgentFile({
        repoRoot: target.path,
        harness: raw.harness as Harness,
        id: raw.id,
        name: raw.name,
        description: raw.description,
        capabilityTags: raw.capabilityTags ?? "",
        body: raw.body ?? "",
      });
      sendJson(res, 200, { ok: true, path, projectId: target.id });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/ira/skills") {
      const raw = JSON.parse(await readBody(req)) as Record<string, string>;
      const target = findProject(projects, raw.projectId ?? projectId);
      if (!target) {
        sendJson(res, 400, { ok: false, error: "No project configured" });
        return true;
      }
      const path = await writeSkillFile({
        repoRoot: target.path,
        id: raw.id,
        name: raw.name,
        description: raw.description,
        body: raw.body ?? "",
      });
      sendJson(res, 200, { ok: true, path, projectId: target.id });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/ira/ask-me/answer") {
      const raw = JSON.parse(await readBody(req)) as {
        id: string;
        answer: string;
        projectId?: string;
      };
      const target = findProject(projects, raw.projectId ?? projectId);
      if (!target) {
        sendJson(res, 400, { ok: false, error: "No project configured" });
        return true;
      }
      const result = await answerAskMe(target.path, raw.id, raw.answer ?? "acknowledged");
      sendJson(res, result.ok ? 200 : 400, result);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/ira/lifecycle/advance") {
      const raw = JSON.parse(await readBody(req)) as {
        projectId?: string;
        featureId?: string;
        stage?: LifecycleStage;
      };
      const target = findProject(projects, raw.projectId ?? projectId);
      if (!target || !raw.featureId || !raw.stage) {
        sendJson(res, 400, { ok: false, error: "projectId, featureId, stage required" });
        return true;
      }
      const result = await advanceLifecycle(target.path, raw.featureId, raw.stage);
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/ira/lifecycle/sync-status") {
      const raw = JSON.parse(await readBody(req)) as {
        projectId?: string;
        featureId?: string;
      };
      const target = findProject(projects, raw.projectId ?? projectId);
      if (!target || !raw.featureId) {
        sendJson(res, 400, { ok: false, error: "projectId, featureId required" });
        return true;
      }
      const result = await syncFeatureStatus(target.path, raw.featureId);
      sendJson(res, result.ok ? 200 : 400, result);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/ira/forge-status") {
      const target = findProject(projects, projectId);
      const featureId = url.searchParams.get("feature");
      if (!target || !featureId) {
        sendJson(res, 400, { ok: false, error: "project + feature required" });
        return true;
      }
      sendJson(res, 200, await forgeStatus(target.path, featureId));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/ira/cursor/dispatch") {
      const raw = JSON.parse(await readBody(req)) as {
        projectId?: string;
        featureId?: string;
        taskId?: string;
        agentId?: string;
        personaPath?: string;
        brief?: string;
        useCli?: boolean;
      };
      const target = findProject(projects, raw.projectId ?? projectId);
      if (!target || !raw.featureId || !raw.taskId) {
        sendJson(res, 400, {
          ok: false,
          error: "projectId, featureId, taskId required",
        });
        return true;
      }
      if (raw.useCli) {
        const cli = await tryCliDispatchTask(target.path, raw.featureId, raw.taskId);
        sendJson(res, 200, { ok: cli.ok, mode: "cli", ...cli });
        return true;
      }
      const queued = await queueCursorDispatch({
        repoRoot: target.path,
        featureId: raw.featureId,
        taskId: raw.taskId,
        agentId: raw.agentId ?? "us-backend",
        personaPath:
          raw.personaPath ?? ".cursor/agents/us-backend.md",
        brief: raw.brief,
      });
      sendJson(res, 200, queued);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/ira/cursor/dispatch") {
      const target = findProject(projects, projectId);
      const featureId = url.searchParams.get("feature");
      const taskId = url.searchParams.get("task");
      if (!target || !featureId || !taskId) {
        sendJson(res, 400, { ok: false, error: "project, feature, task required" });
        return true;
      }
      const intent = await readQueuedDispatch(target.path, featureId, taskId);
      sendJson(res, intent ? 200 : 404, {
        ok: Boolean(intent),
        intent,
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/ira/roster/seed") {
      const raw = JSON.parse(await readBody(req)) as {
        projectId?: string;
        agents?: Array<{
          id: string;
          displayName: string;
          personaPath: string;
          capabilityTags: string[];
        }>;
      };
      const target = findProject(projects, raw.projectId ?? projectId);
      if (!target || !raw.agents?.length) {
        sendJson(res, 400, { ok: false, error: "projectId + agents required" });
        return true;
      }
      const path = await seedCursorRoster(target.path, raw.agents);
      sendJson(res, 200, { ok: true, path });
      return true;
    }

    sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
    return true;
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}
