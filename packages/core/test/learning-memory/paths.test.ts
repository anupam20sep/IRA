import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolvePatternStoreRoot, assertSafePatternId } from "../../src/learning-memory/paths.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;

beforeEach(() => {
  delete process.env.SUPERSPEC_ROOT;
});

afterEach(async () => {
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lm-root-"));
  roots.push(root);
  return root;
}

/** Synthetic linked worktree: `.git` file plus `commondir` under the main git dir. */
async function linkedWorktree(main: string): Promise<{ worktree: string; nested: string }> {
  const gitDir = join(main, ".git", "worktrees", "learn");
  const worktree = join(main, ".worktrees", "learn");
  const nested = join(worktree, "specs", "003-ira-learning-memory");
  await mkdir(gitDir, { recursive: true });
  await mkdir(nested, { recursive: true });
  await writeFile(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
  await writeFile(join(gitDir, "commondir"), "../..\n");
  await writeFile(join(worktree, "program.md"), "# worktree\n");
  return { worktree, nested };
}

describe("resolvePatternStoreRoot", () => {
  it("resolves patterns dir under repo with program.md", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "program.md"), "# program\n");
    const r = resolvePatternStoreRoot(root);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repositoryRoot).toBe(resolve(root));
      expect(r.patternsDir).toBe(join(root, ".superspec", "patterns"));
      expect(r.indexPath).toBe(join(root, ".superspec", "patterns", "index.sqlite"));
      expect(r.lockPath).toBe(join(root, ".superspec", "patterns", ".index.lock"));
    }
  });

  it("keeps the store at the repository root when cwd is a spec directory", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "program.md"), "# program\n");
    const specDir = join(root, "specs", "003-ira-learning-memory");
    await mkdir(join(specDir, ".superspec"), { recursive: true });
    await writeFile(join(specDir, ".superspec", "state.json"), "{}\n");

    const r = resolvePatternStoreRoot(specDir);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repositoryRoot).toBe(resolve(root));
      expect(r.patternsDir).toBe(join(root, ".superspec", "patterns"));
      expect(r.patternsDir.startsWith(join(specDir, ".superspec"))).toBe(false);
    }
  });

  it("uses SUPERSPEC_ROOT even when cwd is a linked worktree spec dir", async () => {
    const main = await tempRoot();
    await mkdir(join(main, ".git"), { recursive: true });
    await writeFile(join(main, "program.md"), "# p\n");
    const { nested } = await linkedWorktree(main);
    const override = await tempRoot();
    await writeFile(join(override, "program.md"), "# override\n");
    process.env.SUPERSPEC_ROOT = override;

    const r = resolvePatternStoreRoot(nested);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repositoryRoot).toBe(resolve(override));
      expect(r.patternsDir).toBe(join(override, ".superspec", "patterns"));
      expect(r.indexPath).toBe(join(override, ".superspec", "patterns", "index.sqlite"));
      expect(r.lockPath).toBe(join(override, ".superspec", "patterns", ".index.lock"));
    }
  });

  it("resolves a relative SUPERSPEC_ROOT against cwd", async () => {
    const cwd = await tempRoot();
    const override = await tempRoot();
    await writeFile(join(cwd, "program.md"), "# cwd\n");
    await writeFile(join(override, "program.md"), "# override\n");
    process.env.SUPERSPEC_ROOT = relative(cwd, override);

    const r = resolvePatternStoreRoot(cwd);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repositoryRoot).toBe(resolve(override));
      expect(r.patternsDir).toBe(join(override, ".superspec", "patterns"));
    }
  });

  it("returns PATTERNS_ROOT_UNRESOLVED when SUPERSPEC_ROOT has no program.md", async () => {
    const override = await tempRoot();
    const cwd = await tempRoot();
    await writeFile(join(cwd, "program.md"), "# p\n");
    process.env.SUPERSPEC_ROOT = override;

    const r = resolvePatternStoreRoot(cwd);

    expect(r).toEqual({
      ok: false,
      code: "PATTERNS_ROOT_UNRESOLVED",
      message: "Pattern store root is unresolved. Add program.md at the SuperSpec repository root.",
    });
  });

  it("anchors a linked worktree store on the main root, not the worktree", async () => {
    const main = await tempRoot();
    await mkdir(join(main, ".git"), { recursive: true });
    await writeFile(join(main, "program.md"), "# p\n");
    const { worktree, nested } = await linkedWorktree(main);

    const r = resolvePatternStoreRoot(nested);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repositoryRoot).toBe(resolve(main));
      expect(r.patternsDir).toBe(join(main, ".superspec", "patterns"));
      expect(r.patternsDir.startsWith(worktree)).toBe(false);
    }
  });

  it("walks parents for program.md when no .git entry exists", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "program.md"), "# p\n");
    const cwd = join(root, "specs", "003-ira-learning-memory");
    await mkdir(cwd, { recursive: true });

    const r = resolvePatternStoreRoot(cwd);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repositoryRoot).toBe(resolve(root));
      expect(r.patternsDir).toBe(join(root, ".superspec", "patterns"));
    }
  });

  it("returns PATTERNS_ROOT_UNRESOLVED when neither .git nor program.md exists", async () => {
    const cwd = await tempRoot();

    const r = resolvePatternStoreRoot(cwd);

    expect(r).toEqual({
      ok: false,
      code: "PATTERNS_ROOT_UNRESOLVED",
      message: "Pattern store root is unresolved. Add program.md at the SuperSpec repository root.",
    });
  });
});

describe("assertSafePatternId", () => {
  it("rejects unsafe pattern ids", () => {
    expect(() => assertSafePatternId("../evil")).toThrow(/unsafe pattern id/i);
    expect(() => assertSafePatternId("..")).toThrow(/unsafe pattern id/i);
    expect(() => assertSafePatternId(".")).toThrow(/unsafe pattern id/i);
    expect(() => assertSafePatternId("")).toThrow(/unsafe pattern id/i);
    expect(() => assertSafePatternId("foo/../bar")).toThrow(/unsafe pattern id/i);
    expect(() => assertSafePatternId("foo/bar")).toThrow(/unsafe pattern id/i);
    expect(() => assertSafePatternId("foo\\bar")).toThrow(/unsafe pattern id/i);
    expect(() => assertSafePatternId("/tmp/pat_x")).toThrow(/unsafe pattern id/i);
    expect(() => assertSafePatternId("pat_foo..bar")).toThrow(/unsafe pattern id/i);
    expect(() => assertSafePatternId("pat_ok\0")).toThrow(/unsafe pattern id/i);
  });

  it("accepts a single path-segment pattern id", () => {
    expect(() => assertSafePatternId("pat_01JABC")).not.toThrow();
    expect(() => assertSafePatternId("pat_01.ABC-xyz")).not.toThrow();
  });
});
