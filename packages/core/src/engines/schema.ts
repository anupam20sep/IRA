import { z } from "zod";
import { ENGINE_CATALOG_VERSION, LOCAL_CONTEXT_FLOOR } from "./types.js";

export {
  ENGINE_CATALOG_VERSION,
  LOCAL_CONTEXT_FLOOR,
  type AuthMode,
  type CredentialMatrixRow,
  type CustomEngine,
  type CustomEnginesFile,
  type EngineHealth,
  type EngineHealthRecord,
  type EngineHealthStatus,
  type EngineId,
  type EnginePreset,
  type EngineStrategy,
  type FailoverPolicy,
  type LadderRung,
  type LocalPackProfile,
} from "./types.js";

const isoTimestamp = z.string().datetime({ offset: true });

export const EngineIdSchema = z.enum([
  "claude",
  "codex",
  "cursor-agent",
  "opencode",
  "crush",
  "aider",
  "custom",
]);

export const EngineStrategySchema = z.enum(["hooks", "acp", "pty"]);

export const AuthModeSchema = z.enum(["subscription", "byok", "local", "unknown"]);

export const EngineHealthStatusSchema = z.enum([
  "ok",
  "degraded",
  "missing",
  "unauthorized",
]);

export const LadderRungSchema = z.enum(["subscription", "byok", "local"]);

export const EngineEmitCapabilitySchema = z.enum([
  "start",
  "tool",
  "stop",
  "error",
  "tokens",
]);

export const LocalPackBackendSchema = z.enum(["ollama", "lmstudio", "vllm", "byok"]);

export const LocalPackContextSourceSchema = z.enum(["probe", "declared"]);

export const CustomEngineEventModeSchema = z.enum(["sparse", "jsonl"]);

export const CustomEngineRungSchema = z.enum(["byok", "local"]);

export const HitlReasonClassSchema = z.enum(["budget_exceed", "destructive_git"]);

export const DelegateToHostSchema = z
  .enum(["claude", "codex", "cursor-agent"])
  .nullable();

const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "invalid instanceId");

const argvSchema = z
  .array(z.string().min(1))
  .min(1)
  .refine((cmd) => cmd.every((part) => part.length > 0), {
    message: "command argv must not contain empty strings",
  });

export const EnginePresetSchema = z.object({
  catalogVersion: z.literal(ENGINE_CATALOG_VERSION),
  engineId: EngineIdSchema,
  displayName: z.string().min(1),
  binaries: z.array(z.string().min(1)).min(1),
  strategy: EngineStrategySchema,
  rung: LadderRungSchema,
  spawnArgs: z.array(z.string()),
  statusArgs: z.array(z.string()),
  authEnv: z.string().min(1).nullable(),
  byokEnvAllowlist: z.array(z.string().min(1)),
  models: z.array(z.string().min(1)),
  emits: z.array(EngineEmitCapabilitySchema),
});

export const CustomEngineSchema = z.object({
  instanceId: slugSchema,
  displayName: z.string().min(1),
  command: argvSchema,
  model: z.string().min(1).nullable().optional(),
  rung: CustomEngineRungSchema.optional(),
  eventMode: CustomEngineEventModeSchema,
});

export const CustomEnginesFileSchema = z.object({
  schemaVersion: z.literal(1),
  engines: z.array(CustomEngineSchema),
});

export const LocalPackProfileSchema = z.object({
  engineId: z.enum(["opencode", "crush"]),
  backend: LocalPackBackendSchema,
  baseUrl: z.string().url(),
  model: z.string().min(1),
  advertisedContext: z.number().int().nonnegative().nullable(),
  contextSource: LocalPackContextSourceSchema,
  tiers: z
    .object({
      economy: z.string().min(1),
      standard: z.string().min(1),
      frontier: z.string().min(1),
    })
    .optional(),
});

export const FailoverPolicySchema = z.object({
  schemaVersion: z.literal(1),
  failoverEnabled: z.boolean(),
  ladder: z
    .tuple([
      z.literal("subscription"),
      z.literal("byok"),
      z.literal("local"),
    ])
    .describe("fixed three-rung order: subscription → byok → local"),
  crossEngineReview: z.boolean(),
  delegateToHost: DelegateToHostSchema,
  hitl: z.array(HitlReasonClassSchema),
  quotaGroups: z.array(z.array(z.string().min(1))),
});

export const CredentialMatrixRowSchema = z.object({
  engineId: z.string().min(1),
  displayName: z.string().min(1),
  installed: z.boolean(),
  authMode: AuthModeSchema,
  health: EngineHealthStatusSchema,
  rung: LadderRungSchema,
  binary: z.string().min(1).nullable(),
});

export const EngineHealthRecordSchema = z.object({
  engineId: z.string().min(1),
  authMode: AuthModeSchema,
  health: EngineHealthStatusSchema,
  reasonClass: z.string().min(1).nullable(),
  binaryVersion: z.string().min(1).nullable(),
  checkedAt: isoTimestamp,
});
