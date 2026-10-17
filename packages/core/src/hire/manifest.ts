import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { HireManifestSchema } from "./schema.js";
import type { HireManifest } from "./types.js";

const DEFAULT_MAX_MANIFEST_BYTES = 65_536;
const DEFAULT_MAX_FIELD_CHARS = 16_384;

export type ParseManifestResult =
  | { ok: true; manifest: HireManifest; contentSha256: string }
  | {
      ok: false;
      code: "HIRE_MANIFEST_TOO_LARGE" | "HIRE_SANITIZE_FAILED";
      message: string;
    };

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function contentSha256(raw: Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}

function decodeStructured(raw: Buffer, sourceLabel: string): unknown {
  const text = raw.toString("utf8").replace(/^\uFEFF/, "");
  const trimmed = text.trimStart();
  const jsonByLabel = /\.json$/i.test(sourceLabel);
  const jsonByContent = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (jsonByLabel || jsonByContent) {
    return JSON.parse(text) as unknown;
  }
  return parseYaml(text) as unknown;
}

function stringFieldTooLong(value: unknown, maxFieldChars: number, path: string): string | null {
  if (typeof value === "string") {
    if (value.length > maxFieldChars) {
      return `${path} exceeds MAX_FIELD_CHARS (${maxFieldChars})`;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = stringFieldTooLong(value[i], maxFieldChars, `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const hit = stringFieldTooLong(child, maxFieldChars, path ? `${path}.${key}` : key);
      if (hit) return hit;
    }
  }
  return null;
}

export function parseManifestBytes(raw: Buffer, sourceLabel: string): ParseManifestResult {
  const maxManifestBytes = readLimit("MAX_MANIFEST_BYTES", DEFAULT_MAX_MANIFEST_BYTES);
  const maxFieldChars = readLimit("MAX_FIELD_CHARS", DEFAULT_MAX_FIELD_CHARS);

  if (raw.length > maxManifestBytes) {
    return {
      ok: false,
      code: "HIRE_MANIFEST_TOO_LARGE",
      message: `Manifest exceeds MAX_MANIFEST_BYTES (${maxManifestBytes})`,
    };
  }

  const hash = contentSha256(raw);

  let parsed: unknown;
  try {
    parsed = decodeStructured(raw, sourceLabel);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "HIRE_SANITIZE_FAILED",
      message: `Failed to parse manifest from ${sourceLabel}: ${detail}`,
    };
  }

  const fieldError = stringFieldTooLong(parsed, maxFieldChars, "");
  if (fieldError) {
    return {
      ok: false,
      code: "HIRE_SANITIZE_FAILED",
      message: fieldError,
    };
  }

  const validated = HireManifestSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      code: "HIRE_SANITIZE_FAILED",
      message: validated.error.message,
    };
  }

  return { ok: true, manifest: validated.data, contentSha256: hash };
}
