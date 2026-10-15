# Feature Specification: Ira Command Plane

**Feature Branch**: `001-ira-command-plane` (alias: `docs/ira-intelligent-resource-automation`)

**Created**: 2026-09-06

**Status**: Draft

**Type**: platform

**Input**: P-001 — Ira (Intelligent Resource Automation) GOD/Command Plane API, hive coordination, Ask-Me HITL, autonomy modes, and doctor. No operator UI (owned by P-002 `ira-command-center`).

## Required Reading

| Path | Reason |
|------|--------|
| [`docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md`](../../docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md) | Parent requirements — CP/GD/HV/DX source IDs and Ira persona definition |
| [`docs/superspec/specs/ira-prior-art-reuse-map.md`](../../docs/superspec/specs/ira-prior-art-reuse-map.md) | Prior-art paths to adapt (Munder, Ruflo, SuperSpec) |
| [Munder Difflin `HIVE.md`](https://github.com/chaitanyagiri/munder-difflin/blob/main/HIVE.md) | Hive inbox/outbox/blackboard protocol reference |
| [`program.md`](../../program.md) | Program row P-001 scope boundary vs P-002–P-007 |
| [`docs/explanation/dispatch-and-context.md`](../../docs/explanation/dispatch-and-context.md) | Fresh subagent dispatch and context boundaries |
| [`docs/explanation/traceability-spine.md`](../../docs/explanation/traceability-spine.md) | FR ↔ task ↔ test traceability rules |

## Prior Art / Reuse

Prefer **adapt** over invent. Cite upstream in architect/forge; preserve MIT attribution.

| Concern | Adapt from |
|---------|------------|
| Hive layout, inbox/outbox, single-writer protocol | Munder [`HIVE.md`](https://github.com/chaitanyagiri/munder-difflin/blob/main/HIVE.md); [`src/main/hive.ts`](https://github.com/chaitanyagiri/munder-difflin/blob/main/src/main/hive.ts) |
| Task ledger semantics | Munder [`src/shared/taskLedger.ts`](https://github.com/chaitanyagiri/munder-difflin/blob/main/src/shared/taskLedger.ts) |
| Ask-Me / HITL ordering | Munder [`askMeOrder.ts`](https://github.com/chaitanyagiri/munder-difflin/blob/main/src/shared/askMeOrder.ts) |
| Orchestrator ≠ executor division | Ruflo [`AGENTS.md`](https://github.com/ruvnet/ruflo/blob/main/AGENTS.md) |
| Adaptive replan / policy envelope ideas | Ruflo metaharness docs; lean orchestrator-as-ledger pattern |
| Doctor / health checks | Ruflo [`docs/metaharness-user-guide.md`](https://github.com/ruvnet/ruflo/blob/main/docs/metaharness-user-guide.md) |
| Forge state machine & MCP tools | SuperSpec [`packages/core/src/forge-loop.ts`](../../packages/core/src/forge-loop.ts), [`packages/core/src/mcp-server.ts`](../../packages/core/src/mcp-server.ts) |
| Coordinator handoff | SuperSpec [`.superspec/coordinator.md`](../../.superspec/coordinator.md) lean-loop semantics |
| Persona discovery | SuperSpec [`packages/core/src/persona-discovery.ts`](../../packages/core/src/persona-discovery.ts) |

**Out of scope for reuse in P-001**: Munder pixel UI assets, Ruflo 300+ MCP tools, neural fine-tune stacks, Command Center React panels (P-002).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Brief Ira and Staff the Floor (Priority: P1)

The Operator submits an outcome brief (goal, constraints, budget, deliverable) to **Ira** — the GOD persona (**Intelligent Resource Automation**, callsign **Ira**). Ira reads or attaches to existing SuperSpec artifacts, populates the hive task ledger from the plan DAG, and selects or requests roster agents so forge work can begin — all without a web UI.

**Why this priority**: Without brief→staff, Ira cannot orchestrate anything; this is the minimum viable Command Plane.

**Independent Test**: Submit a brief via CLI/MCP against a feature with an existing `plan.md`; verify task ledger entries mirror plan tasks (`T00X`), dependencies, and FR tags, and that at least one agent assignment is recorded.

**Acceptance Scenarios**:

1. **Given** a feature spec and plan with three tasks and dependencies, **When** the Operator submits a goal brief naming that feature, **Then** Ira creates or updates hive ledger rows for each plan task with correct `dependsOn` links and `implementsFr` tags.
2. **Given** a brief with a token or USD budget cap, **When** Ira staffs the floor, **Then** the brief constraints are persisted on the feature/session record and exposed via Command Plane query APIs.
3. **Given** no Command Center UI is running, **When** the Operator uses CLI or MCP only, **Then** the same brief→staff outcome is achievable and inspectable as structured state (not chat-only).

---

### User Story 2 - Ask-Me HITL for Critical Escalations (Priority: P1)

Worker agents route clarifications and critical approvals to Ira's **Ask-Me inbox** instead of interrupting the Operator mid-terminal. Ira adjudicates routine items under policy; critical-class items (§ HITL policy) appear in Ask-Me until the Operator answers.

**Why this priority**: HITL discipline is core to supervised/autonomous modes; without Ask-Me, GOD mode cannot safely defer to the human.

**Independent Test**: Simulate a worker clarification and a budget-exceed event; verify only the critical item lands in Ask-Me, is queryable via API, and accepts an Operator answer that unblocks the task.

**Acceptance Scenarios**:

1. **Given** autonomy mode **Supervised**, **When** a worker posts a non-critical routing question Ira can resolve from artifacts, **Then** Ira answers without creating an Ask-Me item.
2. **Given** a task that would exceed the feature budget, **When** the worker requests dispatch, **Then** Ira creates an Ask-Me item with reason, affected task/agent, and blocks silent auto-approval.
3. **Given** an open Ask-Me item, **When** the Operator submits an answer via CLI/MCP, **Then** the item moves to resolved state, the event log records the decision, and the blocked task becomes eligible again.

---

### User Story 3 - Hive Task Ledger Sync with Forge (Priority: P1)

The hive task ledger stays the durable coordination source while remaining compatible with SuperSpec's existing forge loop (`next-task`, `begin-task`, `record-result`, `sync-status`, `forge-status`, `coordinator-brief`). Status transitions on either side converge without dual-writer corruption.

**Why this priority**: Command Plane must extend — not fork — the forge spine; ledger sync is the integration contract for all downstream specs.

**Independent Test**: Run one forge cycle against a plan-backed feature; after each MCP forge tool call, query hive ledger and confirm task status, assignee, and `reviewFailures` match forge state.

**Acceptance Scenarios**:

1. **Given** a hive ledger synced from `plan.md`, **When** `begin-task` marks `T002` in progress, **Then** hive row `T002` status becomes `doing` with assignee and timestamp in the append-only event log.
2. **Given** a successful `record-result`, **When** sync runs, **Then** hive marks the task `done`, updates coordinator handoff artifacts, and leaves inbox/outbox mailboxes single-writer clean.
3. **Given** two concurrent processes, **When** both attempt to scribe the blackboard, **Then** the system enforces single-scribe rules and rejects or serializes the loser without corrupting ledger files.

---

### User Story 4 - Idle Wake and Auto-Replan (Priority: P2)

When a worker finishes, Ira assigns the next DAG-ready task if any (idle wake). On task failure, Ira retries within policy — tier bump, reassign, or split — before marking blocked and escalating.

**Why this priority**: Keeps the floor moving without Operator micro-management; builds on P1 ledger + Ask-Me foundation.

**Independent Test**: Complete a task with a dependent sibling waiting; verify auto-assignment. Fail a task twice; verify replan attempts then Ask-Me/block.

**Acceptance Scenarios**:

1. **Given** agent **A** idle and task **T003** ready (dependencies satisfied), **When** **A** completes **T002**, **Then** Ira assigns **T003** to **A** without Operator action in **Supervised** or **Autonomous** mode.
2. **Given** a task failure with remaining replan budget, **When** Ira replans, **Then** the ledger records the new attempt (retry tier or reassign) before surfacing Ask-Me.
3. **Given** replan budget exhausted per policy, **When** the task still fails, **Then** Ira marks the task `blocked`, opens Ask-Me if critical class, and appends a failure event.

---

### User Story 5 - Night / Away Mode (Priority: P3)

When night/away mode is enabled and autonomy is **Autonomous**, Ira continues eligible forge work (e.g., after CI green) within budgets, escalating only critical-class items to Ask-Me.

**Why this priority**: Valuable for unattended runs but depends on P1–P2 routing, ledger, and HITL being trustworthy first.

**Independent Test**: Enable night mode with a synthetic CI-green trigger stub; verify Ira dispatches the next ready task overnight and does not auto-approve a budget breach.

**Acceptance Scenarios**:

1. **Given** night mode on and a CI-green trigger fired, **When** tasks remain in `todo` with satisfied dependencies, **Then** Ira dispatches the next eligible task within budget policy.
2. **Given** night mode on, **When** a destructive git operation would be required, **Then** Ira creates Ask-Me and does not proceed silently.
3. **Given** night mode off or autonomy **Observe**, **When** a trigger fires, **Then** Ira records the trigger but does not auto-dispatch.

---

### Edge Cases

- What happens when the plan changes after the ledger is populated (new `T00X`, removed task)? Ira MUST reconcile or flag drift for Operator review via Ask-Me or doctor.
- What happens when hive files are manually edited or corrupted? Doctor reports integrity failures; Command Plane refuses dispatch until repaired or reset.
- What happens when autonomy is **Observe**? Ira recommends next actions but never auto-dispatches or auto-spawns.
- What happens when Ask-Me items go unanswered for an extended period? Tasks stay blocked; status queries surface age and severity; no silent timeout approval.
- What happens when forge MCP tools are invoked without hive initialization? System initializes hive idempotently or returns a clear setup error with doctor hints.
- What happens when multiple features share one workspace? Ledger entries MUST be namespaced by `featureId` to prevent cross-feature assignment.

## Requirements *(mandatory)*

### Functional Requirements

#### Command Plane & Ira (GOD)

- **FR-001**: System MUST expose a **Command Plane API** via SuperSpec CLI and MCP that reads and mutates forge/hive/ledger state without requiring the Command Center UI.
- **FR-002**: Operator MUST be able to submit a **goal brief** (outcome, constraints, budget, deliverable) to Ira; Ira MUST staff tasks and agent assignments from that brief.
- **FR-003**: Ira MUST maintain a **task ledger** compatible with SuperSpec plans (`T00X` identifiers, dependencies, status, FR tags).
- **FR-004**: Ira MUST maintain an **Ask-Me inbox**; worker clarifications and critical approvals MUST route there instead of defaulting to ad-hoc terminal prompts.
- **FR-005**: Ira MUST **auto-replan** remaining work on task failure (retry tier, reassign, or split) within policy before marking a task blocked.
- **FR-006**: System MUST support **idle wake**: when a worker finishes, Ira MUST assign the next DAG-ready task if any and policy allows.
- **FR-007**: System MUST support **night/away mode**: continue eligible forge work when configured triggers fire; escalate only critical-class items.
- **FR-008**: System MUST implement autonomy modes **Observe**, **Supervised**, and **Autonomous** as first-class settings with **Supervised** as the default for new installs.
- **FR-009**: Critical-class escalations MUST be queryable and answerable via Command Plane API (list, inspect, respond); optional UI/voice channels MAY consume the same API later.
- **FR-010**: Ira MUST enforce the **critical HITL policy**: never silent-auto for budget exceed, destructive git/production actions, spec scope change, untrusted hire/skill import, repeated review failures, constitution violation, or unresolved ambiguous requirements.
- **FR-011**: Product documentation and API responses MUST use callsign **Ira**; formal expansion **Intelligent Resource Automation** MUST appear in persona definitions.

#### Hive & Coordination

- **FR-012**: System MUST provide a durable **hive** store for roster, blackboard, task ledger, and append-only event log.
- **FR-013**: Workers MUST communicate via **inbox/outbox** (or equivalent message API) with **single-writer** rules; multi-writer mailbox corruption MUST NOT occur.
- **FR-014**: Shared plans on the **blackboard** MUST have a **single scribe** (Ira or designated process).
- **FR-015**: Event log MUST be **append-only** and sufficient to reconstruct activity timelines for downstream consumers.
- **FR-016**: Coordinator handoff MUST remain compatible with existing `.superspec/coordinator.md` lean-loop semantics.

#### Forge Integration & Compatibility

- **FR-017**: Existing SuperSpec skills lifecycle MUST keep working without Command Center installed.
- **FR-018**: Forge loop MCP tools (`next-task`, `begin-task`, `record-result`, `sync-status`, `forge-status`, `coordinator-brief`, `route-model`, `build-matrix`, plan/spec lints) MUST remain valid; Command Plane MUST extend — not replace — them.
- **FR-019**: Traceability spine **FR ↔ task ↔ test** MUST remain mandatory for code work coordinated through Ira.
- **FR-020**: Fresh subagent dispatch MUST remain the default worker execution model where the host harness supports it.
- **FR-021**: Command Plane state MUST be **UI-agnostic**: any future Command Center (P-002) MUST consume the same API the CLI uses.

#### Doctor & Operability

- **FR-022**: `superspec doctor` (or equivalent) MUST report hive integrity, broken MCP wiring, constitution/template drift, and Command Plane readiness.
- **FR-023**: Install/onboarding MUST detect installed SuperSpec CLIs and suggest next setup steps for Command Plane (hive path, autonomy default).
- **FR-024**: Telemetry of prompts/code MUST remain **off by default**; any usage analytics MUST be opt-in and anonymized.

#### Policy & Configuration

- **FR-025**: Mode switching (Observe / Supervised / Autonomous) and night mode enablement MUST be persistent settings inspectable via Command Plane API.
- **FR-026**: Night/away mode v1 triggers MUST include at least: manual away toggle and forge/CI status change; additional trigger types MAY follow [NEEDS CLARIFICATION: full v1 trigger catalog — CI webhook only vs local forge-status poll vs scheduled cron].
- **FR-027**: Replan attempt limits before marking blocked MUST be configurable; default ceiling MUST be documented [NEEDS CLARIFICATION: default replan attempt budget per task before mandatory Ask-Me/block].

#### Storage

- **FR-028**: Hive store location MUST be explicit and doctor-verifiable [NEEDS CLARIFICATION: project-local `.superspec/hive/` vs user-global coordination root for multi-repo operators].

### FR Crosswalk (Parent IDs)

| FR | Parent ID(s) | Summary |
|----|--------------|---------|
| FR-001 | CP-001 | Command Plane API (CLI + MCP) |
| FR-002 | GD-001 | Goal brief → staff |
| FR-003 | GD-002 | Task ledger ↔ plan |
| FR-004 | GD-003 | Ask-Me inbox |
| FR-005 | GD-004 | Auto-replan on failure |
| FR-006 | GD-005 | Idle wake |
| FR-007 | GD-006 | Night/away mode |
| FR-008 | GD-007 | Autonomy modes |
| FR-009 | GD-008 | Escalations via API (UI deferred to P-002) |
| FR-010 | §5.3 | Critical HITL policy |
| FR-011 | §4 | Ira persona naming |
| FR-012 | HV-001 | Durable hive store |
| FR-013 | HV-002 | Inbox/outbox single-writer |
| FR-014 | HV-003 | Blackboard single scribe |
| FR-015 | HV-004 | Append-only event log |
| FR-016 | HV-005 | Coordinator compatibility |
| FR-017 | SS-001 | Skills without UI |
| FR-018 | SS-002 | Extend forge MCP tools |
| FR-019 | SS-003 | FR ↔ task ↔ test |
| FR-020 | SS-004 | Fresh subagent dispatch |
| FR-021 | CP-001, §7.3 | Option D API invariant (no UI-only state) |
| FR-022 | DX-001 | Doctor health |
| FR-023 | DX-002 | Onboarding detection |
| FR-024 | DX-003 | Privacy-default telemetry |
| FR-025 | GD-007, GD-006 | Persistent mode settings |
| FR-026 | GD-006 | Night triggers |
| FR-027 | GD-004 | Replan limits |
| FR-028 | HV-001 | Hive path convention |

**Explicitly deferred to sibling specs (not FRs here)**: LR-* → P-003; TK-* → P-004; HR-* → P-005; EN-* → P-006; UI-* → P-002; INT-* → P-007.

### Key Entities

- **Ira (GOD persona)**: Intelligent Resource Automation — floor director that routes, staffs, adjudicates, replans, and escalates; does not write feature code.
- **Goal Brief**: Operator-supplied outcome, constraints, budget cap, and deliverable reference (feature/spec/plan).
- **Task Ledger Entry**: Plan-aligned task (`T00X`), feature ID, title, `implementsFr[]`, `dependsOn[]`, assignee, status (`todo` \| `doing` \| `blocked` \| `done`), review failure count, optional embedded human-QA state.
- **Ask-Me Item**: Escalation record with reason class, affected task/agent, question text, answer, state (`open` \| `resolved`), timestamps.
- **Hive Mailboxes**: Per-agent inbox/outbox messages with single-writer enforcement.
- **Blackboard**: Shared plan/status surface with one scribe.
- **Event Log Entry**: Append-only audit record for staffing, dispatch, completion, escalation, mode change, replan.
- **Autonomy Settings**: Mode (`observe` \| `supervised` \| `autonomous`), night mode flag, trigger subscriptions, replan limits.
- **Roster Entry** (read-only in P-001): Agent ID, persona reference, capability tags, engine/model placeholders — full hire flow in P-005.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Operator can brief a feature and inspect staffed tasks entirely via CLI/MCP in under 5 minutes on a reference feature with an existing plan.
- **SC-002**: 100% of critical-class events in test scenarios produce Ask-Me items; zero silent auto-approvals for budget, destructive, or scope-change classes.
- **SC-003**: After each forge MCP transition (`begin-task`, `record-result`, `sync-status`), hive ledger status matches forge state within one sync cycle in automated tests.
- **SC-004**: Idle wake assigns the next ready task within 30 seconds of worker completion in local supervised-mode tests (no UI).
- **SC-005**: `superspec doctor` detects injected hive corruption and missing MCP prerequisites with actionable remediation text in 95% of seeded fault fixtures.
- **SC-006**: Existing SuperSpec validate flow (lint + matrix) passes unchanged on a feature coordinated only through Command Plane API.
- **SC-007**: Command Plane APIs return consistent state to CLI and MCP callers — no UI-only fields required for core operations.

## Assumptions

- **No UI in P-001**: All journeys are validated through CLI/MCP; P-002 adds visualization on the same API.
- **Single Operator v1**: Multi-user board/auth is out of scope (see parent OPEN-007).
- **Learning, tokens, hire, engines**: Pattern retrieve/distill (P-003), budgets/circuit breaker (P-004), hire gallery (P-005), and engine adapters (P-006) integrate via hooks later; P-001 exposes extension points but does not implement their FRs.
- **Night mode v1**: Assumes at minimum manual away toggle plus forge-status/CI-green polling until trigger catalog is clarified (FR-026).
- **Replan default**: Assumes reuse of existing forge `maxReviewFailures` semantics until FR-027 is resolved.
- **Hive path default**: Assumes project-local `.superspec/hive/` unless FR-028 chooses user-global coordination.
- **Hermes/OpenClaw**: Not required; integrations deferred to P-007 (parent INT-003).
- **Package shape**: Command Plane extends `@superspec-dev/core` MCP surface; exact module split is an architect decision (parent OPEN-008).

<!-- Adapted from SK: templates/spec-template.md (MIT). See /NOTICE. -->
