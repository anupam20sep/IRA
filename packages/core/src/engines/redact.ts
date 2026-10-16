const KEY_VALUE_PATTERN =
  /(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi;

const TOKEN_PATTERN = /\b(sk-[a-zA-Z0-9_-]+|ghp_[a-zA-Z0-9]+)\b/g;

/** Redact secret-like substrings from vendor error text (FR-011). */
export function redactMessage(text: string): string {
  return text
    .replace(KEY_VALUE_PATTERN, "[redacted]")
    .replace(TOKEN_PATTERN, "[redacted]");
}
