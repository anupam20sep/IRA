import type { z } from "zod";
import type {
  ApprovalCopyVariantSchema,
  GalleryEntrySchema,
  GalleryIndexSchema,
  GalleryTrustHintSchema,
  HireManifestSchema,
  HireReviewSchema,
  HireReviewStateSchema,
  HireReviewUiCopySchema,
  HireScoreSchema,
  HireSourceKindSchema,
  PersonaHarnessSchema,
  PersonaScopeSchema,
  SanitizationRejectedSchema,
  SanitizationReportSchema,
  SkillConsentDecisionSchema,
  SkillConsentSchema,
  SuggestedModelTierSchema,
} from "./schema.js";

export type PersonaHarness = z.infer<typeof PersonaHarnessSchema>;
export type PersonaScope = z.infer<typeof PersonaScopeSchema>;
export type SuggestedModelTier = z.infer<typeof SuggestedModelTierSchema>;
export type HireManifest = z.infer<typeof HireManifestSchema>;
export type SanitizationRejected = z.infer<typeof SanitizationRejectedSchema>;
export type SanitizationReport = z.infer<typeof SanitizationReportSchema>;
export type SkillConsentDecision = z.infer<typeof SkillConsentDecisionSchema>;
export type SkillConsent = z.infer<typeof SkillConsentSchema>;
export type HireReviewState = z.infer<typeof HireReviewStateSchema>;
export type HireSourceKind = z.infer<typeof HireSourceKindSchema>;
export type ApprovalCopyVariant = z.infer<typeof ApprovalCopyVariantSchema>;
export type HireReviewUiCopy = z.infer<typeof HireReviewUiCopySchema>;
export type HireReview = z.infer<typeof HireReviewSchema>;
export type GalleryTrustHint = z.infer<typeof GalleryTrustHintSchema>;
export type GalleryEntry = z.infer<typeof GalleryEntrySchema>;
export type GalleryIndex = z.infer<typeof GalleryIndexSchema>;
export type HireScore = z.infer<typeof HireScoreSchema>;
