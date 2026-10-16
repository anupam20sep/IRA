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
| [`docs/superspec/specs/ira-architecture-amendment-2026-10-16.md`](../../docs/superspec/specs/ira-architecture-amendment-2026-10-16.md) | LOCKED production remediation (OD-009–OD-020). Wins over conflicting Decisions in this feature |

`docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` is LOCKED. If this design disagrees with that amendment, the amendment wins.

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
| Fail-closed dispatch, hold, locks, away CI, doctor split, isolation, Slice A | [`docs/superspec/specs/ira-architecture-amendment-2026-10-16.md`](../../docs/superspec/specs/ira-architecture-amendment-2026-10-16.md) (LOCKED) |

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

**Independent Test**: Run one forge cycle against a plan-backed feature. Steer with `dispatch-task` (not a direct `begin-task`). After each successful forge write, query the hive ledger and confirm task status, assignee, and `reviewFailures` match forge state. A failed hive sync leaves `state.json` unchanged.

**Acceptance Scenarios**:

1. **Given** a hive ledger synced from `plan.md`, **When** `dispatch-task` accepts `T002` (`EngineHooks.dispatch` returns `null` or `{ accepted: true }` after `TokenHooks.beforeDispatch` allows) and the internal `begin-task` marks it in progress, **Then** hive row `T002` status becomes `doing` with assignee and timestamp in the append-only event log.
2. **Given** the hive exists, **When** a caller invokes `begin-task` directly (not the internal call from `dispatch-task`), **Then** the command returns `DISPATCH_PATH_REQUIRED` and does not mark the task in progress.
3. **Given** a successful `record-result`, **When** sync runs, **Then** hive marks the task `done`, updates coordinator handoff artifacts, and leaves inbox/outbox mailboxes single-writer clean. Sync failure after that forge write does not roll back `state.json`.
4. **Given** two concurrent processes, **When** both attempt to scribe the blackboard, **Then** the system enforces single-scribe rules and rejects or serializes the loser without corrupting ledger files. A live lock older than 30 seconds is not stolen.

---

### User Story 4 - Idle Wake and Auto-Replan (Priority: P2)

When a worker finishes, Ira assigns the next DAG-ready task if any (idle wake). On task failure, Ira retries within policy — tier bump, reassign, or split — before marking blocked and escalating.

**Why this priority**: Keeps the floor moving without Operator micro-management; builds on P1 ledger + Ask-Me foundation.

**Independent Test**: Complete a task with a dependent sibling waiting; verify auto-assignment. Fail a task twice; verify replan attempts then Ask-Me/block.

**Acceptance Scenarios**:

1. **Given** agent **A** idle and task **T003** ready (dependencies satisfied), **When** **A** completes **T002**, **Then** idle wake calls `dispatch-task` for **T003** (not a raw `begin-task`) and assigns **T003** to **A** without Operator action in **Supervised** or **Autonomous** mode.
2. **Given** a task in progress, **When** the Operator pauses it, **Then** the hive sets `hold: true`, appends `task.held`, and leaves forge `reviewFailures` unchanged.
3. **Given** a task failure with remaining replan budget, **When** Ira replans, **Then** the ledger records the new attempt (retry tier or reassign) before surfacing Ask-Me. The failure is a real review outcome of `passed: false`.
4. **Given** replan budget exhausted per policy, **When** the task still fails a review, **Then** Ira marks the task `blocked`, opens Ask-Me if critical class, and appends a failure event. Pause does not take this path.

---

### User Story 5 - Night / Away Mode (Priority: P3)

When night/away mode is enabled and autonomy is **Autonomous**, Ira continues eligible forge work (e.g., after CI green) within budgets, escalating only critical-class items to Ask-Me.

**Why this priority**: Valuable for unattended runs but depends on P1–P2 routing, ledger, and HITL being trustworthy first.

**Independent Test**: Enable night mode with a synthetic CI-green trigger stub; verify Ira dispatches the next ready task overnight and does not auto-approve a budget breach.

**Acceptance Scenarios**:

1. **Given** night mode on and CI state `green`, **When** tasks remain in `todo` with satisfied dependencies, **Then** the away tick writes `away.heartbeat` and calls `dispatch-task` for the next eligible task within budget policy.
2. **Given** night mode on and `allowAbsentCi` missing or `false`, **When** CI state is `absent` or missing, **Then** away dispatch does not run and the tick reason is `ci_absent`. State `red` stops with `ci_not_green` even when `allowAbsentCi` is `true`.
3. **Given** night mode on, **When** a destructive git operation would be required, **Then** Ira creates Ask-Me and does not proceed silently.
4. **Given** night mode off or autonomy **Observe**, **When** a trigger fires, **Then** Ira records the trigger but does not auto-dispatch.

---

### Edge Cases

- What happens when the plan changes after the ledger is populated (new `T00X`, removed task)? Ira MUST reconcile or flag drift for Operator review via Ask-Me or doctor.
- What happens when hive files are manually edited or corrupted? Doctor reports integrity failures; Command Plane refuses dispatch until repaired or reset.
- What happens when autonomy is **Observe**? Ira recommends next actions but never auto-dispatches or auto-spawns.
- What happens when Ask-Me items go unanswered for an extended period? Tasks stay blocked; status queries surface age and severity; no silent timeout approval.
- What happens when forge MCP tools are invoked without hive initialization? System initializes hive idempotently or returns a clear setup error with doctor hints.
- What happens when multiple features share one workspace? Ledger entries MUST be namespaced by `featureId` to prevent cross-feature assignment.
- What happens when a lock file is older than 30 seconds and the recorded pid is still alive? The lock stays. Age MUST NOT steal it.
- What happens when `away.pid` names a dead process, or away mode is on and `away.heartbeat` is missing or older than `2 * pollIntervalMs`? Doctor reports `AWAY_PID_STALE` at severity `error` and MUST NOT delete `away.pid`.
- What happens when a Command Plane hook throws after forge `saveState` already succeeded? The forge tool stays success. The hook result is deny (`HOOK_FAILED_CLOSED`). The hook MUST NOT exit the process.
- What happens when the Operator aborts without `confirm: true`? `task-abort` writes nothing. Abort MUST NOT increment `reviewFailures`.

## Clarifications

### Session 2026-10-15

- Q: Night mode v1 trigger catalog (OD-005 / FR-026)? → A: Exactly two triggers — manual away toggle and local `forge-status` poll at a default 60s interval while away mode is enabled. No inbound CI webhooks, cron expressions, or external scheduler. While away, continue only eligible forge work; do not continue while a critical Ask-Me item is open; a present CI signal must be green before continuation. The parent “missing signal must not block” sentence is replaced by Session 2026-10-16 (OD-013): `allowAbsentCi` defaults to `false`, and a missing or `absent` CI signal blocks away dispatch with `ci_absent` unless that setting is exactly `true`.

### Session 2026-10-16

- Q: Who may spawn host engines (OD-009 / FR-032)? → A: Host engines are exactly `claude`, `codex`, and `cursor-agent` (`cursor` is an alias of `cursor-agent`). `EngineHooks.dispatch` returns `null` and starts no host CLI. Away and idle wake persist a `DispatchIntent` and MUST NOT start those binaries. A detached supervisor is legal only for `opencode`, `crush`, `aider`, and `custom`, and only after Slice A validates. `delegateToHost: null`, an away pid match, and `engines hooks install` do not authorize host spawn. Violation is `HOST_SPAWN_FORBIDDEN` and starts no child.
- Q: What is the only steer path while the hive exists (OD-010 / FR-029)? → A: `dispatch-task` on CLI and MCP, same JSON. Order is `TokenHooks.beforeDispatch` → `EngineHooks.dispatch` → forge `begin-task` only after allow and a host `null` or `{ accepted: true }`. `{ allow: false }` or `{ accepted: false }` does not call `begin-task`. The board, away tick, and idle wake call `dispatch-task` and do not argv `begin-task`. Any other steer caller, and a direct `begin-task` while the hive exists, returns `DISPATCH_PATH_REQUIRED` and does not mark the task in progress. When the hive is absent, `begin-task` stays the pre-Ira forge command.
- Q: Does pause burn a review (OD-011 / FR-030)? → A: No. Pause is hive-only `hold: true` via `task-hold`. It appends `task.held`, does not call `record-result`, and does not increment `reviewFailures` or change forge failure state. `dispatch-task` on a held task returns `DISPATCH_HELD`. Abort is `task-abort` with `confirm: true` only. Abort does not call `record-result --passed false`. If the only transition would increment `reviewFailures`, abort returns `ABORT_UNSUPPORTED` and writes nothing. `reviewFailures` increments only on a real review outcome of `passed: false`. The ceiling counter in OD-006 stays for that real review path.
- Q: When may a hive lock be stolen (OD-012 / FR-031)? → A: Only `withLock` in `@superspec-dev/core` creates and removes hive lock files. Body is `{ pid, nonce }` with flag `wx`. Steal only when `process.kill(pid, 0)` fails and a re-read shows the same nonce. Age, including `acquiredAt` older than 30 seconds, does not steal. Release unlinks only when the caller’s nonce equals the file nonce. The Command Center has no lock-file implementation.
- Q: How far is a supervisor isolated from forge and MCP (OD-015 / FR-033)? → A: Non-host children run only in a detached supervisor (`detached: true`, `shell: false`, stdio not the MCP pipes, parent unref). The IDE-attached MCP server is not their parent and does not run the supervisor in-process. `registerCommandPlaneHooks` catches every hook exception. A throw becomes deny plus `hook.failed` / `HOOK_FAILED_CLOSED`. An already-successful forge `saveState` result, stdout, and exit code stay success. A hook does not exit the process.
- Q: Which Ira surfaces are live before doctor reports Slice A validated (OD-020 / FR-034)? → A: Until `sliceAValidated` is true, live surfaces are P-001, P-006 host-delegate (`null`, no host-CLI spawn), the board Dispatch control calling `dispatch-task`, and Ask-Me create/list/answer. Distill writes, spend and breaker side effects, hire persona/roster writes, and detached spawn of `opencode` / `crush` / `aider` / `custom` are no-ops that return `SLICE_A_ONLY` and perform no side effect. `TokenHooks.beforeDispatch` stays a live gate: allow with no spend write for a host engine; deny `SLICE_A_ONLY` for a `byok` or `local` supervisor rung. Forge `saveState` / `record-result` persistence stays live. Pause and abort use OD-011 and do not call `record-result`. Doctor recomputes `sliceAValidated` from the four OD-020 checks on every run.
- Q: Replan and review-failure limits before Ask-Me/block (OD-006 / FR-027)? → A: Replan and review-failure limits share forge `maxReviewFailures` as one counter per task (`reviewFailures`); default ceiling 3 (forge CLI/MCP default); ceiling configurable per feature. Below ceiling Ira may auto-replan; at ceiling Ira opens Ask-Me, marks the task blocked, and must not silently replan until the Operator resolves the item.
- Q: Hive store path convention (OD-007 / FR-028)? → A: Hive at `<repository-root>/.superspec/hive/` where repository root is the SuperSpec project root containing `program.md` (roster, blackboard, task ledger, event log, mailboxes). `superspec doctor` reports the resolved absolute path and writability. No user-global hive; no per-feature hive root; hive contents gitignored. Per-feature forge state remains at `specs/<feature>/.superspec/state.json`.

## Requirements *(mandatory)*

### Functional Requirements

#### Command Plane & Ira (GOD)

- **FR-001**: System MUST expose a **Command Plane API** via SuperSpec CLI and MCP that reads and mutates forge/hive/ledger state without requiring the Command Center UI.
- **FR-002**: Operator MUST be able to submit a **goal brief** (outcome, constraints, budget, deliverable) to Ira; Ira MUST staff tasks and agent assignments from that brief.
- **FR-003**: Ira MUST maintain a **task ledger** compatible with SuperSpec plans (`T00X` identifiers, dependencies, status, FR tags).
- **FR-004**: Ira MUST maintain an **Ask-Me inbox**; worker clarifications and critical approvals MUST route there instead of defaulting to ad-hoc terminal prompts.
- **FR-005**: Ira MUST **auto-replan** remaining work on task failure (retry tier, reassign, or split) within policy before marking a task blocked.
- **FR-006**: System MUST support **idle wake**: when a worker finishes, Ira MUST assign the next DAG-ready task if any and policy allows by calling `dispatch-task` (FR-029). Idle wake MUST NOT argv `begin-task`.
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
- **FR-018**: Forge loop MCP tools (`next-task`, `begin-task`, `record-result`, `sync-status`, `forge-status`, `coordinator-brief`, `route-model`, `build-matrix`, plan/spec lints) MUST remain valid; Command Plane MUST extend — not replace — them. When the hive is absent, `begin-task` stays the pre-Ira forge command. When the hive exists, a `begin-task` call that is not the internal call from `dispatch-task` MUST return `DISPATCH_PATH_REQUIRED` and MUST NOT mark the task in progress. Forge functions remain the only writers of `specs/<feature>/.superspec/state.json`. After a successful forge write, hive sync is best-effort: sync failure MUST NOT roll back forge state and MUST NOT change that forge tool’s success result.
- **FR-019**: Traceability spine **FR ↔ task ↔ test** MUST remain mandatory for code work coordinated through Ira.
- **FR-020**: Fresh subagent dispatch MUST remain the default worker execution model where the host harness supports it.
- **FR-021**: Command Plane state MUST be **UI-agnostic**: any future Command Center (P-002) MUST consume the same API the CLI uses.

#### Doctor & Operability

- **FR-022**: `superspec doctor` (or equivalent) MUST report hive integrity, broken MCP wiring, constitution/template drift, and Command Plane readiness as boolean `hiveReady`. `hiveReady` is coordination-store health: schema, parseable ledger, gitignore, writability, lock module present, and away pid not stale. Doctor MUST also return `engineRungReady` as a separate boolean. Engine rung readiness is P-006 (`specs/006-ira-engine-adapters`). An engine finding MUST NOT set `hiveReady` false. A legacy `ready` field, if emitted, MUST equal `hiveReady` and MUST NOT be the conjunction of `hiveReady` and `engineRungReady`. Dispatch requires `hiveReady`. Doctor MUST emit `worktreeKind` (`main` or `linked`) and `sandboxed` independently. `sandboxed: true` is legal only when that child was started under an OS sandbox wrapper. A linked worktree MUST NOT set `sandboxed` true (finding `WORKTREE_IS_NOT_SANDBOX`, reported `sandboxed` corrected to `false`). Slice A has no sandbox wrapper, so `sandboxed` is `false`. Finding `AWAY_PID_STALE` is severity `error` when `away.pid` exists and the pid is dead, or `awayMode` is true and the heartbeat is missing or older than `2 * pollIntervalMs`. Doctor MUST NOT delete `away.pid`. Remedy text MUST name `superspec away off` as the clear path. Doctor’s read of the pid file is side-effect free. *(OD-014, OD-013, OD-019)*
- **FR-023**: Install/onboarding MUST detect installed SuperSpec CLIs and suggest next setup steps for Command Plane (hive path, autonomy default).
- **FR-024**: Telemetry of prompts/code MUST remain **off by default**; any usage analytics MUST be opt-in and anonymized.

#### Policy & Configuration

- **FR-025**: Mode switching (Observe / Supervised / Autonomous) and night mode enablement MUST be persistent settings inspectable via Command Plane API.
- **FR-026**: Night/away mode v1 MUST honor exactly two trigger types: a manual away toggle, and a local poll of forge-status at a default interval of 60 seconds while away mode is enabled. While away mode is enabled, Ira MUST continue only eligible forge work by calling `dispatch-task`, and MUST NOT argv `begin-task` and MUST NOT continue while a critical Ask-Me item is open. Settings field `allowAbsentCi` is boolean; a missing field means `false`. The away CI gate, evaluated before `dispatch-task`, is: state `green` passes the CI gate only; state `red` always stops with reason `ci_not_green`; state `absent` or a missing CI field stops with reason `ci_absent` unless the persisted value is exactly `allowAbsentCi: true`. Each away tick MUST write `<hiveRoot>/away.heartbeat` (`{ pid, at }`, mode `0600`) and fsync it before any dispatch. A failed heartbeat write skips dispatch with `dispatched: false` and reason `heartbeat_failed`. v1 MUST NOT accept inbound CI webhooks and MUST NOT expose cron expressions or an external scheduler. *(GD-006, OD-005 resolved; missing-signal clause replaced by OD-013)*
- **FR-027**: Replan limits and review-failure limits MUST share forge `maxReviewFailures` as one counter per task (`reviewFailures`). The default ceiling MUST be 3, matching the forge CLI and MCP default, and the ceiling MUST be configurable per feature. On each real review failure below the ceiling, Ira MAY auto-replan (retry at a higher model tier, reassign, or split) and the task stays retryable. When `reviewFailures` reaches the ceiling after a review `record-result` with `passed: false`, Ira MUST open an Ask-Me item, mark the task blocked, and MUST NOT silently replan further until the Operator resolves that item. Operator pause and `task-hold` MUST NOT increment `reviewFailures`. The ceiling path applies only after that real review outcome. *(GD-004, §5.3, OD-006 resolved; pause is not a review failure per OD-011)*

#### Storage

- **FR-028**: The hive store MUST live at the project-local path `<repository-root>/.superspec/hive/`, where repository root is the SuperSpec project root that contains `program.md`. It MUST hold roster, blackboard, task ledger, append-only event log, and mailboxes. `superspec doctor` MUST report this resolved absolute path and whether it is present and writable. v1 MUST NOT use a user-global hive and MUST NOT use a per-feature hive root. Hive contents are machine state and MUST be gitignored. Per-feature forge state MUST remain at `specs/<feature>/.superspec/state.json`. Forge `saveState` / `loadState` remain the only writers of that file. *(HV-001, OD-007 resolved)*
- **FR-029**: System MUST expose `dispatch-task` on CLI and MCP, returning the same JSON. Request fields are `featureId`, `taskId`, and optional `cwd`. Steer callers are only the board Dispatch control, `dispatch-task` CLI, `dispatch-task` MCP, idle wake, and the away tick. Any other steer caller MUST be refused with `DISPATCH_PATH_REQUIRED`. Internal order is fixed: (1) `hiveReady` false returns `HIVE_NOT_READY` and does not call `begin-task`; (2) refuse, with no `begin-task`, when the task is not DAG-ready, `hold` is true (`DISPATCH_HELD`), an Ask-Me item is open for that feature, the CI gate fails (FR-026), or a code task has an empty `implementsFr`; (3) build `DispatchIntent` with `freshSubagent: true` — a false value is `INVALID_INPUT` and starts no spawn; (4) call `TokenHooks.beforeDispatch` — `{ allow: false }` stops the command with no `EngineHooks.dispatch` and no `begin-task`; (5) call `EngineHooks.dispatch` — a failover rung change inside that call MUST call `TokenHooks.beforeDispatch` again on the effective engine and model before spawn and before `{ accepted: true }`, and a deny returns `{ accepted: false }`; (6) call forge `begin-task` only when step 4 allowed and step 5 returned `null` or `{ accepted: true }`, then sync the hive to `doing`; (7) if `begin-task` fails after a non-host child started, the supervisor MUST terminate that child and the command MUST return the forge error; if `begin-task` fails after a host intent was queued, the command MUST delete that queue file and MUST NOT leave hive status `doing`. `{ allow: false }` or `{ accepted: false }` MUST NOT call `begin-task`, and hive status MUST stay unchanged. A hook throw at step 4 or 5 is `HOOK_FAILED_CLOSED`, treated as deny. Forge state already saved by a previous command stays saved. Hive sync after a successful forge write stays best-effort and MUST NOT roll back `state.json`. *(OD-010)*
- **FR-030**: Pause MUST set hive-only ledger field `hold` (boolean, default `false`) and MUST NOT change forge failure state. `task-hold` with `hold: true` sets the flag, sets `updatedAt`, appends `task.held`, and returns. `task-hold` with `hold: false` clears the flag and appends `task.resumed`. Neither call accepts `passed`. Pause MUST NOT call `record-result` and MUST NOT increment `reviewFailures`. `dispatch-task` on a held task returns `DISPATCH_HELD`. Abort is `task-abort` and requires `confirm: true`. Missing `confirm` writes nothing. On success, abort sets hive status `blocked`, `hold: false`, and `abortReason`, appends `task.aborted`, and clears the forge attempt from `in_progress` by a transition that leaves `reviewFailures` unchanged. Abort MUST NOT call `record-result` with `passed: false`. If the only available transition would increment `reviewFailures`, abort returns `ABORT_UNSUPPORTED` and writes nothing. `reviewFailures` increments only on a real review outcome of `passed: false`. *(OD-011)*
- **FR-031**: The only creator and the only remover of hive lock files MUST be `withLock` in `@superspec-dev/core`. The lock body is `{ pid, nonce }`, created with flag `wx`. `acquiredAt` MAY be stored for logs and MUST NOT be read by the steal predicate. Steal (unlink and retry) is permitted only when `process.kill(pid, 0)` fails and a re-read shows the same `nonce`. Age, including a lock older than 30 seconds, MUST NOT steal. A lock older than 30 seconds whose pid is alive MUST be left in place. If the pid is alive, the caller waits up to `waitMs` and does not unlink, then returns `LEDGER_BUSY`, `MAILBOX_BUSY`, `EVENT_BUSY`, or `SCRIBE_BUSY` for that path. Wait bounds stay blackboard `0` ms and ledger, mailbox, and events `2000` ms. A malformed lock file is unlinked and retried once, then the busy code is returned. Release unlinks only when the caller’s nonce equals the file nonce. The Command Center MUST NOT contain a lock-file implementation. Hive writes from the board go through a core CLI/MCP command. A second lock copy is a defect. *(OD-012)*
- **FR-032**: Engine ids `claude`, `codex`, and `cursor-agent` are host engines. The id `cursor` is an input alias of `cursor-agent` and is a host engine. `EngineHooks.dispatch` for a host engine MUST return `null`, MUST persist `DispatchIntent` at `<hiveRoot>/dispatch-queue/<featureId>/<taskId>.json` (mode `0600`), MUST return that intent to an attached host session, and MUST NOT start a process whose argv0 is `claude`, `codex`, `cursor-agent`, or `agent`. Ira MUST NOT parent a host engine from an IDE-attached MCP process. Away and idle wake persist that intent and MUST NOT start `claude`, `codex`, or `cursor-agent`. Detached supervisor spawn is legal only when the effective engine id is `opencode`, `crush`, `aider`, or `custom`, and only after FR-034 allows it. Any other id returns `{ accepted: false }` and starts no child. `delegateToHost: null`, an away pid match, and `engines hooks install` MUST NOT authorize host spawn. Violation returns `HOST_SPAWN_FORBIDDEN` and starts no child. *(OD-009)*
- **FR-033**: Non-host engine children MUST run only inside a detached supervisor: argv `superspec engines supervise` plus an intent path argument array, `detached: true`, `shell: false`, stdio `ignore` or a pipe pair created for that child, child `unref`’d, and env a new object that is not `process.env` (OD-019 allowlist; a catalog `byokEnvAllowlist` name is copied only when the effective rung is `byok`). The IDE-attached MCP server MUST NOT be the parent of those children and MUST NOT run the supervisor in-process. The MCP server’s stdin and stdout MUST NOT be in that stdio set. An in-process supervisor call from the MCP request handler is `SUPERVISOR_IN_MCP_FORBIDDEN`. `registerCommandPlaneHooks` MUST catch every exception from `beforeDispatch`, `dispatch`, `normalizeEvent`, `onRecordResult`, `onUntrustedImport`, and `matchCapabilities`. The catch path records `hook.failed` with reason `HOOK_FAILED_CLOSED` when the event log is writable, returns `{ allow: false }` or `{ accepted: false }`, and MUST swallow the exception. The forge tool’s already-successful `saveState` result, stdout, and exit code stay success. A hook MUST NOT exit the process. *(OD-015, OD-019)*
- **FR-034**: Until doctor reports `sliceAValidated: true`, the only live Ira surfaces are P-001 (hive, locks, doctor, `dispatch-task`, Ask-Me, `task-hold`, `task-abort`), P-006 host-delegate (`null`, no host-CLI spawn), the board Dispatch control calling `dispatch-task`, and Ask-Me create/list/answer. P-003 distill writes, P-004 spend and breaker side effects, P-005 persona and roster writes, and P-006 detached spawn of `opencode`, `crush`, `aider`, and `custom` MUST be no-ops that return `SLICE_A_ONLY` and perform no side effect. `TokenHooks.beforeDispatch` stays live: `{ allow: true }` for a host engine with no spend write; `{ allow: false, reason: "SLICE_A_ONLY" }` for a `byok` or `local` supervisor rung. Forge `saveState` and `record-result` persistence stay live. A pause or abort control MUST use FR-030 and MUST NOT call `record-result`. Doctor sets `sliceAValidated` true only when all four checks pass in the same run: `hiveReady` is true; a host-engine `dispatch-task` queues a `DispatchIntent` and starts no host CLI; the board Dispatch control invokes `dispatch-task` and does not invoke `begin-task`; Ask-Me create, list, and answer round-trip for one critical class without spawning a worker. `sliceAValidated` MUST be recomputed on every doctor run. A file that claims validated without those four checks passing MUST be ignored. A no-op returns `{ ok: false, code: "SLICE_A_ONLY" }` for a command whose only job is the deferred side effect, and returns forge success for `record-result` after `saveState` with the deferred hook skipped. It MUST NOT half-apply the deferred write. *(OD-020)*

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
| FR-029 | OD-010 | `dispatch-task` is the only steer path |
| FR-030 | OD-011 | Hive `hold` and `task-abort` do not burn reviews |
| FR-031 | OD-012 | `withLock`; steal only dead pid plus nonce |
| FR-032 | OD-009 | Host engines are not Ira-parented |
| FR-033 | OD-015, OD-019 | Detached supervisor; hooks fail closed |
| FR-034 | OD-020 | Slice A live surfaces and doctor checks |

**Explicitly deferred to sibling specs (not FRs here)**: LR-* → P-003; TK-* → P-004; HR-* → P-005; EN-* → P-006; UI-* → P-002; INT-* → P-007.

### Key Entities

- **Ira (GOD persona)**: Intelligent Resource Automation — floor director that routes, staffs, adjudicates, replans, and escalates; does not write feature code.
- **Goal Brief**: Operator-supplied outcome, constraints, budget cap, and deliverable reference (feature/spec/plan).
- **Task Ledger Entry**: Plan-aligned task (`T00X`), feature ID, title, `implementsFr[]`, `dependsOn[]`, assignee, status (`todo` \| `doing` \| `blocked` \| `done`), hive-only `hold` (default `false`), review failure count (forge copy; incremented only on a real review `passed: false`), optional `abortReason`, optional embedded human-QA state.
- **Ask-Me Item**: Escalation record with reason class, affected task/agent, question text, answer, state (`open` \| `resolved`), timestamps.
- **Hive Mailboxes**: Per-agent inbox/outbox messages with single-writer enforcement.
- **Blackboard**: Shared plan/status surface with one scribe.
- **Event Log Entry**: Append-only audit record for staffing, dispatch, completion, escalation, mode change, replan, `task.held`, `task.resumed`, `task.aborted`, and `hook.failed`.
- **Autonomy Settings**: Mode (`observe` \| `supervised` \| `autonomous`), night mode flag, `allowAbsentCi` (default `false` when missing), trigger subscriptions, replan limits.
- **Roster Entry** (read-only in P-001): Agent ID, persona reference, capability tags, engine/model placeholders — full hire flow in P-005.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Operator can brief a feature and inspect staffed tasks entirely via CLI/MCP in under 5 minutes on a reference feature with an existing plan.
- **SC-002**: 100% of critical-class events in test scenarios produce Ask-Me items; zero silent auto-approvals for budget, destructive, or scope-change classes.
- **SC-003**: After each successful forge write (`begin-task` only as the internal step of `dispatch-task` when the hive exists, `record-result`, `sync-status`), hive ledger status matches forge state within one sync cycle in automated tests. A failed sync does not roll back `state.json`.
- **SC-004**: Idle wake assigns the next ready task within 30 seconds of worker completion in local supervised-mode tests (no UI).
- **SC-005**: `superspec doctor` detects injected hive corruption and missing MCP prerequisites with actionable remediation text in 95% of seeded fault fixtures.
- **SC-006**: Existing SuperSpec validate flow (lint + matrix) passes unchanged on a feature coordinated only through Command Plane API.
- **SC-007**: Command Plane APIs return consistent state to CLI and MCP callers — no UI-only fields required for core operations.
- **SC-008**: While the hive exists, direct `begin-task` returns `DISPATCH_PATH_REQUIRED` and leaves the task out of progress; `dispatch-task` calls `begin-task` only after `TokenHooks.beforeDispatch` allows and `EngineHooks.dispatch` returns `null` or `{ accepted: true }`.
- **SC-009**: `task-hold` leaves `reviewFailures` unchanged. `task-abort` without `confirm: true` writes nothing. A successful abort does not increment `reviewFailures`.
- **SC-010**: A lock whose pid is alive is not stolen, including when `acquiredAt` is older than 30 seconds. A dead pid is stolen only when a re-read shows the same nonce.
- **SC-011**: With `allowAbsentCi` missing or `false`, away does not dispatch on CI `absent` or missing (`ci_absent`). A failed `away.heartbeat` write does not dispatch. `AWAY_PID_STALE` is a doctor error and doctor does not delete `away.pid`.

## Assumptions

- **No UI in P-001**: All journeys are validated through CLI/MCP; P-002 adds visualization on the same API.
- **Single Operator v1**: Multi-user directory auth stays open (parent OPEN-007). P-001 does not bind an HTTP server. Command Center mutations are a local loopback bearer gate (architecture amendment OD-017), not an unauthenticated board and not a user directory.
- **Learning, tokens, hire, engines**: Pattern retrieve/distill (P-003), budgets/circuit breaker (P-004), hire gallery (P-005), and engine adapters (P-006) integrate via hooks later; P-001 exposes extension points but does not implement their FRs.
- **Night mode v1**: Manual away toggle plus local `forge-status` poll every 60 seconds (default) while away is enabled; no CI webhooks or external scheduler. Continuation calls `dispatch-task` and is gated by eligible forge work, critical Ask-Me, heartbeat write, and the CI table in FR-026. `allowAbsentCi` defaults to `false`. A missing or `absent` CI signal blocks away dispatch unless that setting is exactly `true`. State `red` always blocks.
- **Replan limits**: Single per-task `reviewFailures` counter aligned with forge `maxReviewFailures`; default ceiling 3 (forge CLI/MCP default), configurable per feature; mandatory Ask-Me and block at ceiling per FR-027. The counter increments only on a real review `passed: false`. Pause (`hold`) and `task-abort` do not burn that budget.
- **Hive path**: Project-local `<repository-root>/.superspec/hive/` at the SuperSpec root containing `program.md`; doctor-verified; gitignored; per-feature forge state at `specs/<feature>/.superspec/state.json` per FR-028.
- **Hermes/OpenClaw**: Not required; integrations deferred to P-007 (parent INT-003).
- **Package shape**: Command Plane extends `@superspec-dev/core` MCP surface; exact module split is an architect decision (parent OPEN-008).

<!-- Adapted from SK: templates/spec-template.md (MIT). See /NOTICE. -->
