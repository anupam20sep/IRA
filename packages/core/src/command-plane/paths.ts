import { readFileSync, statSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** FR-028 hive location under the main worktree that contains `program.md`. */
export type RepositoryRootResult =
  | { ok: true; repositoryRoot: string; hiveRoot: string }
  | { ok: false; error: "HIVE_ROOT_UNRESOLVED" };

/**
 * Resolve the repository root and hive path for `cwd`.
 *
 * A linked worktree's `.git` file is followed through `gitdir:` and `commondir`
 * so the hive stays on the main worktree. `SUPERSPEC_ROOT` skips that walk.
 */
export function resolveRepositoryRoot(cwd: string): RepositoryRootResult {
  const override = superspecRootOverride(cwd);
  if (override) return rootWithProgram(override);

  const start = resolve(cwd);
  const gitEntry = findUp(start, (dir) => {
    const git = join(dir, ".git");
    return statOrNull(git) ? git : null;
  });
  if (gitEntry) {
    const mainRoot = mainRootFromGitEntry(gitEntry);
    if (!mainRoot) return unresolved();
    return rootWithProgram(mainRoot);
  }

  const copied = findUp(start, (dir) => (isFile(join(dir, "program.md")) ? dir : null));
  if (!copied) return unresolved();
  return success(copied);
}

function superspecRootOverride(cwd: string): string | null {
  const raw = process.env.SUPERSPEC_ROOT?.trim();
  if (!raw) return null;
  return isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw);
}

function rootWithProgram(repositoryRoot: string): RepositoryRootResult {
  if (!isFile(join(repositoryRoot, "program.md"))) return unresolved();
  return success(repositoryRoot);
}

function success(repositoryRoot: string): Extract<RepositoryRootResult, { ok: true }> {
  return {
    ok: true,
    repositoryRoot,
    hiveRoot: join(repositoryRoot, ".superspec", "hive"),
  };
}

function unresolved(): RepositoryRootResult {
  return { ok: false, error: "HIVE_ROOT_UNRESOLVED" };
}

function mainRootFromGitEntry(gitPath: string): string | null {
  const info = statOrNull(gitPath);
  if (!info) return null;
  // Main worktree: `.git` is a directory. Linked worktrees are a `gitdir:` file.
  if (info.isDirectory()) return dirname(gitPath);
  if (!info.isFile()) return null;
  const gitDir = readGitDirPointer(gitPath);
  if (!gitDir) return null;
  return mainRootFromCommonDir(gitDir);
}

/** `gitdir:` is relative to the directory that contains the `.git` file. */
function readGitDirPointer(gitFile: string): string | null {
  const text = readText(gitFile);
  if (text === null) return null;
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith("gitdir:"));
  if (!line) return null;
  const raw = line.slice("gitdir:".length).trim();
  if (!raw) return null;
  return isAbsolute(raw) ? resolve(raw) : resolve(dirname(gitFile), raw);
}

/** `commondir` is relative to the linked worktree git dir. Main root is its parent. */
function mainRootFromCommonDir(gitDir: string): string | null {
  const raw = readText(join(gitDir, "commondir"))?.trim();
  if (!raw) return null;
  const shared = isAbsolute(raw) ? resolve(raw) : resolve(gitDir, raw);
  return dirname(shared);
}

function findUp<T>(start: string, pick: (dir: string) => T | null): T | null {
  let dir = start;
  for (;;) {
    const found = pick(dir);
    if (found !== null) return found;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function statOrNull(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function isFile(path: string): boolean {
  return statOrNull(path)?.isFile() ?? false;
}
