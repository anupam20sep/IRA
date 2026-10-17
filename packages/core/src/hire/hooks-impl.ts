import { capabilityOverlap, normalizeCapabilityTags } from "./capabilities.js";

/** Roster row plus the optional hire score used as a routing tie-break. */
export type CapabilityRosterAgent = {
  id: string;
  status: string;
  origin: string;
  capabilityTags: string[];
  hireScore?: { score?: number } | null;
};

/**
 * Pick one idle roster agent for a task.
 *
 * Required tags rank by overlap (desc), then `hireScore.score` (desc, missing last),
 * then `id` (asc). Placeholders are excluded from that ranking. With no task tags,
 * the first idle hire wins; if none exist, the first idle agent (P-001 placeholder
 * fallback). Required tags with no overlap return null.
 */
export function matchCapabilities<T extends CapabilityRosterAgent>(
  task: { capabilityTags: string[] },
  roster: readonly T[],
): T | null {
  const taskTags = normalizeCapabilityTags(task.capabilityTags);
  const idle = roster.filter((agent) => agent.status === "idle");

  if (taskTags.length === 0) {
    return idle.find((agent) => agent.origin === "hire") ?? idle[0] ?? null;
  }

  const ranked = idle
    .filter((agent) => agent.origin !== "placeholder")
    .map((agent) => ({ agent, overlap: capabilityOverlap(taskTags, agent.capabilityTags) }))
    .filter((row) => row.overlap > 0)
    .sort((a, b) => compareCapabilityRank(a, b));

  return ranked[0]?.agent ?? null;
}

function compareCapabilityRank(
  a: { agent: CapabilityRosterAgent; overlap: number },
  b: { agent: CapabilityRosterAgent; overlap: number },
): number {
  if (a.overlap !== b.overlap) return b.overlap - a.overlap;
  const scoreA = recordedScore(a.agent);
  const scoreB = recordedScore(b.agent);
  if (scoreA !== null && scoreB !== null && scoreA !== scoreB) return scoreB - scoreA;
  if (scoreA !== null && scoreB === null) return -1;
  if (scoreA === null && scoreB !== null) return 1;
  return a.agent.id.localeCompare(b.agent.id);
}

function recordedScore(agent: CapabilityRosterAgent): number | null {
  const score = agent.hireScore?.score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}
