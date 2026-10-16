import { statSync } from "node:fs";
import { join } from "node:path";
import { registerCommandPlaneHooks } from "../command-plane/hooks.js";
import { createEngineHooks } from "./hooks-impl.js";

export type RegisterEngineHooksDeps = {
  registerCommandPlaneHooks: typeof registerCommandPlaneHooks;
};

/** Wire engine hooks into the command-plane registry (OD-015 fail-closed lives in safe* callers). */
export function registerEngineHooks(hiveRoot: string, deps?: RegisterEngineHooksDeps): void {
  const register = deps?.registerCommandPlaneHooks ?? registerCommandPlaneHooks;
  register({ engine: createEngineHooks(hiveRoot) });
}

function hiveLayoutPresent(hiveRoot: string): boolean {
  try {
    return statSync(join(hiveRoot, "hive.json")).isFile();
  } catch {
    return false;
  }
}

/** Register engine hooks when `hiveRoot` exists; no-op otherwise (detect paths stay usable). */
export function registerEngineHooksIfHive(hiveRoot: string, deps?: RegisterEngineHooksDeps): void {
  if (!hiveLayoutPresent(hiveRoot)) return;
  registerEngineHooks(hiveRoot, deps);
}
