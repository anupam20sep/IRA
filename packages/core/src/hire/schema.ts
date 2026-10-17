import { z } from "zod";
import { HIRE_TRUST_BANNER } from "./constants.js";

const isoTimestamp = z.string().datetime({ offset: true });

const hireSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "invalid hire id slug");

export const PersonaHarnessSchema = z.enum(["cursor", "claude", "codex"]);

export const PersonaScopeSchema = z.enum(["project", "home", "both"]);

export const SuggestedModelTierSchema = z.enum(["economy", "standard", "frontier"]);

export const HireManifestSchema = z.object({
  schemaVersion: z.literal("hireManifest/v1"),
  id: hireSlugSchema,
  displayName: z.string().min(1).max(128),
  goal: z.string().min(1).max(4000),
  capabilityTags: z.array(z.string()),
  suggestedEngine: z.string().min(1),
  suggestedModelTier: SuggestedModelTierSchema,
  budget: z.object({
    tokens: z.number().nullable(),
    usd: z.number().nullable(),
  }),
  allowlists: z.object({
    skills: z.array(z.string()),
    mcp: z.array(z.string()),
  }),
  persona: z.object({
    harness: PersonaHarnessSchema,
    scope: PersonaScopeSchema,
    body: z.string().min(1),
  }),
});

export const SanitizationRejectedSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
});

export const SanitizationReportSchema = z.object({
  droppedKeys: z.array(z.string()),
  rejected: z.array(SanitizationRejectedSchema),
  warnings: z.array(z.string()),
  contentSha256: z.string().min(1),
  sanitizedAt: isoTimestamp,
});

export const SkillConsentDecisionSchema = z.enum(["pending", "accepted", "declined"]);

export const SkillConsentSchema = z.object({
  skillId: z.string().min(1),
  source: z.string().min(1),
  scanResult: z.record(z.unknown()).nullable(),
  decision: SkillConsentDecisionSchema,
});

export const HireReviewStateSchema = z.enum(["pending", "spawned", "cancelled", "rejected"]);

export const HireSourceKindSchema = z.enum(["file", "url", "paste", "gallery"]);

export const ApprovalCopyVariantSchema = z.enum(["standard", "curated_catalog"]);

export const HireReviewUiCopySchema = z.object({
  trustBanner: z.literal(HIRE_TRUST_BANNER),
  showFullSanitizationReport: z.boolean(),
});

export const HireReviewSchema = z.object({
  reviewId: z.string().min(1),
  state: HireReviewStateSchema,
  sourceKind: HireSourceKindSchema,
  sourceRef: z.string().min(1),
  approvalCopyVariant: ApprovalCopyVariantSchema,
  contentSha256: z.string().min(1),
  sanitizationReport: SanitizationReportSchema,
  parsedManifest: HireManifestSchema,
  operatorEdits: z.record(z.unknown()).optional(),
  skillConsents: z.array(SkillConsentSchema),
  askMeId: z.string().min(1),
  uiCopy: HireReviewUiCopySchema,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const GalleryTrustHintSchema = z.literal("curated_catalog");

export const GalleryEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  capabilityTags: z.array(z.string()),
  manifestPath: z.string().min(1),
  manifestSha256: z.string().min(1),
  trustHint: GalleryTrustHintSchema,
});

export const GalleryIndexSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(GalleryEntrySchema),
});

export const HireScoreSchema = z.object({
  agentId: z.string().min(1),
  passRate: z.number().min(0).max(1),
  reviewFailures: z.number().min(0),
  spendUsd: z.number().min(0),
  spendTokens: z.number().min(0),
  score: z.number().min(0).max(100),
  demotionHint: z.boolean(),
  demotionReasons: z.array(z.string()),
  updatedAt: isoTimestamp,
});
