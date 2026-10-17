import type { z } from "zod";
import type {
  BudgetRowSchema,
  BudgetScopeSchema,
  BudgetUnitSchema,
  BudgetsFileSchema,
  BreakerStageSchema,
  BreakerTriggerSchema,
  BreakersFileSchema,
  CircuitBreakerStateSchema,
  CompactionRecordSchema,
  CompactionStrategySchema,
  ContextGaugeSchema,
  CostForecastSchema,
  GaugesFileSchema,
  ModelTierSchema,
  RoutingHintReasonSchema,
  RoutingHintSchema,
  SpendEventInputSchema,
  SpendEventSchema,
  SpendSourceSchema,
  TierOverrideSchema,
  TokenSettingsSchema,
} from "./schema.js";

export type { ModelTier } from "../model-router.js";

export type SpendSource = z.infer<typeof SpendSourceSchema>;
export type ModelTierFromSchema = z.infer<typeof ModelTierSchema>;
export type SpendEvent = z.infer<typeof SpendEventSchema>;
export type SpendEventInput = z.infer<typeof SpendEventInputSchema>;

export type BudgetScope = z.infer<typeof BudgetScopeSchema>;
export type BudgetUnit = z.infer<typeof BudgetUnitSchema>;
export type BudgetRow = z.infer<typeof BudgetRowSchema>;
export type BudgetsFile = z.infer<typeof BudgetsFileSchema>;

export type BreakerStage = z.infer<typeof BreakerStageSchema>;
export type BreakerTrigger = z.infer<typeof BreakerTriggerSchema>;
export type CircuitBreakerState = z.infer<typeof CircuitBreakerStateSchema>;
export type BreakersFile = z.infer<typeof BreakersFileSchema>;

export type ContextGauge = z.infer<typeof ContextGaugeSchema>;
export type GaugesFile = z.infer<typeof GaugesFileSchema>;

export type CostForecast = z.infer<typeof CostForecastSchema>;

export type RoutingHintReason = z.infer<typeof RoutingHintReasonSchema>;
export type RoutingHint = z.infer<typeof RoutingHintSchema>;

export type TierOverride = z.infer<typeof TierOverrideSchema>;

export type CompactionStrategy = z.infer<typeof CompactionStrategySchema>;
export type CompactionRecord = z.infer<typeof CompactionRecordSchema>;

export type TokenSettings = z.infer<typeof TokenSettingsSchema>;
