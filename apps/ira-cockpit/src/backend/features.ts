import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type { FeatureStage } from "./types.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function inferStage(flags: {
  hasSpec: boolean;
  hasDesign: boolean;
  hasPlan: boolean;
  hasStatus: boolean;
  statusText?: string;
}): string {
  const t = (flags.statusText ?? "").toLowerCase();
  if (t.includes("ship") || t.includes("complete")) return "ship";
  if (t.includes("validate")) return "validate";
  if (t.includes("forge") || t.includes("in progress")) return "forge";
  if (flags.hasPlan && flags.hasStatus) return "forge";
  if (flags.hasPlan) return "plan";
  if (flags.hasDesign) return "architect";
  if (flags.hasSpec) return "scope";
  return "explore";
}

export async function listFeatureStages(repoRoot: string): Promise<FeatureStage[]> {
  const specsRoot = join(repoRoot, "specs");
  let entries;
  try {
    entries = await readdir(specsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: FeatureStage[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".")) continue;
    const dir = join(specsRoot, ent.name);
    const hasSpec = await exists(join(dir, "spec.md"));
    const hasDesign = await exists(join(dir, "design.md"));
    const hasPlan = await exists(join(dir, "plan.md"));
    const statusPath = join(dir, "status.md");
    const hasStatus = await exists(statusPath);
    let statusText = "";
    if (hasStatus) {
      try {
        statusText = await readFile(statusPath, "utf8");
      } catch {
        statusText = "";
      }
    }
    out.push({
      featureId: ent.name,
      title: ent.name,
      stage: inferStage({ hasSpec, hasDesign, hasPlan, hasStatus, statusText }),
      hasSpec,
      hasDesign,
      hasPlan,
      hasStatus,
    });
  }
  return out.sort((a, b) => a.featureId.localeCompare(b.featureId));
}
