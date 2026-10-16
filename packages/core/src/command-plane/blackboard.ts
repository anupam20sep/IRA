import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ForgeStatus } from "../forge-loop.js";
import { featureIdSchema } from "./schema.js";
import { lockWaitMs, withLock, writeJsonAtomic } from "./store.js";
import type { CommandPlaneErrorCode } from "./types.js";

export type CiState = "green" | "red" | "absent";

export type BlackboardCi = {
  state: CiState;
  source: string;
  at: string;
};

export type BlackboardFeature = {
  planPath?: string;
  specDir?: string;
  forge?: ForgeStatus;
  ci?: BlackboardCi | null;
};

export type BlackboardDoc = {
  scribe: "ira";
  updatedAt: string;
  features: Record<string, BlackboardFeature>;
};

export type CiGateReason = "ci_absent" | "ci_not_green";

export type CiGateResult = { pass: true; reason: null } | { pass: false; reason: CiGateReason };

/** OD-013 away CI gate before dispatch-task. */
export function evaluateCiGate(input: {
  ci: CiState | null;
  allowAbsentCi: boolean;
}): CiGateResult {
  if (input.ci === "green") return { pass: true, reason: null };
  if (input.ci === "red") return { pass: false, reason: "ci_not_green" };
  if (input.allowAbsentCi === true) return { pass: true, reason: null };
  return { pass: false, reason: "ci_absent" };
}

export type BlackboardUpdateResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: Extract<CommandPlaneErrorCode, "SCRIBE_BUSY" | "HIVE_CORRUPT"> };

/**
 * Single-scribe read-modify-write for blackboard.json.
 * Uses the blackboard lock with its 0 ms wait bound.
 */
export async function blackboardUpdate<T>(
  hiveRoot: string,
  mutate: (doc: BlackboardDoc) => T,
): Promise<BlackboardUpdateResult<T>> {
  const lockPath = join(hiveRoot, "locks", "blackboard.lock");
  const blackboardPath = join(hiveRoot, "blackboard.json");
  const waitMs = lockWaitMs(lockPath);

  const locked = await withLock(lockPath, { waitMs }, async () => {
    const doc = await readBlackboard(blackboardPath);
    if (!doc) return { ok: false as const, code: "HIVE_CORRUPT" as const };
    const value = mutate(doc);
    doc.updatedAt = new Date().toISOString();
    await writeJsonAtomic(blackboardPath, doc);
    return { ok: true as const, value };
  });

  if (!locked.ok) {
    return { ok: false, code: locked.code };
  }
  if (locked.value.ok === false) {
    return locked.value;
  }
  return { ok: true, value: locked.value.value };
}

export type HiveCiSetInput = {
  hiveRoot: string;
  featureId: string;
  state: CiState;
  source: string;
};

export type HiveCiSetResult =
  | { ok: true; ci: BlackboardCi }
  | {
      ok: false;
      error: Extract<CommandPlaneErrorCode, "INVALID_INPUT" | "SCRIBE_BUSY" | "HIVE_CORRUPT">;
      message: string;
    };

/** Local write of CI gate state onto a feature blackboard entry (hive-ci-set). */
export async function hiveCiSet(input: HiveCiSetInput): Promise<HiveCiSetResult> {
  const featureId = featureIdSchema.safeParse(input.featureId);
  if (!featureId.success) {
    return { ok: false, error: "INVALID_INPUT", message: "invalid featureId" };
  }
  if (typeof input.source !== "string" || input.source.length === 0) {
    return { ok: false, error: "INVALID_INPUT", message: "source is required" };
  }
  const ci: BlackboardCi = {
    state: input.state,
    source: input.source,
    at: new Date().toISOString(),
  };

  const updated = await blackboardUpdate(input.hiveRoot, (doc) => {
    const existing = doc.features[featureId.data] ?? {};
    doc.features[featureId.data] = { ...existing, ci };
    return ci;
  });

  if (!updated.ok) {
    return { ok: false, error: updated.code, message: `blackboard update failed: ${updated.code}` };
  }
  return { ok: true, ci: updated.value };
}

async function readBlackboard(blackboardPath: string): Promise<BlackboardDoc | null> {
  try {
    const text = await readFile(blackboardPath, "utf8");
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return null;
    const scribe = (value as { scribe?: unknown }).scribe;
    const updatedAt = (value as { updatedAt?: unknown }).updatedAt;
    const features = (value as { features?: unknown }).features;
    if (scribe !== "ira") return null;
    if (typeof updatedAt !== "string") return null;
    if (!features || typeof features !== "object" || Array.isArray(features)) return null;
    return {
      scribe: "ira",
      updatedAt,
      features: features as Record<string, BlackboardFeature>,
    };
  } catch {
    return null;
  }
}
