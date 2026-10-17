import { createHash } from "node:crypto";
import { HireManifestSchema } from "./schema.js";
import type { HireManifest, SanitizationRejected, SanitizationReport } from "./types.js";

const DEFAULT_MAX_FIELD_CHARS = 16_384;
const EXECUTABLE_KEY_RE = /script|executable|command|shell|eval|base64/i;

const MANIFEST_KEYS = [
  "schemaVersion",
  "id",
  "displayName",
  "goal",
  "capabilityTags",
  "suggestedEngine",
  "suggestedModelTier",
  "budget",
  "allowlists",
  "persona",
] as const;

type AllowNode =
  | { kind: "string" }
  | { kind: "numberOrNull" }
  | { kind: "stringArray" }
  | { kind: "array" }
  | { kind: "object"; fields: Record<string, AllowNode> };

const stringNode: AllowNode = { kind: "string" };
const numberOrNullNode: AllowNode = { kind: "numberOrNull" };
const stringArrayNode: AllowNode = { kind: "stringArray" };

const manifestAllowlist: AllowNode = {
  kind: "object",
  fields: {
    schemaVersion: stringNode,
    id: stringNode,
    displayName: stringNode,
    goal: stringNode,
    capabilityTags: stringArrayNode,
    suggestedEngine: stringNode,
    suggestedModelTier: stringNode,
    budget: {
      kind: "object",
      fields: {
        tokens: numberOrNullNode,
        usd: numberOrNullNode,
      },
    },
    allowlists: {
      kind: "object",
      fields: {
        skills: stringArrayNode,
        mcp: stringArrayNode,
      },
    },
    persona: {
      kind: "object",
      fields: {
        harness: stringNode,
        scope: stringNode,
        body: stringNode,
      },
    },
    skills: { kind: "array" },
    metadata: {
      kind: "object",
      fields: {
        galleryTitle: stringNode,
        sourceUri: stringNode,
      },
    },
  },
};

type Collect = {
  droppedKeys: string[];
  rejected: SanitizationRejected[];
  maxFieldChars: number;
};

export function buildSanitizationReport(input: {
  droppedKeys: string[];
  rejected: SanitizationRejected[];
  warnings: string[];
  contentSha256: string;
  sanitizedAt?: string;
}): SanitizationReport {
  return {
    droppedKeys: [...input.droppedKeys],
    rejected: input.rejected.map((item) => ({ path: item.path, reason: item.reason })),
    warnings: [...input.warnings],
    contentSha256: input.contentSha256,
    sanitizedAt: input.sanitizedAt ?? new Date().toISOString(),
  };
}

function readMaxFieldChars(): number {
  const raw = process.env.MAX_FIELD_CHARS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_FIELD_CHARS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_FIELD_CHARS;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSecretKey(key: string): boolean {
  const folded = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (folded === "tokens") return false;
  if (folded.includes("apikey") || folded.includes("password") || folded.includes("secret")) return true;
  const segments = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
  return segments.some((part) => part === "token");
}

function isForbiddenKey(key: string): boolean {
  return EXECUTABLE_KEY_RE.test(key) || isSecretKey(key);
}

function hashInput(input: unknown): string {
  const json = JSON.stringify(input);
  return createHash("sha256").update(Buffer.from(json ?? "null", "utf8")).digest("hex");
}

function reject(collect: Collect, path: string, reason: string): void {
  collect.rejected.push({ path: path || "$", reason });
}

function childPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function scanValue(value: unknown, path: string, collect: Collect): void {
  if (typeof value === "string") {
    if (value.length > collect.maxFieldChars) {
      reject(collect, path, `exceeds MAX_FIELD_CHARS (${collect.maxFieldChars})`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanValue(value[i], `${path}[${i}]`, collect);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const next = childPath(path, key);
    if (EXECUTABLE_KEY_RE.test(key)) reject(collect, next, "executable payload");
    if (isSecretKey(key)) reject(collect, next, "secret-like key");
    scanValue(child, next, collect);
  }
}

function project(value: unknown, node: AllowNode, path: string, collect: Collect): unknown {
  if (node.kind === "string") {
    if (typeof value !== "string") {
      reject(collect, path, "expected string");
      return undefined;
    }
    return value;
  }
  if (node.kind === "numberOrNull") {
    if (typeof value === "number" || value === null) return value;
    reject(collect, path, "expected number or null");
    return undefined;
  }
  if (node.kind === "stringArray") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      reject(collect, path, "expected string array");
      return undefined;
    }
    return [...value];
  }
  if (node.kind === "array") {
    if (!Array.isArray(value)) {
      reject(collect, path, "expected array");
      return undefined;
    }
    return [...value];
  }
  if (!isPlainObject(value)) {
    reject(collect, path, "expected object");
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const next = childPath(path, key);
    const childNode = node.fields[key];
    if (!childNode) {
      if (isForbiddenKey(key)) continue;
      if (isPlainObject(child)) {
        reject(collect, next, "nested object outside allowlist");
        continue;
      }
      collect.droppedKeys.push(next);
      continue;
    }
    if (isForbiddenKey(key)) continue;
    const projected = project(child, childNode, next, collect);
    if (projected !== undefined) out[key] = projected;
  }
  return out;
}

function applyAllowlistDefaults(
  projected: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  if (!Object.prototype.hasOwnProperty.call(source, "allowlists")) {
    projected.allowlists = { skills: [], mcp: [] };
    return;
  }
  if (!isPlainObject(projected.allowlists) || !isPlainObject(source.allowlists)) return;
  if (!Object.prototype.hasOwnProperty.call(source.allowlists, "skills")) {
    projected.allowlists.skills = [];
  }
  if (!Object.prototype.hasOwnProperty.call(source.allowlists, "mcp")) {
    projected.allowlists.mcp = [];
  }
}

function pickManifest(projected: Record<string, unknown>): Record<string, unknown> {
  const candidate: Record<string, unknown> = {};
  for (const key of MANIFEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(projected, key)) candidate[key] = projected[key];
  }
  return candidate;
}

export function sanitizeManifestInput(input: unknown): {
  report: SanitizationReport;
  manifest: HireManifest | null;
} {
  const collect: Collect = {
    droppedKeys: [],
    rejected: [],
    maxFieldChars: readMaxFieldChars(),
  };
  const warnings: string[] = [];

  if (!isPlainObject(input)) {
    return {
      report: buildSanitizationReport({
        droppedKeys: [],
        rejected: [{ path: "$", reason: "manifest must be an object" }],
        warnings,
        contentSha256: hashInput(input),
      }),
      manifest: null,
    };
  }

  scanValue(input, "", collect);
  if (input.schemaVersion !== "hireManifest/v1") {
    reject(collect, "schemaVersion", "unsupported schemaVersion");
  }

  const projected = project(input, manifestAllowlist, "", collect);
  if (isPlainObject(projected)) applyAllowlistDefaults(projected, input);

  const candidate = isPlainObject(projected) ? projected : {};
  if (Array.isArray(candidate.capabilityTags) && candidate.capabilityTags.length === 0) {
    warnings.push("capability tags are empty");
  }

  const parsed = HireManifestSchema.safeParse(pickManifest(candidate));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "$";
      if (collect.rejected.some((item) => item.path === path)) continue;
      reject(collect, path, issue.message);
    }
  }

  const manifest = collect.rejected.length === 0 && parsed.success ? parsed.data : null;

  return {
    report: buildSanitizationReport({
      droppedKeys: collect.droppedKeys,
      rejected: collect.rejected,
      warnings,
      contentSha256: hashInput(input),
    }),
    manifest,
  };
}
