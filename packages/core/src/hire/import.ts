import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { HireAskMeError } from "./ask-me-bridge.js";
import { HIRE_TRUST_BANNER } from "./constants.js";
import { loadGalleryManifest } from "./gallery.js";
import { parseManifestBytes } from "./manifest.js";
import { HireReviewError, createPendingReview } from "./review.js";
import { sanitizeManifestInput } from "./sanitize.js";
import type {
  ApprovalCopyVariant,
  HireManifest,
  HireReview,
  HireSourceKind,
  SanitizationReport,
} from "./types.js";

const DEFAULT_MAX_MANIFEST_BYTES = 65_536;
const MAX_URL_REDIRECTS = 3;
const URL_TIMEOUT_MS = 10_000;

export type HireImportRequest = {
  hiveRoot: string;
  cwd?: string;
  repositoryRoot?: string;
} & (
  | { source: "file"; path: string }
  | { source: "url"; url: string }
  | { source: "paste"; body: string }
  | { source: "gallery"; entryId: string }
);

export type HireImportForm = {
  displayName: string;
  capabilityTags: string[];
  suggestedEngine: string;
  suggestedModelTier: HireManifest["suggestedModelTier"];
  budget: { tokens: number | null; usd: number | null };
  allowlists: { skills: string[]; mcp: string[] };
};

export type HireImportReview = {
  reviewId: string;
  state: HireReview["state"];
  sourceKind: HireSourceKind;
  approvalCopyVariant: ApprovalCopyVariant;
  sanitizationReport: SanitizationReport;
  askMeId: string;
  form: HireImportForm;
  uiCopy: HireReview["uiCopy"];
};

export type HireImportSuccess = {
  ok: true;
  review: HireImportReview;
  uiCopy: HireReview["uiCopy"];
  approvalCopyVariant: ApprovalCopyVariant;
  askMeId: string;
  trustHint?: "curated_catalog";
};

export type HireImportFailure = {
  ok: false;
  error: string;
  message: string;
  hint?: string;
};

export type HireImportResponse = HireImportSuccess | HireImportFailure;

type Acquired =
  | { ok: true; bytes: Buffer; label: string }
  | HireImportFailure;

type OpenInput = {
  hiveRoot: string;
  sourceKind: HireSourceKind;
  sourceRef: string;
  approvalCopyVariant: ApprovalCopyVariant;
  trustHint?: "curated_catalog";
};

function readMaxManifestBytes(): number {
  const raw = process.env.MAX_MANIFEST_BYTES;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_MANIFEST_BYTES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_MANIFEST_BYTES;
}

function fail(error: string, message: string, hint?: string): HireImportFailure {
  return hint ? { ok: false, error, message, hint } : { ok: false, error, message };
}

function decodeDocument(raw: Buffer, sourceLabel: string): unknown {
  const text = raw.toString("utf8").replace(/^\uFEFF/, "");
  const trimmed = text.trimStart();
  const jsonByLabel = /\.json$/i.test(sourceLabel);
  const jsonByContent = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (jsonByLabel || jsonByContent) return JSON.parse(text) as unknown;
  return parseYaml(text) as unknown;
}

function reviewForm(manifest: HireManifest): HireImportForm {
  return {
    displayName: manifest.displayName,
    capabilityTags: [...manifest.capabilityTags],
    suggestedEngine: manifest.suggestedEngine,
    suggestedModelTier: manifest.suggestedModelTier,
    budget: { tokens: manifest.budget.tokens, usd: manifest.budget.usd },
    allowlists: {
      skills: [...manifest.allowlists.skills],
      mcp: [...manifest.allowlists.mcp],
    },
  };
}

function trustCopy(): HireReview["uiCopy"] {
  return {
    trustBanner: HIRE_TRUST_BANNER,
    showFullSanitizationReport: true,
  };
}

function toResponse(review: HireReview, trustHint?: "curated_catalog"): HireImportSuccess {
  const uiCopy = trustCopy();
  const response: HireImportSuccess = {
    ok: true,
    review: {
      reviewId: review.reviewId,
      state: review.state,
      sourceKind: review.sourceKind,
      approvalCopyVariant: review.approvalCopyVariant,
      sanitizationReport: review.sanitizationReport,
      askMeId: review.askMeId,
      form: reviewForm(review.parsedManifest),
      uiCopy,
    },
    uiCopy,
    approvalCopyVariant: review.approvalCopyVariant,
    askMeId: review.askMeId,
  };
  if (trustHint) response.trustHint = trustHint;
  return response;
}

async function openFromBytes(bytes: Buffer, sourceLabel: string, input: OpenInput): Promise<HireImportResponse> {
  const parsed = parseManifestBytes(bytes, sourceLabel);
  if (!parsed.ok) return fail(parsed.code, parsed.message);

  // Sanitize the raw document so disallowed keys are reported before schema stripping.
  let document: unknown;
  try {
    document = decodeDocument(bytes, sourceLabel);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return fail("HIRE_SANITIZE_FAILED", `Failed to parse manifest from ${sourceLabel}: ${detail}`);
  }

  const sanitized = sanitizeManifestInput(document);
  if (!sanitized.manifest || sanitized.report.rejected.length > 0) {
    const reason = sanitized.report.rejected.map((item) => `${item.path}: ${item.reason}`).join("; ");
    return fail("HIRE_SANITIZE_FAILED", reason || "Manifest failed sanitization.");
  }

  const sanitizationReport: SanitizationReport = {
    ...sanitized.report,
    contentSha256: parsed.contentSha256,
  };

  try {
    const review = await createPendingReview({
      hiveRoot: input.hiveRoot,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      approvalCopyVariant: input.approvalCopyVariant,
      sanitizationReport,
      parsedManifest: sanitized.manifest,
      skillConsents: [],
      contentSha256: parsed.contentSha256,
    });
    return toResponse(review, input.trustHint);
  } catch (err) {
    if (err instanceof HireReviewError || err instanceof HireAskMeError) {
      return fail(err.code, err.message);
    }
    throw err;
  }
}

async function acquireFile(path: string, cwd?: string): Promise<Acquired> {
  const filePath = cwd && !isAbsolute(path) ? join(cwd, path) : path;
  const maxBytes = readMaxManifestBytes();
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return fail("INVALID_INPUT", "Manifest path is not a file.");
    if (info.size > maxBytes) {
      return fail("HIRE_MANIFEST_TOO_LARGE", `Manifest exceeds MAX_MANIFEST_BYTES (${maxBytes})`);
    }
    return { ok: true, bytes: await readFile(filePath), label: filePath };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return fail("INVALID_INPUT", "Manifest file was not found.");
    }
    const detail = err instanceof Error ? err.message : String(err);
    return fail("HIRE_SANITIZE_FAILED", `Failed to read manifest: ${detail}`);
  }
}

function acquirePaste(body: string): Acquired {
  const bytes = Buffer.from(body, "utf8");
  const maxBytes = readMaxManifestBytes();
  if (bytes.length > maxBytes) {
    return fail("HIRE_MANIFEST_TOO_LARGE", `Manifest exceeds MAX_MANIFEST_BYTES (${maxBytes})`);
  }
  return { ok: true, bytes, label: "paste" };
}

async function readCappedBody(response: Response, maxBytes: number): Promise<Buffer | "too-large"> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) {
      await response.body?.cancel();
      return "too-large";
    }
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function acquireUrl(urlString: string): Promise<Acquired> {
  const maxBytes = readMaxManifestBytes();
  let current = urlString;

  for (let hop = 0; hop <= MAX_URL_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return fail("INVALID_INPUT", "Manifest URL is not valid.");
    }
    if (parsed.protocol !== "https:") {
      return fail("INVALID_INPUT", "Hire URL import requires https.", "Use an https URL.");
    }

    let response: Response;
    try {
      response = await fetch(parsed, {
        redirect: "manual",
        signal: AbortSignal.timeout(URL_TIMEOUT_MS),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return fail("HIRE_SANITIZE_FAILED", `Failed to fetch manifest: ${detail}`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) return fail("HIRE_SANITIZE_FAILED", "Manifest URL redirect is missing a location.");
      if (hop === MAX_URL_REDIRECTS) {
        return fail("HIRE_SANITIZE_FAILED", "Manifest URL exceeded the redirect limit.");
      }
      current = new URL(location, parsed).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      return fail("HIRE_SANITIZE_FAILED", `Manifest URL returned HTTP ${response.status}.`);
    }

    const body = await readCappedBody(response, maxBytes);
    if (body === "too-large") {
      return fail("HIRE_MANIFEST_TOO_LARGE", `Manifest exceeds MAX_MANIFEST_BYTES (${maxBytes})`);
    }
    return { ok: true, bytes: body, label: parsed.pathname || urlString };
  }

  return fail("HIRE_SANITIZE_FAILED", "Manifest URL exceeded the redirect limit.");
}

export async function hireImport(request: HireImportRequest): Promise<HireImportResponse> {
  if (request.hiveRoot.trim() === "") return fail("INVALID_INPUT", "hiveRoot is required.");

  if (request.source === "file") {
    if (request.path.trim() === "") return fail("INVALID_INPUT", "Manifest path is required.");
    const acquired = await acquireFile(request.path, request.cwd);
    if (!acquired.ok) return acquired;
    return openFromBytes(acquired.bytes, acquired.label, {
      hiveRoot: request.hiveRoot,
      sourceKind: "file",
      sourceRef: request.path,
      approvalCopyVariant: "standard",
    });
  }

  if (request.source === "url") {
    if (request.url.trim() === "") return fail("INVALID_INPUT", "Manifest URL is required.");
    const acquired = await acquireUrl(request.url);
    if (!acquired.ok) return acquired;
    return openFromBytes(acquired.bytes, acquired.label, {
      hiveRoot: request.hiveRoot,
      sourceKind: "url",
      sourceRef: request.url,
      approvalCopyVariant: "standard",
    });
  }

  if (request.source === "paste") {
    const acquired = acquirePaste(request.body);
    if (!acquired.ok) return acquired;
    return openFromBytes(acquired.bytes, acquired.label, {
      hiveRoot: request.hiveRoot,
      sourceKind: "paste",
      sourceRef: "paste",
      approvalCopyVariant: "standard",
    });
  }

  if (request.entryId.trim() === "") return fail("INVALID_INPUT", "Gallery entry id is required.");
  const loaded = await loadGalleryManifest(request.entryId, {
    repositoryRoot: request.repositoryRoot,
  });
  if (!loaded.ok) return fail(loaded.code, loaded.message);
  return openFromBytes(loaded.bytes, `${request.entryId}.yaml`, {
    hiveRoot: request.hiveRoot,
    sourceKind: "gallery",
    sourceRef: request.entryId,
    approvalCopyVariant: "curated_catalog",
    trustHint: "curated_catalog",
  });
}
