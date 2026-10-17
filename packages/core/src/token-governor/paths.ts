import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapTokenLayout } from "./init-token.js";

export function tokenRoot(hiveRoot: string): string {
  return join(hiveRoot, "token");
}

export type EnsureTokenLayoutResult =
  | { ok: true }
  | { ok: false; error: "HIVE_NOT_INITIALIZED"; message: string };

/**
 * Ensure `hive/token/` layout exists with default settings and JSON stubs.
 * Idempotent: existing files are not overwritten.
 */
export async function ensureTokenLayout(hiveRoot: string): Promise<EnsureTokenLayoutResult> {
  const root = tokenRoot(hiveRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await bootstrapTokenLayout(root);
  return { ok: true };
}
