import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { resolveRepositoryRoot } from "./paths.js";
import { AutonomySettingsSchema, featureIdSchema } from "./schema.js";
import { syncHiveFromForge, type SyncHiveFromForgeInput } from "./ledger-sync.js";

/** Same default the forge CLI and MCP use when no hive settings are available. */
const FORGE_DEFAULT_MAX_REVIEW_FAILURES = 3;

export type BeginTaskDecision = { ok: true } | { ok: false; code: "DISPATCH_PATH_REQUIRED" };

export type HiveAnchor =
  | { hiveExists: false }
  | {
      hiveExists: true;
      repositoryRoot: string;
      hiveRoot: string;
      featureId: string;
    };

/**
 * External begin-task is rejected once hive.json exists.
 * The in-process call from dispatch-task is the only begin-task that proceeds.
 */
export function assertBeginTaskAllowed(input: {
  hiveExists: boolean;
  internalFromDispatch: boolean;
}): BeginTaskDecision {
  if (input.hiveExists && !input.internalFromDispatch) {
    return { ok: false, code: "DISPATCH_PATH_REQUIRED" };
  }
  return { ok: true };
}

export function formatDispatchPathRequired(): string {
  return JSON.stringify(
    {
      ok: false,
      error: "DISPATCH_PATH_REQUIRED",
      message: "Direct begin-task is not the steer path while the hive exists.",
      hint: "Call dispatch-task. begin-task runs only after that command's hooks allow it.",
    },
    null,
    2,
  );
}

/**
 * Hive for this spec directory.
 * A spec outside the resolved repository stays on the pre-Ira forge path.
 */
export function resolveHiveAnchor(specDir: string): HiveAnchor {
  const resolved = resolveRepositoryRoot(specDir);
  if (!resolved.ok) return { hiveExists: false };
  const specAbs = resolve(specDir);
  if (!isInside(resolved.repositoryRoot, specAbs)) return { hiveExists: false };
  if (!isFile(join(resolved.hiveRoot, "hive.json"))) return { hiveExists: false };
  const featureId = basename(specAbs);
  return {
    hiveExists: true,
    repositoryRoot: resolved.repositoryRoot,
    hiveRoot: resolved.hiveRoot,
    featureId: featureIdSchema.safeParse(featureId).success ? featureId : "",
  };
}

/** Feature ceiling, else settings ceiling, else the forge default of 3. */
export async function readMaxReviewFailures(anchor: HiveAnchor): Promise<number> {
  if (!anchor.hiveExists) return FORGE_DEFAULT_MAX_REVIEW_FAILURES;
  try {
    const text = await readFile(join(anchor.hiveRoot, "settings.json"), "utf8");
    const parsed = AutonomySettingsSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return FORGE_DEFAULT_MAX_REVIEW_FAILURES;
    if (!anchor.featureId) return parsed.data.maxReviewFailures;
    return parsed.data.featureCeilings[anchor.featureId] ?? parsed.data.maxReviewFailures;
  } catch {
    return FORGE_DEFAULT_MAX_REVIEW_FAILURES;
  }
}

export function hiveSyncTarget(
  anchor: HiveAnchor,
  specDir: string,
  planPath: string,
): SyncHiveFromForgeInput & { hiveExists: boolean } {
  if (!anchor.hiveExists) {
    return { hiveExists: false, featureId: "", repositoryRoot: specDir, specDir, planPath };
  }
  return {
    hiveExists: true,
    featureId: anchor.featureId,
    repositoryRoot: anchor.repositoryRoot,
    specDir,
    planPath,
  };
}

/**
 * Mirror forge into the hive after a successful forge write.
 * Failure is recorded by syncHiveFromForge and must not escape to the forge caller.
 */
export async function maybeSyncHive(input: SyncHiveFromForgeInput & { hiveExists: boolean }): Promise<void> {
  try {
    if (!input.hiveExists) return;
    await syncHiveFromForge({
      featureId: input.featureId,
      repositoryRoot: input.repositoryRoot,
      specDir: input.specDir,
      planPath: input.planPath,
    });
  } catch {
    // Best-effort: a sync throw must not roll back state.json or fail the forge tool.
  }
}

function isInside(root: string, candidate: string): boolean {
  const rootAbs = resolve(root);
  const abs = resolve(candidate);
  return abs === rootAbs || abs.startsWith(rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
