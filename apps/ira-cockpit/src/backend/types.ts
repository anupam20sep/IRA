export type Harness = "cursor" | "claude" | "codex" | "opencode";

export type EngineInfo = {
  id: string;
  cmd: string;
  installed: boolean;
  hostSpawnOnly: boolean;
};

export type DoctorSnapshot = {
  ok: boolean;
  hiveReady: boolean;
  engineRungReady: boolean;
  hiveRoot: string | null;
  repositoryRoot: string;
  sliceAValidated?: boolean;
  findings: Array<{ code?: string; severity?: string; message?: string }>;
};

export type AskMeItem = {
  id: string;
  featureId: string | null;
  taskId: string | null;
  agentId: string | null;
  reasonClass: string;
  question: string;
  answer: string | null;
  state?: string;
};

export type RosterAgent = {
  id: string;
  name?: string;
  displayName?: string;
  status?: string;
  engine?: string;
  personaPath?: string;
  capabilityTags?: string[];
  origin?: string;
  budgetUsd?: number;
  spendUsd?: number;
};

export type DocHit = {
  id: string;
  path: string;
  kind: "spec" | "design" | "plan" | "pattern" | "readme" | "other";
  title: string;
  snippet: string;
};

/** A SuperSpec feature under specs/<id>/ — nested inside a project, not a project itself. */
export type SpecStage = {
  featureId: string;
  title: string;
  stage: string;
  hasSpec: boolean;
  hasDesign: boolean;
  hasPlan: boolean;
  hasStatus: boolean;
};

/** @deprecated Use SpecStage — kept as alias during rename */
export type FeatureStage = SpecStage;

/** One local repository root registered as a cockpit project. */
export type ProjectSnapshot = {
  id: string;
  name: string;
  path: string;
  hiveRoot: string | null;
  doctor: DoctorSnapshot;
  askMe: AskMeItem[];
  roster: RosterAgent[];
  personas: Array<{ name: string; description: string; source: string; path: string }>;
  /** Specs / features inside this repo */
  specs: SpecStage[];
  patterns: Array<{ id: string; path: string; title: string }>;
  events: Array<{ ts?: string; type?: string; message?: string; raw?: string }>;
  settings: Record<string, unknown> | null;
};

export type CockpitSnapshot = {
  generatedAt: string;
  /** Primary / default project path (first configured). */
  repositoryRoot: string;
  hiveRoot: string | null;
  doctor: DoctorSnapshot;
  engines: EngineInfo[];
  projects: ProjectSnapshot[];
};
