import type { SkillConsent, SkillConsentDecision } from "./types.js";

export type SkillConsentUpdate = {
  skillId: string;
  decision: SkillConsentDecision;
};

export type SkillScanResult = {
  status: "skipped" | "pass" | "fail";
  findings: string[];
};

/** v1 stub — structure ready for scanner integration. */
export async function scanSkill(_path: string): Promise<SkillScanResult> {
  return { status: "skipped", findings: [] };
}

export function mergeSkillConsentDecisions(
  existing: SkillConsent[],
  updates: SkillConsentUpdate[],
): SkillConsent[] {
  if (updates.length === 0) return existing;
  const byId = new Map(updates.map((update) => [update.skillId, update.decision]));
  return existing.map((consent) => {
    const decision = byId.get(consent.skillId);
    return decision !== undefined ? { ...consent, decision } : consent;
  });
}

export function allowedSkillsAfterConsent(allowedSkills: string[], skillConsents: SkillConsent[]): string[] {
  const declined = new Set(skillConsents.filter((s) => s.decision === "declined").map((s) => s.skillId));
  return allowedSkills.filter((skillId) => !declined.has(skillId));
}
