import type { CockpitSnapshot, ProjectSnapshot } from "@/backend/types";
import type {
  Decision,
  Intervention,
  LogLine,
  Pattern,
  Project,
  ProjectAgent,
  SpecStage,
} from "./cockpit";

function spark(): number[] {
  return Array.from({ length: 16 }, () => 8 + Math.random() * 92);
}

function asStage(raw: string): SpecStage {
  const allowed: SpecStage[] = [
    "explore",
    "scope",
    "refine",
    "architect",
    "plan",
    "route",
    "forge",
    "validate",
    "ship",
  ];
  return (allowed.includes(raw as SpecStage) ? raw : "explore") as SpecStage;
}

function agentStatus(raw?: string): ProjectAgent["status"] {
  if (raw === "busy" || raw === "blocked" || raw === "offline" || raw === "idle") return raw;
  return "idle";
}

function stageProgress(stage: string, hasPlan: boolean, hasSpec: boolean): number {
  if (stage === "ship") return 95;
  if (stage === "validate") return 85;
  if (stage === "forge") return 60;
  if (hasPlan) return 40;
  if (hasSpec) return 20;
  return 5;
}

function mapProjectAgents(snap: ProjectSnapshot): ProjectAgent[] {
  const rosterAgents: ProjectAgent[] = snap.roster.map((a) => ({
    id: a.id,
    name: a.displayName || a.name || a.id,
    role: (a.capabilityTags ?? []).join(", ") || "agent",
    engine: a.engine || "unknown",
    status: agentStatus(a.status),
    tokensUsed: 0,
    tokensPerMin: a.status === "busy" ? 120 : 0,
    elapsedMin: 0,
    spark: spark(),
    kind: "code" as const,
  }));

  const personaAgents: ProjectAgent[] = snap.personas.map((p, i) => ({
    id: `persona-${p.name || i}`,
    name: p.name || `persona-${i}`,
    role: p.description.slice(0, 80) || p.source,
    engine: p.source || "unknown",
    status: "idle" as const,
    tokensUsed: 0,
    tokensPerMin: 0,
    elapsedMin: 0,
    spark: spark(),
    kind: "ops" as const,
  }));

  return rosterAgents.length > 0 ? rosterAgents : personaAgents;
}

export type LiveMapped = {
  projects: Project[];
  interventions: Intervention[];
  logs: LogLine[];
  catalogAgents: Array<{
    id: string;
    name: string;
    role: string;
    skills: string[];
    defaultEngine: string;
    hired: boolean;
  }>;
  liveMeta: {
    hiveReady: boolean;
    engineRungReady: boolean;
    hiveRoot: string | null;
    repositoryRoot: string;
    generatedAt: string;
    projectCount: number;
  };
};

/**
 * Map backend snapshot → UI store.
 * One UI project per configured repo root; specs nest under that project.
 */
export function mapSnapshotToLive(snapshot: CockpitSnapshot): LiveMapped {
  const interventions: Intervention[] = [];
  for (const snap of snapshot.projects) {
    for (const a of snap.askMe.filter((item) => !item.answer)) {
      interventions.push({
        id: a.id,
        projectId: snap.id,
        severity:
          a.reasonClass.includes("budget") || a.reasonClass.includes("untrusted")
            ? ("critical" as const)
            : ("warning" as const),
        title: a.reasonClass.replace(/_/g, " "),
        detail: a.featureId ? `[${a.featureId}] ${a.question}` : a.question,
      });
    }
  }

  const projects: Project[] = snapshot.projects.map((snap) => {
    const decisions: Decision[] = snap.events.slice(0, 30).map((e, i) => ({
      id: `${snap.id}-ev-${i}`,
      ts: e.ts || snapshot.generatedAt,
      kind: "od" as const,
      title: e.type || "event",
      outcome: e.message || e.raw || "",
      actor: "system",
    }));

    const patterns: Pattern[] = snap.patterns.map((p) => ({
      id: p.id,
      kind: "success" as const,
      summary: p.title,
      score: 0.5,
    }));

    const specs = snap.specs.map((f) => ({
      id: f.featureId,
      title: f.title,
      stage: asStage(f.stage),
      frDone: f.hasStatus ? 1 : 0,
      frTotal: f.hasSpec ? 1 : 0,
    }));

    const progress =
      specs.length === 0
        ? snap.doctor.hiveReady
          ? 30
          : 10
        : Math.round(
            snap.specs.reduce(
              (sum, f) => sum + stageProgress(f.stage, f.hasPlan, f.hasSpec),
              0,
            ) / snap.specs.length,
          );

    const projectAsks = interventions.filter((i) => i.projectId === snap.id);

    return {
      id: snap.id,
      name: snap.name,
      path: snap.path,
      tagline: `${snap.specs.length} spec${snap.specs.length === 1 ? "" : "s"} · ${snap.path}`,
      status: snap.specs.some((s) => s.stage === "ship")
        ? ("shipping" as const)
        : ("active" as const),
      progress,
      done: snap.specs.filter((s) => s.stage === "ship").length,
      blocked: projectAsks.length,
      pending: snap.specs.filter((s) => s.hasPlan && s.stage !== "ship").length,
      spendUsd: 0,
      budgetUsd: 10,
      agents: mapProjectAgents(snap),
      tasks: [],
      specs,
      decisions,
      docs: [],
      patterns,
      triggers: [],
    };
  });

  const totalSpecs = snapshot.projects.reduce((n, p) => n + p.specs.length, 0);
  const logs: LogLine[] = [
    {
      id: `live-${snapshot.generatedAt}`,
      ts: new Date().toLocaleTimeString("en-GB", { hour12: false }),
      level: "ira",
      source: "live",
      message: `Snapshot ${snapshot.generatedAt} · projects=${snapshot.projects.length} · specs=${totalSpecs} · askMe=${interventions.length}`,
    },
    ...snapshot.projects.flatMap((snap) =>
      snap.events.slice(0, 10).map((e, i) => ({
        id: `log-${snap.id}-${e.ts ?? "t"}-${e.type ?? "ev"}-${i}`,
        ts: e.ts?.slice(11, 19) || "--:--:--",
        level: "info" as const,
        source: e.type || snap.name,
        message: e.message || e.raw || "",
      })),
    ),
  ];

  const catalogAgents = snapshot.projects.flatMap((snap) => [
    ...snap.personas.map((p) => ({
      id: `${snap.id}-persona-${p.name}`,
      name: p.name,
      role: p.description.slice(0, 60) || p.source,
      skills: [] as string[],
      defaultEngine: p.source || "cursor-agent",
      hired: true,
    })),
    ...snap.roster.map((a) => ({
      id: `${snap.id}-roster-${a.id}`,
      name: a.displayName || a.name || a.id,
      role: (a.capabilityTags ?? []).join(", ") || "roster",
      skills: a.capabilityTags ?? [],
      defaultEngine: a.engine || "unknown",
      hired: true,
    })),
  ]);

  return {
    projects,
    interventions,
    logs,
    catalogAgents:
      catalogAgents.length > 0
        ? catalogAgents
        : [
            {
              id: "empty",
              name: "No personas yet",
              role: "Add via Setup",
              skills: [],
              defaultEngine: "cursor-agent",
              hired: false,
            },
          ],
    liveMeta: {
      hiveReady: snapshot.doctor.hiveReady,
      engineRungReady: snapshot.doctor.engineRungReady,
      hiveRoot: snapshot.hiveRoot,
      repositoryRoot: snapshot.repositoryRoot,
      generatedAt: snapshot.generatedAt,
      projectCount: snapshot.projects.length,
    },
  };
}
