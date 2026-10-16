import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveRepositoryRoot } from "../../src/command-plane/paths.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

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
  const root = await mkdtemp(join(tmpdir(), "cp-path-"));
  roots.push(root);
  return root;
}

/** Synthetic linked worktree: `.git` file plus `commondir` under the main git dir. */
async function linkedWorktree(main: string): Promise<{ worktree: string; nested: string }> {
  const gitDir = join(main, ".git", "worktrees", "hire");
  const worktree = join(main, ".worktrees", "hire");
  const nested = join(worktree, "pkg", "src");
  await mkdir(gitDir, { recursive: true });
  await mkdir(nested, { recursive: true });
  await writeFile(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
  await writeFile(join(gitDir, "commondir"), "../..\n");
  await writeFile(join(worktree, "program.md"), "# worktree\n");
  return { worktree, nested };
}

describe("resolveRepositoryRoot", () => {
  it("anchors hive under main root with program.md", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "program.md"), "# p\n");
    process.env.SUPERSPEC_ROOT = root;
    const res = resolveRepositoryRoot(root);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.repositoryRoot).toBe(resolve(root));
      expect(res.hiveRoot).toBe(join(root, ".superspec/hive"));
    }
    delete process.env.SUPERSPEC_ROOT;
  });

  it("uses SUPERSPEC_ROOT even when cwd is a linked worktree", async () => {
    const main = await tempRoot();
    await mkdir(join(main, ".git"), { recursive: true });
    await writeFile(join(main, "program.md"), "# p\n");
    const { nested } = await linkedWorktree(main);
    const override = await tempRoot();
    await writeFile(join(override, "program.md"), "# override\n");
    process.env.SUPERSPEC_ROOT = override;

    const res = resolveRepositoryRoot(nested);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.repositoryRoot).toBe(resolve(override));
      expect(res.hiveRoot).toBe(join(override, ".superspec/hive"));
    }
  });

  it("returns HIVE_ROOT_UNRESOLVED when SUPERSPEC_ROOT has no program.md", async () => {
    const override = await tempRoot();
    const cwd = await tempRoot();
    await writeFile(join(cwd, "program.md"), "# p\n");
    process.env.SUPERSPEC_ROOT = override;

    const res = resolveRepositoryRoot(cwd);

    expect(res).toEqual({ ok: false, error: "HIVE_ROOT_UNRESOLVED" });
  });

  it("anchors a main worktree .git directory at the directory that contains program.md", async () => {
    const main = await tempRoot();
    await mkdir(join(main, ".git"), { recursive: true });
    await writeFile(join(main, "program.md"), "# p\n");
    const cwd = join(main, "pkg", "src");
    await mkdir(cwd, { recursive: true });

    const res = resolveRepositoryRoot(cwd);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.repositoryRoot).toBe(resolve(main));
      expect(res.hiveRoot).toBe(join(main, ".superspec/hive"));
    }
  });

  it("anchors a linked worktree hive on the main root, not the worktree", async () => {
    const main = await tempRoot();
    await mkdir(join(main, ".git"), { recursive: true });
    await writeFile(join(main, "program.md"), "# p\n");
    const { worktree, nested } = await linkedWorktree(main);

    const res = resolveRepositoryRoot(nested);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.repositoryRoot).toBe(resolve(main));
      expect(res.hiveRoot).toBe(join(main, ".superspec/hive"));
      expect(res.hiveRoot).not.toBe(join(worktree, ".superspec/hive"));
    }
  });

  it("resolves a relative gitdir file before reading commondir", async () => {
    const main = await tempRoot();
    await writeFile(join(main, "program.md"), "# p\n");
    const gitDir = join(main, ".git", "worktrees", "hire");
    const worktree = join(main, ".worktrees", "hire");
    const nested = join(worktree, "src");
    await mkdir(gitDir, { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(join(worktree, ".git"), "gitdir: ../../.git/worktrees/hire\n");
    await writeFile(join(gitDir, "commondir"), "../..\n");
    await writeFile(join(worktree, "program.md"), "# worktree\n");

    const res = resolveRepositoryRoot(nested);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.repositoryRoot).toBe(resolve(main));
      expect(res.hiveRoot).toBe(join(main, ".superspec/hive"));
    }
  });

  it("does not fork a hive when a linked worktree has no commondir", async () => {
    const main = await tempRoot();
    await writeFile(join(main, "program.md"), "# p\n");
    const gitDir = join(main, ".git", "worktrees", "hire");
    const worktree = join(main, ".worktrees", "hire");
    await mkdir(gitDir, { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
    await writeFile(join(worktree, "program.md"), "# worktree\n");

    const res = resolveRepositoryRoot(worktree);

    expect(res).toEqual({ ok: false, error: "HIVE_ROOT_UNRESOLVED" });
  });

  it("does not walk above a main .git directory when that root lacks program.md", async () => {
    const parent = await tempRoot();
    await writeFile(join(parent, "program.md"), "# parent\n");
    const main = join(parent, "repo");
    await mkdir(join(main, ".git"), { recursive: true });
    const cwd = join(main, "src");
    await mkdir(cwd, { recursive: true });

    const res = resolveRepositoryRoot(cwd);

    expect(res).toEqual({ ok: false, error: "HIVE_ROOT_UNRESOLVED" });
  });

  it("does not fall back to a linked worktree program.md when the main root lacks one", async () => {
    const main = await tempRoot();
    await mkdir(join(main, ".git"), { recursive: true });
    const { nested } = await linkedWorktree(main);

    const res = resolveRepositoryRoot(nested);

    expect(res).toEqual({ ok: false, error: "HIVE_ROOT_UNRESOLVED" });
  });

  it("walks parents for program.md when no .git entry exists", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "program.md"), "# p\n");
    const cwd = join(root, "a", "b");
    await mkdir(cwd, { recursive: true });

    const res = resolveRepositoryRoot(cwd);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.repositoryRoot).toBe(resolve(root));
      expect(res.hiveRoot).toBe(join(root, ".superspec/hive"));
    }
  });

  it("returns HIVE_ROOT_UNRESOLVED when neither .git nor program.md exists", async () => {
    const cwd = await tempRoot();

    const res = resolveRepositoryRoot(cwd);

    expect(res).toEqual({ ok: false, error: "HIVE_ROOT_UNRESOLVED" });
  });
});
