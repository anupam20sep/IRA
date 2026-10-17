import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GalleryIndexSchema } from "./schema.js";
import type { GalleryEntry, GalleryIndex } from "./types.js";

export const HIRE_GALLERY_INDEX_FILE = "index.json";

const MINIMAL_FIXTURE_INDEX: GalleryIndex = {
  schemaVersion: 1,
  entries: [
    {
      id: "ios-developer",
      title: "iOS Developer",
      description: "Ship SwiftUI features for mobile apps.",
      capabilityTags: ["ios", "mobile"],
      manifestPath: "manifests/ios-developer.yaml",
      manifestSha256: "0000000000000000000000000000000000000000000000000000000000000001",
      trustHint: "curated_catalog",
    },
    {
      id: "qa-specialist",
      title: "QA Specialist",
      description: "Test and verify product quality.",
      capabilityTags: ["qa"],
      manifestPath: "manifests/qa-specialist.yaml",
      manifestSha256: "0000000000000000000000000000000000000000000000000000000000000002",
      trustHint: "curated_catalog",
    },
  ],
};

const MINIMAL_FIXTURE_MANIFESTS: Record<string, string> = {
  "ios-developer": `schemaVersion: hireManifest/v1
id: ios-developer
displayName: iOS Developer
goal: Ship SwiftUI features.
capabilityTags: [ios]
suggestedEngine: cursor
suggestedModelTier: standard
budget: { tokens: 100000, usd: 25 }
allowlists: { skills: [], mcp: [] }
persona: { harness: cursor, scope: project, body: "body" }
`,
  "qa-specialist": `schemaVersion: hireManifest/v1
id: qa-specialist
displayName: QA Specialist
goal: Verify releases.
capabilityTags: [qa]
suggestedEngine: cursor
suggestedModelTier: economy
budget: { tokens: 50000, usd: 10 }
allowlists: { skills: [], mcp: [] }
persona: { harness: cursor, scope: project, body: "body" }
`,
};

export type GalleryErrorCode = "HIRE_GALLERY_UNAVAILABLE";

export class HireGalleryError extends Error {
  readonly code: GalleryErrorCode;

  constructor(code: GalleryErrorCode, message: string) {
    super(message);
    this.name = "HireGalleryError";
    this.code = code;
  }
}

export type SearchGalleryOptions = {
  query?: string;
  tags?: string[];
  limit?: number;
  indexFixture?: "minimal";
  repositoryRoot?: string;
};

export type LoadGalleryManifestOptions = {
  indexFixture?: "minimal";
  repositoryRoot?: string;
};

export type LoadGalleryManifestResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; code: GalleryErrorCode; message: string };

function resolveGalleryRoot(repositoryRoot: string): string {
  const override = process.env.SUPERSPEC_HIRE_GALLERY?.trim();
  if (override) return override;
  return join(repositoryRoot, "hire-gallery");
}

function loadIndex(options?: {
  indexFixture?: "minimal";
  repositoryRoot?: string;
}): { index: GalleryIndex; galleryRoot: string } {
  if (options?.indexFixture === "minimal") {
    return { index: MINIMAL_FIXTURE_INDEX, galleryRoot: "<minimal-fixture>" };
  }

  const repositoryRoot = options?.repositoryRoot ?? process.cwd();
  const galleryRoot = resolveGalleryRoot(repositoryRoot);
  const indexPath = join(galleryRoot, HIRE_GALLERY_INDEX_FILE);

  if (!existsSync(indexPath)) {
    throw new HireGalleryError(
      "HIRE_GALLERY_UNAVAILABLE",
      `Gallery index not found at ${indexPath}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(indexPath, "utf8")) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new HireGalleryError(
      "HIRE_GALLERY_UNAVAILABLE",
      `Gallery index is not valid JSON: ${detail}`,
    );
  }

  const parsed = GalleryIndexSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HireGalleryError(
      "HIRE_GALLERY_UNAVAILABLE",
      `Gallery index failed schema validation: ${parsed.error.message}`,
    );
  }

  return { index: parsed.data, galleryRoot };
}

function normalizeSearchToken(value: string): string {
  return value.trim().toLowerCase();
}

function entryMatchesTags(entry: GalleryEntry, tags: string[]): boolean {
  if (tags.length === 0) return true;
  const entryTags = entry.capabilityTags.map(normalizeSearchToken);
  return tags.some((tag) => entryTags.includes(normalizeSearchToken(tag)));
}

function entryMatchesQuery(entry: GalleryEntry, query: string): boolean {
  const q = normalizeSearchToken(query);
  if (!q) return true;
  const haystack = [
    entry.title,
    entry.description,
    ...entry.capabilityTags,
    entry.id,
  ]
    .map(normalizeSearchToken)
    .join(" ");
  return haystack.includes(q);
}

export function searchGallery(options: SearchGalleryOptions = {}): GalleryEntry[] {
  const { index } = loadIndex(options);
  const tags = options.tags ?? [];
  const query = options.query ?? "";
  const limit = options.limit ?? index.entries.length;

  const filtered = index.entries.filter(
    (entry) => entryMatchesTags(entry, tags) && entryMatchesQuery(entry, query),
  );

  return filtered.slice(0, Math.max(0, limit));
}

export async function loadGalleryManifest(
  entryId: string,
  options: LoadGalleryManifestOptions = {},
): Promise<LoadGalleryManifestResult> {
  let index: GalleryIndex;
  let galleryRoot: string;
  try {
    ({ index, galleryRoot } = loadIndex(options));
  } catch (err) {
    if (err instanceof HireGalleryError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }

  const entry = index.entries.find((e) => e.id === entryId);
  if (!entry) {
    return {
      ok: false,
      code: "HIRE_GALLERY_UNAVAILABLE",
      message: `Gallery entry not found: ${entryId}`,
    };
  }

  if (options.indexFixture === "minimal") {
    const text = MINIMAL_FIXTURE_MANIFESTS[entryId];
    if (!text) {
      return {
        ok: false,
        code: "HIRE_GALLERY_UNAVAILABLE",
        message: `Gallery manifest fixture missing for: ${entryId}`,
      };
    }
    return { ok: true, bytes: Buffer.from(text, "utf8") };
  }

  const manifestPath = join(galleryRoot, entry.manifestPath);
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      code: "HIRE_GALLERY_UNAVAILABLE",
      message: `Gallery manifest not found at ${manifestPath}`,
    };
  }

  try {
    const bytes = readFileSync(manifestPath);
    return { ok: true, bytes };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "HIRE_GALLERY_UNAVAILABLE",
      message: `Failed to read gallery manifest: ${detail}`,
    };
  }
}
