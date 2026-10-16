import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";
import { LEDGER_LOCK_WAIT_MS, withLock, writeJsonAtomic } from "../command-plane/store.js";
import { resolveRepositoryRoot } from "../command-plane/paths.js";
import { FailoverPolicySchema, type FailoverPolicy } from "./schema.js";

export type EnginesStoreError = "HIVE_NOT_INITIALIZED" | "LEDGER_BUSY";

export type ReadPolicyResult =
  | { ok: true; policy: FailoverPolicy }
  | { ok: false; error: EnginesStoreError };

export type WritePolicyResult = { ok: true } | { ok: false; error: EnginesStoreError };

export function defaultFailoverPolicy(): FailoverPolicy {
  return {
    schemaVersion: 1,
    failoverEnabled: true,
    ladder: ["subscription", "byok", "local"],
    crossEngineReview: false,
    delegateToHost: null,
    hitl: ["budget_exceed", "destructive_git"],
    quotaGroups: [],
  };
}

export function enginesLockPath(hiveRoot: string): string {
  return join(hiveRoot, "locks", "ledger-engines.lock");
}

export async function hiveInitialized(hiveRoot: string): Promise<boolean> {
  try {
    await access(join(hiveRoot, "hive.json"), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve hive root from cwd; requires `hive.json`. */
export async function resolveHiveRoot(
  cwd: string,
): Promise<{ ok: true; hiveRoot: string } | { ok: false; error: "HIVE_ROOT_UNRESOLVED" | "HIVE_NOT_INITIALIZED" }> {
  const resolved = resolveRepositoryRoot(cwd);
  if (!resolved.ok) return { ok: false, error: "HIVE_ROOT_UNRESOLVED" };
  if (!(await hiveInitialized(resolved.hiveRoot))) {
    return { ok: false, error: "HIVE_NOT_INITIALIZED" };
  }
  return { ok: true, hiveRoot: resolved.hiveRoot };
}

export async function readPolicy(hiveRoot: string): Promise<ReadPolicyResult> {
  if (!(await hiveInitialized(hiveRoot))) {
    return { ok: false, error: "HIVE_NOT_INITIALIZED" };
  }
  const path = join(hiveRoot, "engines", "policy.json");
  try {
    const text = await readFile(path, "utf8");
    const policy = FailoverPolicySchema.parse(JSON.parse(text));
    return { ok: true, policy };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, policy: defaultFailoverPolicy() };
    }
    throw err;
  }
}

export async function writePolicy(hiveRoot: string, policy: FailoverPolicy): Promise<WritePolicyResult> {
  if (!(await hiveInitialized(hiveRoot))) {
    return { ok: false, error: "HIVE_NOT_INITIALIZED" };
  }
  const parsed = FailoverPolicySchema.parse(policy);
  const locked = await withLock(enginesLockPath(hiveRoot), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    await writeJsonAtomic(join(hiveRoot, "engines", "policy.json"), parsed);
  });
  if (!locked.ok) return { ok: false, error: "LEDGER_BUSY" };
  return { ok: true };
}

export async function bootstrapEnginesFiles(hiveRoot: string, enginesDir: string): Promise<WritePolicyResult> {
  const locked = await withLock(enginesLockPath(hiveRoot), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    await writeJsonIfMissing(join(enginesDir, "policy.json"), defaultFailoverPolicy());
    await writeJsonIfMissing(join(enginesDir, "custom.json"), { schemaVersion: 1, engines: [] });
    await writeJsonIfMissing(join(enginesDir, "health.json"), {});
    await writeJsonIfMissing(join(enginesDir, "local-pack.json"), {});
  });
  if (!locked.ok) return { ok: false, error: "LEDGER_BUSY" };
  return { ok: true };
}

async function writeJsonIfMissing(filePath: string, value: unknown): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    await writeJsonAtomic(filePath, value);
  }
}
