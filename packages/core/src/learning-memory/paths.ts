import { join } from "node:path";
import { resolveRepositoryRoot } from "../command-plane/paths.js";

/** Project-local pattern store under the forge/hive repository root. */
export type PatternStoreRootResult =
  | {
      ok: true;
      repositoryRoot: string;
      patternsDir: string;
      indexPath: string;
      lockPath: string;
    }
  | { ok: false; code: "PATTERNS_ROOT_UNRESOLVED"; message: string };

const UNRESOLVED_MESSAGE =
  "Pattern store root is unresolved. Add program.md at the SuperSpec repository root.";

/**
 * Resolve canonical pattern-store paths for `cwd`.
 *
 * Repository root matches forge and hive resolution (`program.md`, linked
 * worktrees, `SUPERSPEC_ROOT`). The store is
 * `<repository-root>/.superspec/patterns/`, outside any spec `.superspec/`.
 */
export function resolvePatternStoreRoot(cwd: string): PatternStoreRootResult {
  const resolved = resolveRepositoryRoot(cwd);
  if (!resolved.ok) {
    return { ok: false, code: "PATTERNS_ROOT_UNRESOLVED", message: UNRESOLVED_MESSAGE };
  }
  const patternsDir = join(resolved.repositoryRoot, ".superspec", "patterns");
  return {
    ok: true,
    repositoryRoot: resolved.repositoryRoot,
    patternsDir,
    indexPath: join(patternsDir, "index.sqlite"),
    lockPath: join(patternsDir, ".index.lock"),
  };
}

/**
 * Reject a pattern id that is not a single filename segment.
 * Empty ids, `.`, embedded `..`, separators, and NUL are unsafe.
 */
export function assertSafePatternId(id: string): void {
  if (!isSinglePathSegment(id)) {
    throw new Error(`Unsafe pattern id: ${JSON.stringify(id)}`);
  }
}

function isSinglePathSegment(id: string): boolean {
  if (id.length === 0 || id === ".") return false;
  return !id.includes("..") && !id.includes("\0") && !id.includes("/") && !id.includes("\\");
}
