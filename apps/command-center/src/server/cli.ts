import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RunSuperspecResult =
  | { ok: true; json: unknown }
  | { ok: false; error: string };

export type RunSuperspecOptions = {
  cwd: string;
  timeoutMs: number;
};

const DEFAULT_BIN_REL = join("packages", "core", "bin", "superspec.js");

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

async function resolveSuperspecScript(cwd: string): Promise<string> {
  const override = process.env.SUPERSPEC_BIN?.trim();
  if (override) return isAbsolute(override) ? override : resolve(cwd, override);

  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) {
    throw new Error("Could not resolve repository root (program.md not found).");
  }
  return join(repositoryRoot, DEFAULT_BIN_REL);
}

function parseStdoutJson(stdout: string): RunSuperspecResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { ok: false, error: "CLI stdout was empty; expected a JSON object." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "CLI stdout is not valid JSON." };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "CLI stdout is not a single JSON object." };
  }

  return { ok: true, json: parsed };
}

export async function runSuperspec(
  argv: string[],
  opts: RunSuperspecOptions,
): Promise<RunSuperspecResult> {
  let scriptPath: string;
  try {
    scriptPath = await resolveSuperspecScript(opts.cwd);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const nodeBin = process.execPath;

  try {
    const { stdout, stderr } = await execFileAsync(nodeBin, [scriptPath, ...argv], {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
      env: process.env,
    });

    const parsed = parseStdoutJson(stdout);
    if (!parsed.ok) return parsed;

    return parsed;
  } catch (err: unknown) {
    const execErr = err as {
      stdout?: string | Buffer;
      message?: string;
      killed?: boolean;
      signal?: string;
    };

    if (execErr.killed || execErr.signal === "SIGTERM") {
      return { ok: false, error: `CLI timed out after ${opts.timeoutMs}ms.` };
    }

    const stdout = execErr.stdout ? String(execErr.stdout) : "";
    if (stdout.trim()) {
      const parsed = parseStdoutJson(stdout);
      if (parsed.ok) return parsed;
    }

    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ETIMEDOUT") || message.includes("timed out")) {
      return { ok: false, error: `CLI timed out after ${opts.timeoutMs}ms.` };
    }
    return { ok: false, error: message };
  }
}
