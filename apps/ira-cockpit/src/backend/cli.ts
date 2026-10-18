import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CliResult =
  | { ok: true; json: unknown; raw: string }
  | { ok: false; error: string; raw?: string };

async function findRepositoryRoot(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);
  for (;;) {
    try {
      await access(join(dir, "program.md"), constants.R_OK);
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

export async function resolveRepoRoot(cwd: string): Promise<string> {
  const found = await findRepositoryRoot(cwd);
  if (!found) throw new Error(`Could not resolve repository root from ${cwd}`);
  return found;
}

async function findCliUnder(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);
  for (;;) {
    for (const rel of ["packages/core/dist/cli.js", "packages/core/bin/superspec.js"]) {
      const candidate = join(dir, rel);
      try {
        await access(candidate, constants.R_OK);
        return candidate;
      } catch {
        // try next
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Locate superspec CLI. Onboarded projects are often outside the Ira monorepo,
 * so we search upward from the project, then from cwd, then SUPERSPEC_BIN.
 */
export async function resolveSuperspecBin(repoRoot: string): Promise<string> {
  const override = process.env.SUPERSPEC_BIN?.trim();
  if (override) {
    return isAbsolute(override) ? override : resolve(repoRoot, override);
  }
  const found =
    (await findCliUnder(repoRoot)) ?? (await findCliUnder(process.cwd()));
  if (found) return found;
  throw new Error(
    "superspec CLI not found (set SUPERSPEC_BIN or build packages/core)",
  );
}

async function execSuperspec(
  repoRoot: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: true; raw: string } | { ok: false; error: string; raw?: string }> {
  let bin: string;
  try {
    bin = await resolveSuperspecBin(repoRoot);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bin, ...args], {
      cwd: repoRoot,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        NO_COLOR: "1",
        // Scope hive/doctor to this onboarded project, not a parent monorepo git root
        SUPERSPEC_ROOT: repoRoot,
      },
    });
    const raw = String(stdout || stderr || "").trim();
    if (!raw) return { ok: false, error: "empty CLI stdout", raw };
    return { ok: true, raw };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const raw = String(e.stdout || e.stderr || e.message || err);
    return { ok: false, error: raw.slice(0, 2000), raw };
  }
}

/** Run superspec and return raw stdout (JSON or text reports). */
export async function runSuperspecRaw(
  repoRoot: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ ok: true; raw: string } | { ok: false; error: string; raw?: string }> {
  return execSuperspec(repoRoot, args, timeoutMs);
}

export async function runSuperspecJson(
  repoRoot: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<CliResult> {
  const res = await execSuperspec(repoRoot, args, timeoutMs);
  if (!res.ok) {
    try {
      const json = JSON.parse((res.raw ?? "").trim()) as unknown;
      return { ok: true, json, raw: res.raw ?? "" };
    } catch {
      return { ok: false, error: res.error, raw: res.raw };
    }
  }
  try {
    const json = JSON.parse(res.raw) as unknown;
    return { ok: true, json, raw: res.raw };
  } catch {
    return { ok: false, error: "CLI stdout is not JSON", raw: res.raw };
  }
}
