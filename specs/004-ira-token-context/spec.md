# Feature Specification: Ira Token Context

**Feature Branch**: `004-ira-token-context`

**Created**: 2026-09-06

**Status**: Draft

**Type**: platform

**Input**: P-004 — Ira token/context governor: durable cost ledger, per-agent and per-feature budgets, circuit breaker (steer → constrain → stop), context-window gauges, compact-or-clear on `record-result`, pre-dispatch cost forecast, and quota-aware routing hints. Keep SuperSpec `route-model` tiers `economy` | `standard` | `frontier`. Prefer adapting Munder cost/budget/circuit-breaker patterns. Compaction is semantic (task-boundary), not a raw token watermark.

## Required Reading

| Path | Reason |
|------|--------|
| `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md` | Parent TK-* requirements (§6.4), HITL spend class (§5.3), spend data model (§8.4), journey §9.4, NFR-003 |
| `docs/superspec/specs/ira-prior-art-reuse-map.md` | Reuse map — Munder cost ledger / CostHud / circuit breaker paths to adapt |
| `program.md` | P-004 row, OD-004 adapt-first, SuperSpec model-tier index |
| `docs/explanation/dispatch-and-context.md` | Fresh-subagent default; filesystem survives compaction |
| `docs/explanation/traceability-spine.md` | FR ↔ task ↔ test spine for downstream plan |
| `packages/core/src/model-router.ts` | Existing `route-model` economy/standard/frontier contract — do not replace |
| `packages/core/src/forge-loop.ts` | `record-result` is the semantic compact-on-complete hook |
| `specs/001-ira-command-plane/spec.md` | Command Plane API + Ask-Me consume budget/breaker events |
| `specs/002-ira-command-center/spec.md` | Command Center renders spend HUD and worker gauges from this contract |
| `specs/003-ira-learning-memory/spec.md` | Pattern store MUST survive compaction (LR-006) |
| https://munderdiffl.in/blog/command-center-guide/ | Per-agent budgets, steer→constrain→stop, context-window gauges, transcript cost ledger |
| https://blakecrosley.com/blog/agent-context-compaction | SelfCompact research — semantic task-boundary compaction (cite only, not a dependency) |
| https://pydantic.dev/docs/ai/harness/compaction/ | Tiered cheap→expensive compaction research (cite only, not a dependency) |

## Prior Art / Reuse

Prefer **adapt** over invent (OD-004). Formal FRs stay WHAT/WHY; paths below guide later `architect` / `forge`. Preserve MIT attribution. Do **not** vendor research repos or Munder pixel/Electron chrome.

| Concern | Adapt / cite |
|---------|----------------|
| Durable transcript cost ledger | Munder `src/main/costLedger.ts` |
| Live spend accumulation | Munder `src/main/realtimeCost.ts` |
| Spend HUD / store contract | Munder `CostHud.tsx`, `costStore.ts` — **data contract only**; visual language is P-002 |
| Per-agent budgets, circuit breaker, context gauges | [Munder Command Center guide](https://munderdiffl.in/blog/command-center-guide/) |
| Semantic compaction at task complete | Blake Crosley SelfCompact essay — **research reference, not a dependency** |
| Tiered cheap→expensive compaction | PydanticAI harness compaction docs — **research reference, not a dependency** |
| Model tiers | SuperSpec `packages/core/src/model-router.ts` (`economy` \| `standard` \| `frontier`) |
| Compact-on-complete hook | SuperSpec `record-result` in `packages/core/src/forge-loop.ts` |
| Fresh workers vs coordinator memory | SuperSpec `docs/explanation/dispatch-and-context.md` |

**Out of scope for reuse in P-004**: Munder Electron shell and LimeZu assets; Pydantic or SelfCompact as runtime libraries; replacing `route-model` with vendor model IDs; Command Center pixel HUD (P-002); engine token-scraping adapters (P-006); pattern-store backend (P-003 / OD-002).

## Parent Requirements Crosswalk

| Parent ID | Summary | Maps to |
|-----------|---------|---------|
| TK-001 | Track tokens and estimated USD per agent, session, feature (durable ledger) | FR-001, FR-002 |
| TK-002 | Operator sets budgets per agent and/or feature; system enforces them | FR-003, FR-004 |
| TK-003 | Circuit breaker steer → constrain → stop on loops, errors, or budget breach | FR-005, FR-006, FR-007, FR-008 |
| TK-004 | Worker context-window gauge when measurable | FR-009, FR-010 |
| TK-005 | Compact or clear worker context on `record-result` (pass or fail) | FR-011, FR-014 |
| TK-006 | Semantic task-boundary compaction; tiered drop-noise → dedupe → summarize | FR-012, FR-013 |
| TK-007 | Forecast cost from similar past work; warn/confirm if over remaining budget | FR-015, FR-016 |
| TK-008 | `route-model` economy/standard/frontier remains default; Command Plane MAY override | FR-007, FR-017 |
| TK-009 | Quota/subscription signals influence routing (prefer local/economy when low) | FR-018, FR-019 |
| §5.3 | Spend-exceed and breaker stop are critical HITL (never silent-auto) | FR-004, FR-008, FR-016, FR-023 |
| §8.4 | SpendEvent conceptual model | FR-002, Key Entities |
| SS-002 | Extend forge tools; do not replace them | FR-021 |
| SS-004 | Fresh-subagent dispatch remains default | FR-022 |
| CP-001 / Option D | CLI/MCP expose the same state the UI will show | FR-020 |
| LR-006 | Compaction MUST NOT delete the pattern store | FR-014 |
| NFR-003 | Local state updates within ~1–2s | SC-006 |

**Explicitly deferred to sibling specs (not FRs here)**: CP/GD/HV hive ownership → P-001; Command Center spend/fleet chrome → P-002; DISTILL/RETRIEVE loop → P-003; hire manifests/budgets-on-hire form → P-005; engine token/quota adapters → P-006; Hermes/OpenClaw → P-007.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Durable cost ledger and budget enforcement (Priority: P1)

The Operator sets a token and/or USD budget on an agent and/or a feature. As workers run, Ira records tokens and estimated spend in a durable ledger keyed by agent, session, and feature. A dispatch that would exceed remaining budget does not start silently — Ira warns and requires Operator confirmation (Ask-Me / Command Plane).

**Why this priority**: Without a ledger and enforcement, every later governor (breaker, forecast, quota hints) has nothing to measure against. This is the MVP slice.

**Independent Test**: Seed spend events and a feature budget; query per-agent / per-session / per-feature totals without any Command Center UI; attempt a dispatch that would exceed remaining budget and confirm it is blocked pending Operator answer.

**Acceptance Scenarios**:

1. **Given** a feature with an explicit USD or token budget and at least one worker completing tool work, **When** spend is recorded, **Then** the durable ledger shows token counts and estimated USD rolled up by agent, session, and feature.
2. **Given** remaining feature budget is below the next dispatch's known or estimated cost, **When** Ira would start that dispatch, **Then** the system does not start it silently and opens a critical HITL item naming the budget, remaining amount, and requested work.
3. **Given** Command Center is not running, **When** the Operator queries spend and remaining budget via CLI or MCP, **Then** the same totals are returned as structured state.

---

### User Story 2 - Circuit breaker steer → constrain → stop (Priority: P1)

When a worker loops, error-storms, or burns through budget mid-task, Ira applies a three-stage circuit breaker: first **steer** (nudge wrap-up or a different approach), then **constrain** (cut spend/risk — lower model tier within SuperSpec tiers and/or limit further context/tool growth), then **stop** (halt the worker and escalate to the Operator).

**Why this priority**: Budget caps alone do not stop runaway loops; the breaker is the safety governor that protects quality and spend.

**Independent Test**: Inject a looping worker, an error-storm worker, and an in-flight budget-breach worker as three fixtures; observe steer, then constrain, then stop with a persisted halt reason and Ask-Me item — no silent continue after stop.

**Acceptance Scenarios**:

1. **Given** a worker emitting repeated identical tool/error cycles, **When** the first breaker window fires, **Then** Ira **steers** (notifies wrap-up or approach change) and the worker is still allowed to continue.
2. **Given** steer already fired and the same trigger persists, **When** the next window fires, **Then** Ira **constrains** by lowering the model tier within `economy` \| `standard` \| `frontier` and/or limiting further context/tool growth, and records the constraint.
3. **Given** constrain already fired and the trigger still persists (or remaining budget is exhausted), **When** the next window fires, **Then** Ira **stops** the worker, persists the reason, and opens a critical HITL item; no further silent dispatch occurs for that worker until the Operator answers.

---

### User Story 3 - Compact on `record-result` at a semantic boundary (Priority: P1)

When a task completes — pass or fail — Ira treats `record-result` as the semantic boundary and **compacts or clears** that worker's conversational context. Compaction prefers cheap steps first (drop tool noise, then dedupe repeated reads) and summarizes only if residual context still exceeds a bound. The spend ledger and persisted patterns survive.

**Why this priority**: Token rot is a primary Ira goal (G6). Fresh workers remain the default; compaction is the in-session complement so a reused worker does not carry a whole forge in chat.

**Independent Test**: Complete one passing and one failing `record-result`; verify a compact-or-clear action is recorded for that worker; query the spend ledger and pattern store and confirm both still return pre-compaction records.

**Acceptance Scenarios**:

1. **Given** a worker has conversational context from task `T001`, **When** `record-result` records a pass, **Then** the system compact-or-clears that worker's conversational context and writes a compaction record naming the task and strategy used.
2. **Given** a worker has conversational context from task `T002`, **When** `record-result` records a fail, **Then** the same compact-or-clear duty runs — failure does not skip compaction.
3. **Given** patterns and spend events existed before compaction, **When** compact-or-clear finishes, **Then** the pattern store and spend ledger still return those records (compaction MUST NOT delete durable learning or spend).

---

### User Story 4 - Context-window gauges (Priority: P2)

Each worker exposes a context-window utilization gauge (or equivalent) when the engine can measure it, so the Operator and Command Center can see who is near the window. When measurement is unavailable, the gauge is explicitly unavailable — not a fake zero.

**Why this priority**: Floor visibility without guessing; depends on ledger identity (P1) but is independently demonstrable.

**Independent Test**: Publish a measured utilization for worker A and an unknown measurement for worker B; CLI/MCP returns a ratio/percent for A and an unavailable state for B.

**Acceptance Scenarios**:

1. **Given** an engine reports context used and context limit for a worker, **When** a consumer queries gauges, **Then** that worker's utilization is available as a bounded ratio or percent.
2. **Given** an engine does not report context use, **When** a consumer queries gauges, **Then** that worker's gauge state is `unavailable` (or equivalent) and MUST NOT be presented as 0% used.
3. **Given** Command Center is later attached (P-002), **When** it renders a worker card, **Then** it consumes this gauge contract and does not invent a second measurement source.

---

### User Story 5 - Cost forecast before dispatch (Priority: P2)

Before Ira starts a worker, it forecasts expected cost from similar past spend (same feature, task kind, and/or engine when history exists). If the forecast exceeds remaining budget, Ira warns and requires Operator confirmation.

**Why this priority**: Prevents the “start then slam the breaker” failure mode; valuable once the ledger has history.

**Independent Test**: Seed two completed similar tasks with recorded spend; request a forecast for a third similar dispatch; confirm a forecast is produced and that an over-budget forecast requires confirmation.

**Acceptance Scenarios**:

1. **Given** at least two prior completed tasks with the same task kind (and feature or engine when present) and recorded spend, **When** Ira prepares a new similar dispatch, **Then** it produces a cost forecast (tokens and/or USD) before start.
2. **Given** a forecast that exceeds remaining agent or feature budget, **When** dispatch is requested, **Then** Ira warns with forecast vs remaining and requires Operator confirmation — it MUST NOT start silently.
3. **Given** no similar history exists, **When** dispatch is requested, **Then** forecast is omitted or marked `insufficient-history`; routing still proceeds under live budget enforcement (Story 1).

---

### User Story 6 - Quota-aware routing hints without replacing `route-model` (Priority: P3)

`route-model` continues to recommend only `economy`, `standard`, or `frontier`. When a quota or subscription-remaining signal is available and low, Ira prefers economy (or a local/BYOK path when that engine is available) over frontier. Command Plane MAY override the recommended tier per agent assignment; the override is recorded. Missing quota signals do not block routing.

**Why this priority**: Subscription awareness is required (TK-009) but depends on engine/quota adapters (P-006) and must not fork SuperSpec's tiering.

**Independent Test**: Call `route-model` and confirm only the three tiers; inject a low-quota signal and confirm the routing hint prefers economy/local; inject no quota signal and confirm default `route-model` still returns; record an Operator override and confirm it is persisted.

**Acceptance Scenarios**:

1. **Given** a mechanical first-attempt implementer task and no quota signal, **When** `route-model` runs, **Then** the recommendation is the existing SuperSpec tier (`economy` for mechanical attempt 1) and no new tier names appear.
2. **Given** a known low remaining quota or subscription, **When** Ira produces a routing hint, **Then** the hint prefers `economy` (or local/BYOK when that path is available) over `frontier`, unless a recorded Operator override says otherwise.
3. **Given** Command Plane assigns an agent a tier other than the `route-model` recommendation, **When** the assignment is stored, **Then** the override (requested tier, reason, actor) is recorded and later breaker **constrain** may still lower the tier within the same three-tier set.

---

### Edge Cases

- What happens when an engine reports no token usage? Record an estimate source (or `unknown` tokens with USD omitted) rather than inventing precise counts; budget enforcement still applies to whatever is known.
- What happens when the Operator lowers a budget below already-spent amount? Remaining becomes zero; in-flight work enters the circuit breaker; new dispatch requires HITL.
- What happens when agent budget and feature budget disagree? The **tighter remaining cap** wins.
- What happens when several workers share one feature budget? Spend is summed across workers; a dispatch that would exceed the shared remainder is blocked or confirmed as in Story 1.
- What happens when compaction is unsupported by the engine? Attempt clear; if neither compact nor clear is possible, record `compact-skipped` with reason — task completion still succeeds; ledger and patterns are untouched.
- What happens when DISTILL (P-003) and compact both hook `record-result`? Distill durable patterns **before** compact/clear conversational context; compact MUST NOT race-delete inputs DISTILL still needs.
- What happens on a stale or missing quota signal? Routing uses `route-model` defaults; no hard fail (FR-019).
- What happens if Operator override conflicts with breaker constrain? Breaker MAY still lower the tier within `economy` \| `standard` \| `frontier`; it MUST NOT invent a fourth tier; the constrain event is recorded.
- What happens in **Observe** mode? Breaker still steers/constrains/stops (safety); dispatch start remains human-initiated; budget-exceed still HITL.
- What happens if forecast history is from a different engine or wildly different task kind? Do not treat it as similar; fall back to `insufficient-history`.
- What happens if spend-event parse is partial (tokens without USD, or the reverse)? Persist what is known; mark missing fields; do not drop the event.

## Requirements *(mandatory)*

### Functional Requirements

#### Ledger and budgets

- **FR-001**: System MUST persist a durable spend ledger that tracks **token counts and estimated USD cost** per agent, per session, and per feature. *(TK-001)*
- **FR-002**: Each spend event MUST record agent, session, feature (when known), engine, model, input tokens, output tokens, estimated USD (when computable), timestamp, and source class (`transcript` \| `api` \| `estimate`). *(TK-001, §8.4)*
- **FR-003**: Operator MUST be able to set **token and/or USD budgets** per agent and/or per feature; unset budget means no cap; an explicit zero remaining cap MUST block new silent dispatch. *(TK-002)*
- **FR-004**: System MUST **enforce** budgets: a dispatch that would exceed remaining agent or feature budget MUST NOT proceed silently — it MUST warn and require Operator confirmation (critical HITL). *(TK-002, §5.3)*

#### Circuit breaker

- **FR-005**: System MUST implement a three-stage circuit breaker — **steer**, then **constrain**, then **stop** — when it detects runaway loops, repeated errors, or in-flight budget breach. *(TK-003)*
- **FR-006**: **Steer** MUST notify the worker and Operator to change approach or wrap up **without** halting the current task. *(TK-003)*
- **FR-007**: **Constrain** MUST reduce spend or risk while allowing the current task to continue: lower the model tier within `economy` \| `standard` \| `frontier` and/or limit further conversational-context or tool-noise growth. *(TK-003, TK-008)*
- **FR-008**: **Stop** MUST halt the worker, persist the halt reason, and escalate to the Operator as critical HITL; the worker MUST NOT resume silently. *(TK-003, §5.3)*

#### Context gauges

- **FR-009**: System MUST expose a **context-window utilization** measure per worker when the bound engine reports used and limit. *(TK-004)*
- **FR-010**: When utilization is not measurable, the system MUST expose an explicit **unavailable** state and MUST NOT present a fabricated zero. *(TK-004)*

#### Compaction

- **FR-011**: On every successful or failed forge `record-result`, the system MUST **compact or clear** that worker's conversational context. *(TK-005)*
- **FR-012**: Compaction MUST treat **task completion** as the primary semantic boundary; a raw token watermark MUST NOT be the only or default trigger. *(TK-006)*
- **FR-013**: Compaction MUST apply a cheap-to-expensive tier: drop tool noise first, then deduplicate repeated reads, then summarize only if residual conversational context still exceeds a configured bound. *(TK-006)*
- **FR-014**: Compaction or context clear MUST NOT delete, truncate, or relocate the spend ledger, budgets, circuit-breaker history, or the persisted pattern store. *(TK-005, LR-006)*

#### Forecast and routing

- **FR-015**: Before dispatch, the system SHOULD **forecast** expected cost from similar past spend (same feature, task kind, and/or engine when history exists). *(TK-007)*
- **FR-016**: If forecasted cost exceeds remaining agent or feature budget, the system MUST warn and require Operator confirmation before dispatch. *(TK-007, §5.3)*
- **FR-017**: `route-model` MUST remain the default tiering of **economy**, **standard**, and **frontier**; Command Plane MAY override the recommended tier for a specific agent assignment and MUST record the override (tier, reason, actor). *(TK-008)*
- **FR-018**: When quota or subscription remaining is known and below the configured low threshold, routing MUST prefer `economy` (or a local/BYOK path when that engine is available) over `frontier`, unless a recorded Operator override applies. *(TK-009)*
- **FR-019**: Missing or stale quota signals MUST NOT block routing; the system MUST fall back to `route-model` defaults. *(TK-009)*

#### Platform contract

- **FR-020**: CLI and MCP MUST expose current spend, remaining budget, circuit-breaker stage, cost forecast, and context gauges **without** requiring the Command Center UI. *(CP-001, Option D)*
- **FR-021**: Existing SuperSpec forge tools (`next-task`, `begin-task`, `record-result`, `sync-status`, `forge-status`, `coordinator-brief`, `route-model`, `build-matrix`, lints) MUST remain valid; this feature MUST extend them rather than replace them. *(SS-002)*
- **FR-022**: Fresh-subagent dispatch MUST remain the default worker execution model where the host harness supports it; compaction is complementary, not a substitute for fresh workers. *(SS-004)*
- **FR-023**: Budget-exceed confirmations and circuit-breaker **stop** events MUST be queryable as Command Plane / Ask-Me critical items (same inbox P-001 owns). *(§5.3, GD-003)*

### Key Entities

- **SpendEvent**: One observed or estimated cost increment — timestamp, agent, session, feature, engine, model, input/output tokens, USD estimate, source (`transcript` \| `api` \| `estimate`).
- **Budget**: Operator-set cap — scope (`agent` \| `feature`), unit (`tokens` \| `usd`), amount, remaining (derived), unset = unlimited.
- **CircuitBreakerState**: Per-worker (and optionally per-feature) stage `clear` \| `steer` \| `constrain` \| `stop`, trigger class (`loop` \| `errors` \| `budget`), windows fired, halt reason.
- **ContextGauge**: Per-worker utilization when measurable; otherwise explicit `unavailable`.
- **CostForecast**: Pre-dispatch estimate from similar past SpendEvents — expected tokens/USD, similarity basis, or `insufficient-history`.
- **RoutingHint**: Optional quota-aware advice that may prefer economy/local; never introduces a fourth `route-model` tier.
- **TierOverride**: Recorded Command Plane assignment that differs from `route-model` — requested tier, reason, actor, time.
- **CompactionRecord**: Proof that compact-or-clear ran after `record-result` — task id, pass/fail, strategy (`drop-tool-noise` \| `dedupe-reads` \| `summarize` \| `clear` \| `compact-skipped`), timestamp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a task completes, an Operator can retrieve per-agent, per-session, and per-feature token counts and estimated USD from the durable ledger without reopening the original worker chat (100% of ledger acceptance scenarios).
- **SC-002**: In test scenarios, a dispatch whose recorded or forecasted cost would exceed remaining agent or feature budget proceeds **zero** times without explicit Operator confirmation.
- **SC-003**: For loop, error-storm, and in-flight budget-breach fixtures, the breaker reaches **stop** only after **steer** then **constrain**, and the halt reason is visible to the Operator in the same cycle.
- **SC-004**: 100% of `record-result` completions (pass and fail) produce a compact-or-clear (or explicit `compact-skipped`) CompactionRecord for that worker.
- **SC-005**: After compaction, 100% of previously written spend events and persisted patterns remain queryable in a 10-cycle compact test sequence.
- **SC-006**: When an engine reports context use, a CLI/MCP consumer can read utilization within 2 seconds of the last measured update on a local machine.
- **SC-007**: Given two prior similar tasks with recorded spend, a pre-dispatch forecast is produced; if it exceeds remaining budget, confirmation is required before start.
- **SC-008**: With quota remaining below the configured low threshold, the next routing hint prefers `economy` (or local/BYOK) over `frontier` unless a recorded override exists.
- **SC-009**: After this feature ships, `route-model` still returns only `economy` \| `standard` \| `frontier`, and existing forge tools remain callable without a Command Center.
- **SC-010**: Downstream P-001 and P-002 can consume spend, remaining budget, breaker stage, gauges, and forecast from this contract without inventing a second ledger.

## Assumptions

- **Adapt Munder, don't vendor Electron**: cost ledger, realtime spend, CostHud store semantics, and Command Center guide breaker/gauge behavior are the behavioral reference. SuperSpec implements the contract in core/MCP; P-002 owns visual HUD.
- **Research citations, not dependencies**: Blake Crosley SelfCompact and PydanticAI tiered compaction inform the semantic-boundary + cheap-to-expensive strategy. They MUST NOT be required packages.
- **Sibling ownership**: P-001 owns hive, Ask-Me, and event log write APIs this feature publishes into. P-002 renders spend/fleet chrome. P-003 owns pattern DISTILL/RETRIEVE. P-006 owns how engines emit tokens and quota signals. This spec consumes those signals when present.
- **Distill-then-compact**: When P-003 is present, DISTILL runs on `record-result` **before** conversational compact/clear.
- **Unset vs zero budget**: No budget configured = no cap (ledger still records). Explicit zero remaining = block silent dispatch.
- **Tighter cap wins**: When both agent and feature budgets exist, enforcement uses the smaller remaining amount.
- **Breaker windows (v1 default)**: First trigger window → steer; second → constrain; third → stop. Hard remaining-zero mid-task still walks the stages unless the Operator already denied further spend via HITL. Exact numeric loop/error thresholds are an architect default, documented in design, not a product fork.
- **Low-quota threshold (v1 default)**: Remaining quota or subscription ≤ 20% (configurable) counts as “low” for FR-018.
- **Forecast similarity (v1)**: Same task kind plus same feature or same engine, with at least two completed SpendEvent rollups. No embeddings required (P-003 may later enrich signals).
- **Spend source preference**: Observed API counts beat parsed transcript counts, which beat estimates.
- **Autonomy**: Default install mode remains **Supervised** (P-001). Observe still applies breaker safety. Autonomous still escalates budget-exceed and stop.
- **No new model tiers**: Quota hints and breaker constrain only move within `economy` \| `standard` \| `frontier` (plus optional local/BYOK engine choice owned by P-006).
- **Single Operator v1**: Shared team billing and multi-user quota pools are out of scope.

<!-- Adapted from SK: templates/spec-template.md (MIT). See /NOTICE. -->
