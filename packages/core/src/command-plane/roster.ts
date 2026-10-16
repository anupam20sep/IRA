import type { RosterAgent } from "./types.js";

export const AGENT_HOST_ID = "agent-host";

/** Placeholder host worker inserted when the roster is empty at brief-submit. */
export function buildAgentHostPlaceholder(personaPath: string | null): RosterAgent {
  return {
    id: AGENT_HOST_ID,
    name: "Host worker",
    personaPath,
    capabilityTags: [],
    engine: null,
    model: null,
    workspace: null,
    worktreePolicy: "shared",
    status: "idle",
    origin: "placeholder",
  };
}

/**
 * When the roster is empty, insert the agent-host placeholder.
 * An existing `agent-host` row is never overwritten (including hire rows).
 */
export function ensurePlaceholderRoster(
  roster: RosterAgent[],
  personaPath: string | null,
): { roster: RosterAgent[]; inserted: boolean } {
  if (roster.some((agent) => agent.id === AGENT_HOST_ID)) {
    return { roster, inserted: false };
  }
  if (roster.length === 0) {
    return { roster: [buildAgentHostPlaceholder(personaPath)], inserted: true };
  }
  return { roster, inserted: false };
}
