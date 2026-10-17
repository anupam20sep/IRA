/** Slug shape for hire capability tags (design decision test 1). */
const CAPABILITY_TAG_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;

export type NormalizeCapabilityOptions = {
  /** Called for raw inputs that fail slug validation after trim + lowercase. */
  onInvalidTag?: (raw: string) => void;
};

export function normalizeCapabilityTags(
  tags: string[],
  options?: NormalizeCapabilityOptions,
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of tags) {
    const token = raw.trim().toLowerCase();
    if (!CAPABILITY_TAG_RE.test(token)) {
      options?.onInvalidTag?.(raw);
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    normalized.push(token);
  }

  return normalized;
}

export function tagsIntersect(taskTags: string[], agentTags: string[]): string[] {
  const agentSet = new Set(normalizeCapabilityTags(agentTags));
  return normalizeCapabilityTags(taskTags).filter((tag) => agentSet.has(tag));
}

/** How many normalized capability tags the task and agent share. */
export function capabilityOverlap(taskTags: string[], agentTags: string[]): number {
  return tagsIntersect(taskTags, agentTags).length;
}
