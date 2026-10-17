import type { z } from "zod";
import type {
  AutonomySettingsSchema,
  HiveManifestSchema,
  HiveTaskSchema,
  HiveLedgerSchema,
  AskMeItemSchema,
  IraEventSchema,
  IraPersonaSchema,
  BriefSchema,
  RosterAgentSchema,
} from "./schema.js";

/** Structured error codes returned by Command Plane CLI/MCP handlers. */
export const COMMAND_PLANE_ERROR_CODES = [
  "HIVE_NOT_INITIALIZED",
  "HIVE_NOT_READY",
  "HIVE_ROOT_UNRESOLVED",
  "HIVE_SCHEMA_MISMATCH",
  "HIVE_CORRUPT",
  "HIVE_NOT_WRITABLE",
  "SCRIBE_BUSY",
  "LEDGER_BUSY",
  "MAILBOX_BUSY",
  "MAILBOX_ROLE",
  "EVENT_BUSY",
  "ROSTER_BUSY",
  "ASK_ME_NOT_FOUND",
  "ASK_ME_ALREADY_RESOLVED",
  "INVALID_INPUT",
  "FEATURE_NOT_FOUND",
  "AWAY_ALREADY_RUNNING",
  "TRACEABILITY_GAP",
  "UNSUPPORTED_TRIGGER",
  "DISPATCH_PATH_REQUIRED",
  "DISPATCH_HELD",
  "HOST_SPAWN_FORBIDDEN",
  "ABORT_UNSUPPORTED",
  "HOOK_FAILED_CLOSED",
  "SUPERVISOR_IN_MCP_FORBIDDEN",
  "SLICE_A_ONLY",
  "TOKEN_FILE_MODE",
] as const;

export type CommandPlaneErrorCode = (typeof COMMAND_PLANE_ERROR_CODES)[number];

export type IraPersona = z.infer<typeof IraPersonaSchema>;
export type HiveManifest = z.infer<typeof HiveManifestSchema>;
export type AutonomySettings = z.infer<typeof AutonomySettingsSchema>;
export type HiveTask = z.infer<typeof HiveTaskSchema>;
export type HiveLedger = z.infer<typeof HiveLedgerSchema>;
export type AskMeItem = z.infer<typeof AskMeItemSchema>;
export type IraEvent = z.infer<typeof IraEventSchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type RosterAgent = z.infer<typeof RosterAgentSchema>;

export type AskMeReasonClass =
  | "budget_exceed"
  | "circuit_breaker_stop"
  | "destructive_git"
  | "constitution_violation"
  | "spec_scope_change"
  | "untrusted_import"
  | "repeated_review_failure"
  | "ambiguous_requirement";

export type AskMeAction = "retry" | "keep_blocked" | "acknowledge";

export type HiveTaskStatus = "todo" | "doing" | "blocked" | "done";

export type TaskDrift = "ok" | "added" | "removed" | "changed";

export type ReplanKind = "retry_tier" | "reassign" | "split";
