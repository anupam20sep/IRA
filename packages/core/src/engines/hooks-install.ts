import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type HostHookEngine = "claude" | "codex" | "cursor-agent";

const HOOK_INGEST_CMD =
  'superspec engines hook-ingest --session "$SUPERSPEC_ENGINE_SESSION"';

const HOST_HOOK_FILE: Record<HostHookEngine, string> = {
  claude: "hooks/hooks.json",
  codex: "hooks/hooks-codex.json",
  "cursor-agent": "hooks/hooks-cursor.json",
};

function commandContainsHookIngest(value: unknown): boolean {
  return typeof value === "string" && value.includes("hook-ingest");
}

function hooksArrayHasIngest(hooks: unknown): boolean {
  if (!Array.isArray(hooks)) return false;
  for (const entry of hooks) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (commandContainsHookIngest(row.command)) return true;
    if (hooksArrayHasIngest(row.hooks)) return true;
  }
  return false;
}

function documentHasHookIngest(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const root = doc as Record<string, unknown>;
  if (hooksArrayHasIngest(root.hooks)) return true;
  const nested = root.hooks;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    for (const value of Object.values(nested as Record<string, unknown>)) {
      if (hooksArrayHasIngest(value)) return true;
    }
  }
  return false;
}

function appendClaudeHook(doc: Record<string, unknown>): void {
  const hooks = (doc.hooks as Record<string, unknown>) ?? {};
  doc.hooks = hooks;
  const events = ["SessionStart", "PreToolUse", "PostToolUse", "Stop"] as const;
  const ingest = { type: "command", command: HOOK_INGEST_CMD };
  for (const event of events) {
    const list = hooks[event];
    if (!Array.isArray(list) || list.length === 0) {
      hooks[event] = [{ hooks: [ingest] }];
      continue;
    }
    const first = list[0] as Record<string, unknown>;
    const inner = Array.isArray(first.hooks) ? [...first.hooks] : [];
    if (!hooksArrayHasIngest(inner)) inner.push(ingest);
    first.hooks = inner;
  }
}

function appendCodexHook(doc: Record<string, unknown>): void {
  const hooks = (doc.hooks as Record<string, unknown>) ?? {};
  doc.hooks = hooks;
  const ingest = { type: "command", command: HOOK_INGEST_CMD, statusMessage: "SuperSpec hook ingest" };
  const events = ["SessionStart", "PreToolUse", "PostToolUse", "Stop"] as const;
  for (const event of events) {
    const list = hooks[event];
    if (!Array.isArray(list) || list.length === 0) {
      hooks[event] = [{ hooks: [ingest] }];
      continue;
    }
    const first = list[0] as Record<string, unknown>;
    const inner = Array.isArray(first.hooks) ? [...first.hooks] : [];
    if (!hooksArrayHasIngest(inner)) inner.push(ingest);
    first.hooks = inner;
  }
}

function appendCursorHook(doc: Record<string, unknown>): void {
  const hooks = (doc.hooks as Record<string, unknown>) ?? {};
  doc.hooks = hooks;
  const ingest = { command: HOOK_INGEST_CMD };
  const events = ["sessionStart", "preToolUse", "postToolUse", "sessionEnd"] as const;
  for (const event of events) {
    const list = hooks[event];
    if (!Array.isArray(list)) {
      hooks[event] = [ingest];
      continue;
    }
    if (!hooksArrayHasIngest(list)) list.push(ingest);
  }
}

/** Append project hook bridge commands; does not authorize host spawn. */
export async function installProjectHookBridge(
  projectRoot: string,
  host: HostHookEngine,
): Promise<{ ok: true; path: string }> {
  const rel = HOST_HOOK_FILE[host];
  const path = join(projectRoot, rel);
  await mkdir(join(projectRoot, "hooks"), { recursive: true });

  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    doc = host === "cursor-agent" ? { version: 1, hooks: {} } : { hooks: {} };
  }

  if (!documentHasHookIngest(doc)) {
    if (host === "claude") appendClaudeHook(doc);
    else if (host === "codex") appendCodexHook(doc);
    else appendCursorHook(doc);
  }

  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o644 });
  return { ok: true, path };
}
