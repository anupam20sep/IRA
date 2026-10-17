import { statSync } from "node:fs";
import { join } from "node:path";
import { registerTokenGovernor } from "./hooks-impl.js";
import { ensureTokenLayout } from "./paths.js";

function hiveLayoutPresent(hiveRoot: string): boolean {
  try {
    return statSync(join(hiveRoot, "hive.json")).isFile();
  } catch {
    return false;
  }
}

/** Ensure token storage and wire TokenHooks after a successful hive init. */
export async function bootstrapTokenGovernor(hiveRoot: string): Promise<void> {
  if (!hiveLayoutPresent(hiveRoot)) return;
  await ensureTokenLayout(hiveRoot);
  registerTokenGovernor(hiveRoot);
}

/** Register TokenHooks when the hive manifest exists; no-op otherwise (forge without hive). */
export function registerTokenGovernorIfHive(hiveRoot: string): void {
  if (!hiveLayoutPresent(hiveRoot)) return;
  registerTokenGovernor(hiveRoot);
}
