# Feature Specification: Ira Learning Memory

**Feature Branch**: `003-ira-learning-memory`

**Created**: 2026-09-06

**Status**: Draft

**Type**: platform

**Input**: User description: "Pattern store + RETRIEVE→JUDGE→DISTILL→CONSOLIDATE after forge tasks; survive compaction. Prefer lean Ruflo intelligence plugin semantics (no mandatory LoRA/EWC/neural train). Platform capability consumed by Command Plane (P-001) and Command Center (P-002)."

## Required Reading

| Path | Reason |
|------|--------|
| `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md` | Parent requirements — LR-* learning section, pattern data model (§8.3), journey §9.4, non-goals NG4 |
| `docs/superspec/specs/ira-prior-art-reuse-map.md` | Reuse map — Ruflo intelligence + Munder memory paths to adapt |
| `program.md` (P-003 row) | Program placement; OD-002 resolved (Session 2026-10-15) |
| `docs/explanation/dispatch-and-context.md` | Forge dispatch boundaries; filesystem vs chat memory |
| `docs/explanation/traceability-spine.md` | FR ↔ task ↔ test traceability for downstream plan |
| `packages/core/src/forge-loop.ts` | Forge state machine — hook points for `begin-task` / `record-result` |
| `plugins/ruflo-intelligence/README.md` (Ruflo upstream) | RETRIEVE→JUDGE→DISTILL→CONSOLIDATE loop semantics — lean reference, not a dependency |
| `.agents/skills/agentdb-memory-patterns/SKILL.md` (Ruflo upstream) | Pattern namespace and memory skill conventions |
| `.agents/skills/reasoningbank-intelligence/SKILL.md` (Ruflo upstream) | Reasoning-bank pattern retrieval ideas |
| `src/main/memory.ts` / `src/main/memory.md` (Munder upstream, optional) | Markdown-first memory layer — optional inspiration for human-readable pattern files |
| `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` | LOCKED production invariants — OD-016 learning non-blocking, OD-015 hook isolation, OD-020 Slice A for P-003 |

## Parent Requirements Crosswalk

| Parent ID | Summary | Maps to |
|-----------|---------|---------|
| LR-001 | Distill reusable pattern after each forge task result | FR-001, FR-007 |
| LR-002 | Persist patterns outside chat context | FR-002, FR-010 |
| LR-003 | Retrieve and inject bounded summary on route / begin-task / brief | FR-003, FR-008 |
| LR-004 | RETRIEVE→JUDGE→DISTILL→CONSOLIDATE loop (lean; no mandatory neural fine-tune) | FR-004, FR-008, FR-009 |
| LR-005 | Key patterns by FR tags, task kind, stack, failure reason, engine | FR-005 |
| LR-006 | Compaction / context clear must not delete pattern store | FR-006 |
| SS-002 | Extend forge MCP/CLI without breaking standalone SuperSpec | FR-011 |
| NG4 | No mandatory LoRA/EWC/neural stack | FR-004, Assumptions |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Distill lessons after forge tasks (Priority: P1)

When a worker completes a forge task (pass or fail), Ira extracts a reusable lesson from the outcome and saves it to durable storage so the knowledge survives session end and context compaction.

**Why this priority**: Without post-task distillation, every successful or failed attempt is lost when chat context is cleared — the core problem Ira learning memory solves.

**Independent Test**: Run `record-result` for a task with a known outcome, verify a pattern record exists on disk with matching signals and a bounded summary, without reading the worker transcript.

**Acceptance Scenarios**:

1. **Given** a forge task completes with a passing result, **When** `record-result` returns success after `saveState`, **Then** the forge outcome is success without waiting on DISTILL, and DISTILL eventually persists at least one success-pattern keyed to the task's FR tags and task kind (unless Slice A or distill skip).
2. **Given** a forge task completes with a failing result (review rejected or implementation error), **When** `record-result` returns after recording failure, **Then** forge success/failure reflects only the review outcome (distill failure does not fail the command), and DISTILL eventually persists at least one failure-pattern when distill succeeds.
3. **Given** DISTILL produces output containing credential-like strings, **When** the pattern is persisted, **Then** secrets are redacted or the pattern is rejected with a logged skip event — never written verbatim to the store.

---

### User Story 2 - Brief workers with relevant past patterns (Priority: P1)

Before a worker starts a new task, Ira retrieves patterns that match the upcoming work and injects a bounded summary into the task brief so the worker benefits from prior forge experience without the full prior transcript.

**Why this priority**: Retrieval at dispatch time delivers immediate value from stored patterns; paired with P1 distillation it closes the learning loop.

**Independent Test**: Seed the pattern store with a pattern keyed to `FR-012` and task kind `code`, dispatch `begin-task` for a task implementing `FR-012`, confirm the worker brief includes an injected pattern summary and excludes irrelevant patterns.

**Acceptance Scenarios**:

1. **Given** the pattern store contains entries matching the current task's FR tags and stack signals, **When** `begin-task` or brief generation runs, **Then** the worker brief includes a bounded RETRIEVE summary of the top relevant patterns after JUDGE filtering.
2. **Given** the pattern store has no entries matching the current task signals, **When** brief generation runs, **Then** the worker brief proceeds unchanged (no error) and optionally notes that no prior patterns matched.
3. **Given** multiple candidate patterns match, **When** JUDGE runs, **Then** only patterns above a relevance threshold are injected and the combined injection stays within the configured size cap.

---

### User Story 3 - Consolidate pattern quality over time (Priority: P2)

As forge work continues, Ira merges duplicate or near-duplicate patterns and maintains a usable store size so retrieval stays fast and brief injections stay focused.

**Why this priority**: Without consolidation the store degrades into noise; important but secondary to first distillation and retrieval.

**Independent Test**: Distill two patterns with the same signal bucket and substantially overlapping summaries, run CONSOLIDATE, verify a single canonical pattern (or one primary with demoted duplicate) remains.

**Acceptance Scenarios**:

1. **Given** two patterns share the same signal bucket and ≥80% summary overlap, **When** CONSOLIDATE runs (on schedule or after DISTILL), **Then** they merge into one canonical pattern with incremented use metadata.
2. **Given** a pattern has never been retrieved and is superseded by a newer canonical entry, **When** CONSOLIDATE runs, **Then** the superseded entry is demoted or archived without breaking evidence references.

---

### User Story 4 - Expose patterns to Command Plane consumers (Priority: P3)

Operators and downstream Ira features (Command Plane API, Command Center memory panel) can list and inspect stored patterns without opening raw store files.

**Why this priority**: Platform integrators need a stable read surface; UI rendering belongs to P-002 but depends on this contract.

**Independent Test**: After patterns exist, invoke the read-only pattern query surface and receive paginated pattern summaries with signals and evidence refs — no UI required.

**Acceptance Scenarios**:

1. **Given** patterns exist for feature `003-ira-learning-memory`, **When** a consumer queries by feature ID or signal filter, **Then** matching pattern summaries are returned with id, kind, signals, summary, and evidence refs.
2. **Given** SuperSpec runs without Command Center installed, **When** forge hooks execute, **Then** learning memory operates fully — the query surface is optional for CLI/MCP consumers only.

### Edge Cases

- What happens when DISTILL fails (engine unavailable, timeout)? Forge `record-result` MUST return success after `saveState` without awaiting DISTILL. DISTILL runs only after the success response is returned; failures are logged; distill failure MUST NOT fail `record-result` or roll back forge state; no partial or corrupt pattern is written.
- What happens when `better-sqlite3` is missing or the native module fails to load? RETRIEVE and distill index upserts MUST fall back to a capped scan of canonical markdown under `.superspec/patterns/`; forge calls MUST NOT fail; `superspec doctor` MUST warn (e.g. `PATTERNS_INDEX_UNAVAILABLE`); markdown files remain canonical and `patterns reindex` rebuilds the index when SQLite is available.
- What happens when a learning hook throws? The exception MUST be caught at the P-001 hook boundary; the forge MCP process MUST NOT exit; forge success from an already-completed `saveState` stays success (OD-015).
- What happens when the pattern store file is corrupted or unreadable? Retrieval skips bad entries, logs the error, and `superspec doctor` (or equivalent) SHOULD report store integrity issues.
- How are cross-feature patterns handled? Default: project-scoped store with optional feature filter on retrieve; global user-scoped patterns are out of scope for v1 unless Assumptions change.
- What happens when injected patterns would exceed the brief size cap? JUDGE ranks candidates; inject highest-relevance subset within cap; remainder omitted with trace in forge log.
- What happens on concurrent forge tasks writing patterns? Writes MUST be serialized or use single-writer semantics per store partition to avoid lost updates.

## Clarifications

### Session 2026-10-15

- Q: Pattern store primary backend (OD-002 / FR-010)? → A: Hybrid — human-readable markdown canonical records under `<repository-root>/.superspec/patterns/`; derived SQLite full-text index at `<repository-root>/.superspec/patterns/index.sqlite` for RETRIEVE and the read-only query surface; markdown is source of truth; index rebuildable from files and gitignored; v1 does not require local embeddings or a vector index.

### Session 2026-10-16 (OD-016, OD-015, OD-020)

Normative: `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md`.

- Q: When does DISTILL run relative to forge `record-result`? → A: After forge `saveState` succeeds and hive sync (when present), the handler returns forge success JSON without awaiting DISTILL, a distill hard timeout, or CONSOLIDATE. DISTILL is scheduled off the returned call (not on the request stack). A microtask the handler still `await`s is forbidden.
- Q: Does distill failure fail the task? → A: No. DISTILL failure MUST NOT fail `record-result`, MUST NOT roll back forge state, and MUST NOT change exit code after a successful save.
- Q: Is SQLite required at runtime? → A: No. Markdown under `.superspec/patterns/` is canonical. SQLite FTS is a derived index. If `better-sqlite3` is missing, fails to load, or the index cannot be opened, RETRIEVE and distill MUST use markdown (capped scan for RETRIEVE); doctor warns; forge calls continue.
- Q: Where does CONSOLIDATE run? → A: CONSOLIDATE MUST NOT run on the `record-result` stack. It may run after async DISTILL completes or on a lazy schedule — never blocking forge return.
- Q: Hook throws? → A: Learning hooks run inside `registerCommandPlaneHooks` try/catch (OD-015). A throw becomes deny/closed-hook semantics for in-flight steer paths; it MUST NOT exit the MCP server or undo a prior successful `saveState`.
- Q: Slice A and P-003 writes? → A: Until doctor reports `sliceAValidated: true`, P-003 distill/consolidate pattern writes are no-op `SLICE_A_ONLY` with no pattern file side effect. Forge `record-result` after `saveState` stays live; deferred distill hook is skipped under Slice A rules (OD-020).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST run a **DISTILL** step after each forge `record-result` (pass or fail) that extracts at least one reusable pattern — success lesson or failure lesson — from the task outcome. DISTILL MUST be scheduled only after forge `saveState` succeeds and the forge success response is returned; the handler MUST NOT await DISTILL, a distill hard timeout, or CONSOLIDATE on the `record-result` stack. *(LR-001, OD-016)*
- **FR-001a**: DISTILL failure MUST NOT fail `record-result`, MUST NOT roll back forge state, and MUST NOT change forge exit code after a successful save. Failures MUST be logged; no partial or corrupt pattern write. *(OD-016)*
- **FR-002**: System MUST persist distilled patterns **outside worker conversational context** in a durable store under project-local and/or user-local SuperSpec data paths. *(LR-002)*
- **FR-003**: On `route-model`, `begin-task`, or worker brief generation, system MUST **RETRIEVE** patterns whose signals match the current task context and inject a bounded summary into the worker brief. *(LR-003)*
- **FR-004**: The learning pipeline MUST implement **RETRIEVE → JUDGE → DISTILL → CONSOLIDATE** phases consistent with lean Ruflo intelligence semantics; LoRA, EWC, or other mandatory neural fine-tuning MUST NOT be required. *(LR-004, NG4)*
- **FR-005**: Each pattern MUST be keyed or indexed by one or more signals: FR tags, task kind, language/stack, failure reason, and/or engine. *(LR-005)*
- **FR-006**: Worker context compaction or clear MUST NOT delete, truncate, or relocate the pattern store. *(LR-006)*
- **FR-007**: DISTILL output MUST be size-bounded and MUST NOT persist secrets, credentials, API keys, or full raw transcripts. *(LR-001, NFR-002)*
- **FR-008**: The **JUDGE** phase MUST score or filter retrieved candidates for relevance; patterns below threshold MUST NOT appear in injected brief summaries. *(LR-004)*
- **FR-009**: The **CONSOLIDATE** phase MUST merge or demote duplicate and near-duplicate patterns within the same signal bucket to limit store noise. *(LR-004)*
- **FR-010**: Pattern store persistence MUST use a hybrid backend. Canonical records MUST be human-readable markdown files under `<repository-root>/.superspec/patterns/`. A derived SQLite full-text index at `<repository-root>/.superspec/patterns/index.sqlite` SHOULD serve RETRIEVE and the read-only query surface when the binding loads. Markdown is the source of truth. If `better-sqlite3` is missing, the native module fails to load, or the index cannot be opened, RETRIEVE and distill MUST use markdown files (RETRIEVE via capped markdown scan) and MUST NOT fail the forge call; doctor MUST surface a warning (e.g. `PATTERNS_INDEX_UNAVAILABLE`). The index MUST be rebuildable from markdown and gitignored. v1 MUST NOT require a local embeddings model or a vector index. *(LR-002, OPEN-004 resolved, OD-016)*
- **FR-011**: Learning hooks MUST extend existing forge MCP/CLI tools (`begin-task`, `record-result`, `route-model`) without breaking standalone SuperSpec usage when Command Plane is absent. Hook implementations MUST NOT crash or exit the forge MCP process on throw; exceptions are caught at the P-001 hook boundary per OD-015. *(SS-002)*
- **FR-011a**: **CONSOLIDATE** MUST NOT run on the `record-result` call stack; it MAY run after async DISTILL or on a lazy schedule only. *(OD-016)*
- **FR-012**: System MUST expose a **read-only** pattern list or query surface (CLI and/or MCP) consumable by P-001 Command Plane API and P-002 Command Center memory views.
- **FR-013**: Each pattern record MUST include evidence references (e.g., task id, report paths) traceable to the originating forge outcome. *(§8.3 Pattern model)*
- **FR-014**: Operator SHOULD be able to disable learning (distill and/or retrieve) per feature or globally via configuration without removing existing stored patterns.

### Key Entities

- **Pattern**: A distilled reusable lesson. Attributes: id, created/updated timestamps, kind (`success` | `failure` | `routing`), signals (FR tags, task kind, stack, engine, error class), bounded summary (markdown), evidence refs, optional score and use count.
- **PatternStore**: Durable partition holding patterns for a project or scope; survives worker compaction; canonical markdown under `<repository-root>/.superspec/patterns/` with a derived, rebuildable SQLite FTS index per FR-010.
- **RetrieveContext**: Inputs for RETRIEVE/JUDGE — target task id, implements FR list, task kind, stack tags, engine, optional error class from prior attempt.
- **InjectionSummary**: Bounded text block appended to worker brief; max size configurable; produced only after JUDGE approval.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a forge task completes and worker context is cleared, a distilled pattern from that task is discoverable via store query or next-task retrieval without re-reading the prior worker transcript (100% in acceptance test scenarios).
- **SC-002**: When matching patterns exist, worker briefs include at least one injected pattern summary; when none match, brief generation succeeds with zero injections (no false injections in either case).
- **SC-003**: Pattern store retains 100% of written patterns across 10 consecutive worker context compactions in a controlled test sequence. *(LR-006)*
- **SC-004**: Near-duplicate patterns (same signal bucket, ≥80% summary overlap) consolidate to one canonical entry within one CONSOLIDATE cycle in acceptance tests.
- **SC-005**: Injected pattern summaries remain within the configured size cap (default ≤2 KB combined) on every brief in acceptance tests.
- **SC-006**: Full learning loop (RETRIEVE→JUDGE→DISTILL→CONSOLIDATE) operates with zero LoRA/EWC/neural-training dependencies installed.
- **SC-007**: Downstream P-001 can consume the read-only pattern query surface without direct filesystem access to store files.

## Assumptions

- Lean Ruflo intelligence semantics are the behavioral reference; SuperSpec does not vendor the Ruflo plugin as a runtime dependency.
- Pattern store v1 uses a **hybrid backend**: markdown canonical files under `<repository-root>/.superspec/patterns/` plus a derived SQLite full-text index at `<repository-root>/.superspec/patterns/index.sqlite` (gitignored, rebuildable from markdown).
- Munder `memory.ts` / `memory.md` is a **markdown-layer design reference only** — not a runtime dependency.
- v1 retrieval uses signal matching and SQLite FTS only; **no local embeddings model or vector index** is required.
- DISTILL may use the coordinator engine or an economy-tier model via existing `route-model` policy; dedicated distill model selection is out of scope for this spec.
- Default store scope is **project-local** (per feature workspace); user-global cross-project memory is deferred.
- CONSOLIDATE MUST NOT block forge `record-result` return; it runs after async DISTILL or on a lazy schedule, never on the `record-result` stack (OD-016).
- DISTILL uses a hard timeout in the background worker; timeout abandons distill with log only and does not affect forge outcome.
- Pattern scoring (`useCount`, relevance decay) follows simple heuristics in v1 — no mandatory ML ranking.
- Command Center UI for browsing patterns is owned by P-002; this feature delivers store + hooks + read API only.

<!-- Adapted from SK: templates/spec-template.md (MIT). See /NOTICE. -->
