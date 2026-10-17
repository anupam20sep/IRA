import { z } from "zod";

const isoTimestamp = z.string().datetime({ offset: true });

export const featureIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/, "invalid featureId");

export const agentIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "invalid agentId");

export const IraPersonaSchema = z.object({
  callsign: z.literal("Ira"),
  expansion: z.literal("Intelligent Resource Automation"),
});

export const HiveManifestSchema = z.object({
  schemaVersion: z.literal(1),
  repositoryRoot: z.string().min(1),
  createdAt: isoTimestamp,
  persona: IraPersonaSchema,
});

export const AutonomyModeSchema = z.enum(["observe", "supervised", "autonomous"]);

export const TelemetryModeSchema = z.enum(["off", "opt-in"]);

export const AutonomySettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    autonomy: AutonomyModeSchema,
    awayMode: z.boolean(),
    allowAbsentCi: z.boolean().optional(),
    pollIntervalMs: z.number().int().min(10000),
    maxReviewFailures: z.number().int().min(1),
    featureCeilings: z.record(featureIdSchema, z.number().int().min(1)),
    telemetry: TelemetryModeSchema,
    updatedAt: isoTimestamp,
  })
  .transform((s) => ({
    ...s,
    allowAbsentCi: s.allowAbsentCi ?? false,
  }));

export const HiveTaskStatusSchema = z.enum(["todo", "doing", "blocked", "done"]);

export const TaskKindSchema = z.enum([
  "code",
  "verify",
  "provision",
  "signoff",
  "doc-sync",
]);

export const ComplexitySchema = z.enum(["mechanical", "moderate", "complex"]);

export const TaskDriftSchema = z.enum(["ok", "added", "removed", "changed"]);

export const ReplanKindSchema = z.enum(["retry_tier", "reassign", "split"]);

export const ReplanSchema = z.object({
  kind: ReplanKindSchema,
  substeps: z.array(z.string()).optional(),
  reviewFailures: z.number().int().min(0),
  ceiling: z.number().int().min(1),
  attempt: z.number().int().min(1),
  fromAgentId: z.string().nullable(),
  toAgentId: z.string().nullable(),
});

export const HumanQASchema = z.object({
  question: z.string(),
  answer: z.string().nullable(),
  state: z.string(),
});

export const HiveTaskSchema = z.object({
  id: z.string().min(1),
  featureId: featureIdSchema,
  title: z.string().min(1),
  implementsFr: z.array(z.string()),
  dependsOn: z.array(z.string()),
  assigneeAgentId: agentIdSchema.nullable(),
  status: HiveTaskStatusSchema,
  kind: TaskKindSchema,
  complexity: ComplexitySchema,
  reviewFailures: z.number().int().min(0),
  hold: z.boolean().default(false),
  abortReason: z.string().nullable().optional(),
  ceiling: z.number().int().min(1),
  resultRef: z.string().nullable().optional(),
  blockedByAskMeId: z.string().nullable().optional(),
  drift: TaskDriftSchema,
  replan: ReplanSchema.nullable().optional(),
  capabilityTags: z.array(z.string()),
  humanQA: HumanQASchema.nullable().optional(),
  updatedAt: isoTimestamp,
});

export const HiveLedgerSchema = z.object({
  featureId: featureIdSchema,
  planPath: z.string().min(1),
  specDir: z.string().min(1),
  maxReviewFailures: z.number().int().min(1),
  updatedAt: isoTimestamp,
  tasks: z.array(HiveTaskSchema),
});

export const AskMeReasonClassSchema = z.enum([
  "budget_exceed",
  "circuit_breaker_stop",
  "destructive_git",
  "constitution_violation",
  "spec_scope_change",
  "untrusted_import",
  "repeated_review_failure",
  "ambiguous_requirement",
]);

export const AskMeActionSchema = z.enum(["retry", "keep_blocked", "acknowledge"]);

export const AskMeItemSchema = z.object({
  id: z.string().min(1),
  featureId: featureIdSchema.nullable(),
  taskId: z.string().nullable(),
  agentId: agentIdSchema.nullable(),
  reasonClass: AskMeReasonClassSchema,
  question: z.string().min(1).max(4000),
  answer: z.string().nullable(),
  action: AskMeActionSchema.nullable(),
  state: z.enum(["open", "resolved"]),
  createdAt: isoTimestamp,
  resolvedAt: isoTimestamp.nullable(),
});

export const EventActorSchema = z.object({
  kind: z.enum(["ira", "operator", "worker", "system"]),
  id: z.string().min(1),
});

export const IraEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  version: z.literal(1),
  ts: isoTimestamp,
  featureId: featureIdSchema.nullable(),
  actor: EventActorSchema,
  data: z.record(z.string(), z.unknown()),
});

export const BriefSchema = z.object({
  id: z.string().min(1),
  featureId: featureIdSchema,
  outcome: z.string().min(1).max(4000),
  constraints: z.array(z.string().max(500)),
  budgetTokens: z.number().nonnegative().nullable(),
  budgetUsd: z.number().nonnegative().nullable(),
  deliverable: z.string().min(1).max(1000),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  createdBy: z.literal("operator"),
});

export const RosterAgentStatusSchema = z.enum(["idle", "busy", "blocked", "offline"]);

export const RosterAgentOriginSchema = z.enum(["placeholder", "hire", "manual"]);

export const WorktreePolicySchema = z.enum(["isolated", "shared"]);

export const RosterAgentSchema = z.object({
  id: agentIdSchema,
  name: z.string().min(1),
  personaPath: z.string().nullable(),
  capabilityTags: z.array(z.string()),
  engine: z.string().nullable(),
  model: z.string().nullable(),
  budgetTokens: z.number().nonnegative().nullable().optional(),
  budgetUsd: z.number().nonnegative().nullable().optional(),
  workspace: z.string().nullable(),
  worktreePolicy: WorktreePolicySchema,
  allowedSkills: z.array(z.string()).optional(),
  allowedMcp: z.array(z.string()).optional(),
  status: RosterAgentStatusSchema,
  origin: RosterAgentOriginSchema,
  featureId: featureIdSchema.nullable().optional(),
});
