# Design: Ira Token Context

**Revision**: 2026-10-16 | **Status**: DRAFT | **Owner**: @composer

**Input**: Feature specification from `specs/004-ira-token-context/spec.md`

## Required Reading / Prior Art

| Path | Reason |
|------|--------|
| `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` | LOCKED — OD-010 dispatch path, OD-015 hook isolation, OD-020 Slice A token gates |

`docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` is LOCKED. If this design disagrees with that amendment, the amendment wins.

## Summary

P-004 implements Ira’s **token and context governor** inside `@superspec-dev/core`: a durable spend ledger, operator budgets (per agent and per feature), a three-stage circuit breaker (**steer → constrain → stop**), semantic **compact-or-clear** on forge `record-result`, pre-dispatch **cost forecast**, **quota-aware routing hints** that never replace SuperSpec’s `economy` | `standard` | `frontier` tiers, and **context-window gauges** with an explicit unavailable state.

The governor registers **`TokenHooks`** (`beforeDispatch`, `recordSpend`, `onRecordResult`) on the Command Plane hook registry defined in P-001. Budget exceed and breaker **stop** open Ask-Me items (`budget_exceed`, `circuit_breaker_stop`); Ira never silently approves those classes. Spend and breaker history live under **`.superspec/hive/token/`** on the main worktree (same hive root as P-001), not under per-feature `specs/<feature>/.superspec/`, because rollups are cross-feature and tied to hive roster and briefs. Forge task state stays in `specs/<feature>/.superspec/state.json`; the governor only reads feature identity and task metadata for forecast and enforcement.

Adapt-first (OD-004): ledger append semantics and realtime rollups follow Munder `costLedger.ts` / `realtimeCost.ts` behavior; breaker stages and gauges follow the [Munder Command Center guide](https://munderdiffl.in/blog/command-center-guide/). Compaction strategy is informed by Blake Crosley SelfCompact and PydanticAI tiered compaction docs as **research only** — no vendor runtime dependency.

Budget enforcement and forecast gates run **only** inside P-001 **`dispatch-task`** via `TokenHooks.beforeDispatch` (OD-010). Idle wake and away ticks call `dispatch-task`; they do not argv forge `begin-task` or call `beforeDispatch` on a side path.

## Production invariants (fail-closed)

| Invariant | Fail-closed behavior | Source |
|-----------|------------------------|--------|
| Unified dispatch gate | `TokenHooks.beforeDispatch` runs only as step 4 of **`dispatch-task`** after hive / hold / Ask-Me / CI / FR gates and before `EngineHooks.dispatch`. `{ allow: false }` stops the command — no dispatch hook, no `begin-task`. Board, idle wake, and away MUST use `dispatch-task`. While the hive exists, external `begin-task` returns `DISPATCH_PATH_REQUIRED` and does not enforce budgets. | OD-010, FR-024 |
| Failover re-gate | Every engine rung change inside `EngineHooks.dispatch` MUST call `beforeDispatch` again on the effective engine and model before spawn or `{ accepted: true }`. | OD-010 step 5 |
| Budget-metered failover | When agent or feature has a **numeric** budget cap (not null), automatic failover MUST NOT select a rung with `emitsTokenSignals: false` in the P-006 catalog. If no signal-capable rung remains, return deny / `{ accepted: false }` — no silent unmetered dispatch under an enforced cap. | FR-025, P-006 |
| Hook throw isolation | `registerCommandPlaneHooks` wraps token hooks in try/catch (OD-015). A throw MUST NOT exit the process or fail an unrelated forge tool after a successful `saveState`. `beforeDispatch` throw → `{ allow: false, reasonClass: "budget_exceed" }`, Ask-Me **`budget_exceed`**, optional `hook.failed` / `HOOK_FAILED_CLOSED` on the event log when writable. | OD-015, FR-026 |
| Deny opens Ask-Me | Forecast or budget deny from `beforeDispatch` (including hook-failure mapping) opens Ask-Me **`budget_exceed`** (weight 100); never silent-auto. Breaker **stop** remains `circuit_breaker_stop`. | FR-004, FR-016, FR-023 |
| Slice A token gate | Until `sliceAValidated: true`, `beforeDispatch` stays live: host engine → `{ allow: true }` with no spend ledger write; `byok` / `local` supervisor rung → `{ allow: false, reason: "SLICE_A_ONLY" }`. Spend append, breaker side effects, and compaction writes are no-op `SLICE_A_ONLY`. | OD-020 |

## Technical Context

**Language/Version**: TypeScript 5.5, Node.js ≥ 20, ESM (`"type": "module"`), NodeNext — same as `@superspec-dev/core` 0.2.x and P-001.

**Primary Dependencies**: Existing core only: `@modelcontextprotocol/sdk`, `zod`, Node built-ins (`node:fs/promises`, `node:path`, `node:crypto`). Reuses Command Plane modules from P-001 (`command-plane/store.ts`, `paths.ts`, `ask-me.ts`, `hooks.ts`) when present. No SQLite for the spend ledger (append-only JSONL matches hive event log pattern). No Electron, no HTTP server.

**Storage**: Append-only JSONL and atomic JSON under `<repository-root>/.superspec/hive/token/`. Hive must be initialized (P-001); when absent, token MCP tools return `HIVE_NOT_INITIALIZED` and forge tools behave as today (no invented spend).

**Testing**: Vitest in `packages/core/test/token-governor/`. Unit tests for rollups, tighter-cap enforcement, breaker stage transitions, forecast similarity, tier-down on constrain, compaction record emission. Integration tests with temp hive: seed spend, deny dispatch, steer→constrain→stop fixtures, `record-result` compact hook after mock distill. Contract tests for new MCP tools and extended `route-model` optional fields.

**Target Platform**: Local Node in the SuperSpec CLI and stdio MCP server `superspec`. Cross-harness via the same JSON tools P-001 exposes.

**Project Type**: Library modules + MCP tools + CLI subcommands inside `@superspec-dev/core`.

**Performance Goals**: Spend rollup and budget read for one feature + one agent complete in **< 50 ms** on local SSD for ≤ 10k spend lines (doctor warns above 50 MB JSONL). Gauge and spend queries satisfy **SC-006**: structured gauge state readable within **2 seconds** of last engine update (in-memory cache + atomic `gauges.json` write). `dispatch-task` step (`beforeDispatch` + forecast) on idle wake adds **< 200 ms** p95 when history ≤ 500 events.

**Constraints**: Local-first; hive gitignored. No fourth model tier. `route-model` remains the default tier recommender; hints and overrides only bias within the three tiers (plus optional local/BYOK **engine** choice owned by P-006, not a tier name). Compaction MUST NOT delete spend ledger, budgets, breaker history, or pattern store (P-003). Distill runs before compact (P-001 hook order). Critical HITL never auto-approves.

**Scale/Scope**: Single Operator, one hive, tens of agents, hundreds of tasks, multi-feature spend. v1 does not rotate or compact `spend.jsonl`; doctor warns above 50 MB and suggests export. Session ids group one worker run; feature ids namespace budgets and rollups.

## Architecture

### System Structure

The token governor is a **`token-governor/`** module namespace. At module load it calls `registerCommandPlaneHooks({ token: tokenHooksImpl })`. It does not replace forge handlers; it extends them through hooks and adds read/write MCP/CLI tools.

```text
Operator / host harness
  |  superspec CLI  or  MCP (existing + token-* tools)
  v
packages/core  mcp-server.ts / cli.ts
  |  route-model (unchanged default; optional quota + hint fields)
  |  record-result / begin-task / sync-status (unchanged stdout)
  v
command-plane/ (P-001)
  |  dispatch-task (board | CLI | MCP | idle wake | away tick)
  |    -> TokenHooks.beforeDispatch -> EngineHooks.dispatch -> begin-task
  |  record-result pipeline:
  |    1 LearningHooks.distill (P-003)
  |    2 TokenHooks.onRecordResult (compact/clear + compaction record)
  |    3 hive sync, replan, idle wake
  v
token-governor/
  ├── spend-ledger.ts      append SpendEvent, rollups
  ├── budgets.ts           caps, remaining, tighter-cap wins
  ├── breaker.ts           steer | constrain | stop
  ├── forecast.ts          similar-task cost estimate
  ├── routing-hints.ts     quota-aware hint; tier overrides
  ├── compaction.ts        semantic compact-or-clear orchestration
  ├── gauges.ts            context utilization cache
  ├── hooks-impl.ts        TokenHooks adapter
  └── index.ts
  |
  v
.superspec/hive/token/
  spend.jsonl, budgets.json, breakers.json, compaction.jsonl,
  gauges.json, tier-overrides.jsonl, settings.json
  |
  ^ EngineHooks (P-006): recordSpend source, compact/clear execution,
    context measurement events -> gauges
```

| Component | Responsibility |
|-----------|----------------|
| `spend-ledger.ts` | Append-only `SpendEvent` lines; idempotent `eventId`; rollups by agent, session, feature, task |
| `budgets.ts` | Merge brief + roster + explicit budget API; compute remaining; enforce tighter cap |
| `breaker.ts` | Detect loop / error-storm / in-flight budget breach; advance stage; emit hive events; open Ask-Me on stop |
| `forecast.ts` | Pre-dispatch estimate from similar completed tasks; `insufficient-history` when < 2 peers |
| `routing-hints.ts` | Low-quota bias toward `economy`; persist `TierOverride`; never emit a fourth tier |
| `compaction.ts` | Tiered strategies at task boundary; record `CompactionRecord`; invoke engine compact/clear when available |
| `gauges.ts` | Store measured ratio or `unavailable`; reject fabricated zero |
| `hooks-impl.ts` | `beforeDispatch`, `recordSpend`, `onRecordResult` wiring to Ask-Me and ledger |

Governance gates (TDD, traceability) remain in `constitution.md` and `superspec-validate`.

### Project Structure

#### Documentation (this feature)

```text
specs/004-ira-token-context/
├── spec.md
├── design.md            # this document
└── adr/                 # optional extracts; decisions below are normative
```

#### Source Code (repository root)

```text
packages/core/src/token-governor/
├── schema.ts
├── types.ts
├── spend-ledger.ts
├── budgets.ts
├── breaker.ts
├── forecast.ts
├── routing-hints.ts
├── compaction.ts
├── gauges.ts
├── hooks-impl.ts
├── rollup.ts
└── index.ts

packages/core/src/command-plane/hooks.ts   # TokenHooks types (P-001); P-004 implements
packages/core/src/mcp-server.ts            # register token-* tools; extend route-model args
packages/core/src/cli.ts                   # matching subcommands
packages/core/src/index.ts                 # re-export token governor types

packages/core/test/token-governor/
├── spend-ledger.test.ts
├── budgets.test.ts
├── breaker.test.ts
├── forecast.test.ts
├── compaction.test.ts
├── gauges.test.ts
├── hooks.test.ts
└── contracts.test.ts
```

**Structure Decision**: Single package extension (same rationale as P-001): hook registration must run in-process immediately after forge writes. A separate npm package would race the hive writer.

## Decisions

### Decision: Store governor state under `.superspec/hive/token/`, not per-feature `.superspec/`

**Rationale**:

Problem statement: FR-001 and FR-020 require durable ledger and CLI/MCP access; SC-010 requires P-001/P-002 to share one ledger contract.

Context: P-001 anchors machine state at `<main-worktree>/.superspec/hive/` (roster, briefs, ledger, events). Spend rolls up by **agent** (roster), **feature** (brief + hive ledger), and **session** (dispatch-scoped). Per-feature `specs/<feature>/.superspec/state.json` is forge-only and feature-scoped; duplicating spend there would fork totals when one agent works multiple features and violates Option D (one local API).

Layout:

```text
.superspec/hive/token/
├── settings.json              # breaker thresholds, lowQuotaPercent, compaction bounds
├── budgets.json               # explicit Budget rows (agent | feature); syncs with brief/roster
├── spend.jsonl                # append-only SpendEvent
├── breakers.json              # map workerKey -> CircuitBreakerState
├── compaction.jsonl           # append-only CompactionRecord
├── gauges.json                # map workerKey -> ContextGauge snapshot
├── tier-overrides.jsonl       # append-only TierOverride
└── locks/                     # spend.lock, breakers.lock (same wx lock pattern as P-001)
```

Brief `budgetTokens` / `budgetUsd` and roster `budgetTokens` / `budgetUsd` are **mirrors**: `budgets.json` is authoritative for enforcement; `brief-submit` and roster updates upsert the same caps. Unset (`null`) means unlimited for that unit; **remaining zero** blocks silent dispatch.

Forge coordinator files and pattern store (P-003) are never truncated by compaction code paths in this module.

**Alternatives considered**:

- **`specs/<feature>/.superspec/spend.jsonl`**: Rejected. Cross-feature agent rollups and single CLI surface would require merging N files; conflicts with OD-007 single hive root.
- **SQLite spend table**: Rejected for v1. P-003 owns SQLite for patterns; hive stays inspectable JSON/JSONL without a driver.
- **In-memory only ledger**: Rejected. FR-001 and SC-001 require durability across worker restarts.

### Decision: Implement P-004 as `TokenHooks` on `dispatch-task` only (OD-010)

**Rationale**:

Problem statement: FR-021 and FR-024 require extending forge without a second steer path; P-001 owns unified `dispatch-task`.

Context: The only steer command that may invoke budget enforcement is **`dispatch-task`**. Internal order (no bypass): resolve hive and pre-dispatch gates → build `DispatchIntent` → `LearningHooks.retrieve` (when registered) → **`TokenHooks.beforeDispatch`** → **`EngineHooks.dispatch`** → forge **`begin-task`** only when the hook allowed and dispatch returned `null` or `{ accepted: true }`. Deny returns `{ allow: false, reasonClass: "budget_exceed", detail }` (or `SLICE_A_ONLY` under Slice A); Command Plane opens Ask-Me **`budget_exceed`** for budget-class denies. `recordSpend` is invoked when engines report usage (P-006) and by internal estimates when only partial data exists. `onRecordResult` runs **after** `LearningHooks.distill` and performs compact-or-clear plus `CompactionRecord`.

When the hive is absent, hooks are not registered and behavior matches pre–P-004 core. When the hive exists but budgets are unset, the ledger still records; enforcement only blocks when remaining cap is zero or a forecast/dispatch check would exceed remaining (FR-004, FR-016).

**Alternatives considered**:

- **Wrap MCP `begin-task` only**: Rejected and **non-conformant** under OD-010. Idle wake and away MUST call `dispatch-task`, not argv `begin-task`.
- **Replace `route-model`**: Rejected. FR-017 and SC-009 forbid new tier names.

### Decision: Budget-metered failover requires token signals (FR-025)

**Rationale**:

Problem statement: Numeric budgets are meaningless if failover silently lands on a rung that cannot emit usage.

Context: P-006 catalog entries expose `emitsTokenSignals: boolean` (default `true` for subscription/API engines; `false` for opaque local shells until P-006 reports usage). When **either** enforced scope has a numeric cap in `budgets.json` or brief/roster mirror, `EngineHooks.dispatch` failover logic MUST skip rungs with `emitsTokenSignals: false`. Each accepted rung change re-runs `beforeDispatch` with the effective engine and model (OD-010 step 5). If the ladder exhausts without a signal-capable rung, return `{ accepted: false, reason: "budget_unmetered_rung" }` (or equivalent) — do not spawn. Doctor MAY emit `budget_unmetered` when a numeric brief budget exists and the token hook is absent; under an active hook, failover MUST NOT bypass metering.

**Alternatives considered**:

- **Fail open to local opaque engine**: Rejected. Violates TK-002 and FR-025.
- **Block all dispatch without API tokens**: Rejected. Unset budget still allows dispatch with estimates and `unknown` source class (spec edge cases).

### Decision: Hook failure mapping for `beforeDispatch` (OD-015)

**Rationale**:

Problem statement: FR-026; a thrown forecast or ledger read must not take down forge or MCP.

Context: `hooks-impl.ts` does not catch internally — P-001 `registerCommandPlaneHooks` wraps all token hooks. On throw from `beforeDispatch`, the catch path returns `{ allow: false, reasonClass: "budget_exceed", detail: { hookFailed: true, reason: "HOOK_FAILED_CLOSED" } }`, appends `hook.failed` when the event log is writable, and opens Ask-Me **`budget_exceed`**. The in-flight `dispatch-task` command returns a non-zero / `ok: false` outcome; hive status stays unchanged; no `begin-task`. A prior forge `saveState` success from another tool remains success.

**Alternatives considered**:

- **Process exit on hook throw**: Rejected. OD-015 forbids.
- **Silent allow on throw**: Rejected. Fail-closed; Operator sees `budget_exceed` Ask-Me.

### Decision: Circuit breaker v1 thresholds and stage machine

**Rationale**:

Problem statement: FR-005–FR-008 and spec assumptions require steer → constrain → stop with persisted halt reason.

Context: Breaker state is keyed by **`workerKey`** = `{agentId}:{sessionId}` (sessionId assigned at dispatch acceptance, stored on hive task row extension field `sessionId` optional on sync). Triggers:

| Trigger class | Detection (rolling window **60 s**) | Notes |
|---------------|-------------------------------------|-------|
| `loop` | ≥ **3** events with same `(toolName \| errorCode)` hash | From `EngineHooks.normalizeEvent` or internal tool telemetry |
| `errors` | ≥ **5** error-class events | Same window |
| `budget` | Remaining USD or tokens for enforced scope hits **0** while task `doing` | Uses live rollup |

Stage transitions on repeated trigger evaluation (each evaluation window after a trigger fires counts as one **breaker window**):

```text
clear --(trigger)--> steer --(same trigger persists next window)--> constrain --(persists)--> stop
```

- **Steer (FR-006)**: Append `token.breaker_steer` event; post mailbox hint to worker (`kind: handoff`, body summarizes wrap-up); task stays `doing`; no Ask-Me yet.
- **Constrain (FR-007)**: Lower effective tier one step within tiers: `frontier→standard`, `standard→economy`, `economy→economy`; set `constrainContextGrowth: true` on breaker state (engines SHOULD trim tool-noise on next turn — P-006); append `token.breaker_constrain`; record effective tier on task replan metadata when present.
- **Stop (FR-008)**: Set roster agent `blocked` if workerKey maps to agent; append `token.breaker_stop`; open Ask-Me `circuit_breaker_stop` (additive enum, weight **95**, between `budget_exceed` and `destructive_git`); no further dispatch for that worker until Operator resolves.

Operator **tier override** (FR-017) may request `frontier`; constrain may still lower within the three tiers for safety; override is not deleted.

Observe mode: breaker still runs (spec edge case); dispatch start remains human-initiated.

**Alternatives considered**:

- **Single-shot stop**: Rejected. SC-003 requires steer then constrain before stop.
- **Hard-coded vendor model downgrade**: Rejected. Only abstract tiers via `routeModel` / `ModelTier`.

### Decision: Semantic compaction on `onRecordResult`

**Rationale**:

Problem statement: FR-011–FR-014; compaction at task boundary, not raw watermark-only.

Context: On every pass/fail `record-result` (hive present, hook registered):

1. Build `CompactionContext` from `{ featureId, taskId, passed, reviewFailures, agentId, sessionId }`.
2. Run tiered strategy until residual bound satisfied or engine cannot compact:
   - **`drop-tool-noise`**: Strip verbose tool I/O from conversational scratch (engine adapter when P-006 present; else record-only plan for host).
   - **`dedupe-reads`**: Collapse repeated file-read chunks in scratch.
   - **`summarize`**: Only if estimated residual tokens > `settings.compactionSummarizeThresholdTokens` (default **8000**).
   - **`clear`**: If engine supports clear session, clear conversational scratch entirely.
   - **`compact-skipped`**: Neither compact nor clear available — task completion still succeeds.
3. Append `CompactionRecord` to `compaction.jsonl`.
4. Never delete or rewrite `spend.jsonl`, `budgets.json`, `breakers.json`, or P-003 pattern files.

P-003 `distill` completes before this hook (P-001 order); compact must not read distiller temp files.

**Alternatives considered**:

- **Watermark-only compaction**: Rejected as sole trigger (FR-012); may be used inside `summarize` step only.
- **Vendor SelfCompact library**: Rejected. Research citation only.

### Decision: Cost forecast and dispatch gate

**Rationale**:

Problem statement: FR-015, FR-016, FR-007.

Similarity rule (v1): same **task kind** from plan, and same **featureId** OR same **engine** on historical rollups; require ≥ **2** completed tasks (`forge status done`) with at least one `SpendEvent` each. Forecast value = median of total tokens and median USD (ignoring null USD for median if ≥ half missing).

`beforeDispatch` checks:

1. Effective remaining = min(agent remaining, feature remaining) per unit when both set (tighter cap wins).
2. If forecast present and forecast > remaining → `{ allow: false, reasonClass: "budget_exceed", detail }`.
3. If no forecast (`insufficient-history`), still block when **known** dispatch estimate from caller exceeds remaining (optional `estimatedTokens` / `estimatedUsd` on `DispatchContext` extension).

Idle wake calls `dispatch-task`, which passes plan task kind and feature into forecast inside `beforeDispatch`.

**Alternatives considered**:

- **Embedding similarity**: Deferred to P-003 enrichment.
- **Block all dispatch without history**: Rejected. Spec allows proceed with live enforcement only.

### Decision: Context gauges and unavailable state

**Rationale**:

Problem statement: FR-009, FR-010, SC-006.

`gauges.json` stores per `workerKey`: `{ state: "measured", usedTokens, limitTokens, ratio }` where `ratio = usedTokens/limitTokens` clamped [0,1], or `{ state: "unavailable", reason }`. Updates via `token-gauge-report` MCP/CLI (P-006 calls same) or `EngineHooks.normalizeEvent` types `context.usage`. **Never** write `ratio: 0` when measurement is unknown.

In-memory cache mirrors last write for fast read; flush to disk on update (atomic replace) for CLI consistency.

**Alternatives considered**:

- **Infer gauge from spend**: Rejected. FR-009 requires engine-reported window use.

### Decision: Quota-aware routing hint without changing `route-model` core

**Rationale**:

Problem statement: FR-017–FR-019, FR-018 default low quota ≤ **20%** (`settings.lowQuotaPercent`).

`routeModel()` implementation in `model-router.ts` is unchanged. MCP `route-model` gains optional inputs: `quotaRemainingPercent?: number`, `operatorOverrideTier?: ModelTier`. Response adds optional:

```json
{
  "tier": "standard",
  "routingHint": { "preferredTier": "economy", "reason": "low_quota" },
  "quotaApplied": true
}
```

When quota is low, hint prefers `economy` (or documents local/BYOK engine preference flag for P-006 — not a tier). Missing quota → `quotaApplied: false`, hint omitted. `TierOverride` append records Command Plane assignments that differ from recommendation.

**Alternatives considered**:

- **New tier `local`**: Rejected. FR-017 forbids fourth tier name in `route-model` output.

### Decision: Ask-Me class extension for breaker stop

**Rationale**:

Problem statement: FR-023 requires breaker stop as critical HITL distinct from budget exceed when trigger is loop/errors.

Add `circuit_breaker_stop` to Ask-Me `reasonClass` enum (schema v1 additive). Weight **95**. Question text includes stage, trigger class, workerKey, taskId, halt reason.

Budget exceed continues to use `budget_exceed` (weight 100) for forecast/dispatch denial and budget-triggered stop.

**Alternatives considered**:

- **Reuse `ambiguous_requirement`**: Rejected. Stop is safety-critical and must sort high.

## Data Model

Schema version **1**. Timestamps ISO-8601 UTC. Money USD as number with 4 decimal places max in JSON.

### SpendEvent

Append-only line in `spend.jsonl`. Primary key `id` (`spend_` + UUID).

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | |
| `ts` | timestamp | yes | |
| `agentId` | string | yes | Roster id |
| `sessionId` | string | yes | Dispatch session |
| `featureId` | string or null | yes | |
| `taskId` | string or null | yes | When known |
| `engine` | string or null | yes | |
| `model` | string or null | yes | Vendor id or abstract |
| `inputTokens` | number | yes | ≥ 0; may be 0 if unknown estimate |
| `outputTokens` | number | yes | ≥ 0 |
| `usdEstimate` | number or null | yes | Null when not computable |
| `source` | `transcript` \| `api` \| `estimate` | yes | Preference: api > transcript > estimate |
| `partial` | boolean | yes | True when tokens or USD missing intentionally |

Invariants: append-only; duplicate `id` rejected on write. Rollups sum tokens; USD sums non-null estimates only.

### Budget

Rows in `budgets.json` `{ schemaVersion: 1, items: Budget[] }`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `scope` | `agent` \| `feature` | yes | |
| `scopeId` | string | yes | agentId or featureId |
| `unit` | `tokens` \| `usd` | yes | Separate rows per unit |
| `cap` | number or null | yes | Null = unlimited |
| `updatedAt` | timestamp | yes | |

**Remaining** (derived, not stored): `cap - sum(spend for scope)` when cap set; unlimited when cap null. **Explicit zero remaining** when cap ≤ spent. Tighter cap across agent+feature scopes uses minimum remaining per unit at enforcement time.

Relationships: feature caps mirror `briefs/<featureId>.json`; agent caps mirror `roster.json` optional fields.

### CircuitBreakerState

Map entry in `breakers.json` keyed by `workerKey`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `workerKey` | string | yes | `agentId:sessionId` |
| `stage` | `clear` \| `steer` \| `constrain` \| `stop` | yes | |
| `trigger` | `loop` \| `errors` \| `budget` or null | yes | Last active trigger |
| `windowsFired` | number | yes | Count of breaker windows |
| `constrainContextGrowth` | boolean | yes | |
| `effectiveTier` | ModelTier or null | yes | After constrain |
| `haltReason` | string or null | yes | Set on stop |
| `updatedAt` | timestamp | yes | |

State machine: see breaker decision. `stop` is terminal until Operator resolves Ask-Me and clears breaker entry via `token-breaker-reset` (Operator tool).

### ContextGauge

Snapshot in `gauges.json` keyed by `workerKey`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `state` | `measured` \| `unavailable` | yes | |
| `usedTokens` | number | if measured | |
| `limitTokens` | number | if measured | > 0 |
| `ratio` | number | if measured | 0–1 |
| `reason` | string | if unavailable | e.g. `engine_no_metric` |
| `updatedAt` | timestamp | yes | |

### CostForecast

Ephemeral object returned by forecast API (not persisted).

| Field | Type | Notes |
|-------|------|-------|
| `expectedTokens` | number or null | |
| `expectedUsd` | number or null | |
| `basis` | string | e.g. `median_of_3_tasks_same_kind_feature` |
| `status` | `ok` \| `insufficient-history` | |

### RoutingHint

Optional attachment on `route-model` response.

| Field | Type | Notes |
|-------|------|-------|
| `preferredTier` | ModelTier | |
| `preferLocalEngine` | boolean | P-006 interprets |
| `reason` | `low_quota` \| `operator_override` \| `none` | |

### TierOverride

Append-only `tier-overrides.jsonl`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `ovr_` + UUID |
| `ts` | timestamp | |
| `agentId` | string | |
| `featureId` | string or null | |
| `requestedTier` | ModelTier | |
| `routeModelTier` | ModelTier | At time of override |
| `reason` | string | |
| `actor` | `operator` | v1 |

### CompactionRecord

Append-only `compaction.jsonl`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `cmp_` + UUID |
| `ts` | timestamp | |
| `featureId` | string | |
| `taskId` | string | |
| `agentId` | string | |
| `sessionId` | string | |
| `passed` | boolean | |
| `strategy` | `drop-tool-noise` \| `dedupe-reads` \| `summarize` \| `clear` \| `compact-skipped` | Final strategy applied |
| `strategiesAttempted` | string[] | Ordered attempts |

### TokenSettings

`settings.json` defaults on first init:

| Field | Default | Notes |
|-------|---------|-------|
| `breakerWindowMs` | 60000 | |
| `loopThreshold` | 3 | |
| `errorThreshold` | 5 | |
| `lowQuotaPercent` | 20 | FR-018 |
| `compactionSummarizeThresholdTokens` | 8000 | |

## Contracts

Shared JSON envelope with P-001 (`ok`, `error`, `message`, `hint`). Token tools require hive initialized.

### TokenHooks (implements P-001 contract)

```ts
// packages/core/src/token-governor/hooks-impl.ts — registers at import when hive present

export const tokenHooksImpl: TokenHooks = {
  async beforeDispatch(ctx: DispatchContext): Promise<DispatchGate> {
    // rollup remaining, run forecast, compare tighter cap
  },
  async recordSpend(event: SpendEventInput): Promise<void> {
    // append spend.jsonl; refresh breaker budget trigger; rollup cache
  },
  async onRecordResult(ctx: DistillContext): Promise<void> {
    // compaction pipeline + CompactionRecord
  },
};
```

`DispatchContext` extension (additive): optional `sessionId`, `estimatedTokens`, `estimatedUsd`, `taskKind`, `complexity`.

### MCP tools (new)

Registered beside existing tools. Names kebab-case.

#### `token-spend-record`

Request: `{ "agentId", "sessionId", "featureId?", "taskId?", "engine?", "model?", "inputTokens", "outputTokens", "usdEstimate?", "source" }`

Response: `{ "ok": true, "id": "spend_...", "rollup": { "agent", "feature", "session" } }`

#### `token-spend-query`

Request: `{ "agentId?", "featureId?", "sessionId?", "taskId?" }` (at least one scope)

Response:

```json
{
  "ok": true,
  "totals": { "inputTokens": 12000, "outputTokens": 4000, "usdEstimate": 1.25 },
  "remaining": { "tokens": null, "usd": 8.75 },
  "events": 42
}
```

#### `token-budget-set`

Request: `{ "scope": "agent|feature", "scopeId", "unit": "tokens|usd", "cap": number|null }`

Response: `{ "ok": true, "budget": { } }`

#### `token-budget-show`

Request: `{ "agentId?", "featureId?" }`

Response: caps, spent, remaining per unit, `enforcedRemaining` (tighter cap).

#### `token-forecast`

Request: `{ "featureId", "taskKind", "engine?", "agentId?" }`

Response: `CostForecast` object.

#### `token-breaker-status`

Request: `{ "workerKey?" , "agentId?" }`

Response: `{ "ok": true, "breakers": [ CircuitBreakerState ] }`

#### `token-breaker-reset`

Operator clears terminal stop after Ask-Me resolved. Request: `{ "workerKey", "agentId" }`.

#### `token-gauge-report`

Request: `{ "workerKey", "usedTokens", "limitTokens" }` OR `{ "workerKey", "unavailable": true, "reason" }`.

#### `token-gauge-query`

Request: `{ "agentId?", "workerKey?" }`

Response: gauges with measured or unavailable.

#### `token-compaction-list`

Request: `{ "featureId?", "taskId?", "limit": 50 }`

Response: recent `CompactionRecord` lines.

#### `token-tier-override`

Request: `{ "agentId", "featureId?", "requestedTier", "reason" }`

Response: persisted override + current `routeModel` tier for audit.

### Extended MCP tool

#### `route-model` (additive optional fields)

Request adds: `quotaRemainingPercent?: number`, `featureId?: string`, `agentId?: string` (for override lookup).

Response adds: `routingHint?`, `quotaApplied: boolean`, `overrideApplied: boolean`.

Core `routeModel()` function unchanged; wrapper in mcp-server applies hints.

### CLI commands

Mirror MCP JSON (`superspec token spend query`, `token budget set`, `token forecast`, `token breaker status`, `token gauge query`, etc.).

### Event schema (hive `events.jsonl` additions)

| `type` | `data` fields |
|--------|----------------|
| `token.spend_recorded` | `spendId`, `agentId`, `featureId`, `taskId`, `usdEstimate` |
| `token.budget_exceeded` | `scope`, `scopeId`, `remaining`, `requested` |
| `token.breaker_steer` | `workerKey`, `trigger` |
| `token.breaker_constrain` | `workerKey`, `effectiveTier` |
| `token.breaker_stop` | `workerKey`, `trigger`, `askMeId` |
| `token.compaction` | `taskId`, `strategy` |
| `token.forecast` | `featureId`, `taskKind`, `status`, `expectedUsd` |

Telemetry allowlist: no prompt bodies; token counts allowed.

### Integration points

| Integration | Protocol | Notes |
|-------------|----------|-------|
| P-001 Command Plane | `registerCommandPlaneHooks`, Ask-Me | `budget_exceed`, `circuit_breaker_stop` |
| P-001 brief/roster | JSON files | Budget mirrors |
| Forge loop | `record-result` hook only | No change to `recordResult()` pure function |
| `model-router.ts` | Import `routeModel` | Unchanged tier logic |
| P-003 Learning | Hook order | Distill before compact |
| P-006 Engine | `recordSpend`, compact execution, gauge reports | Adapters call MCP or in-process exports |
| P-002 Command Center | Read-only same MCP | Spend HUD, gauges, breaker badge |

### Consumed From Other Specs

| Source spec | Contract | Version / stability | Notes |
|-------------|----------|---------------------|-------|
| `specs/001-ira-command-plane` | `TokenHooks`, hook call order, hive paths, Ask-Me API | v1 | Deny opens Ask-Me; distill before compact |
| `specs/001-ira-command-plane` | `briefs/*.json` `budgetTokens`/`budgetUsd` | v1 | Feature budget mirror |
| `specs/001-ira-command-plane` | `roster.json` agent budgets | v1 | Agent budget mirror |
| `specs/001-ira-command-plane` | `dispatch-task`, `DispatchIntent`, idle wake | v1 | `beforeDispatch` only on dispatch-task (OD-010) |
| `specs/006-ira-engine-adapters` | Catalog `emitsTokenSignals`, failover ladder | v1 | FR-025 metered failover |
| `packages/core` | `routeModel`, `ModelTier` | core 0.2.x | Tier floor for constrain |
| `specs/006-ira-engine-adapters` | Usage + compaction + gauge signals | v1 planned | When absent, estimate + compact-skipped |

### Produced For Other Specs

| Target spec / consumer | Contract | Version / stability | Notes |
|------------------------|----------|---------------------|-------|
| `specs/001-ira-command-plane` | Ask-Me `circuit_breaker_stop` class | v1 additive | Stop escalation |
| `specs/002-ira-command-center` | `token-spend-query`, `token-gauge-query`, `token-breaker-status` | v1 | HUD data contract |
| `specs/003-ira-learning-memory` | Compaction does not touch pattern store | v1 | LR-006 |
| `specs/006-ira-engine-adapters` | `recordSpend` + gauge report + compact executor hooks | v1 | Engine writes usage |

## Appendix: FR Coverage

| FR | Where this design satisfies it |
|----|--------------------------------|
| FR-001 | `spend.jsonl` durable ledger + rollups |
| FR-002 | SpendEvent fields + source enum |
| FR-003 | `token-budget-set`, brief/roster mirrors |
| FR-004 | `beforeDispatch` deny → Ask-Me `budget_exceed` |
| FR-005 | Breaker stage machine in `breaker.ts` |
| FR-006 | Steer event + mailbox hint, no halt |
| FR-007 | Constrain tier down within ModelTier |
| FR-008 | Stop + Ask-Me + agent blocked |
| FR-009 | `token-gauge-query` measured ratio |
| FR-010 | `unavailable` state, no fake zero |
| FR-011 | `onRecordResult` compaction duty |
| FR-012 | Task boundary = record-result |
| FR-013 | Tiered strategies order in compaction |
| FR-014 | Ledger/patterns not touched by compact |
| FR-015 | `token-forecast` |
| FR-016 | Forecast gate in `beforeDispatch` |
| FR-017 | `token-tier-override`; route-model unchanged core |
| FR-018 | `lowQuotaPercent` + routingHint |
| FR-019 | Missing quota → default route-model |
| FR-020 | Token MCP/CLI tools |
| FR-021 | Hooks extend forge; tools remain |
| FR-022 | Fresh subagent default unchanged |
| FR-023 | `budget_exceed` + `circuit_breaker_stop` in Ask-Me |
| FR-024 | `beforeDispatch` only inside `dispatch-task`; no side path |
| FR-025 | Failover skips non-signal rungs when numeric cap set |
| FR-026 | Hook throw → deny + Ask-Me `budget_exceed`; no crash |
