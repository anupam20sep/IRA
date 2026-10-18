import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { runSuperspecJson } from "./cli.js";

export type CursorDispatchInput = {
  repoRoot: string;
  featureId: string;
  taskId: string;
  agentId: string;
  personaPath: string;
  brief?: string;
};

export type CursorDispatchResult = {
  ok: true;
  queuePath: string;
  intent: Record<string, unknown>;
  note: string;
};

/**
 * Queue a host-spawn Cursor DispatchIntent under the project's hive.
 * Does NOT start cursor-agent (OD-009). Cursor host picks up the queue file.
 */
export async function queueCursorDispatch(
  input: CursorDispatchInput,
): Promise<CursorDispatchResult> {
  await ensureHive(input.repoRoot);

  const hiveRoot = join(input.repoRoot, ".superspec", "hive");
  const intent = {
    featureId: input.featureId,
    taskId: input.taskId,
    agentId: input.agentId,
    personaPath: input.personaPath,
    workspace: input.repoRoot,
    hiveRoot,
    specDir: join(input.repoRoot, "specs", input.featureId),
    attempt: 1,
    tier: "standard",
    freshSubagent: true,
    engine: "cursor-agent",
    brief: input.brief ?? `Ira → Cursor: implement ${input.taskId} for ${input.featureId}`,
    queuedAt: new Date().toISOString(),
  };

  const queuePath = join(
    hiveRoot,
    "dispatch-queue",
    input.featureId,
    `${input.taskId}.json`,
  );
  await mkdir(dirname(queuePath), { recursive: true, mode: 0o700 });
  await writeFile(queuePath, `${JSON.stringify(intent, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(queuePath, 0o600);

  await appendEvent(hiveRoot, {
    ts: intent.queuedAt,
    type: "cursor_dispatch_queued",
    message: `Queued ${input.taskId} → cursor-agent (${input.agentId})`,
    featureId: input.featureId,
    taskId: input.taskId,
  });

  return {
    ok: true,
    queuePath,
    intent,
    note: "Host-spawn only: intent queued; Ira did not parent cursor-agent (OD-009).",
  };
}

export async function readQueuedDispatch(
  repoRoot: string,
  featureId: string,
  taskId: string,
): Promise<Record<string, unknown> | null> {
  const path = join(
    repoRoot,
    ".superspec",
    "hive",
    "dispatch-queue",
    featureId,
    `${taskId}.json`,
  );
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function ensureHive(repoRoot: string): Promise<void> {
  const hiveJson = join(repoRoot, ".superspec", "hive", "hive.json");
  try {
    await access(hiveJson, constants.R_OK);
    return;
  } catch {
    // init
  }
  const res = await runSuperspecJson(repoRoot, ["hive", "init"]);
  if (!res.ok) {
    // Minimal local hive if CLI cannot init (still allow queue files)
    const hiveRoot = join(repoRoot, ".superspec", "hive");
    await mkdir(join(hiveRoot, "events"), { recursive: true, mode: 0o700 });
    await mkdir(join(hiveRoot, "dispatch-queue"), { recursive: true, mode: 0o700 });
    await writeFile(
      join(hiveRoot, "hive.json"),
      JSON.stringify(
        {
          version: 1,
          repositoryRoot: repoRoot,
          createdAt: new Date().toISOString(),
          source: "ira-cockpit",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(join(hiveRoot, "roster.json"), "[]\n", "utf8");
  }
}

export async function seedCursorRoster(
  repoRoot: string,
  agents: Array<{
    id: string;
    displayName: string;
    personaPath: string;
    capabilityTags: string[];
  }>,
): Promise<string> {
  await ensureHive(repoRoot);
  const hiveRoot = join(repoRoot, ".superspec", "hive");
  const roster = agents.map((a) => ({
    id: a.id,
    name: a.id,
    displayName: a.displayName,
    status: "idle",
    engine: "cursor-agent",
    personaPath: a.personaPath,
    capabilityTags: a.capabilityTags,
    origin: "ira-onboard",
  }));
  const path = join(hiveRoot, "roster.json");
  await writeFile(path, `${JSON.stringify(roster, null, 2)}\n`, "utf8");
  return path;
}

async function appendEvent(
  hiveRoot: string,
  event: Record<string, unknown>,
): Promise<void> {
  const dir = join(hiveRoot, "events");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "events.jsonl");
  await writeFile(file, `${JSON.stringify(event)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

/** Try full CLI dispatch-task; returns raw result (may gate if ledger incomplete). */
export async function tryCliDispatchTask(
  repoRoot: string,
  featureId: string,
  taskId: string,
): Promise<{ ok: boolean; json?: unknown; error?: string; raw?: string }> {
  await ensureHive(repoRoot);
  const res = await runSuperspecJson(repoRoot, [
    "dispatch-task",
    "--feature",
    featureId,
    "--task",
    taskId,
    "--cwd",
    repoRoot,
  ]);
  if (res.ok) return { ok: true, json: res.json, raw: res.raw };
  return { ok: false, error: res.error, raw: res.raw };
}
