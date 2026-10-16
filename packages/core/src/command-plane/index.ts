export { resolveRepositoryRoot, type RepositoryRootResult } from "./paths.js";
export { hiveInit, type HiveInitResult } from "./hive-init.js";
export { IRA_PERSONA, personaField, type IraPersonaField } from "./persona.js";
export {
  withLock,
  writeJsonAtomic,
  appendJsonlLine,
  shouldStealLock,
  busyCodeForLock,
  lockWaitMs,
  SCRIBE_BUSY,
  LEDGER_BUSY,
  MAILBOX_BUSY,
  EVENT_BUSY,
  ROSTER_BUSY,
  BLACKBOARD_LOCK_WAIT_MS,
  LEDGER_LOCK_WAIT_MS,
  MAILBOX_LOCK_WAIT_MS,
  EVENT_LOCK_WAIT_MS,
  type LockHolder,
  type WithLockResult,
  type LockBusyCode,
} from "./store.js";
export {
  registerCommandPlaneHooks,
  safeBeforeDispatch,
  safeEngineDispatch,
  safeNormalizeEvent,
  safeOnRecordResult,
  safeOnUntrustedImport,
  safeMatchCapabilities,
  HOOK_FAILED_CLOSED,
  type HookName,
  type DispatchIntent,
  type DispatchContext,
  type DispatchGate,
  type LearningHooks,
  type TokenHooks,
  type HireHooks,
  type EngineHooks,
} from "./hooks.js";
export { COMMAND_PLANE_ERROR_CODES, type CommandPlaneErrorCode } from "./types.js";
export {
  AutonomySettingsSchema,
  HiveManifestSchema,
  HiveTaskSchema,
  HiveLedgerSchema,
  featureIdSchema,
  agentIdSchema,
} from "./schema.js";
