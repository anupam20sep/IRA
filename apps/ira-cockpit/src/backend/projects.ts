import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export type ProjectConfigEntry = {
  id?: string;
  name?: string;
  path: string;
};

export type ResolvedProject = {
  id: string;
  name: string;
  path: string;
};

export type OnboardProjectInput = {
  path: string;
  name?: string;
  id?: string;
};

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function shortHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).slice(0, 6);
}

export function projectIdFromPath(absPath: string, explicitId?: string): string {
  if (explicitId?.trim()) return slugify(explicitId) || `p-${shortHash(absPath)}`;
  const base = slugify(basename(absPath)) || "project";
  return `${base}-${shortHash(absPath)}`;
}

export function projectNameFromPath(absPath: string, explicitName?: string): string {
  if (explicitName?.trim()) return explicitName.trim();
  return basename(absPath) || absPath;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

type RawIraConfig = {
  repositoryRoot?: string;
  projects?: ProjectConfigEntry[];
  [key: string]: unknown;
};

function configPaths(cockpitCwd: string): string[] {
  return [
    join(cockpitCwd, "ira.config.json"),
    join(cockpitCwd, "public", "ira.config.json"),
  ];
}

async function readIraConfig(cockpitCwd: string): Promise<RawIraConfig> {
  for (const file of configPaths(cockpitCwd)) {
    try {
      const text = await readFile(file, "utf8");
      return JSON.parse(text) as RawIraConfig;
    } catch {
      // try next
    }
  }
  return {};
}

async function writeIraConfig(cockpitCwd: string, config: RawIraConfig): Promise<void> {
  const payload = `${JSON.stringify(config, null, 2)}\n`;
  for (const file of configPaths(cockpitCwd)) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, payload, "utf8");
  }
}

function resolveConfiguredPath(cockpitCwd: string, configured: string): string {
  if (isAbsolute(configured)) return resolve(configured);
  return resolve(cockpitCwd, configured);
}

function entriesFromConfig(raw: RawIraConfig, cockpitCwd: string): ProjectConfigEntry[] {
  // Explicit projects array (including []) wins — empty means no projects yet.
  if (Array.isArray(raw.projects)) {
    return raw.projects.filter((p) => typeof p?.path === "string" && p.path.trim());
  }
  if (raw.repositoryRoot) return [{ path: String(raw.repositoryRoot) }];
  return [{ path: resolve(cockpitCwd, "../..") }];
}

/**
 * Resolve local project roots from ira.config.json.
 * A project is a repository root — not a SuperSpec feature folder.
 */
export async function resolveConfiguredProjects(
  cockpitCwd: string,
): Promise<ResolvedProject[]> {
  const raw = await readIraConfig(cockpitCwd);
  const entries = entriesFromConfig(raw, cockpitCwd);

  const out: ResolvedProject[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const abs = resolveConfiguredPath(cockpitCwd, entry.path.trim());
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!(await pathExists(abs))) continue;
    out.push({
      id: projectIdFromPath(abs, entry.id),
      name: projectNameFromPath(abs, entry.name),
      path: abs,
    });
  }

  return out;
}

export function findProject(
  projects: ResolvedProject[],
  projectId: string | null | undefined,
): ResolvedProject | null {
  if (!projects.length) return null;
  if (!projectId) return projects[0] ?? null;
  return projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
}

/**
 * Onboard a local repo path into ira.config.json (persisted for Vite backend).
 */
export async function onboardProject(
  cockpitCwd: string,
  input: OnboardProjectInput,
): Promise<ResolvedProject> {
  const trimmed = input.path.trim();
  if (!trimmed) throw new Error("path is required");

  const abs = resolveConfiguredPath(cockpitCwd, trimmed);
  let st;
  try {
    st = await stat(abs);
  } catch {
    throw new Error(`Path does not exist: ${abs}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`Path is not a directory: ${abs}`);
  }

  const id = projectIdFromPath(abs, input.id);
  const name = projectNameFromPath(abs, input.name);

  const raw = await readIraConfig(cockpitCwd);
  const existing = entriesFromConfig(raw, cockpitCwd);
  const absSet = new Set(
    existing.map((e) => resolveConfiguredPath(cockpitCwd, e.path.trim())),
  );
  if (absSet.has(abs)) {
    throw new Error(`Project already onboarded: ${abs}`);
  }

  const nextEntry: ProjectConfigEntry = { id, name, path: abs };
  const projects = [
    ...existing.map((e) => ({
      ...e,
      path: resolveConfiguredPath(cockpitCwd, e.path.trim()),
    })),
    nextEntry,
  ];

  const next: RawIraConfig = {
    ...raw,
    projects,
    repositoryRoot: projects[0]?.path ?? abs,
  };
  await writeIraConfig(cockpitCwd, next);

  return { id, name, path: abs };
}

/**
 * Remove a configured project by id (or by absolute path match).
 */
export async function removeConfiguredProject(
  cockpitCwd: string,
  projectId: string,
): Promise<{ removed: boolean; projects: ResolvedProject[] }> {
  if (!projectId.trim()) throw new Error("projectId is required");

  const raw = await readIraConfig(cockpitCwd);
  const existing = entriesFromConfig(raw, cockpitCwd);
  const remaining = existing.filter((e) => {
    const abs = resolveConfiguredPath(cockpitCwd, e.path.trim());
    const id = projectIdFromPath(abs, e.id);
    return id !== projectId && abs !== projectId;
  });

  if (remaining.length === existing.length) {
    return {
      removed: false,
      projects: await resolveConfiguredProjects(cockpitCwd),
    };
  }

  const projects = remaining.map((e) => {
    const abs = resolveConfiguredPath(cockpitCwd, e.path.trim());
    return {
      id: projectIdFromPath(abs, e.id),
      name: projectNameFromPath(abs, e.name),
      path: abs,
    };
  });

  await writeIraConfig(cockpitCwd, {
    ...raw,
    projects: projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
    repositoryRoot: projects[0]?.path ?? "",
  });

  return {
    removed: true,
    projects: await resolveConfiguredProjects(cockpitCwd),
  };
}
