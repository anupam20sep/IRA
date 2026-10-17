const KEY_VALUE_PATTERN =
  /(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/i;

const TOKEN_PATTERN = /\b(sk-[a-zA-Z0-9_-]+|ghp_[a-zA-Z0-9]+)\b/;

const BEARER_PATTERN = /\bbearer\s+[a-zA-Z0-9._~+/=-]{8,}\b/i;

const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/;

function containsSecret(input: string): boolean {
  return (
    KEY_VALUE_PATTERN.test(input) ||
    TOKEN_PATTERN.test(input) ||
    BEARER_PATTERN.test(input) ||
    AWS_ACCESS_KEY_PATTERN.test(input)
  );
}

export type RedactPatternSummaryResult =
  | { ok: true; text: string }
  | { ok: false; reason: "SECRET_DETECTED" };

/** Reject pattern summaries that contain credential-like material (FR-007). */
export function redactPatternSummary(input: string): RedactPatternSummaryResult {
  if (containsSecret(input)) {
    return { ok: false, reason: "SECRET_DETECTED" };
  }
  return { ok: true, text: input };
}
