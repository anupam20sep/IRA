import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { statSync } from "node:fs";
import { personaField, type IraPersonaField } from "./persona.js";
import { resolveRepositoryRoot } from "./paths.js";
import { writeJsonAtomic } from "./store.js";
import { bootstrapTokenGovernor } from "../token-governor/register.js";

const GITIGNORE_LINE = ".superspec/hive/";

const HIVE_DIRS = [
  "briefs",
  "ledger",
  "ask-me",
  "events",
  "mailboxes",
  "locks",
  "dispatch-queue",
] as const;

export type HiveInitResult =
  | {
      ok: true;
      created: boolean;
      repositoryRoot: string;
      hiveRoot: string;
      worktreeKind: "main" | "linked";
      persona: IraPersonaField;
    }
  | { ok: false; error: "HIVE_ROOT_UNRESOLVED" | "HIVE_SCHEMA_MISMATCH" | "HIVE_CORRUPT" };

/** Create or validate the project-local Ira hive and default supervised settings. */
export async function hiveInit(input: { cwd: string; repair?: boolean }): Promise<HiveInitResult> {
  const resolved = resolveRepositoryRoot(input.cwd);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const { repositoryRoot, hiveRoot } = resolved;
  const persona = personaField();
  const worktreeKind = detectWorktreeKind(resolve(input.cwd));

  const existing = await readHiveManifest(hiveRoot);
  if (existing === "mismatch") return { ok: false, error: "HIVE_SCHEMA_MISMATCH" };
  if (existing === "corrupt" && !input.repair) {
    return { ok: false, error: "HIVE_CORRUPT" };
  }
  if (existing === "corrupt" && input.repair) {
    await quarantineHive(hiveRoot);
  }

  const created = existing === "missing";
  await mkdir(hiveRoot, { recursive: true, mode: 0o700 });
  await ensureHiveDirs(hiveRoot);

  if (created || existing === "corrupt") {
    const now = new Date().toISOString();
    await writeJsonAtomic(join(hiveRoot, "hive.json"), {
      schemaVersion: 1,
      repositoryRoot,
      createdAt: now,
      persona,
    });
    await writeSettingsDefaults(hiveRoot, now);
    await writeJsonAtomic(join(hiveRoot, "roster.json"), []);
    await writeJsonAtomic(join(hiveRoot, "blackboard.json"), {
      scribe: "ira",
      updatedAt: now,
      features: {},
    });
    await ensureEmptyFile(join(hiveRoot, "events", "events.jsonl"));
  }

  await ensureGitignoreLine(repositoryRoot);
  await bootstrapTokenGovernor(hiveRoot);

  return {
    ok: true,
    created,
    repositoryRoot,
    hiveRoot,
    worktreeKind,
    persona,
  };
}

async function writeSettingsDefaults(hiveRoot: string, updatedAt: string): Promise<void> {
  const settings = {
    schemaVersion: 1 as const,
    autonomy: "supervised" as const,
    awayMode: false,
    pollIntervalMs: 60_000,
    maxReviewFailures: 3,
    featureCeilings: {},
    telemetry: "off" as const,
    updatedAt,
  };
  const payload = `${JSON.stringify(settings)}\n`;
  const path = join(hiveRoot, "settings.json");
  const tmp = join(hiveRoot, `.settings.json.${process.pid}.tmp`);
  await writeFile(tmp, payload, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

async function ensureHiveDirs(hiveRoot: string): Promise<void> {
  await Promise.all(HIVE_DIRS.map((name) => mkdir(join(hiveRoot, name), { recursive: true, mode: 0o700 })));
}

async function ensureEmptyFile(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, "", { encoding: "utf8", mode: 0o600 });
  }
}

async function readHiveManifest(hiveRoot: string): Promise<"missing" | "valid" | "mismatch" | "corrupt"> {
  try {
    const text = await readFile(join(hiveRoot, "hive.json"), "utf8");
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return "corrupt";
    const version = (value as { schemaVersion?: unknown }).schemaVersion;
    if (version === 1) return "valid";
    if (typeof version === "number") return "mismatch";
    return "corrupt";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "corrupt";
  }
}

async function quarantineHive(hiveRoot: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(hiveRoot, "quarantine", stamp);
  await mkdir(dest, { recursive: true, mode: 0o700 });
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(hiveRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "quarantine") continue;
    await rename(join(hiveRoot, entry.name), join(dest, entry.name));
  }
}

async function ensureGitignoreLine(repositoryRoot: string): Promise<void> {
  const gitignorePath = join(repositoryRoot, ".gitignore");
  let text = "";
  try {
    text = await readFile(gitignorePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const lines = text.length === 0 ? [] : text.split(/\r?\n/);
  if (lines.some((line) => line.trim() === GITIGNORE_LINE)) return;
  const suffix = text.length > 0 && !text.endsWith("\n") ? "\n" : text.length === 0 ? "" : "";
  await writeFile(gitignorePath, `${text}${suffix}${GITIGNORE_LINE}\n`, "utf8");
}

function detectWorktreeKind(cwd: string): "main" | "linked" {
  let dir = cwd;
  for (;;) {
    const gitPath = join(dir, ".git");
    try {
      const st = statSync(gitPath);
      if (st.isDirectory()) return "main";
      if (st.isFile()) return "linked";
    } catch {
      // keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "main";
}
