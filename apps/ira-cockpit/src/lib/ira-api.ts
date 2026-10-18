import type { CockpitSnapshot, DocHit, EngineInfo } from "@/backend/types";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok) {
    throw new Error(
      typeof (json as { error?: string }).error === "string"
        ? (json as { error: string }).error
        : `HTTP ${res.status}`,
    );
  }
  return json;
}

export function fetchSnapshot(): Promise<CockpitSnapshot> {
  return api<CockpitSnapshot>("/api/ira/snapshot");
}

export function fetchEngines(): Promise<{ engines: EngineInfo[]; note: string }> {
  return api("/api/ira/engines");
}

export function fetchProjectsApi(): Promise<{
  ok: true;
  projects: Array<{ id: string; name: string; path: string }>;
}> {
  return api("/api/ira/projects");
}

export function onboardProjectApi(body: {
  path: string;
  name?: string;
  id?: string;
}): Promise<{ ok: true; project: { id: string; name: string; path: string } }> {
  return api("/api/ira/projects", { method: "POST", body: JSON.stringify(body) });
}

export function removeProjectApi(
  id: string,
): Promise<{ ok: boolean; projects: Array<{ id: string; name: string; path: string }> }> {
  return api(`/api/ira/projects?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function searchDocsApi(
  q: string,
  projectId?: string | null,
): Promise<{ ok: true; hits: DocHit[]; projectId?: string }> {
  const qs = new URLSearchParams({ q });
  if (projectId) qs.set("project", projectId);
  return api(`/api/ira/docs?${qs.toString()}`);
}

export function createAgentApi(body: {
  harness: string;
  id: string;
  name: string;
  description: string;
  capabilityTags: string;
  body: string;
  projectId?: string;
}): Promise<{ ok: true; path: string }> {
  return api("/api/ira/agents", { method: "POST", body: JSON.stringify(body) });
}

export function createSkillApi(body: {
  id: string;
  name: string;
  description: string;
  body: string;
  projectId?: string;
}): Promise<{ ok: true; path: string }> {
  return api("/api/ira/skills", { method: "POST", body: JSON.stringify(body) });
}

export function answerAskMeApi(
  id: string,
  answer: string,
  projectId?: string,
): Promise<{ ok: boolean; error?: string }> {
  return api("/api/ira/ask-me/answer", {
    method: "POST",
    body: JSON.stringify({ id, answer, projectId }),
  });
}

export function advanceLifecycleApi(body: {
  projectId: string;
  featureId: string;
  stage: string;
}): Promise<{ ok: true; stage: string; inferred: string; statusPath: string }> {
  return api("/api/ira/lifecycle/advance", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function syncStatusApi(body: {
  projectId: string;
  featureId: string;
}): Promise<{ ok: boolean; raw?: string; error?: string }> {
  return api("/api/ira/lifecycle/sync-status", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function dispatchCursorApi(body: {
  projectId: string;
  featureId: string;
  taskId: string;
  agentId?: string;
  personaPath?: string;
  brief?: string;
  useCli?: boolean;
}): Promise<{ ok: boolean; queuePath?: string; note?: string; intent?: unknown }> {
  return api("/api/ira/cursor/dispatch", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
