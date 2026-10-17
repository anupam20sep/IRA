import { z } from "zod";

const isoTimestamp = z.string().datetime({ offset: true });

export const SpendSourceSchema = z.enum(["transcript", "api", "estimate"]);

export const ModelTierSchema = z.enum(["economy", "standard", "frontier"]);

export const SpendEventSchema = z.object({
  id: z.string().min(1),
  ts: isoTimestamp,
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  featureId: z.string().nullable(),
  taskId: z.string().nullable(),
  engine: z.string().nullable(),
  model: z.string().nullable(),
  inputTokens: z.number().min(0),
  outputTokens: z.number().min(0),
  usdEstimate: z.number().nullable(),
  source: SpendSourceSchema,
  partial: z.boolean(),
});

export const SpendEventInputSchema = SpendEventSchema.omit({ id: true, ts: true });

export const BudgetScopeSchema = z.enum(["agent", "feature"]);
export const BudgetUnitSchema = z.enum(["tokens", "usd"]);

export const BudgetRowSchema = z.object({
  scope: BudgetScopeSchema,
  scopeId: z.string().min(1),
  unit: BudgetUnitSchema,
  cap: z.number().nullable(),
  updatedAt: isoTimestamp,
});

export const BudgetsFileSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(BudgetRowSchema),
});

export const BreakerStageSchema = z.enum(["clear", "steer", "constrain", "stop"]);
export const BreakerTriggerSchema = z.enum(["loop", "errors", "budget"]);

export const CircuitBreakerStateSchema = z.object({
  workerKey: z.string().min(1),
  stage: BreakerStageSchema,
  trigger: BreakerTriggerSchema.nullable(),
  windowsFired: z.number().int().min(0),
  constrainContextGrowth: z.boolean(),
  effectiveTier: ModelTierSchema.nullable(),
  haltReason: z.string().nullable(),
  updatedAt: isoTimestamp,
});

export const BreakersFileSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.record(z.string(), CircuitBreakerStateSchema),
});

const ContextGaugeMeasuredSchema = z.object({
  state: z.literal("measured"),
  usedTokens: z.number().min(0),
  limitTokens: z.number().positive(),
  ratio: z.number().min(0).max(1),
  updatedAt: isoTimestamp,
});

const ContextGaugeUnavailableSchema = z.object({
  state: z.literal("unavailable"),
  reason: z.string().min(1),
  updatedAt: isoTimestamp,
});

export const ContextGaugeSchema = z.discriminatedUnion("state", [
  ContextGaugeMeasuredSchema,
  ContextGaugeUnavailableSchema,
]);

export const GaugesFileSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.record(z.string(), ContextGaugeSchema),
});

export const CostForecastSchema = z.object({
  expectedTokens: z.number().nullable(),
  expectedUsd: z.number().nullable(),
  basis: z.string(),
  status: z.enum(["ok", "insufficient-history"]),
});

export const RoutingHintReasonSchema = z.enum(["low_quota", "operator_override", "none"]);

export const RoutingHintSchema = z.object({
  preferredTier: ModelTierSchema,
  preferLocalEngine: z.boolean(),
  reason: RoutingHintReasonSchema,
});

export const TierOverrideSchema = z.object({
  id: z.string().min(1),
  ts: isoTimestamp,
  agentId: z.string().min(1),
  featureId: z.string().nullable(),
  requestedTier: ModelTierSchema,
  routeModelTier: ModelTierSchema,
  reason: z.string(),
  actor: z.literal("operator"),
});

export const CompactionStrategySchema = z.enum([
  "drop-tool-noise",
  "dedupe-reads",
  "summarize",
  "clear",
  "compact-skipped",
]);

export const CompactionRecordSchema = z.object({
  id: z.string().min(1),
  ts: isoTimestamp,
  featureId: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  passed: z.boolean(),
  strategy: CompactionStrategySchema,
  strategiesAttempted: z.array(z.string()),
});

export const TokenSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  breakerWindowMs: z.number().int().positive().default(60_000),
  loopThreshold: z.number().int().positive().default(3),
  errorThreshold: z.number().int().positive().default(5),
  lowQuotaPercent: z.number().min(0).max(100).default(20),
  compactionSummarizeThresholdTokens: z.number().int().positive().default(8000),
});
