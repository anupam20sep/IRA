import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Harness } from "./types.js";

export type WriteAgentInput = {
  repoRoot: string;
  harness: Harness;
  id: string;
  name: string;
  description: string;
  capabilityTags: string;
  body: string;
};

export type WriteSkillInput = {
  repoRoot: string;
  id: string;
  name: string;
  description: string;
  body: string;
};

export function sanitizeId(id: string): string {
  const cleaned = id.trim().toLowerCase();
  if (!cleaned || cleaned.length > 64) {
    throw new Error("id must be 1–64 chars");
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(cleaned)) {
    throw new Error("id must be alphanumeric, hyphen, or underscore");
  }
  return cleaned;
}

function assertUnderRoot(repoRoot: string, target: string): void {
  const root = resolve(repoRoot) + sep;
  const file = resolve(target);
  if (!file.startsWith(root) && file !== resolve(repoRoot)) {
    throw new Error("refusing to write outside repository root");
  }
}

export function agentPath(repoRoot: string, harness: Harness, id: string): string {
  const file = harness === "codex" ? `${id}.toml` : `${id}.md`;
  const folder =
    harness === "cursor"
      ? ".cursor/agents"
      : harness === "claude"
        ? ".claude/agents"
        : harness === "codex"
          ? ".codex/agents"
          : ".opencode/agents";
  return join(repoRoot, folder, file);
}

export function skillPath(repoRoot: string, id: string): string {
  return join(repoRoot, "skills", id, "SKILL.md");
}

export function renderAgentDocument(input: WriteAgentInput): string {
  const id = sanitizeId(input.id);
  if (input.harness === "codex") {
    return `name = "${id}"\ndescription = "${input.description.replace(/"/g, "'")}"\ncapabilityTags = "${input.capabilityTags.replace(/"/g, "'")}"\n\n${input.body.trim()}\n`;
  }
  return `---\nname: ${id}\ndescription: ${input.description.replace(/\n/g, " ")}\ncapabilityTags: ${input.capabilityTags.replace(/\n/g, " ")}\n---\n\n# ${input.name.trim()}\n\n${input.body.trim()}\n`;
}

export function renderSkillDocument(input: WriteSkillInput): string {
  const id = sanitizeId(input.id);
  return `---\nname: ${id}\ndescription: ${input.description.replace(/\n/g, " ")}\n---\n\n# ${input.name.trim()}\n\n${input.body.trim()}\n`;
}

export async function writeAgentFile(input: WriteAgentInput): Promise<string> {
  const id = sanitizeId(input.id);
  const path = agentPath(input.repoRoot, input.harness, id);
  assertUnderRoot(input.repoRoot, path);
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  await writeFile(path, renderAgentDocument({ ...input, id }), "utf8");
  return path;
}

export async function writeSkillFile(input: WriteSkillInput): Promise<string> {
  const id = sanitizeId(input.id);
  const path = skillPath(input.repoRoot, id);
  assertUnderRoot(input.repoRoot, path);
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  await writeFile(path, renderSkillDocument({ ...input, id }), "utf8");
  return path;
}
