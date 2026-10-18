import { create } from "zustand";
import { fetchSnapshot } from "@/lib/ira-api";
import { mapSnapshotToLive } from "@/store/live-map";

export type AutonomyMode = "observe" | "supervised" | "autonomous";
export type Route = "home" | "project" | "brainstorm" | "setup";
export type ProjectLens =
  | "pulse"
  | "team"
  | "stages"
  | "docs"
  | "decisions"
  | "memory"
  | "spend"
  | "triggers"
  | "askme";

export type AgentStatus = "idle" | "busy" | "blocked" | "offline";
export type TaskStatus = "todo" | "doing" | "blocked" | "done";
export type SpecStage =
  | "explore"
  | "scope"
  | "refine"
  | "architect"
  | "plan"
  | "route"
  | "forge"
  | "validate"
  | "ship";

export type LogLine = {
  id: string;
  ts: string;
  level: "info" | "warn" | "error" | "ira";
  source: string;
  message: string;
};

export type Intervention = {
  id: string;
  projectId: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
};

export type ProjectAgent = {
  id: string;
  name: string;
  role: string;
  engine: string;
  status: AgentStatus;
  tokensUsed: number;
  tokensPerMin: number;
  elapsedMin: number;
  taskId?: string;
  spark: number[];
  kind: "code" | "creative" | "ops";
};

export type ProjectTask = {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeId?: string;
  fr?: string;
};

export type SpecInfo = {
  id: string;
  title: string;
  stage: SpecStage;
  frDone: number;
  frTotal: number;
};

export type Decision = {
  id: string;
  ts: string;
  kind: "ask-me" | "scope" | "hire" | "budget" | "od";
  title: string;
  outcome: string;
  actor: string;
};

export type DocHit = {
  id: string;
  path: string;
  kind: "spec" | "design" | "plan" | "pattern" | "readme" | "other";
  title: string;
  snippet: string;
};

export type Pattern = {
  id: string;
  kind: "success" | "failure" | "routing";
  summary: string;
  score: number;
  usedIn?: string;
};

export type Trigger = {
  id: string;
  name: string;
  next: string;
  enabled: boolean;
};

export type CatalogAgent = {
  id: string;
  name: string;
  role: string;
  skills: string[];
  defaultEngine: string;
  hired: boolean;
};

export type CatalogSkill = {
  id: string;
  name: string;
  description: string;
  installed: boolean;
};

export type BrainstormSession = {
  id: string;
  title: string;
  projectId?: string;
  status: "draft" | "planning" | "ready";
  notes: string;
  planModeTarget: "cursor" | "claude" | "codex";
};

export type Project = {
  id: string;
  name: string;
  /** Absolute local repository root for this project */
  path: string;
  tagline: string;
  status: "active" | "paused" | "shipping";
  progress: number;
  done: number;
  blocked: number;
  pending: number;
  spendUsd: number;
  budgetUsd: number;
  agents: ProjectAgent[];
  tasks: ProjectTask[];
  /** Specs / features inside this repo (not projects themselves) */
  specs: SpecInfo[];
  decisions: Decision[];
  docs: DocHit[];
  patterns: Pattern[];
  triggers: Trigger[];
};

export type Telemetry = {
  cpu: number;
  mem: number;
  gpu: number;
  vram: number;
  gpuTemp: number;
  hiveReady: boolean;
  engineRungReady: boolean;
};

type CockpitState = {
  route: Route;
  projectId: string | null;
  projectLens: ProjectLens;
  projectFilter: string;
  autonomy: AutonomyMode;
  away: boolean;
  deckOpen: boolean;
  processing: boolean;
  prompt: string;
  commandOpen: boolean;
  docsQuery: string;
  brainstormDraft: string;
  projects: Project[];
  catalogAgents: CatalogAgent[];
  catalogSkills: CatalogSkill[];
  brainstorms: BrainstormSession[];
  logs: LogLine[];
  interventions: Intervention[];
  telemetry: Telemetry;
  live: boolean;
  liveError: string | null;
  refreshing: boolean;
  lastRefreshAt: string | null;
  liveMeta: {
    hiveReady: boolean;
    engineRungReady: boolean;
    hiveRoot: string | null;
    repositoryRoot: string;
    generatedAt: string;
    projectCount: number;
  } | null;
  setRoute: (route: Route) => void;
  openProject: (id: string, lens?: ProjectLens) => void;
  setProjectLens: (lens: ProjectLens) => void;
  setProjectFilter: (q: string) => void;
  setAutonomy: (mode: AutonomyMode) => void;
  setAway: (away: boolean) => void;
  setDeckOpen: (open: boolean) => void;
  setPrompt: (value: string) => void;
  setCommandOpen: (open: boolean) => void;
  setDocsQuery: (q: string) => void;
  setBrainstormDraft: (v: string) => void;
  submitPrompt: () => void;
  approveIntervention: (id: string) => void;
  toggleCatalogAgent: (id: string) => void;
  toggleCatalogSkill: (id: string) => void;
  hireAgentToProject: (catalogId: string, projectId: string) => void;
  launchPlanMode: (sessionId: string) => void;
  createBrainstorm: () => void;
  tick: () => void;
  filteredProjects: () => Project[];
  activeProject: () => Project | null;
  refreshLive: () => Promise<void>;
};

function spark() {
  return Array.from({ length: 16 }, () => 8 + Math.random() * 92);
}

function nowTs() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

const projects: Project[] = [
  {
    id: "edu-platform",
    name: "Education Platform",
    path: "/Users/macky/IRA/edu-platform",
    tagline: "Refactor backend + tenant isolation",
    status: "active",
    progress: 68,
    done: 12,
    blocked: 1,
    pending: 5,
    spendUsd: 4.12,
    budgetUsd: 5,
    agents: [
      {
        id: "edu-arch",
        name: "Nova",
        role: "Architect",
        engine: "claude",
        status: "busy",
        tokensUsed: 182400,
        tokensPerMin: 420,
        elapsedMin: 47,
        taskId: "T014",
        spark: spark(),
        kind: "ops",
      },
      {
        id: "edu-py",
        name: "Cipher",
        role: "Python Developer",
        engine: "cursor-agent",
        status: "busy",
        tokensUsed: 410200,
        tokensPerMin: 880,
        elapsedMin: 112,
        taskId: "T015",
        spark: spark(),
        kind: "code",
      },
      {
        id: "edu-react",
        name: "Vesper",
        role: "React Specialist",
        engine: "codex",
        status: "idle",
        tokensUsed: 44200,
        tokensPerMin: 0,
        elapsedMin: 28,
        spark: spark(),
        kind: "code",
      },
      {
        id: "edu-qa",
        name: "Quill",
        role: "QA Specialist",
        engine: "claude",
        status: "blocked",
        tokensUsed: 22100,
        tokensPerMin: 0,
        elapsedMin: 15,
        taskId: "T016",
        spark: spark(),
        kind: "ops",
      },
    ],
    tasks: [
      { id: "T014", title: "Design tenant isolation", status: "doing", assigneeId: "edu-arch", fr: "FR-018" },
      { id: "T015", title: "Implement auth refresh", status: "doing", assigneeId: "edu-py", fr: "FR-012" },
      { id: "T016", title: "Regression suite for billing hooks", status: "blocked", assigneeId: "edu-qa", fr: "FR-014" },
      { id: "T017", title: "Student dashboard polish", status: "todo", fr: "FR-020" },
      { id: "T018", title: "Ship validate matrix", status: "todo", fr: "FR-021" },
      { id: "T011", title: "API rate limiter", status: "done", assigneeId: "edu-py", fr: "FR-009" },
    ],
    specs: [
      { id: "006-edu-backend", title: "edu-backend", stage: "forge", frDone: 9, frTotal: 14 },
      { id: "007-tenant", title: "tenant-isolation", stage: "architect", frDone: 2, frTotal: 6 },
    ],
    decisions: [
      {
        id: "d1",
        ts: "2026-10-17 21:02",
        kind: "scope",
        title: "FR-018 multi-tenant invoices",
        outcome: "Pending Ask-Me",
        actor: "Nova → Operator",
      },
      {
        id: "d2",
        ts: "2026-10-17 18:40",
        kind: "budget",
        title: "Raise mission budget to $5",
        outcome: "Approved",
        actor: "Operator",
      },
      {
        id: "d3",
        ts: "2026-10-16 11:12",
        kind: "hire",
        title: "Hire Quill (QA)",
        outcome: "Spawned after review",
        actor: "Operator",
      },
    ],
    docs: [
      {
        id: "doc1",
        path: "specs/006-edu-backend/spec.md",
        kind: "spec",
        title: "Education backend spec",
        snippet: "FR-012 Auth refresh tokens expire…",
      },
      {
        id: "doc2",
        path: "specs/006-edu-backend/design.md",
        kind: "design",
        title: "Backend design",
        snippet: "FastAPI + Postgres RLS for tenants…",
      },
      {
        id: "doc3",
        path: "specs/006-edu-backend/plan.md",
        kind: "plan",
        title: "Forge plan",
        snippet: "T014 depends on T011…",
      },
      {
        id: "doc4",
        path: ".superspec/patterns/pat_auth.md",
        kind: "pattern",
        title: "fastapi-auth-refresh",
        snippet: "Prefer rotate-on-use for refresh tokens…",
      },
    ],
    patterns: [
      { id: "p1", kind: "success", summary: "fastapi-auth-refresh@v3", score: 0.91, usedIn: "T015" },
      { id: "p2", kind: "failure", summary: "RLS policies need migration order", score: 0.74 },
    ],
    triggers: [
      { id: "tr1", name: "CI green → continue forge", next: "when CI passes", enabled: true },
      { id: "tr2", name: "Night poll forge-status", next: "02:00 local", enabled: true },
    ],
  },
  {
    id: "billing-portal",
    name: "Billing Portal",
    path: "/Users/macky/IRA/billing-portal",
    tagline: "Greenfield checkout + invoices",
    status: "active",
    progress: 22,
    done: 3,
    blocked: 0,
    pending: 11,
    spendUsd: 1.08,
    budgetUsd: 8,
    agents: [
      {
        id: "bill-react",
        name: "Vesper",
        role: "React Specialist",
        engine: "codex",
        status: "busy",
        tokensUsed: 98000,
        tokensPerMin: 510,
        elapsedMin: 33,
        taskId: "T003",
        spark: spark(),
        kind: "code",
      },
      {
        id: "bill-mkt",
        name: "Lumen",
        role: "Marketing",
        engine: "opencode",
        status: "busy",
        tokensUsed: 41000,
        tokensPerMin: 190,
        elapsedMin: 50,
        taskId: "T004",
        spark: spark(),
        kind: "creative",
      },
      {
        id: "bill-arch",
        name: "Nova",
        role: "Architect",
        engine: "claude",
        status: "idle",
        tokensUsed: 22000,
        tokensPerMin: 0,
        elapsedMin: 12,
        spark: spark(),
        kind: "ops",
      },
    ],
    tasks: [
      { id: "T001", title: "Explore checkout flows", status: "done", assigneeId: "bill-arch" },
      { id: "T002", title: "Scope payment FR set", status: "done", assigneeId: "bill-arch" },
      { id: "T003", title: "Invoice UI shell", status: "doing", assigneeId: "bill-react", fr: "FR-002" },
      { id: "T004", title: "Launch copy + pricing page", status: "doing", assigneeId: "bill-mkt" },
      { id: "T005", title: "Stripe webhook contract", status: "todo", fr: "FR-005" },
    ],
    specs: [
      { id: "001-billing", title: "billing-portal", stage: "plan", frDone: 0, frTotal: 8 },
    ],
    decisions: [
      {
        id: "bd1",
        ts: "2026-10-17 09:10",
        kind: "od",
        title: "Use Stripe test mode only",
        outcome: "Locked",
        actor: "Operator",
      },
    ],
    docs: [
      {
        id: "bdoc1",
        path: "specs/001-billing/spec.md",
        kind: "spec",
        title: "Billing portal spec",
        snippet: "US-1 Operator can issue invoice…",
      },
      {
        id: "bdoc2",
        path: "docs/pricing-notes.md",
        kind: "readme",
        title: "Pricing notes",
        snippet: "Starter $29 · Pro $99…",
      },
    ],
    patterns: [
      { id: "bp1", kind: "routing", summary: "Marketing deliverables need human accept gate", score: 0.8 },
    ],
    triggers: [
      { id: "btr1", name: "Manual away only", next: "none scheduled", enabled: false },
    ],
  },
  {
    id: "ira-cockpit",
    name: "Ira Cockpit",
    path: "/Users/macky/IRA/superspec",
    tagline: "GOD-mode product surface",
    status: "shipping",
    progress: 91,
    done: 35,
    blocked: 0,
    pending: 2,
    spendUsd: 12.4,
    budgetUsd: 20,
    agents: [
      {
        id: "ira-ui",
        name: "Vesper",
        role: "React Specialist",
        engine: "cursor-agent",
        status: "busy",
        tokensUsed: 620000,
        tokensPerMin: 640,
        elapsedMin: 180,
        taskId: "T040",
        spark: spark(),
        kind: "code",
      },
    ],
    tasks: [
      { id: "T040", title: "Project-first cockpit IA", status: "doing", assigneeId: "ira-ui" },
      { id: "T041", title: "Wire Command Plane", status: "todo" },
    ],
    specs: [
      { id: "008-cockpit", title: "ira-cockpit", stage: "validate", frDone: 18, frTotal: 20 },
    ],
    decisions: [
      {
        id: "id1",
        ts: "2026-10-18 00:30",
        kind: "od",
        title: "Tauri 2 + Glass-Tech stack",
        outcome: "Locked",
        actor: "Operator",
      },
    ],
    docs: [
      {
        id: "idoc1",
        path: "apps/ira-cockpit/README.md",
        kind: "readme",
        title: "Cockpit README",
        snippet: "Glass-Tech GOD-mode dashboard…",
      },
    ],
    patterns: [],
    triggers: [],
  },
];

export const useCockpit = create<CockpitState>((set, get) => ({
  route: "home",
  projectId: null,
  projectLens: "pulse",
  projectFilter: "",
  autonomy: "supervised",
  away: false,
  deckOpen: true,
  processing: false,
  prompt: "",
  commandOpen: false,
  docsQuery: "",
  brainstormDraft: "",
  live: false,
  liveError: null,
  refreshing: false,
  lastRefreshAt: null,
  liveMeta: null,
  projects,
  catalogAgents: [
    {
      id: "ca-py",
      name: "Cipher",
      role: "Python Developer",
      skills: ["fastapi", "pytest", "sqlalchemy"],
      defaultEngine: "cursor-agent",
      hired: true,
    },
    {
      id: "ca-react",
      name: "Vesper",
      role: "React Specialist",
      skills: ["react", "tailwind", "vite"],
      defaultEngine: "codex",
      hired: true,
    },
    {
      id: "ca-arch",
      name: "Nova",
      role: "Architect",
      skills: ["system-design", "adr", "threat-model"],
      defaultEngine: "claude",
      hired: true,
    },
    {
      id: "ca-mkt",
      name: "Lumen",
      role: "Marketing",
      skills: ["copywriting", "positioning", "landing"],
      defaultEngine: "opencode",
      hired: true,
    },
    {
      id: "ca-qa",
      name: "Quill",
      role: "QA Specialist",
      skills: ["playwright", "vitest", "fuzz"],
      defaultEngine: "claude",
      hired: true,
    },
    {
      id: "ca-research",
      name: "Atlas",
      role: "Research Analyst",
      skills: ["web-research", "summarize", "compete"],
      defaultEngine: "claude",
      hired: false,
    },
    {
      id: "ca-design",
      name: "Iris",
      role: "Product Designer",
      skills: ["wireframe", "critique", "tokens"],
      defaultEngine: "codex",
      hired: false,
    },
  ],
  catalogSkills: [
    { id: "sk1", name: "superspec-forge", description: "Forge loop TDD", installed: true },
    { id: "sk2", name: "superspec-explore", description: "Brainstorm → design", installed: true },
    { id: "sk3", name: "security-review", description: "Adversarial review", installed: true },
    { id: "sk4", name: "docs-researcher", description: "Library docs fetch", installed: false },
    { id: "sk5", name: "mockup", description: "UI mockups", installed: false },
  ],
  brainstorms: [
    {
      id: "bs1",
      title: "Nightly customer digest",
      projectId: undefined,
      status: "draft",
      notes: "Ira monitors support inbox and drafts a morning brief.",
      planModeTarget: "cursor",
    },
    {
      id: "bs2",
      title: "Tenant isolation approach",
      projectId: "edu-platform",
      status: "planning",
      notes: "RLS vs app-layer tenancy — need plan mode deep dive.",
      planModeTarget: "claude",
    },
  ],
  logs: [
    {
      id: "l1",
      ts: nowTs(),
      level: "ira",
      source: "ira",
      message: "Cockpit online — project-first GOD mode.",
    },
    {
      id: "l2",
      ts: nowTs(),
      level: "info",
      source: "dispatch",
      message: "edu-platform: Cipher on T015 · Nova on T014.",
    },
    {
      id: "l3",
      ts: nowTs(),
      level: "warn",
      source: "ask-me",
      message: "3 interventions waiting across projects.",
    },
  ],
  interventions: [
    {
      id: "i1",
      projectId: "edu-platform",
      severity: "critical",
      title: "Approve scope change",
      detail: "Nova proposes FR-018: multi-tenant invoice isolation.",
    },
    {
      id: "i2",
      projectId: "edu-platform",
      severity: "warning",
      title: "Budget near limit",
      detail: "Spend $4.12 of $5.00 — raise or constrain.",
    },
    {
      id: "i3",
      projectId: "billing-portal",
      severity: "critical",
      title: "Untrusted hire confirm",
      detail: "Import research-analyst.hire.json — review before spawn.",
    },
  ],
  telemetry: {
    cpu: 34,
    mem: 58,
    gpu: 41,
    vram: 6.2,
    gpuTemp: 62,
    hiveReady: true,
    engineRungReady: true,
  },

  setRoute: (route) => set({ route, projectId: route === "project" ? get().projectId : get().projectId }),
  openProject: (id, lens = "pulse") =>
    set({ route: "project", projectId: id, projectLens: lens, projectFilter: "" }),
  setProjectLens: (lens) => set({ projectLens: lens }),
  setProjectFilter: (q) => set({ projectFilter: q }),
  setAutonomy: (mode) => set({ autonomy: mode }),
  setAway: (away) => set({ away }),
  setDeckOpen: (open) => set({ deckOpen: open }),
  setPrompt: (value) => set({ prompt: value }),
  setCommandOpen: (open) => set({ commandOpen: open }),
  setDocsQuery: (q) => set({ docsQuery: q }),
  setBrainstormDraft: (v) => set({ brainstormDraft: v }),

  filteredProjects: () => {
    const q = get().projectFilter.trim().toLowerCase();
    if (!q) return get().projects;
    return get().projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.tagline.toLowerCase().includes(q),
    );
  },
  activeProject: () => {
    const id = get().projectId;
    return get().projects.find((p) => p.id === id) ?? null;
  },

  submitPrompt: () => {
    const text = get().prompt.trim();
    if (!text) return;
    const lower = text.toLowerCase();
    set({ processing: true, prompt: "" });

    const line: LogLine = {
      id: `l-${Date.now()}`,
      ts: nowTs(),
      level: "ira",
      source: "omni",
      message: `Operator → Ira: “${text}”`,
    };
    set((s) => ({ logs: [line, ...s.logs].slice(0, 100) }));

    // Voice/command stubs: navigate by intent
    if (lower.includes("setup") || lower.includes("hire") || lower.includes("skill")) {
      set({ route: "setup" });
    } else if (lower.includes("brainstorm") || lower.includes("idea")) {
      set({ route: "brainstorm", brainstormDraft: text });
    } else if (lower.includes("home") || lower.includes("brief")) {
      set({ route: "home" });
    } else {
      const match = get().projects.find(
        (p) =>
          lower.includes(p.id) ||
          lower.includes(p.name.toLowerCase()) ||
          (lower.includes("billing") && p.id === "billing-portal") ||
          (lower.includes("edu") && p.id === "edu-platform") ||
          (lower.includes("cockpit") && p.id === "ira-cockpit"),
      );
      if (match) {
        const lens: ProjectLens = lower.includes("team")
          ? "team"
          : lower.includes("stage") || lower.includes("spec")
            ? "stages"
            : lower.includes("doc")
              ? "docs"
              : lower.includes("decision")
                ? "decisions"
                : lower.includes("spend") || lower.includes("budget")
                  ? "spend"
                  : lower.includes("trigger")
                    ? "triggers"
                    : lower.includes("memory") || lower.includes("pattern")
                      ? "memory"
                      : "pulse";
        set({ route: "project", projectId: match.id, projectLens: lens });
      }
    }

    window.setTimeout(() => {
      const reply: LogLine = {
        id: `l-${Date.now()}-r`,
        ts: nowTs(),
        level: "ira",
        source: "ira",
        message:
          "Acknowledged. Live hive snapshot drives projects; host engines stay host-spawn only.",
      };
      set((s) => ({ processing: false, logs: [reply, ...s.logs].slice(0, 100) }));
    }, 900);
  },

  approveIntervention: (id) => {
    const projectId = get().interventions.find((i) => i.id === id)?.projectId;
    void (async () => {
      try {
        const { answerAskMeApi } = await import("@/lib/ira-api");
        await answerAskMeApi(id, "approved from Ira cockpit", projectId);
      } catch {
        // local remove still applies
      }
    })();
    set((s) => {
      const line: LogLine = {
        id: `l-${Date.now()}`,
        ts: nowTs(),
        level: "info",
        source: "ask-me",
        message: `Operator approved ${id}.`,
      };
      return {
        interventions: s.interventions.filter((i) => i.id !== id),
        logs: [line, ...s.logs].slice(0, 100),
      };
    });
  },

  refreshLive: async () => {
    set({ refreshing: true });
    try {
      const snapshot = await fetchSnapshot();
      const mapped = mapSnapshotToLive(snapshot);
      const at = new Date().toLocaleTimeString("en-GB", { hour12: false });
      set((s) => {
        // Keep operator/local lines; replace snapshot-derived logs to avoid duplicate React keys
        const localLogs = s.logs.filter(
          (l) => !l.id.startsWith("live-") && !l.id.startsWith("log-"),
        );
        return {
          live: true,
          liveError: null,
          refreshing: false,
          lastRefreshAt: at,
          liveMeta: mapped.liveMeta,
          projects: mapped.projects,
          interventions: mapped.interventions,
          logs: [...mapped.logs, ...localLogs].slice(0, 120),
          catalogAgents: mapped.catalogAgents,
          telemetry: {
            ...s.telemetry,
            hiveReady: mapped.liveMeta.hiveReady,
            engineRungReady: mapped.liveMeta.engineRungReady,
          },
          projectId:
            s.projectId && mapped.projects.some((p) => p.id === s.projectId)
              ? s.projectId
              : mapped.projects[0]?.id ?? null,
        };
      });
    } catch (err) {
      set({
        live: false,
        refreshing: false,
        liveError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  toggleCatalogAgent: (id) =>
    set((s) => ({
      catalogAgents: s.catalogAgents.map((a) =>
        a.id === id ? { ...a, hired: !a.hired } : a,
      ),
    })),

  toggleCatalogSkill: (id) =>
    set((s) => ({
      catalogSkills: s.catalogSkills.map((sk) =>
        sk.id === id ? { ...sk, installed: !sk.installed } : sk,
      ),
    })),

  hireAgentToProject: (catalogId, projectId) => {
    const cat = get().catalogAgents.find((a) => a.id === catalogId);
    if (!cat) return;
    set((s) => ({
      projects: s.projects.map((p) => {
        if (p.id !== projectId) return p;
        if (p.agents.some((a) => a.role === cat.role)) return p;
        const agent: ProjectAgent = {
          id: `${projectId}-${catalogId}`,
          name: cat.name,
          role: cat.role,
          engine: cat.defaultEngine,
          status: "idle",
          tokensUsed: 0,
          tokensPerMin: 0,
          elapsedMin: 0,
          spark: spark(),
          kind: cat.role.toLowerCase().includes("market") ? "creative" : "code",
        };
        return { ...p, agents: [...p.agents, agent] };
      }),
      logs: [
        {
          id: `l-${Date.now()}`,
          ts: nowTs(),
          level: "ira" as const,
          source: "hire",
          message: `Assigned ${cat.name} (${cat.role}) → ${projectId}. (demo)`,
        },
        ...s.logs,
      ].slice(0, 100),
    }));
  },

  launchPlanMode: (sessionId) =>
    set((s) => ({
      brainstorms: s.brainstorms.map((b) =>
        b.id === sessionId ? { ...b, status: "planning" } : b,
      ),
      logs: [
        {
          id: `l-${Date.now()}`,
          ts: nowTs(),
          level: "ira" as const,
          source: "brainstorm",
          message: `Launching plan mode for ${sessionId} (stub → Cursor/Claude plan).`,
        },
        ...s.logs,
      ].slice(0, 100),
    })),

  createBrainstorm: () => {
    const draft = get().brainstormDraft.trim() || "Untitled idea";
    const session: BrainstormSession = {
      id: `bs-${Date.now()}`,
      title: draft.slice(0, 60),
      projectId: get().projectId ?? undefined,
      status: "draft",
      notes: draft,
      planModeTarget: "cursor",
    };
    set((s) => ({
      brainstorms: [session, ...s.brainstorms],
      brainstormDraft: "",
      route: "brainstorm",
    }));
  },

  tick: () =>
    set((s) => ({
      projects: s.projects.map((p) => ({
        ...p,
        agents: p.agents.map((a) => {
          if (a.status !== "busy") return a;
          return {
            ...a,
            spark: [...a.spark.slice(1), 10 + Math.random() * 90],
            tokensPerMin: Math.max(
              40,
              Math.round(a.tokensPerMin + (Math.random() - 0.48) * 50),
            ),
            tokensUsed: a.tokensUsed + Math.round(a.tokensPerMin / 60),
            elapsedMin: a.elapsedMin + 0.015,
          };
        }),
        spendUsd: clamp(p.spendUsd + 0.0008, 0, p.budgetUsd),
      })),
      telemetry: {
        ...s.telemetry,
        cpu: clamp(s.telemetry.cpu + (Math.random() - 0.5) * 3, 12, 92),
        mem: clamp(s.telemetry.mem + (Math.random() - 0.5) * 2, 40, 88),
        gpu: clamp(s.telemetry.gpu + (Math.random() - 0.5) * 5, 8, 96),
        vram: clamp(s.telemetry.vram + (Math.random() - 0.5) * 0.1, 4, 11.8),
        gpuTemp: clamp(s.telemetry.gpuTemp + (Math.random() - 0.5), 48, 82),
      },
    })),
}));
