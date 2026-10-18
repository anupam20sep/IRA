import { invoke } from "@tauri-apps/api/core";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type WriteAgentArgs = {
  repoRoot: string;
  harness: "cursor" | "claude" | "codex" | "opencode";
  id: string;
  name: string;
  description: string;
  capabilityTags: string;
  body: string;
};

export type WriteSkillArgs = {
  repoRoot: string;
  id: string;
  name: string;
  description: string;
  body: string;
};

export async function writeAgentFile(args: WriteAgentArgs): Promise<string> {
  if (!isTauri()) {
    throw new Error("Agent file write requires the Ira desktop app (Tauri).");
  }
  return invoke<string>("write_agent", args);
}

export async function writeSkillFile(args: WriteSkillArgs): Promise<string> {
  if (!isTauri()) {
    throw new Error("Skill file write requires the Ira desktop app (Tauri).");
  }
  return invoke<string>("write_skill", args);
}

export async function runSuperspec(
  repoRoot: string,
  binRel: string,
  args: string[],
): Promise<string> {
  if (!isTauri()) {
    throw new Error("CLI bridge requires the Ira desktop app (Tauri).");
  }
  return invoke<string>("run_superspec", { repoRoot, binRel, args });
}

export async function detectEngines(repoRoot: string): Promise<string> {
  if (!isTauri()) return JSON.stringify({ engines: [], note: "browser-only" });
  return invoke<string>("detect_engines", { repoRoot });
}
