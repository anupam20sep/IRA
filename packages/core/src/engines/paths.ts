import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapEnginesFiles } from "./store.js";

export { resolveHiveRoot } from "./store.js";

export function enginesRoot(hiveRoot: string): string {
  return join(hiveRoot, "engines");
}

export type EnsureEnginesLayoutResult =
  | { ok: true }
  | { ok: false; error: "HIVE_NOT_INITIALIZED" | "LEDGER_BUSY" };

/**
 * Ensure `engines/` exists with default policy and JSON stubs.
 * Idempotent: existing files are not overwritten.
 */
export async function ensureEnginesLayout(hiveRoot: string): Promise<EnsureEnginesLayoutResult> {
  const root = enginesRoot(hiveRoot);
  await mkdir(join(hiveRoot, "locks"), { recursive: true, mode: 0o700 });
  await mkdir(root, { recursive: true, mode: 0o700 });

  const boot = await bootstrapEnginesFiles(hiveRoot, root);
  if (!boot.ok) return boot;
  return { ok: true };
}
