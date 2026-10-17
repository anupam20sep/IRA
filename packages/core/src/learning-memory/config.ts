import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { featureIdSchema } from "../command-plane/schema.js";

const DistillModeSchema = z.enum(["heuristic", "model"]);

const FeatureLearningOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  retrieve: z.boolean().optional(),
  distillEnabled: z.boolean().optional(),
});

const LearningConfigFileSchema = z
  .object({
    enabled: z.boolean().optional(),
    retrieve: z.boolean().optional(),
    distillEnabled: z.boolean().optional(),
    maxInjectionBytes: z.number().int().positive().optional(),
    maxSummaryBytes: z.number().int().positive().optional(),
    judgeMinScore: z.number().min(0).max(1).optional(),
    distill: z.object({ mode: DistillModeSchema.optional() }).optional(),
    features: z.record(featureIdSchema, FeatureLearningOverrideSchema).optional(),
  })
  .strict();

export type FeatureLearningOverride = z.infer<typeof FeatureLearningOverrideSchema>;

export type LearningConfig = {
  enabled: boolean;
  retrieve: boolean;
  distillEnabled: boolean;
  maxInjectionBytes: number;
  maxSummaryBytes: number;
  judgeMinScore: number;
  distill: { mode: "heuristic" | "model" };
  features: Record<string, FeatureLearningOverride>;
};

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  enabled: true,
  retrieve: true,
  distillEnabled: true,
  maxInjectionBytes: 2048,
  maxSummaryBytes: 1024,
  judgeMinScore: 0.35,
  distill: { mode: "heuristic" },
  features: {},
};

function mergeLearningConfig(
  file: z.infer<typeof LearningConfigFileSchema>,
): LearningConfig {
  return {
    enabled: file.enabled ?? DEFAULT_LEARNING_CONFIG.enabled,
    retrieve: file.retrieve ?? DEFAULT_LEARNING_CONFIG.retrieve,
    distillEnabled: file.distillEnabled ?? DEFAULT_LEARNING_CONFIG.distillEnabled,
    maxInjectionBytes: file.maxInjectionBytes ?? DEFAULT_LEARNING_CONFIG.maxInjectionBytes,
    maxSummaryBytes: file.maxSummaryBytes ?? DEFAULT_LEARNING_CONFIG.maxSummaryBytes,
    judgeMinScore: file.judgeMinScore ?? DEFAULT_LEARNING_CONFIG.judgeMinScore,
    distill: {
      mode: file.distill?.mode ?? DEFAULT_LEARNING_CONFIG.distill.mode,
    },
    features: file.features ?? DEFAULT_LEARNING_CONFIG.features,
  };
}

/** Load `.superspec/learning.json` under `repositoryRoot`, applying design defaults when missing or invalid. */
export async function loadLearningConfig(repositoryRoot: string): Promise<LearningConfig> {
  const configPath = join(repositoryRoot, ".superspec", "learning.json");
  try {
    const text = await readFile(configPath, "utf8");
    const value: unknown = JSON.parse(text);
    const parsed = LearningConfigFileSchema.safeParse(value);
    if (!parsed.success) {
      return { ...DEFAULT_LEARNING_CONFIG, features: { ...DEFAULT_LEARNING_CONFIG.features } };
    }
    return mergeLearningConfig(parsed.data);
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    if (code === "ENOENT") {
      return { ...DEFAULT_LEARNING_CONFIG, features: { ...DEFAULT_LEARNING_CONFIG.features } };
    }
    return { ...DEFAULT_LEARNING_CONFIG, features: { ...DEFAULT_LEARNING_CONFIG.features } };
  }
}

/** Whether DISTILL is enabled globally and for `featureId` (feature override wins when set). */
export function isFeatureDistillEnabled(config: LearningConfig, featureId: string): boolean {
  if (!config.distillEnabled) {
    return false;
  }
  const override = config.features[featureId];
  if (override?.distillEnabled === false) {
    return false;
  }
  return true;
}
