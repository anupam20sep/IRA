import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getCachedHealth } from "./health.js";
import { CustomEnginesFileSchema, LocalPackProfileSchema } from "./schema.js";
import { hiveInitialized } from "./store.js";
import { listBuiltinPresets } from "./catalog.js";
import { LOCAL_CONTEXT_FLOOR } from "./types.js";

export type DoctorSeverity = "error" | "warning";

export type DoctorFinding = {
  code: string;
  severity: DoctorSeverity;
  message: string;
  remedy: string;
};

export type PostSliceARung = {
  engineId: string;
  healthy: boolean;
};

const ENGINE_BLOCKING = new Set([
  "ENGINE_SPAWN_UNSUPPORTED",
  "ENGINE_NONE_HEALTHY",
  "LOCAL_CONTEXT_BELOW_FLOOR",
  "LOCAL_CONTEXT_UNKNOWN",
]);

const LOCAL_RUNG_ONLY = new Set(["LOCAL_CONTEXT_BELOW_FLOOR", "LOCAL_CONTEXT_UNKNOWN"]);

const POST_SLICE_A_IDS = new Set(["opencode", "crush", "aider", "custom"]);

function finding(code: string, severity: DoctorSeverity, message: string, remedy: string): DoctorFinding {
  return { code, severity, message, remedy };
}

function contextMessage(model: string, shown: number | "unknown"): string {
  return `Local model "${model}" advertises ${shown} context; minimum is ${LOCAL_CONTEXT_FLOOR}. Raise context (Ollama: set num_ctx to at least ${LOCAL_CONTEXT_FLOOR}) or bind another model.`;
}

function hasBlocking(findings: readonly { code: string }[], codes: Set<string>): boolean {
  return findings.some((item) => codes.has(item.code));
}

/**
 * Rung health: host delegate, or a healthy post-Slice-A supervisor rung.
 * Local context findings fail the local rung only and do not block host delegate.
 */
export function computeEngineRungReady(
  findings: readonly DoctorFinding[],
  hostDelegateAvailable: boolean,
  postSliceARungs: readonly PostSliceARung[],
): boolean {
  const globalBlocking = findings.filter(
    (item) => ENGINE_BLOCKING.has(item.code) && !LOCAL_RUNG_ONLY.has(item.code),
  );
  if (hostDelegateAvailable && globalBlocking.length === 0) {
    return true;
  }
  const postHealthy = postSliceARungs.some((rung) => rung.healthy);
  if (postHealthy && globalBlocking.length === 0) {
    return true;
  }
  if (hostDelegateAvailable || postHealthy) {
    return false;
  }
  return !hasBlocking(findings, ENGINE_BLOCKING);
}

/** Engine findings never clear hiveReady; legacy `ready` mirrors hiveReady only. */
export function mergeDoctorReadiness(
  baseHiveReady: boolean,
  findings: readonly DoctorFinding[],
): { hiveReady: boolean; engineRungReady: boolean; ready: boolean } {
  const hiveReady = baseHiveReady;
  return {
    hiveReady,
    engineRungReady: computeEngineRungReady(findings, false, []),
    ready: hiveReady,
  };
}

async function localPackFindings(hiveRoot: string): Promise<DoctorFinding[]> {
  let text: string;
  try {
    text = await readFile(join(hiveRoot, "engines", "local-pack.json"), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object" || Object.keys(parsed as object).length === 0) {
    return [];
  }
  const profile = LocalPackProfileSchema.safeParse(parsed);
  if (!profile.success) return [];

  const ctx = profile.data.advertisedContext;
  const model = profile.data.model;
  if (ctx === null) {
    return [
      finding(
        "LOCAL_CONTEXT_UNKNOWN",
        "error",
        contextMessage(model, "unknown"),
        `Raise context to at least ${LOCAL_CONTEXT_FLOOR} or bind another model.`,
      ),
    ];
  }
  if (ctx < LOCAL_CONTEXT_FLOOR) {
    return [
      finding(
        "LOCAL_CONTEXT_BELOW_FLOOR",
        "error",
        contextMessage(model, ctx),
        `Raise context to at least ${LOCAL_CONTEXT_FLOOR} or bind another model.`,
      ),
    ];
  }
  return [];
}

async function customCatalogFinding(hiveRoot: string): Promise<DoctorFinding | null> {
  try {
    const text = await readFile(join(hiveRoot, "engines", "custom.json"), "utf8");
    const parsed = CustomEnginesFileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return finding(
        "ENGINE_CATALOG_MISMATCH",
        "error",
        "engines/custom.json schemaVersion is not 1 or the file is invalid.",
        "Fix custom.json to match schemaVersion 1 or remove the file and re-run superspec hive init.",
      );
    }
  } catch {
    // bootstrap creates valid custom.json
  }
  return null;
}

async function healthFindings(hiveRoot: string): Promise<DoctorFinding[]> {
  const out: DoctorFinding[] = [];
  for (const preset of listBuiltinPresets()) {
    const row = await getCachedHealth(hiveRoot, preset.engineId);
    if (!row) continue;
    if (row.health === "unauthorized") {
      out.push(
        finding(
          "ENGINE_UNAUTHORIZED",
          "warning",
          `${preset.displayName} reports unauthorized auth.`,
          `Log in to ${preset.engineId} or bind BYOK credentials.`,
        ),
      );
    }
    if (row.health === "missing") {
      out.push(
        finding(
          "ENGINE_MISSING",
          "warning",
          `${preset.displayName} binary is not installed.`,
          "Install the CLI or bind a detected engine.",
        ),
      );
    }
    if (row.health === "degraded" && row.reasonClass === "context_below_floor") {
      out.push(
        finding(
          "LOCAL_CONTEXT_BELOW_FLOOR",
          "error",
          contextMessage(preset.engineId, "unknown"),
          `Raise context to at least ${LOCAL_CONTEXT_FLOOR} or bind another model.`,
        ),
      );
    }
  }
  return out;
}

/** Summarize post-Slice-A supervisor rungs from cached health. */
export async function summarizePostSliceARungs(hiveRoot: string): Promise<PostSliceARung[]> {
  const rungs: PostSliceARung[] = [];
  for (const preset of listBuiltinPresets()) {
    if (!POST_SLICE_A_IDS.has(preset.engineId)) continue;
    const row = await getCachedHealth(hiveRoot, preset.engineId);
    rungs.push({
      engineId: preset.engineId,
      healthy: row?.health === "ok",
    });
  }
  return rungs;
}

/** Collect engine-layer doctor findings; does not mutate hive readiness. */
export async function collectEngineDoctorFindings(hiveRoot: string): Promise<DoctorFinding[]> {
  if (!(await hiveInitialized(hiveRoot))) {
    return [];
  }

  const findings: DoctorFinding[] = [];
  findings.push(...(await localPackFindings(hiveRoot)));
  findings.push(...(await healthFindings(hiveRoot)));
  const custom = await customCatalogFinding(hiveRoot);
  if (custom) findings.push(custom);

  return findings;
}
