export const ENGINE_CATALOG_VERSION = 1 as const;
export const LOCAL_CONTEXT_FLOOR = 65536 as const;

export type EngineId =
  | "claude"
  | "codex"
  | "cursor-agent"
  | "opencode"
  | "crush"
  | "aider"
  | "custom";

export type EngineStrategy = "hooks" | "acp" | "pty";
export type AuthMode = "subscription" | "byok" | "local" | "unknown";
export type EngineHealthStatus = "ok" | "degraded" | "missing" | "unauthorized";
export type LadderRung = "subscription" | "byok" | "local";

export type EngineEmitCapability = "start" | "tool" | "stop" | "error" | "tokens";

export type LocalPackBackend = "ollama" | "lmstudio" | "vllm" | "byok";
export type LocalPackContextSource = "probe" | "declared";

export type CustomEngineEventMode = "sparse" | "jsonl";
export type CustomEngineRung = "byok" | "local";

export type DelegateToHost = EngineId | null;

export type HitlReasonClass = "budget_exceed" | "destructive_git";

export interface EnginePreset {
  catalogVersion: typeof ENGINE_CATALOG_VERSION;
  engineId: EngineId;
  displayName: string;
  binaries: string[];
  strategy: EngineStrategy;
  rung: LadderRung;
  spawnArgs: string[];
  statusArgs: string[];
  authEnv: string | null;
  byokEnvAllowlist: string[];
  models: string[];
  emits: EngineEmitCapability[];
}

export interface CustomEngine {
  instanceId: string;
  displayName: string;
  command: string[];
  model?: string | null;
  rung?: CustomEngineRung;
  eventMode: CustomEngineEventMode;
}

export interface CustomEnginesFile {
  schemaVersion: 1;
  engines: CustomEngine[];
}

export interface LocalPackProfile {
  engineId: Extract<EngineId, "opencode" | "crush">;
  backend: LocalPackBackend;
  baseUrl: string;
  model: string;
  advertisedContext: number | null;
  contextSource: LocalPackContextSource;
  tiers?: Record<"economy" | "standard" | "frontier", string>;
}

export interface FailoverPolicy {
  schemaVersion: 1;
  failoverEnabled: boolean;
  ladder: [LadderRung, LadderRung, LadderRung];
  crossEngineReview: boolean;
  delegateToHost: Extract<EngineId, "claude" | "codex" | "cursor-agent"> | null;
  hitl: HitlReasonClass[];
  quotaGroups: string[][];
}

export interface CredentialMatrixRow {
  engineId: string;
  displayName: string;
  installed: boolean;
  authMode: AuthMode;
  health: EngineHealthStatus;
  rung: LadderRung;
  binary: string | null;
}

export interface EngineHealth {
  engineId: string;
  authMode: AuthMode;
  health: EngineHealthStatus;
  reasonClass: string | null;
  binaryVersion: string | null;
  checkedAt: string;
}
