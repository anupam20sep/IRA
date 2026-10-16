/** Board snapshot DTOs aligned with P-001 hive documents and GET /api/snapshot. */

export const SNAPSHOT_TYPES_VERSION = 1 as const;

export type IraPersona = {
  callsign: "Ira";
  expansion: "Intelligent Resource Automation";
};

export type TaskReadiness = "ready" | "waiting";

export type HiveTaskStatus = "todo" | "doing" | "blocked" | "done";

export type TaskKind = "code" | "verify" | "provision" | "signoff" | "doc-sync";

export type TaskComplexity = "mechanical" | "moderate" | "complex";

export type TaskDrift = "ok" | "added" | "removed" | "changed";

export type ReplanKind = "retry_tier" | "reassign" | "split";

export type TaskReplan = {
  kind: ReplanKind;
  substeps?: string[];
  reviewFailures: number;
  ceiling: number;
  attempt: number;
  fromAgentId: string | null;
  toAgentId: string | null;
};

export type HumanQA = {
  question: string;
  answer: string | null;
  state: string;
};

/** P-001 ledger task plus derived readiness for todo columns. */
export type SnapshotTask = {
  id: string;
  featureId: string;
  title: string;
  implementsFr: string[];
  dependsOn: string[];
  assigneeAgentId: string | null;
  status: HiveTaskStatus;
  kind: TaskKind;
  complexity: TaskComplexity;
  reviewFailures: number;
  hold?: boolean;
  abortReason?: string | null;
  ceiling: number;
  resultRef?: string | null;
  blockedByAskMeId?: string | null;
  drift: TaskDrift;
  replan?: TaskReplan | null;
  capabilityTags: string[];
  humanQA?: HumanQA | null;
  updatedAt: string;
  readiness: TaskReadiness;
};

export type AskMeReasonClass =
  | "budget_exceed"
  | "destructive_git"
  | "constitution_violation"
  | "spec_scope_change"
  | "untrusted_import"
  | "repeated_review_failure"
  | "ambiguous_requirement";

export type AskMeAction = "retry" | "keep_blocked" | "acknowledge";

export type AskMeState = "open" | "resolved";

/** P-001 AskMeItem plus list projection fields from ask-me-list. */
export type SnapshotAskMe = {
  id: string;
  featureId: string | null;
  taskId: string | null;
  agentId: string | null;
  reasonClass: AskMeReasonClass;
  question: string;
  answer: string | null;
  action: AskMeAction | null;
  state: AskMeState;
  createdAt: string;
  resolvedAt: string | null;
  ageSeconds: number;
};

export type EventActorKind = "ira" | "operator" | "worker" | "system";

export type SnapshotEventActor = {
  kind: EventActorKind;
  id: string;
};

/** P-001 Event line from events.jsonl. */
export type SnapshotEvent = {
  id: string;
  type: string;
  version: 1;
  ts: string;
  featureId: string | null;
  actor: SnapshotEventActor;
  data: Record<string, unknown>;
};

export type RosterAgentStatus = "idle" | "busy" | "blocked" | "offline";

export type RosterAgentOrigin = "placeholder" | "hire" | "manual";

export type WorktreePolicy = "isolated" | "shared";

/** P-001 RosterAgent plus board join fields for Fleet. */
export type SnapshotAgent = {
  id: string;
  name: string;
  personaPath: string | null;
  capabilityTags: string[];
  engine: string | null;
  model: string | null;
  budgetTokens?: number | null;
  budgetUsd?: number | null;
  workspace: string | null;
  worktreePolicy: WorktreePolicy;
  allowedSkills?: string[];
  allowedMcp?: string[];
  status: RosterAgentStatus;
  origin: RosterAgentOrigin;
  featureId?: string | null;
  currentTaskId: string | null;
  contextUsedRatio?: number;
};

export type Brief = {
  id: string;
  featureId: string;
  outcome: string;
  constraints: string[];
  budgetTokens: number | null;
  budgetUsd: number | null;
  deliverable: string;
  createdAt: string;
  updatedAt: string;
  createdBy: "operator";
};

export type TaskCounts = {
  todo: number;
  doing: number;
  blocked: number;
  done: number;
};

export type SnapshotFeature = {
  featureId: string;
  taskCounts: TaskCounts;
  openAskMe: number;
  tasks: SnapshotTask[];
  brief: Brief | null;
};

export type DoctorFinding = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  remedy?: string;
};

/** Doctor projection for the board (OD-014 hive vs engine split). */
export type DoctorSlice = {
  ok: boolean;
  hiveReady: boolean;
  engineRungReady: boolean;
  ready?: boolean;
  findings: DoctorFinding[];
};

export type AutonomyMode = "observe" | "supervised" | "autonomous";

/** Subset of AutonomySettings exposed on the snapshot. */
export type AutonomySlice = {
  autonomy: AutonomyMode;
  awayMode: boolean;
  pollIntervalMs: number;
};

/** Pattern store probe from GET /api/snapshot (no file bytes or sqlite). */
export type PatternsDirState = "empty" | "unavailable" | "files-no-query";

export type BoardSnapshot = {
  ok: true;
  generatedAt: string;
  stale: boolean;
  repositoryRoot: string;
  hiveRoot: string;
  persona: IraPersona;
  doctor: DoctorSlice;
  autonomy: AutonomySlice;
  features: SnapshotFeature[];
  agents: SnapshotAgent[];
  askMe: SnapshotAskMe[];
  events: SnapshotEvent[];
  patternsDirState: PatternsDirState;
};
