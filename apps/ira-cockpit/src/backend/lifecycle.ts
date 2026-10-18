import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listFeatureStages } from "./features.js";
import { runSuperspecRaw } from "./cli.js";

export type LifecycleStage =
  | "explore"
  | "scope"
  | "refine"
  | "architect"
  | "plan"
  | "route"
  | "forge"
  | "validate"
  | "ship";

const STAGE_STATUS: Record<LifecycleStage, string> = {
  explore: "Status: explore — brainstorming",
  scope: "Status: scope — spec drafted",
  refine: "Status: refine — clarifications resolved",
  architect: "Status: architect — design signed off",
  plan: "Status: plan — plan + execution map ready",
  route: "Status: route — model routing set",
  forge: "Status: forge — implementation in progress",
  validate: "Status: validate — acceptance checks running",
  ship: "Status: ship complete",
};

export async function writeFeatureStatus(
  repoRoot: string,
  featureId: string,
  stage: LifecycleStage,
  extra = "",
): Promise<string> {
  const dir = join(repoRoot, "specs", featureId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "status.md");
  const body = `# ${featureId} — Status\n\n${STAGE_STATUS[stage]}\n${extra ? `\n${extra}\n` : ""}`;
  await writeFile(path, body, "utf8");
  return path;
}

export async function readFeatureStatus(
  repoRoot: string,
  featureId: string,
): Promise<string | null> {
  try {
    return await readFile(join(repoRoot, "specs", featureId, "status.md"), "utf8");
  } catch {
    return null;
  }
}

export async function getProjectStages(repoRoot: string) {
  return listFeatureStages(repoRoot);
}

/** Run superspec sync-status against a feature. */
export async function syncFeatureStatus(
  repoRoot: string,
  featureId: string,
): Promise<{ ok: boolean; raw?: string; error?: string; statusPath?: string }> {
  const specDir = join(repoRoot, "specs", featureId);
  const specPath = join(specDir, "spec.md");
  const planPath = join(specDir, "plan.md");
  const res = await runSuperspecRaw(repoRoot, [
    "sync-status",
    "--spec",
    specPath,
    "--plan",
    planPath,
    "--dir",
    specDir,
  ]);
  if (!res.ok) {
    return { ok: false, error: res.error, raw: res.raw };
  }
  return {
    ok: true,
    raw: res.raw,
    statusPath: join(specDir, "status.md"),
  };
}

export async function forgeStatus(
  repoRoot: string,
  featureId: string,
): Promise<{ ok: boolean; raw?: string; error?: string }> {
  const specDir = join(repoRoot, "specs", featureId);
  const planPath = join(specDir, "plan.md");
  const res = await runSuperspecRaw(repoRoot, [
    "forge-status",
    "--plan",
    planPath,
    "--dir",
    specDir,
  ]);
  if (!res.ok) return { ok: false, error: res.error, raw: res.raw };
  return { ok: true, raw: res.raw };
}

export async function writeValidationReport(
  repoRoot: string,
  featureId: string,
  passed: boolean,
  details: string,
): Promise<string> {
  const path = join(repoRoot, "specs", featureId, "validation-report.md");
  await writeFile(
    path,
    `# Validation Report — ${featureId}\n\n**Passed**: ${passed}\n\n${details}\n`,
    "utf8",
  );
  return path;
}

export async function advanceLifecycle(
  repoRoot: string,
  featureId: string,
  stage: LifecycleStage,
): Promise<{ stage: LifecycleStage; statusPath: string; inferred: string }> {
  const statusPath = await writeFeatureStatus(repoRoot, featureId, stage);
  const stages = await listFeatureStages(repoRoot);
  const row = stages.find((s) => s.featureId === featureId);
  return {
    stage,
    statusPath,
    inferred: row?.stage ?? stage,
  };
}
