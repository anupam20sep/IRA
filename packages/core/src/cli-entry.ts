import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRepositoryRoot } from "./command-plane/paths.js";
import { registerEngineHooksIfHive } from "./engines/register.js";

/** True when this module is the process entry script (node dist/cli.js). */
export function isDirectRun(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    const modulePath = resolve(fileURLToPath(moduleUrl));
    const entry = resolve(argv1);
    if (modulePath === entry) return true;
    if (process.platform === "win32" && modulePath.toLowerCase() === entry.toLowerCase()) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function binEntryName(argv1: string | undefined): string {
  if (!argv1) return "";
  return basename(argv1).replace(/\.(cmd|ps1|exe)$/i, "");
}

/** Resolve hive from cwd and register engine hooks when the hive layout exists. */
export function bootstrapEngineHooksFromCwd(cwd: string = process.cwd()): void {
  const resolved = resolveRepositoryRoot(cwd);
  if (!resolved.ok) return;
  registerEngineHooksIfHive(resolved.hiveRoot);
}

if (process.env.VITEST !== "true") {
  bootstrapEngineHooksFromCwd();
}

