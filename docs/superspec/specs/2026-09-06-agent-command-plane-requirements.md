# Requirements: Ira — Agent Command Plane

**Revision**: 2026-09-06  
**Status**: DRAFT — brainstorm capture; input for later SuperSpec `scope` / `spec.md` work  
**Owner**: SuperSpec product (Anupam + agents)  
**Audience**: Future SuperSpec / Superpowers agents and humans who will turn this into formal specs and plans  
**GOD persona**: **Ira** — **I**ntelligent **R**esource **A**utomation (locked — see §4)

**How to use this document**

1. Treat this as the **requirements + design intent** source of truth for the program.  
2. Do **not** implement from this file directly. Next step is SuperSpec lifecycle: `scope` → `refine` → `architect` → `plan` → … (likely as a **program** with multiple feature specs).  
3. Items marked **OPEN** need decisions during refine/architect. Items marked **NICE-TO-HAVE** are in scope for the product vision but not mandatory for a first vertical slice when slicing is eventually chosen.  
4. Preserve SuperSpec’s existing identity: **spec-driven + TDD-driven**, thin coordinator, fresh subagents, FR↔task↔test traceability.

---

## 1. Problem statement

AI coding agents (Claude Code, Cursor, Codex, and local/BYOK engines) can write code quickly but fail at scale when:

1. **No oversight surface** — work is buried in terminals and chat; the human cannot see the whole fleet, spend, or blockers at a glance.  
2. **No durable learning** — successful forge patterns die when context is compacted or the session ends.  
3. **Hard to extend the team** — adding a specialist (e.g. “iOS developer”) is ad-hoc markdown, not a hireable roster with budgets and routing.  
4. **Token / context rot** — long cycles burn money and quality; clearing context throws away knowledge unless something persists outside the chat.  
5. **Harness lock-in** — Claude/Cursor-specific agents vanish on local models; subscriptions and quotas are invisible to the orchestrator.

**We will build** **Ira** (**Intelligent Resource Automation**): a named GOD persona plus Command Plane / Command Center on SuperSpec’s lifecycle and forge loop, combining the best ideas from open agent harnesses while remaining **plugin + MCP first**.

Ira fills the *role* of a JARVIS/FRIDAY-style floor director (brief, status, escalate) but is an **original** persona — not a Marvel clone. Command Center visual language remains **OPEN**.

---

## 2. Goals

### 2.1 Primary goals

| ID | Goal |
|----|------|
| G1 | Give the human a **GOD-level Command Center** to oversee all SuperSpec work: agents, tasks, FRs, spend, blockers, escalations. |
| G2 | Keep SuperSpec’s **spec → plan → forge → validate → ship** spine and strengthen it with multi-agent orchestration. |
| G3 | Support **multi-CLI / multi-engine** workers with **per-agent model assignment**, subscription awareness, and local/BYOK parity. |
| G4 | **Self-learning harness**: persist patterns across forges; retrieve them on route/dispatch; survive compaction. |
| G5 | Make **hiring agents and skills** a first-class flow (“hire iOS developer”) with safe import and capability routing. |
| G6 | **Track and optimize tokens**; compact/clear context at semantic boundaries while learnings persist on disk. |
| G7 | **GOD mode + HITL**: routine work runs autonomously; critical actions escalate to the human. |

### 2.2 Non-goals (explicit)

| ID | Non-goal |
|----|----------|
| NG1 | Replacing Claude Code / Cursor / Codex as the code-writing runtime. SuperSpec orchestrates; engines execute. |
| NG2 | Becoming a general personal assistant (calendar, home IoT, etc.). Scope is **software delivery via SuperSpec**. |
| NG3 | Shipping a pixel “The Office” clone as the primary UX (Munder inspiration only). |
| NG4 | Adopting Ruflo’s full ~300 MCP tool surface, SONA/LoRA neural stack, or federation mesh as required dependencies. |
| NG5 | Requiring Hermes or OpenClaw to use SuperSpec (they are **nice-to-have** integrations). |
| NG6 | Deciding final cinematic UI art direction in this document (OPEN — see §12). |

---

## 3. Sources and prior art

Agents reading this MUST treat these as **inspiration and borrow lists**, not as packages to vendor wholesale unless a later ADR says otherwise.

### 3.1 Primary sources (explicitly reviewed)

| Source | URL | What to borrow | What not to copy |
|--------|-----|----------------|------------------|
| **SuperSpec (this repo)** | `c:\startup\SuperSpec` | Lifecycle, forge loop, matrix, coordinator.md, route-model tiers, persona discovery, multi-harness plugins | — (this is the base) |
| **Munder Difflin** | https://github.com/chaitanyagiri/munder-difflin | Hive (inbox/outbox/blackboard), GOD agent, Command Center (kanban, fleet, budgets, circuit breaker, Ask-Me), hire gallery, multi-CLI engines, cost ledger from transcripts | Pixel Sims office as primary UI; Electron-only product shape |
| **Munder Command Center guide** | https://munderdiffl.in/blog/command-center-guide/ | Floor vs board attention model; dependency-aware kanban; context-window gauges; steer→constrain→stop | — |
| **Munder Hire Gallery** | https://munderdiffl.in/blog/how-to-hire-from-the-agent-gallery/ | Hire as untrusted manifest → review → spawn; engine/model editable after import | — |
| **Ruflo (claude-flow)** | https://github.com/ruvnet/ruflo | RETRIEVE→JUDGE→DISTILL→CONSOLIDATE learning loop; orchestrator=ledger / workers=executors; adaptive replan; policy envelopes; doctor/metaharness health ideas | 300+ MCP tools; heavy neural stack; federation as v1 requirement |
| **Ruflo intelligence plugin** | `plugins/ruflo-intelligence` in ruflo | Pattern namespaces; pre-task retrieve / post-task distill hooks | LoRA/EWC as mandatory |

### 3.2 Related open-source (UI, gateway, agents)

| Source | URL | Relevance |
|--------|-----|-----------|
| Mission Control | https://github.com/0x-nyk/mission-control | Ops dashboard panels (tasks, tokens, skills, security); SQLite local-first |
| Hermes Studio | https://github.com/JPeetz/Hermes-Studio | Multi-agent studio UI; Conductor; cost history |
| Hermes Agent | https://github.com/NousResearch/hermes-agent | Always-on agent, memory, cron, messaging; MCP client/server — **NICE-TO-HAVE** integration |
| OpenClaw | https://docs.openclaw.ai / https://github.com/openclaw/openclaw | Gateway for channels + CLI backends + approvals — **NICE-TO-HAVE** integration |
| Sentient-OS | https://github.com/gestas666/Sentient-OS | KITT-style mission control over Claude/Codex/Hermes/OpenClaw |
| CrewHub | https://github.com/EKINSOL-DEV/crewhub | 3D agent world + HQ; Claude/OpenClaw |
| AI Agent Session Center | https://github.com/lpecom/ai-agent-session-center | Animated 3D robots per session |
| NEXUS-7 HUD | https://github.com/nael-awadallah/nexus-hud | Holographic glass + Three.js sci-fi dashboard kit |
| MIRA / Jarvis Electron | https://github.com/mkr-infinity/MIRA | Arc reactor HUD themes |
| Vesper | https://github.com/Souvikkundu0901/Vesper-assistant | Simple browser HUD (radar, rings, scanlines) |
| Omnigent (Databricks) | https://www.databricks.com/blog/introducing-omnigent-meta-harness-combine-control-and-share-your-agents | Meta-harness over Claude/Codex; cross-vendor review; policy at meta layer |
| Aegis | https://apiad.github.io/aegis/ | Drive Claude/Gemini/OpenCode over native protocols |
| OpenCode + Ollama | https://docs.ollama.com/integrations/opencode | Claude Code–like local agent loop; needs **≥64k context** |
| Context compaction research | https://blakecrosley.com/blog/agent-context-compaction ; https://pydantic.dev/docs/ai/harness/compaction/ | Semantic compaction at task boundaries; tiered cheap→expensive strategies |
| Agent skills marketplaces | skills.sh / Agensi / Agent Skills standard | Hire/skills install patterns; security scan before install |

### 3.3 Decisions already locked in brainstorm

| Decision | Choice | Notes |
|----------|--------|-------|
| Delivery shape | **Hybrid (Option D)** | `@superspec-dev/core` + MCP/CLI remain the engine; thin **web Command Center** on top so Claude/Cursor/Codex all feed one board |
| GOD persona | **Ira** | Full form: **Intelligent Resource Automation**. Spoken/UI callsign: **Ira** (title case, not all-caps IRA) |
| Visual direction | **OPEN** | Inspired by KITT + Arc Reactor + holographic HUD; must be **innovative and original**, not a Jarvis clone |
| Hermes / OpenClaw | **Nice-to-have** | Optional adapters; SuperSpec must work fully without them |
| Phasing | **Not decided in this doc** | This file lists full vision; slicing happens when creating formal specs |

---

## 4. Ira — persona definition

### 4.1 Name

| Form | Usage |
|------|--------|
| **Ira** | Spoken name, UI chrome, wake/address (“Ira, status”), docs prose |
| **IRA** | Acronym expansion only in formal definitions |
| **Intelligent Resource Automation** | Full form — locked |

**Meaning of the full form**

- **Intelligent** — learns patterns, retrieves them, forecasts cost, routes by capability  
- **Resource** — agents, engines, models, tokens, budgets, worktrees, skills  
- **Automation** — staffs the floor from a brief, idle-wake, replan, night mode; escalates only critical HITL  

### 4.2 Role

Ira is the **GOD / Floor Director**: the single persona the Operator talks to in order to run the agent office. Workers (implementer, QA, iOS hire, …) report through the hive; Ira routes, adjudicates, and surfaces Ask-Me items.

Ira does **not** replace coding engines. Ira **allocates and automates resources**; engines write code.

### 4.3 Voice & behavior (for prompts / UI copy)

| Trait | Guidance |
|-------|----------|
| Tone | Calm, clipped, precise; cost- and quota-aware |
| Address | Operator / Chief (configurable); never forced Marvel “sir” |
| Brief style | Lead with numbers: done / blocked / spend / quota / what needs the human |
| Escalation | Only critical class (§5.3); routine stays silent automation |
| Signature brief (example) | “Three done. One blocked — needs you. Spend $1.12. Claude quota forty percent.” |

### 4.4 Product vision

SuperSpec remains the system of record for **what to build and whether it shipped with tests**. **Ira (Intelligent Resource Automation)** is the GOD persona and Command Plane so the Operator can brief outcomes (“ship FR-012 under $5”), watch specialist agents across CLIs and models, approve only critical escalations, and let patterns survive compaction. When cloud agents are unavailable, the same personas run on local engines. The Command Center look is a modern sci-fi ops surface — original, not a Jarvis clone.

---

## 5. Actors and modes

### 5.1 Actors

| Actor | Role |
|-------|------|
| **Human (Operator)** | Briefs goals, answers Ask-Me, sets budgets, hires agents, approves critical escalations, reviews Command Center. |
| **Ira (GOD)** | **Intelligent Resource Automation** — privileged persona that routes work, staffs the floor from a brief, adjudicates routine requests, escalates critical ones, maintains blackboard/task ledger. |
| **Worker agents** | Personas (implementer, reviewer, iOS, QA, …) bound to an **engine** + **model** + **budget** + **capabilities**. |
| **Harness engines** | `claude`, `codex`, `cursor-agent`, `opencode`, `crush`, `aider`, custom — execute tool loops. |
| **Command Center** | Web UI over forge/hive/ledger state (Option D). |
| **SuperSpec core** | MCP/CLI: matrix, lint, forge-state, route-model, personas, future command-plane APIs. |

### 5.2 Autonomy modes (policy)

| Mode | Behavior |
|------|----------|
| **Observe** | System recommends; human starts every dispatch. |
| **Supervised** | GOD auto-routes routine tasks; HITL for spend, destructive ops, scope change, hire spawn, repeated failures. |
| **Autonomous** | GOD runs night/away loops within budgets; still escalates critical class. |

Default for new installs: **Supervised**. Mode switching is a first-class setting.

### 5.3 HITL escalation policy (critical class)

Escalate to human (Ask-Me / approvals), never silent-auto:

- Spend would exceed agent or feature budget  
- Destructive git / force-push / secret handling / production deploy  
- Spec scope change (new FR or acceptance criteria change)  
- Untrusted hire/skill/MCP import before spawn  
- Review failed ≥ N times (reuse forge `maxReviewFailures` semantics)  
- Constitution / policy violation  
- Ambiguous requirement GOD cannot resolve from artifacts  

Routine (auto):

- Pick next DAG-ready task  
- Assign capable idle worker  
- Retrieve patterns into task brief  
- Compact worker context after `record-result`  
- Retry with higher model tier within budget  
- Failover engine on rate-limit within policy  
- Continue forge when CI green in night mode (if enabled)

---

## 6. Functional requirements

> Numbering is stable for later `FR-###` mapping in `scope`. Prefixes: `CP` Command Plane, `HV` Hive, `LR` Learning, `TK` Tokens/Context, `HR` Hire/Skills, `EN` Engines, `GD` GOD/HITL, `UI` Command Center, `INT` Integrations, `DX` Doctor/Ops.

### 6.1 Command Plane & GOD (`CP`, `GD`)

| ID | Requirement |
|----|-------------|
| CP-001 | System SHALL expose a **Command Plane API** (CLI + MCP) over SuperSpec forge/hive/ledger state usable without the UI. |
| CP-002 | System SHALL support a **web Command Center** that consumes the same API (Option D). |
| GD-001 | Operator SHALL be able to submit a **goal brief** (outcome, constraints, budget, deliverable); GOD SHALL staff tasks/agents accordingly. |
| GD-002 | GOD SHALL maintain a **task ledger** compatible with SuperSpec plans (`T00X`, dependencies, status). |
| GD-003 | GOD SHALL maintain an **Ask-Me inbox**; worker clarifications route there instead of spamming the operator mid-terminal. |
| GD-004 | GOD SHALL **auto-replan** remaining work on task failure (retry tier, reassign, split) within policy before marking blocked. |
| GD-005 | System SHALL support **idle wake**: when a worker finishes, GOD assigns the next ready task if any. |
| GD-006 | System SHALL support **night/away mode**: continue eligible forge work when triggers fire (e.g. CI green); escalate only critical class. |
| GD-007 | System SHALL implement autonomy modes Observe / Supervised / Autonomous (§5.2). |
| GD-008 | Escalations SHALL be visible in Command Center and optionally voice/chat channels when those integrations exist. |

### 6.2 Hive & coordination (`HV`)

| ID | Requirement |
|----|-------------|
| HV-001 | System SHALL provide a **filesystem hive** (or equivalent durable store) for roster, blackboard, task ledger, event log. |
| HV-002 | Workers SHALL communicate via **inbox/outbox** (or message API) with single-writer rules; no multi-writer mailbox files. |
| HV-003 | Shared plans on the **blackboard** SHALL have a single scribe (GOD or designated process). |
| HV-004 | Event log SHALL be append-only and drive UI activity streams. |
| HV-005 | Coordinator handoff SHALL remain compatible with existing `.superspec/coordinator.md` lean-loop semantics. |

### 6.3 Learning (`LR`)

| ID | Requirement |
|----|-------------|
| LR-001 | After each forge task result, system SHALL run a **distill** step: extract reusable pattern (success or failure lesson). |
| LR-002 | Patterns SHALL persist **outside chat context** (disk DB and/or markdown store under project/user SuperSpec data). |
| LR-003 | On `route` / `begin-task` / brief generation, system SHALL **retrieve** relevant patterns and inject a bounded summary into the worker brief. |
| LR-004 | Learning loop SHALL follow RETRIEVE → JUDGE → DISTILL → CONSOLIDATE semantics (lean Ruflo; no mandatory neural fine-tune). |
| LR-005 | Patterns SHOULD be keyed by signals such as FR tags, task kind, language/stack, failure reason, engine. |
| LR-006 | Compaction or context clear SHALL **not** delete the pattern store. |

### 6.4 Tokens, budgets, context engineering (`TK`)

| ID | Requirement |
|----|-------------|
| TK-001 | System SHALL track **token and estimated USD cost** per agent, per session, per feature (durable ledger). |
| TK-002 | Operator SHALL set **budgets** per agent and/or per feature; system SHALL enforce them. |
| TK-003 | Circuit breaker SHALL **steer → constrain → stop** when loops, errors, or budget breaches occur. |
| TK-004 | Each worker card SHALL expose a **context-window gauge** (or equivalent) when measurable. |
| TK-005 | On successful or failed task completion (`record-result` boundary), system SHALL **compact or clear** worker conversational context. |
| TK-006 | Compaction SHALL prefer **semantic boundaries** (task complete) over raw token thresholds; tiered strategies: drop tool noise → dedupe reads → summarize only if needed. |
| TK-007 | Before dispatch, system SHOULD **forecast cost** from similar past patterns and warn/confirm if over remaining budget. |
| TK-008 | `route-model` economy/standard/frontier SHALL remain the default tiering; Command Plane MAY override per agent assignment. |
| TK-009 | Quota/subscription signals (when available) SHALL influence routing (prefer local/economy when quota low). |

### 6.5 Hire, personas, skills (`HR`)

| ID | Requirement |
|----|-------------|
| HR-001 | Operator SHALL be able to **hire** a specialist (e.g. iOS developer) via gallery or manifest. |
| HR-002 | A hire is a **manifest**: identity, goal/briefing, capabilities tags, default engine, default model tier, token budget, allowed skills/MCP (default deny). |
| HR-003 | Importing a hire SHALL **never auto-spawn**; human reviews fields then confirms spawn. |
| HR-004 | Manifests from the network SHALL be treated as **untrusted input** (allowlisted flags, no arbitrary executables). |
| HR-005 | Hires SHALL install/update portable persona files discoverable by existing `list-personas` (`.claude` / `.cursor` / `.codex` agents). |
| HR-006 | Operator SHALL install **skills** (SKILL.md / registries) with consent and optional security scan. |
| HR-007 | GOD SHALL **route by capability tags** (`ios`, `qa`, `security`, …), not only by display name. |
| HR-008 | System SHOULD score hires over time (pass rate, cost, review failures) and surface demotion hints. |

### 6.6 Engines, multi-CLI, local/BYOK (`EN`)

| ID | Requirement |
|----|-------------|
| EN-001 | Roster entry SHALL bind **persona + engine + model + budget + workspace/worktree**. |
| EN-002 | Supported engines (target set): Claude Code, Codex, Cursor Agent, OpenCode, Crush, Aider, custom command; detect what’s installed. |
| EN-003 | **Per-agent model assignment** SHALL allow mixing (e.g. implementer on Codex, reviewer on Claude). |
| EN-004 | **Cross-engine review** SHOULD be supported as a policy option. |
| EN-005 | When Claude/Cursor proprietary agents are unavailable, **same SuperSpec personas/skills** SHALL run on OpenCode (or equivalent) + Ollama/LM Studio/vLLM/BYOK. |
| EN-006 | Local OpenCode+Ollama path SHALL enforce **minimum context length** (e.g. ≥64k) or fail Doctor with a clear fix. |
| EN-007 | **Failover ladder**: subscription-backed CLI → API/BYOK → local, according to policy and health. |
| EN-008 | Credential/subscription matrix SHALL show per-engine auth mode and health in Command Center. |
| EN-009 | Engine adapter layer SHOULD normalize lifecycle events (start, tool, stop, error, tokens) for the hive log. |

### 6.7 Command Center UI (`UI`)

| ID | Requirement |
|----|-------------|
| UI-001 | Command Center SHALL provide GOD-level views: **Tasks (dependency kanban)**, **Fleet/roster**, **Activity/event log**, **Memory/patterns**, **Spend/budgets**, **Ask-Me/approvals**, **Triggers/schedules**. |
| UI-002 | UI SHALL be **animated, sci-fi, tech** in spirit; exact visual language is **OPEN** (§12) — innovative original, not a stock Jarvis clone. Inspiration allowed: KITT mission control, arc-reactor presence, holographic glass panels. |
| UI-003 | UI SHALL update live (SSE/WebSocket/poll) from Command Plane state. |
| UI-004 | Morning/status **brief** SHALL summarize: done/blocked, spend, quota, escalations, next triggers. |
| UI-005 | Operator SHALL dispatch, pause, abort, reassign, and answer Ask-Me from the UI. |
| UI-006 | Optional spatial/ambient “floor” view MAY exist later; management board is primary (Munder rule: floor for one agent, board for the fleet). |
| UI-007 | Voice control (Jarvis-like) is **in vision**: speak briefs, status, approve — orchestration only; never silent spend/spawn. Implementation timing OPEN. |

### 6.8 Integrations — nice-to-have (`INT`)

| ID | Requirement | Priority |
|----|-------------|----------|
| INT-001 | Optional **OpenClaw adapter**: dispatch/observe CLI backends; channel messages → Ask-Me; remote exec approval bridge. | Nice-to-have |
| INT-002 | Optional **Hermes adapter**: Hermes as always-on GOD front-door (memory/cron/messaging) calling SuperSpec MCP. | Nice-to-have |
| INT-003 | SuperSpec SHALL remain fully usable with **neither** Hermes nor OpenClaw installed. | Required |
| INT-004 | Optional Slack/Telegram/phone approve for Ask-Me. | Nice-to-have |
| INT-005 | Optional shareable board URL for teammates. | Nice-to-have |

### 6.9 Doctor & operability (`DX`)

| ID | Requirement |
|----|-------------|
| DX-001 | `superspec doctor` (or equivalent) SHALL report: missing engines, auth health, Ollama context too small, MCP broken, constitution/template drift, hive integrity. |
| DX-002 | Install/onboarding SHALL detect installed CLIs and suggest hires/engines. |
| DX-003 | Telemetry of prompts/code SHALL remain off-by-default; any usage analytics must be opt-in and anonymized (align with SuperSpec/Munder privacy posture). |

### 6.10 Compatibility with existing SuperSpec

| ID | Requirement |
|----|-------------|
| SS-001 | Existing skills lifecycle MUST keep working without Command Center. |
| SS-002 | Forge loop tools (`next-task`, `begin-task`, `record-result`, `sync-status`, `forge-status`, `coordinator-brief`, `route-model`, `build-matrix`, lints) MUST remain valid; Command Plane extends them. |
| SS-003 | Traceability spine FR ↔ task ↔ test MUST remain mandatory for code work. |
| SS-004 | Fresh subagent dispatch (anti–context-rot) MUST remain the default worker execution model where the host harness supports it. |
| SS-005 | Worktree isolation SHOULD be default for spawned hires that write code. |

---

## 7. Architecture (intent)

### 7.1 High-level

```
                    ┌─────────────────────────────────────┐
                    │  Operator (UI / voice / chat)       │
                    └─────────────────┬───────────────────┘
                                      │ HITL only for critical
                    ┌─────────────────▼───────────────────┐
                    │  GOD Orchestrator                    │
                    │  brief · route · adjudicate · replan │
                    └─────────────────┬───────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
   ┌──────────────┐          ┌──────────────┐            ┌──────────────┐
   │ Hive / Ledger│          │ Pattern Store│            │ Cost Ledger  │
   │ tasks·mail   │          │ learn/recall │            │ budgets·CB   │
   │ board·events │          └──────────────┘            └──────────────┘
   └──────┬───────┘
          │
          ▼
   ┌──────────────────────────────────────────────────────┐
   │ SuperSpec Core (MCP/CLI)                              │
   │ forge · matrix · lint · personas · route-model · NEW  │
   └──────────────────────────┬───────────────────────────┘
                              │ dispatch
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   Engine A              Engine B              Engine C
   Claude/Codex/…        OpenCode+Ollama       …
```

### 7.2 Deployment (locked)

- **Engine**: Node packages under SuperSpec monorepo (`@superspec-dev/core` extended; possible `@superspec-dev/command-plane`).  
- **UI**: Local web app (browser) talking to local API/MCP bridge — **not** required Electron for v-vision.  
- **Data**: Prefer project-local + user-local files/SQLite; gitignore machine state; commit human-facing `status.md` / specs as today.

### 7.3 Division of labor (Ruflo lesson)

| Component | Does | Does not |
|-----------|------|----------|
| GOD / Command Plane | Route, record, escalate, retrieve patterns, enforce budgets | Write feature code itself (except tiny orchestration edits) |
| Worker engines | Edit code, run tests, use tools | Own global policy or spend ledger |
| SuperSpec validate/matrix | Prove FRs covered | Spawn CLIs |

---

## 8. Data model (conceptual)

> Formal schemas come in `architect`. This is enough for scope agents to write FRs.

### 8.1 Roster entry (Hire / Agent)

```text
Agent {
  id, name, avatarRef?,
  personaPath,              // agents/*.md
  capabilityTags[],         // ["ios","swift"]
  engine,                   // "claude"|"codex"|"cursor"|"opencode"|...
  model,                    // vendor id or abstract tier
  budgetTokens?, budgetUsd?,
  workspace, worktreePolicy,
  allowedSkills[], allowedMcp[],
  status: idle|busy|blocked|offline,
  contextUsedRatio?,
  spendSession?, spendFeature?
}
```

### 8.2 Task ledger

```text
Task {
  id,                 // T001 or hive id mapped to plan task
  featureId,
  title, implementsFr[],
  dependsOn[],
  assigneeAgentId?,
  status: todo|doing|blocked|done,
  kind, complexity,
  resultRef?, reviewFailures,
  humanQA?: { question, answer?, state }
}
```

### 8.3 Pattern record

```text
Pattern {
  id, createdAt, updatedAt,
  kind: success|failure|routing,
  signals: { frTags?, stack?, taskKind?, engine?, errorClass? },
  summary,          // bounded markdown
  evidenceRefs[],   // status/report paths
  score?, useCount?
}
```

### 8.4 Cost ledger entry

```text
SpendEvent {
  ts, agentId, featureId?, sessionId?,
  engine, model,
  inputTokens, outputTokens, usdEstimate?,
  source: transcript|api|estimate
}
```

### 8.5 Hire manifest (import)

```text
HireManifest {
  schemaVersion,
  name, goal, capabilityTags[],
  suggestedEngine, suggestedModel, suggestedBudget,
  skillsAllow[], mcpAllow[],
  // no executable payload
}
```

---

## 9. Key user journeys

### 9.1 Brief → ship

1. Operator opens Command Center (or chat) and briefs: goal, constraints, budget.  
2. GOD reads/creates SuperSpec artifacts as needed (or attaches to existing feature spec/plan).  
3. GOD hires/selects agents, assigns engines/models, fills task ledger from plan DAG.  
4. Workers execute via forge loop; patterns retrieved into briefs; spend tracked.  
5. Ask-Me only for critical/ambiguous items.  
6. Validate matrix green → ship path unchanged.

### 9.2 Hire iOS developer

1. Operator searches gallery or says “hire iOS developer”.  
2. Manifest pre-fills form; operator edits engine/model/budget/briefing.  
3. Confirm spawn → persona files written → agent appears on roster.  
4. Tasks tagged `ios` route to this agent.

### 9.3 Local/BYOK day

1. Doctor detects Claude quota exhausted / offline.  
2. Failover policy moves mechanical tasks to OpenCode+Ollama; keeps frontier review on available API if any.  
3. Same personas; engine field changes; learning store still shared.

### 9.4 Task complete → compact + learn

1. Worker finishes; reviewer passes; `record-result` success.  
2. Distill pattern to store.  
3. Clear/compact worker context.  
4. Update status.md / coordinator.md / ledger.  
5. Idle wake assigns next task with retrieved patterns only (not full prior transcript).

---

## 10. Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-001 | Local-first: core loop works on localhost without cloud SaaS (engines may call cloud models). |
| NFR-002 | Security: untrusted manifests; default-deny skills/MCP; no secrets in pattern store; HITL for destructive ops. |
| NFR-003 | Performance: Command Center updates within ~1–2s of state change on local machine (target; refine in architect). |
| NFR-004 | Cross-harness: Claude Code, Cursor, Codex remain first-class SuperSpec hosts. |
| NFR-005 | Observability: append-only event log; optional OTEL later. |
| NFR-006 | Extensibility: engine adapters and hire manifests versioned. |

---

## 11. Success criteria (program-level)

The program is successful when an operator can:

1. Brief a feature and watch it progress on a Command Center board without reading raw terminal scrollback.  
2. Hire a specialist and see work route by capability.  
3. Run the same feature with mixed CLIs/models and see real spend vs budgets.  
4. Lose chat context after tasks and still benefit from stored patterns on the next task.  
5. Work offline/BYOK with OpenCode-class engines using the same personas.  
6. Only be interrupted for critical HITL items.  
7. Run all of the above **without** Hermes or OpenClaw installed.  
8. Still pass SuperSpec validate (lint + matrix) before ship.

---

## 12. Open items

| ID | Topic | Notes |
|----|-------|-------|
| OPEN-001 | **Visual language** | KITT + Arc + holographic inspiration; invent SuperSpec-original sci-fi look. No final art direction yet. |
| OPEN-002 | **Slicing / program breakdown** | Full vision captured here; which feature specs come first is deferred (user: no phasing during brainstorm). |
| OPEN-003 | **Voice** | In vision; STT/TTS approach and wake-word TBD. |
| OPEN-004 | **Pattern store tech** | Markdown-only vs SQLite FTS vs local embeddings — decide in architect. |
| OPEN-005 | **Exact engine event APIs** | Per-CLI hooks vs PTY scraping vs ACP — decide per adapter. |
| OPEN-006 | **Hermes/OpenClaw adapter depth** | Nice-to-have; depth TBD when prioritized. |
| OPEN-007 | **Multi-user / team board** | Share URL nice-to-have; auth model TBD. |
| OPEN-008 | **Package boundaries** | monolith core vs `command-plane` + `command-center` packages. |

---

## 13. Suggested future SuperSpec program shape

> Advisory only — not a phase plan. When ready to scope, consider separate specs such as:

1. **command-plane-api** — hive, ledger, GOD services, MCP extensions  
2. **command-center-ui** — web app + live views (visual OPEN)  
3. **learning-memory** — pattern store + retrieve/distill hooks  
4. **token-context-governor** — ledger, budgets, circuit breaker, compact-on-complete  
5. **hire-gallery-skills** — manifests, personas, capability routing  
6. **engine-adapters** — multi-CLI, local pack, failover, subscription matrix  
7. **integrations-hermes-openclaw** — optional adapters  

Each becomes its own `explore/scope/…` cycle with testable FRs.

---

## 14. Glossary

| Term | Meaning |
|------|---------|
| **Ira** | GOD persona callsign; full form **Intelligent Resource Automation** |
| **IRA** | Acronym for Intelligent Resource Automation (prefer writing **Ira** in prose) |
| **GOD** | Orchestrator role Ira fills: runs the floor and escalates critical items |
| **HITL** | Human-in-the-loop approval |
| **Hive** | Durable coordination store (mail, board, tasks, log) |
| **Command Plane** | Engine APIs + Ira/GOD services behind the UI |
| **Command Center** | Operator-facing web UI (Ira’s board) |
| **Hire** | Importable agent manifest → roster entry |
| **Engine** | CLI/runtime that executes an agent loop |
| **Pattern** | Distilled reusable lesson from forge outcomes |
| **Brief** | Operator goal statement Ira expands into staffing + tasks |

---

## 15. Document history

| Date | Change |
|------|--------|
| 2026-09-06 | Initial requirements capture from brainstorm: SuperSpec + Munder + Ruflo + JARVIS UI research + autonomy extras; Hermes/OpenClaw as nice-to-have; visual OPEN; delivery Option D |
| 2026-09-06 | Locked GOD persona: **Ira** = **Intelligent Resource Automation**; persona kit in §4 |

---

## 16. Instructions to the next SuperSpec agent

When turning this into formal specs:

1. Read this entire document and `docs/explanation/lifecycle.md`, `dispatch-and-context.md`, `traceability-spine.md`.  
2. Propose a **program.md** entry listing feature specs (see §13) — do not invent phasing the user rejected unless they ask.  
3. For each feature, write `spec.md` with testable `FR-###`, user stories, `SC-###`, mapping back to IDs in §6.  
4. Keep NG* non-goals; do not expand into personal-assistant scope.  
5. Resolve OPEN-* via `refine` questions — do not silently pick art direction.  
6. Prefer extending `@superspec-dev/core` MCP over creating a disconnected product.  
7. Any UI must consume the same state the CLI can print (Option D invariant).
