import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EngineInfo } from "./types.js";

const execFileAsync = promisify(execFile);

const CATALOG: Array<{ id: string; cmd: string; hostSpawnOnly: boolean }> = [
  { id: "claude", cmd: "claude", hostSpawnOnly: true },
  { id: "cursor-agent", cmd: "cursor-agent", hostSpawnOnly: true },
  { id: "codex", cmd: "codex", hostSpawnOnly: true },
  { id: "opencode", cmd: "opencode", hostSpawnOnly: false },
];

async function which(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

export async function detectEngines(): Promise<{
  engines: EngineInfo[];
  note: string;
}> {
  const engines: EngineInfo[] = [];
  for (const row of CATALOG) {
    engines.push({
      id: row.id,
      cmd: row.cmd,
      installed: await which(row.cmd),
      hostSpawnOnly: row.hostSpawnOnly,
    });
  }
  return {
    engines,
    note: "Host engines (claude/cursor-agent/codex) are never Ira-parented (OD-009).",
  };
}
