import { execFile as nodeExecFile } from "node:child_process";
import { join } from "node:path";
import { listBuiltinPresets } from "./catalog.js";

const VERSION_TIMEOUT_MS = 1500;

export type DetectInstalledRow = {
  engineId: string;
  installed: boolean;
  binary: string | null;
};

export type DetectInstalledOptions = {
  envPath?: string;
  execFile?: typeof nodeExecFile;
};

type ExecFileFn = typeof nodeExecFile;

function splitPath(envPath: string): string[] {
  return envPath.split(process.platform === "win32" ? ";" : ":").filter(Boolean);
}

function versionOutput(stdout: string | Buffer, stderr: string | Buffer): string {
  return `${stdout}${stderr}`;
}

function probeVersion(
  execFile: ExecFileFn,
  binaryPath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binaryPath,
      ["--version"],
      { timeout: VERSION_TIMEOUT_MS, shell: false },
      (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(versionOutput(stdout, stderr));
      },
    );
  });
}

async function resolveInstalledBinary(
  execFile: ExecFileFn,
  binaryNames: readonly string[],
  pathDirs: string[],
  requireCursorInVersion?: boolean,
): Promise<string | null> {
  for (const name of binaryNames) {
    for (const dir of pathDirs) {
      const candidate = join(dir, name);
      try {
        const output = await probeVersion(execFile, candidate);
        if (requireCursorInVersion && name === "agent" && !output.includes("Cursor")) {
          continue;
        }
        return candidate;
      } catch {
        // try next PATH entry or binary alias
      }
    }
  }
  return null;
}

async function detectPreset(
  execFile: ExecFileFn,
  engineId: string,
  binaryNames: readonly string[],
  pathDirs: string[],
): Promise<DetectInstalledRow> {
  if (engineId === "cursor-agent") {
    let binary = await resolveInstalledBinary(execFile, ["cursor-agent"], pathDirs);
    if (!binary) {
      binary = await resolveInstalledBinary(execFile, ["agent"], pathDirs, true);
    }
    return { engineId, installed: binary !== null, binary };
  }

  const binary = await resolveInstalledBinary(execFile, binaryNames, pathDirs);
  return { engineId, installed: binary !== null, binary };
}

export async function detectInstalled(
  options: DetectInstalledOptions = {},
): Promise<DetectInstalledRow[]> {
  const execFile = options.execFile ?? nodeExecFile;
  const envPath = options.envPath ?? process.env.PATH ?? "";
  const pathDirs = splitPath(envPath);

  const presets = listBuiltinPresets();
  return Promise.all(
    presets.map((preset) =>
      detectPreset(execFile, preset.engineId, preset.binaries, pathDirs),
    ),
  );
}
