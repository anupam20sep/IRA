import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runSuperspecJson } from "./cli.js";
import { detectEngines } from "./engines.js";
import { listFeatureStages } from "./features.js";
import {
  loadAskMe,
  loadDoctor,
  loadRecentEvents,
  loadRoster,
  loadSettings,
} from "./hive.js";
import type { ResolvedProject } from "./projects.js";
import type { CockpitSnapshot, ProjectSnapshot } from "./types.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export async function buildProjectSnapshot(
  project: ResolvedProject,
): Promise<ProjectSnapshot> {
  const doctor = await loadDoctor(project.path);
  const hiveRoot = doctor.hiveRoot;
  const [askMe, roster, settings, events, specs, personasRes] = await Promise.all([
    loadAskMe(project.path),
    loadRoster(hiveRoot),
    loadSettings(hiveRoot),
    loadRecentEvents(hiveRoot),
    listFeatureStages(project.path),
    runSuperspecJson(project.path, ["list-personas"]),
  ]);

  let personas: ProjectSnapshot["personas"] = [];
  if (personasRes.ok) {
    const raw = personasRes.json;
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(asRecord(raw)?.personas)
        ? (asRecord(raw)!.personas as unknown[])
        : [];
    personas = list
      .map((p) => {
        const row = asRecord(p) ?? {};
        return {
          name: String(row.name ?? ""),
          description: String(row.description ?? ""),
          source: String(row.source ?? ""),
          path: String(row.path ?? ""),
        };
      })
      .filter((p) => p.name || p.path);
  }

  const patterns: ProjectSnapshot["patterns"] = [];
  try {
    const dir = join(project.path, ".superspec", "patterns");
    const entries = await readdir(dir);
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      patterns.push({
        id: name.replace(/\.md$/, ""),
        path: `.superspec/patterns/${name}`,
        title: name.replace(/\.md$/, ""),
      });
    }
  } catch {
    // optional
  }

  return {
    id: project.id,
    name: project.name,
    path: project.path,
    hiveRoot,
    doctor,
    askMe,
    roster,
    personas,
    specs,
    patterns,
    events,
    settings,
  };
}

/**
 * Build a multi-project cockpit snapshot.
 * Each configured local repo path is one project; specs live under each project.
 */
export async function buildCockpitSnapshot(
  projects: ResolvedProject[],
): Promise<CockpitSnapshot> {
  const enginesPack = await detectEngines();
  if (projects.length === 0) {
    const emptyDoctor = {
      ok: false,
      hiveReady: false,
      engineRungReady: false,
      hiveRoot: null,
      repositoryRoot: "",
      findings: [{ code: "NO_PROJECTS", severity: "error", message: "No project paths configured" }],
    };
    return {
      generatedAt: new Date().toISOString(),
      repositoryRoot: "",
      hiveRoot: null,
      doctor: emptyDoctor,
      engines: enginesPack.engines,
      projects: [],
    };
  }

  const projectSnaps = await Promise.all(projects.map((p) => buildProjectSnapshot(p)));
  const primary = projectSnaps[0]!;

  return {
    generatedAt: new Date().toISOString(),
    repositoryRoot: primary.path,
    hiveRoot: primary.hiveRoot,
    doctor: primary.doctor,
    engines: enginesPack.engines,
    projects: projectSnaps,
  };
}
