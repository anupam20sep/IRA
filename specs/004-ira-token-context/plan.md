# Ira Token Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superspec-forge to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Ira’s token and context governor in `@superspec-dev/core`: durable spend ledger, operator budgets, steer→constrain→stop circuit breaker, semantic compact-or-clear on `record-result`, cost forecast, quota-aware routing hints within `economy` | `standard` | `frontier`, and context-window gauges — all via CLI/MCP without Command Center.

**Architecture:** New `packages/core/src/token-governor/` modules persist under `<repository-root>/.superspec/hive/token/`. P-001 **`dispatch-task`** is the sole steer path that invokes `TokenHooks.beforeDispatch` (step 4: hive gates → retrieve → **beforeDispatch** → `EngineHooks.dispatch` → internal `begin-task`). External forge `begin-task` returns `DISPATCH_PATH_REQUIRED` and never runs budget or forecast gates (FR-024). Until doctor reports `sliceAValidated: true`, `beforeDispatch` stays a live gate only (host allow without spend writes; deny `byok`/`local` with `SLICE_A_ONLY`); spend, breaker, and compaction **writes** no-op without ledger mutation (OD-020). After Slice A validates, full governor side effects activate. Numeric budget caps block auto-failover to rungs with `emitsTokenSignals: false`; each failover rung change re-runs `beforeDispatch` (FR-025). Distill (P-003) runs before compact on `record-result`. Forge tools and `routeModel()` core stay unchanged; MCP `route-model` gains optional quota/override fields only.

**Tech Stack:** TypeScript 5.5, Node >= 20, ESM, Vitest, Zod, existing MCP server in `packages/core`; reuses `command-plane/store.ts`, `paths.ts`, `ask-me.ts`, `hooks.ts` from P-001.

## Global Constraints

- Runtime: Node.js >= 20, `"type": "module"`, NodeNext resolution (match `packages/core`).
- Dependencies: no new runtime npm dependencies beyond existing core (`zod`, `@modelcontextprotocol/sdk`).
- Storage: append-only JSONL + atomic JSON under `.superspec/hive/token/`; hive gitignored; forge state stays in `specs/<feature>/.superspec/state.json`.
- Model tiers: `route-model` MUST return only `economy` | `standard` | `frontier` (FR-017, SC-009); quota hints and breaker constrain move within that set only.
- HITL: budget exceed and breaker **stop** never auto-approve (FR-004, FR-008, FR-016, FR-023).
- Compaction: task boundary = forge `record-result`; MUST NOT delete spend ledger, budgets, breaker history, or P-003 pattern store (FR-014, LR-006).
- Low-quota default: remaining quota ≤ **20%** counts as low (`settings.lowQuotaPercent`, FR-018).
- Testing: **Kind: code** tasks use red-green-refactor with `pnpm exec vitest run <file>` from repo root.
- Dispatch path (OD-010 / FR-024): `TokenHooks.beforeDispatch` MUST run **only** inside P-001 **`dispatch-task`** (CLI, MCP, board Dispatch, idle wake, away tick). Idle wake and away MUST call `dispatch-task`, not argv forge `begin-task`.
- Slice A (OD-020): Until `sliceAValidated: true`, `beforeDispatch` allows host-engine dispatch with **no spend ledger write**; denies `byok` / `local` supervisor rungs with `{ allow: false, reason: "SLICE_A_ONLY" }`. `recordSpend`, breaker side effects, and compaction **writes** return no-op `SLICE_A_ONLY` without mutating `spend.jsonl`, `breakers.json`, or `compaction.jsonl`.
- Budget-metered failover (FR-025): When agent or feature has a **numeric** budget cap, automatic engine failover MUST NOT select a catalog rung with `emitsTokenSignals: false`. Each accepted rung change MUST re-invoke `beforeDispatch` on the effective engine and model before spawn or `{ accepted: true }`.
- Hook isolation (OD-015 / FR-026): Token hook throws MUST NOT crash forge or MCP; `beforeDispatch` throw maps to deny + Ask-Me **`budget_exceed`** (`HOOK_FAILED_CLOSED`).

**Prerequisite:** P-001 Command Plane (`command-plane/*`, hive init, **`dispatch-task`**, Ask-Me, hook call order, OD-015 try/catch) MUST be present before forge tasks T011–T025. P-006 engine catalog `emitsTokenSignals` MUST be present before T023.

---

## Phase 1: Schemas and token hive layout

### Task T001: Token governor Zod schemas and types

**Implements:** FR-002

**Depends on:** none

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Multi-entity zod contracts from design.md data model (decision tests 1–2).

**Files:**
- Create: `packages/core/src/token-governor/schema.ts`
- Create: `packages/core/src/token-governor/types.ts`
- Test: `packages/core/test/token-governor/schema.test.ts`

**Interfaces:**
- Consumes: design.md SpendEvent, Budget, CircuitBreakerState, ContextGauge, CostForecast, RoutingHint, TierOverride, CompactionRecord, TokenSettings field names
- Produces: zod parsers and exported types `SpendEvent`, `BudgetRow`, `CircuitBreakerState`, `ContextGauge`, `CostForecast`, `RoutingHint`, `TierOverride`, `CompactionRecord`, `TokenSettings`, `SpendEventInput`, `ModelTier` re-export from `model-router.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { SpendEventSchema, TokenSettingsSchema } from "../../src/token-governor/schema.js";

describe("SpendEventSchema", () => {
  it("requires source transcript|api|estimate and partial flag", () => {
    const e = SpendEventSchema.parse({
      id: "spend_test",
      ts: "2026-10-15T00:00:00.000Z",
      agentId: "agent-host",
      sessionId: "sess_1",
      featureId: "004-ira-token-context",
      taskId: "T001",
      engine: null,
      model: null,
      inputTokens: 100,
      outputTokens: 50,
      usdEstimate: 0.01,
      source: "api",
      partial: false,
    });
    expect(e.source).toBe("api");
  });
});

describe("TokenSettingsSchema", () => {
  it("defaults lowQuotaPercent 20 and breaker thresholds", () => {
    const s = TokenSettingsSchema.parse({
      schemaVersion: 1,
      breakerWindowMs: 60000,
      loopThreshold: 3,
      errorThreshold: 5,
      lowQuotaPercent: 20,
      compactionSummarizeThresholdTokens: 8000,
    });
    expect(s.lowQuotaPercent).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/schema.test.ts`
Expected: FAIL with cannot find module `token-governor/schema.js`

- [ ] **Step 3: Write minimal implementation**

Implement `schema.ts` with zod schemas matching design.md; export inferred types from `types.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/schema.ts packages/core/src/token-governor/types.ts packages/core/test/token-governor/schema.test.ts
git commit -m "feat(token-governor): add spend and settings zod schemas for FR-002"
```

---

### Task T002: Token hive paths and settings bootstrap

**Implements:** FR-001, FR-020

**Depends on:** T001

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Layout under hive root reuses P-001 path resolution; multi-file defaults (decision test 2).

**Files:**
- Create: `packages/core/src/token-governor/paths.ts`
- Create: `packages/core/src/token-governor/init-token.ts`
- Test: `packages/core/test/token-governor/paths.test.ts`

**Interfaces:**
- Consumes: `resolveRepositoryRoot` from `command-plane/paths.js`
- Produces: `tokenRoot(hiveRoot: string): string`, `ensureTokenLayout(hiveRoot: string): Promise<{ ok: true } | { ok: false; error: "HIVE_NOT_INITIALIZED"; message: string }>`, default `settings.json` on first run

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout, tokenRoot } from "../../src/token-governor/paths.js";

describe("token paths", () => {
  it("creates hive/token layout with settings.json", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    const r = await ensureTokenLayout(hive);
    expect(r.ok).toBe(true);
    await access(join(tokenRoot(hive), "settings.json"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/paths.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement `paths.ts` and `init-token.ts` creating `spend.jsonl`, `budgets.json`, `breakers.json`, `gauges.json`, empty JSONL stubs, and `locks/` per design.md.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/paths.ts packages/core/src/token-governor/init-token.ts packages/core/test/token-governor/paths.test.ts
git commit -m "feat(token-governor): bootstrap hive/token layout for FR-001"
```

---


### Task T021: Slice A side-effect guard (OD-020)

**Implements:** FR-021

**Depends on:** T002

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Central guard for doctor `sliceAValidated` and uniform `SLICE_A_ONLY` no-op semantics (decision test 2).

**Files:**
- Create: `packages/core/src/token-governor/slice-a.ts`
- Test: `packages/core/test/token-governor/slice-a.test.ts`

**Interfaces:**
- Consumes: `runDoctor` result field `sliceAValidated` from `command-plane/doctor.js` (or injected test flag)
- Produces: `isSliceAActive(hiveRoot: string): Promise<boolean>`, `guardSideEffectWrite<T>(hiveRoot: string, writeFn: () => Promise<T>): Promise<T | { ok: false; code: "SLICE_A_ONLY" }>`, `sliceABeforeDispatchGate(ctx: { engineRung: "host" | "byok" | "local" }): DispatchGate`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { sliceABeforeDispatchGate, guardSideEffectWrite } from "../../src/token-governor/slice-a.js";

describe("slice-a", () => {
  it("denies byok/local beforeDispatch with SLICE_A_ONLY when slice active", () => {
    const gate = sliceABeforeDispatchGate({ engineRung: "local", sliceAActive: true } as any);
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect(gate.reason).toBe("SLICE_A_ONLY");
  });

  it("skips spend append when slice active", async () => {
    let wrote = false;
    const r = await guardSideEffectWrite("/tmp/hive", async () => { wrote = true; return { ok: true }; }, { sliceAActive: true } as any);
    expect(wrote).toBe(false);
    expect(r).toEqual({ ok: false, code: "SLICE_A_ONLY" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/slice-a.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Read `sliceAValidated` from latest doctor snapshot; when false, `sliceABeforeDispatchGate` allows only `engineRung: "host"` with no ledger IO; `guardSideEffectWrite` short-circuits mutating paths for spend/breaker/compaction.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/slice-a.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/slice-a.ts packages/core/test/token-governor/slice-a.test.ts
git commit -m "feat(token-governor): Slice A side-effect guard for OD-020"
```

---

## Phase 2: Ledger, budgets, and rollups

### Task T003: Append-only spend ledger

**Implements:** FR-001, FR-002

**Depends on:** T001, T002, T021

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** JSONL append with idempotency and store locks; design decided (decision test 1).

**Files:**
- Create: `packages/core/src/token-governor/spend-ledger.ts`
- Test: `packages/core/test/token-governor/spend-ledger.test.ts`

**Interfaces:**
- Consumes: `appendJsonlLine`, `withLock` from `command-plane/store.js`; `SpendEventSchema`, `SpendEventInput`
- Produces: `appendSpendEvent(hiveRoot: string, input: SpendEventInput): Promise<{ id: string }>`, rejects duplicate `id`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout, tokenRoot } from "../../src/token-governor/paths.js";
import { appendSpendEvent } from "../../src/token-governor/spend-ledger.js";

describe("spend-ledger", () => {
  it("appends one JSONL line per event", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    const { id } = await appendSpendEvent(hive, {
      agentId: "a1",
      sessionId: "s1",
      featureId: "004-ira-token-context",
      taskId: "T003",
      inputTokens: 10,
      outputTokens: 5,
      usdEstimate: 0.001,
      source: "estimate",
      partial: true,
    });
    const lines = (await readFile(join(tokenRoot(hive), "spend.jsonl"), "utf8")).trim().split("\n");
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).id).toBe(id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/spend-ledger.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Wrap append body in `guardSideEffectWrite` from `slice-a.ts`; when Slice A active return `{ ok: false, code: "SLICE_A_ONLY" }` without writing `spend.jsonl`. After validation, append with `spend_` + UUID ids, validate via schema, emit `token.spend_recorded` when events writer is available.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/spend-ledger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/spend-ledger.ts packages/core/test/token-governor/spend-ledger.test.ts
git commit -m "feat(token-governor): append durable spend events for FR-001"
```

---

### Task T004: Spend rollups and query totals

**Implements:** FR-001, FR-020

**Depends on:** T003

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Multi-scope aggregation with USD null handling (decision test 2).

**Files:**
- Create: `packages/core/src/token-governor/rollup.ts`
- Test: `packages/core/test/token-governor/rollup.test.ts`

**Interfaces:**
- Consumes: spend.jsonl lines, scope filters
- Produces: `querySpendTotals(hiveRoot: string, filter: { agentId?: string; featureId?: string; sessionId?: string; taskId?: string }): Promise<{ inputTokens: number; outputTokens: number; usdEstimate: number | null; events: number }>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";
import { appendSpendEvent } from "../../src/token-governor/spend-ledger.js";
import { querySpendTotals } from "../../src/token-governor/rollup.js";

describe("rollup", () => {
  it("sums tokens by featureId", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    await appendSpendEvent(hive, { agentId: "a", sessionId: "s", featureId: "f1", taskId: null, inputTokens: 100, outputTokens: 0, source: "api", partial: false });
    await appendSpendEvent(hive, { agentId: "a", sessionId: "s", featureId: "f1", taskId: null, inputTokens: 50, outputTokens: 0, source: "api", partial: false });
    const t = await querySpendTotals(hive, { featureId: "f1" });
    expect(t.inputTokens).toBe(150);
    expect(t.events).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/rollup.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Stream-parse JSONL with early filter; sum tokens; USD sums non-null estimates only.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/rollup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/rollup.ts packages/core/test/token-governor/rollup.test.ts
git commit -m "feat(token-governor): add spend rollups for FR-020 queries"
```

---

### Task T005: Budget caps, remaining, and tighter-cap enforcement

**Implements:** FR-003, FR-004

**Depends on:** T004

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Agent+feature mirror sync and min-remaining enforcement logic (decision test 3).

**Files:**
- Create: `packages/core/src/token-governor/budgets.ts`
- Test: `packages/core/test/token-governor/budgets.test.ts`

**Interfaces:**
- Consumes: `budgets.json`, rollups, optional brief/roster budget fields
- Produces: `setBudget(hiveRoot, row): Promise<BudgetRow>`, `getEnforcedRemaining(hiveRoot, { agentId?, featureId? }): Promise<{ tokens: number | null; usd: number | null }>`, `wouldExceedRemaining(remaining, requested): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";
import { appendSpendEvent } from "../../src/token-governor/spend-ledger.js";
import { setBudget, getEnforcedRemaining } from "../../src/token-governor/budgets.js";

describe("budgets", () => {
  it("uses tighter remaining cap across agent and feature usd", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    await setBudget(hive, { scope: "agent", scopeId: "a1", unit: "usd", cap: 10 });
    await setBudget(hive, { scope: "feature", scopeId: "f1", unit: "usd", cap: 5 });
    await appendSpendEvent(hive, { agentId: "a1", sessionId: "s", featureId: "f1", taskId: null, inputTokens: 0, outputTokens: 0, usdEstimate: 4, source: "api", partial: false });
    const rem = await getEnforcedRemaining(hive, { agentId: "a1", featureId: "f1" });
    expect(rem.usd).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/budgets.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement cap null = unlimited; explicit zero remaining when cap ≤ spent; upsert mirrors from brief/roster when sync helpers called from P-001 brief path.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/budgets.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/budgets.ts packages/core/test/token-governor/budgets.test.ts
git commit -m "feat(token-governor): enforce budgets with tighter cap for FR-003"
```

---

## Phase 3: Breaker, forecast, routing

### Task T006: Circuit breaker steer → constrain → stop

**Implements:** FR-005, FR-006, FR-007, FR-008

**Depends on:** T005, T021

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Stage machine, triggers, tier-down, and Ask-Me integration (decision tests 2–3).

**Files:**
- Create: `packages/core/src/token-governor/breaker.ts`
- Test: `packages/core/test/token-governor/breaker.test.ts`

**Interfaces:**
- Consumes: `breakers.json`, settings thresholds, `ModelTier` from `model-router.js`
- Produces: `evaluateBreaker(hiveRoot, workerKey, signal): Promise<CircuitBreakerState>`, `resetBreaker(hiveRoot, workerKey): Promise<void>`, tier step `frontier→standard→economy`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";
import { evaluateBreaker } from "../../src/token-governor/breaker.js";

describe("breaker", () => {
  it("walks clear to steer to constrain to stop on repeated loop trigger", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    const wk = "a1:s1";
    let s = await evaluateBreaker(hive, wk, { trigger: "loop", toolHash: "read_file" });
    expect(s.stage).toBe("steer");
    s = await evaluateBreaker(hive, wk, { trigger: "loop", toolHash: "read_file" });
    expect(s.stage).toBe("constrain");
    s = await evaluateBreaker(hive, wk, { trigger: "loop", toolHash: "read_file" });
    expect(s.stage).toBe("stop");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/breaker.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Wrap `breakers.json` mutations in `guardSideEffectWrite`; when Slice A active return prior in-memory stage without persisting side effects. After validation, persist state map; on stop call Ask-Me opener (T012); steer posts mailbox hint when available.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/breaker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/breaker.ts packages/core/test/token-governor/breaker.test.ts
git commit -m "feat(token-governor): circuit breaker stages for FR-005"
```

---

### Task T007: Pre-dispatch cost forecast

**Implements:** FR-015, FR-016

**Depends on:** T004

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Similarity rule and median math are specified in design (decision test 1).

**Files:**
- Create: `packages/core/src/token-governor/forecast.ts`
- Test: `packages/core/test/token-governor/forecast.test.ts`

**Interfaces:**
- Consumes: spend rollups grouped by task completion metadata from hive ledger
- Produces: `forecastCost(hiveRoot, { featureId, taskKind, engine?, agentId? }): Promise<CostForecast>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";
import { forecastCost } from "../../src/token-governor/forecast.js";

describe("forecast", () => {
  it("returns insufficient-history when fewer than two peer tasks", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    const f = await forecastCost(hive, { featureId: "004-ira-token-context", taskKind: "code" });
    expect(f.status).toBe("insufficient-history");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/forecast.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement v1 similarity (same task kind + same featureId OR engine); median tokens/USD when ≥2 peers with spend.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/forecast.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/forecast.ts packages/core/test/token-governor/forecast.test.ts
git commit -m "feat(token-governor): cost forecast for FR-015"
```

---

### Task T008: Quota-aware routing hints and tier overrides

**Implements:** FR-017, FR-018, FR-019

**Depends on:** T001

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Wrapper around unchanged `routeModel()`; append-only overrides (decision test 1).

**Files:**
- Create: `packages/core/src/token-governor/routing-hints.ts`
- Test: `packages/core/test/token-governor/routing-hints.test.ts`

**Interfaces:**
- Consumes: `routeModel` from `model-router.js`, `TokenSettings.lowQuotaPercent`, `tier-overrides.jsonl`
- Produces: `buildRouteModelResponse(args): { tier: ModelTier; routingHint?: RoutingHint; quotaApplied: boolean; overrideApplied: boolean }`, `recordTierOverride(hiveRoot, input): Promise<TierOverride>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildRouteModelResponse } from "../../src/token-governor/routing-hints.js";

describe("routing-hints", () => {
  it("prefers economy hint when quotaRemainingPercent is below threshold", () => {
    const r = buildRouteModelResponse({
      complexity: "moderate",
      attempt: 1,
      quotaRemainingPercent: 10,
      settings: { lowQuotaPercent: 20 } as any,
    });
    expect(["economy", "standard", "frontier"]).toContain(r.tier);
    expect(r.quotaApplied).toBe(true);
    expect(r.routingHint?.preferredTier).toBe("economy");
  });

  it("omits quota hint when quota signal missing", () => {
    const r = buildRouteModelResponse({ complexity: "mechanical", attempt: 1 });
    expect(r.quotaApplied).toBe(false);
    expect(r.routingHint).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/routing-hints.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Never emit a fourth tier name; missing quota falls back to plain `routeModel()` output.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/routing-hints.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/routing-hints.ts packages/core/test/token-governor/routing-hints.test.ts
git commit -m "feat(token-governor): quota routing hints for FR-018"
```

---

## Phase 4: Compaction, gauges, hooks

### Task T009: Semantic compaction on record-result

**Implements:** FR-011, FR-012, FR-013, FR-014

**Depends on:** T002, T021

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Tiered strategy pipeline and durable-record invariants (decision test 3).

**Files:**
- Create: `packages/core/src/token-governor/compaction.ts`
- Test: `packages/core/test/token-governor/compaction.test.ts`

**Interfaces:**
- Consumes: `CompactionContext` `{ featureId, taskId, passed, agentId, sessionId }`, settings threshold
- Produces: `runCompaction(hiveRoot, ctx): Promise<CompactionRecord>` with strategies `drop-tool-noise` | `dedupe-reads` | `summarize` | `clear` | `compact-skipped`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout, tokenRoot } from "../../src/token-governor/paths.js";
import { runCompaction } from "../../src/token-governor/compaction.js";

describe("compaction", () => {
  it("writes CompactionRecord without touching spend.jsonl", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    const spendPath = join(tokenRoot(hive), "spend.jsonl");
    await runCompaction(hive, { featureId: "f", taskId: "T009", passed: true, agentId: "a", sessionId: "s" });
    const cmp = (await readFile(join(tokenRoot(hive), "compaction.jsonl"), "utf8")).trim();
    expect(cmp.length).toBeGreaterThan(0);
    await readFile(spendPath);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/compaction.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

When Slice A active via `guardSideEffectWrite`, return synthetic `CompactionRecord` with strategy `compact-skipped` and **do not** append `compaction.jsonl`. After validation, run strategy chain; when no engine adapter finalize with `compact-skipped`; append compaction.jsonl only.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/compaction.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/compaction.ts packages/core/test/token-governor/compaction.test.ts
git commit -m "feat(token-governor): task-boundary compaction for FR-011"
```

---

### Task T010: Context-window gauges

**Implements:** FR-009, FR-010

**Depends on:** T002

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Measured vs unavailable states with cache flush (decision test 2).

**Files:**
- Create: `packages/core/src/token-governor/gauges.ts`
- Test: `packages/core/test/token-governor/gauges.test.ts`

**Interfaces:**
- Consumes: workerKey, engine measurements
- Produces: `reportGauge(hiveRoot, input): Promise<ContextGauge>`, `queryGauges(hiveRoot, filter): Promise<ContextGauge[]>`, never writes `ratio: 0` for unknown

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";
import { reportGauge, queryGauges } from "../../src/token-governor/gauges.js";

describe("gauges", () => {
  it("stores unavailable without fabricating zero ratio", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    await reportGauge(hive, { workerKey: "a:s", unavailable: true, reason: "engine_no_metric" });
    const [g] = await queryGauges(hive, { workerKey: "a:s" });
    expect(g.state).toBe("unavailable");
    expect((g as any).ratio).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/gauges.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Atomic `gauges.json` replace; in-memory cache for fast read per SC-006.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/gauges.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/gauges.ts packages/core/test/token-governor/gauges.test.ts
git commit -m "feat(token-governor): context gauges for FR-009"
```

---

### Task T011: TokenHooks adapter (beforeDispatch, recordSpend, onRecordResult)

**Implements:** FR-004, FR-011, FR-016, FR-021, FR-022, FR-024

**Depends on:** T005, T006, T007, T009, T021

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Cross-cutting dispatch gate with Slice A host-only allow, forecast compare, and hook registration order (decision test 3).

**Files:**
- Create: `packages/core/src/token-governor/hooks-impl.ts`
- Create: `packages/core/src/token-governor/index.ts`
- Test: `packages/core/test/token-governor/hooks.test.ts`

**Interfaces:**
- Consumes: `TokenHooks`, `DispatchContext`, `DistillContext` from `command-plane/hooks.js`; `sliceABeforeDispatchGate`, `guardSideEffectWrite` from `slice-a.js`
- Produces: `tokenHooksImpl: TokenHooks`, `registerTokenGovernor(hiveRoot: string): void` calling `registerCommandPlaneHooks({ token: tokenHooksImpl })`; **`beforeDispatch` MUST only be invoked by P-001 `dispatch-task` pipeline** (never registered on MCP `begin-task` wrapper)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTokenLayout } from "../../src/token-governor/paths.js";
import { tokenHooksImpl } from "../../src/token-governor/hooks-impl.js";
import { setBudget } from "../../src/token-governor/budgets.js";

describe("TokenHooks.beforeDispatch", () => {
  it("denies dispatch when remaining usd is zero after Slice A validates", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await ensureTokenLayout(hive);
    await setBudget(hive, { scope: "feature", scopeId: "f1", unit: "usd", cap: 0 });
    const gate = await tokenHooksImpl.beforeDispatch!({
      featureId: "f1",
      taskId: "T011",
      agentId: "a1",
      estimatedUsd: 0.01,
      engineRung: "host",
      sliceAActive: false,
    } as any);
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect(gate.reasonClass).toBe("budget_exceed");
  });

  it("allows host engine with no spend write when Slice A active", async () => {
    const gate = await tokenHooksImpl.beforeDispatch!({
      featureId: "f1",
      taskId: "T011",
      agentId: "a1",
      engineRung: "host",
      sliceAActive: true,
    } as any);
    expect(gate.allow).toBe(true);
  });

  it("denies byok rung with SLICE_A_ONLY when Slice A active", async () => {
    const gate = await tokenHooksImpl.beforeDispatch!({
      featureId: "f1",
      taskId: "T011",
      agentId: "a1",
      engineRung: "byok",
      sliceAActive: true,
    } as any);
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect((gate as any).reason).toBe("SLICE_A_ONLY");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/hooks.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Wire forecast + tighter cap when not Slice A; delegate Slice A branch to `sliceABeforeDispatchGate`; `recordSpend`/`onRecordResult` use `guardSideEffectWrite`; no-op registration when hive absent.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/hooks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/hooks-impl.ts packages/core/src/token-governor/index.ts packages/core/test/token-governor/hooks.test.ts
git commit -m "feat(token-governor): TokenHooks dispatch gate for FR-004 and Slice A"
```

---

---

### Task T012: Ask-Me `circuit_breaker_stop` critical class

**Implements:** FR-008, FR-023

**Depends on:** T006

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Additive enum on existing Ask-Me schema (decision test 2).

**Files:**
- Modify: `packages/core/src/command-plane/schema.ts` (Ask-Me reasonClass enum)
- Modify: `packages/core/src/token-governor/breaker.ts` (open Ask-Me on stop)
- Test: `packages/core/test/token-governor/breaker-askme.test.ts`

**Interfaces:**
- Consumes: `openAskMe` from `command-plane/ask-me.js`
- Produces: stop path opens item with `reasonClass: "circuit_breaker_stop"`, weight 95

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { AskMeReasonClassSchema } from "../../src/command-plane/schema.js";

describe("Ask-Me reason classes", () => {
  it("includes circuit_breaker_stop", () => {
    expect(AskMeReasonClassSchema.parse("circuit_breaker_stop")).toBe("circuit_breaker_stop");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/breaker-askme.test.ts`
Expected: FAIL invalid enum value

- [ ] **Step 3: Write minimal implementation**

Extend zod enum; wire breaker stop to Ask-Me opener with halt reason in detail text.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/breaker-askme.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/schema.ts packages/core/src/token-governor/breaker.ts packages/core/test/token-governor/breaker-askme.test.ts
git commit -m "feat(token-governor): circuit_breaker_stop Ask-Me for FR-023"
```

---

## Phase 5: MCP, CLI, and integration

### Task T013: MCP token-* tools

**Implements:** FR-020, FR-021

**Depends on:** T003, T005, T006, T007, T009, T010, T008

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Many thin tool handlers sharing JSON envelope (decision test 2).

**Files:**
- Modify: `packages/core/src/mcp-server.ts`
- Create: `packages/core/src/token-governor/mcp-handlers.ts`
- Test: `packages/core/test/token-governor/contracts.test.ts`

**Interfaces:**
- Consumes: ledger, budgets, forecast, breaker, gauges modules
- Produces: MCP tools `token-spend-record`, `token-spend-query`, `token-budget-set`, `token-budget-show`, `token-forecast`, `token-breaker-status`, `token-breaker-reset`, `token-gauge-report`, `token-gauge-query`, `token-compaction-list`, `token-tier-override` returning `HIVE_NOT_INITIALIZED` when hive missing

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { TOKEN_MCP_TOOL_NAMES } from "../../src/token-governor/mcp-handlers.js";

describe("token MCP surface", () => {
  it("registers eleven token-* tool names", () => {
    expect(TOKEN_MCP_TOOL_NAMES).toContain("token-spend-query");
    expect(TOKEN_MCP_TOOL_NAMES.length).toBe(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/contracts.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Add handlers and register in `createMcpServer()` without breaking existing forge tool names.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp-server.ts packages/core/src/token-governor/mcp-handlers.ts packages/core/test/token-governor/contracts.test.ts
git commit -m "feat(token-governor): MCP token tools for FR-020"
```

---

### Task T014: Extend MCP `route-model` optional quota fields

**Implements:** FR-017, FR-018, FR-019

**Depends on:** T008, T013

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Additive request/response fields only; core `routeModel()` untouched (decision test 1).

**Files:**
- Modify: `packages/core/src/mcp-server.ts` (`route-model` handler)
- Modify: `packages/core/test/token-governor/contracts.test.ts`

**Interfaces:**
- Consumes: `buildRouteModelResponse`
- Produces: response fields `routingHint?`, `quotaApplied`, `overrideApplied`; tiers remain `economy` | `standard` | `frontier` only

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { routeModel } from "../../src/model-router.js";

describe("route-model core unchanged", () => {
  it("returns only economy for mechanical attempt 1", () => {
    expect(routeModel({ complexity: "mechanical", attempt: 1 })).toBe("economy");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/contracts.test.ts -t "route-model core"`
Expected: FAIL if test file missing route-model section (add assertion in Step 3)

- [ ] **Step 3: Write minimal implementation**

Wrap existing handler with optional quota/override args; assert no fourth tier in response schema test.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp-server.ts packages/core/test/token-governor/contracts.test.ts
git commit -m "feat(token-governor): extend route-model MCP for FR-017"
```

---

### Task T015: CLI token subcommands

**Implements:** FR-020

**Depends on:** T013

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Mirror MCP JSON handlers to CLI argv (decision test 1).

**Files:**
- Modify: `packages/core/src/cli.ts`
- Test: `packages/core/test/token-governor/cli-token.test.ts`

**Interfaces:**
- Consumes: same handlers as MCP
- Produces: `superspec token spend query`, `token budget set`, `token forecast`, `token breaker status`, `token gauge query`, etc.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { tokenCliCommands } from "../../src/token-governor/cli-token.js";

describe("token CLI", () => {
  it("lists spend query command", () => {
    expect(tokenCliCommands.some((c) => c.name === "token spend query")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/cli-token.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Add `cli-token.ts` registry and wire into `cli.ts` dispatch.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/cli-token.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli.ts packages/core/src/token-governor/cli-token.ts packages/core/test/token-governor/cli-token.test.ts
git commit -m "feat(token-governor): CLI token commands for FR-020"
```

---

### Task T016: Auto-register TokenHooks after hive init

**Implements:** FR-021, FR-022

**Depends on:** T011, T002

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Side-effect import and hive-init hook without breaking no-hive forge path (decision test 2).

**Files:**
- Modify: `packages/core/src/command-plane/init.ts` or hive-init entry (call `ensureTokenLayout` + `registerTokenGovernor`)
- Modify: `packages/core/src/cli-entry.ts` (optional side-effect import)
- Test: `packages/core/test/token-governor/hooks.test.ts` (extend)

**Interfaces:**
- Consumes: `registerTokenGovernor`
- Produces: when hive exists, token hooks active; when hive absent, forge unchanged

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isTokenGovernorRegistered } from "../../src/token-governor/index.js";

describe("token registration", () => {
  it("starts unregistered before hive bootstrap in unit test", () => {
    expect(isTokenGovernorRegistered()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/hooks.test.ts -t "token registration"`
Expected: FAIL `isTokenGovernorRegistered` not exported

- [ ] **Step 3: Write minimal implementation**

Call registration from hive-init success path only; export test helper flag.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/hooks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/init.ts packages/core/src/cli-entry.ts packages/core/src/token-governor/index.ts packages/core/test/token-governor/hooks.test.ts
git commit -m "feat(token-governor): register hooks on hive init for FR-021"
```

---

### Task T017: Integration test — distill before compact on record-result

**Implements:** FR-014, FR-021

**Depends on:** T011, T016

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Hook order proof with mock LearningHooks (decision test 3).

**Files:**
- Create: `packages/core/test/token-governor/integration-record-result.test.ts`

**Interfaces:**
- Consumes: command-plane record-result pipeline test harness
- Produces: assertion that distill mock runs before compaction mock

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";

describe("record-result hook order", () => {
  it("runs distill before token onRecordResult", async () => {
    const order: string[] = [];
    const learning = { distill: async () => { order.push("distill"); } };
    const token = { onRecordResult: async () => { order.push("compact"); } };
    await learning.distill({} as any);
    await token.onRecordResult({} as any);
    expect(order).toEqual(["distill", "compact"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/integration-record-result.test.ts`
Expected: FAIL until wired to real pipeline helper (replace stub in Step 3)

- [ ] **Step 3: Write minimal implementation**

Add `runRecordResultHooksForTest` in command-plane test helper invoking registered hooks in P-001 order.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/integration-record-result.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/token-governor/integration-record-result.test.ts packages/core/src/command-plane/hooks.ts
git commit -m "test(token-governor): distill-before-compact hook order for FR-014"
```

---

### Task T018: End-to-end breaker and budget fixtures

**Implements:** FR-004, FR-005, FR-006, FR-007, FR-008, FR-016, FR-024, FR-025

**Depends on:** T012, T013, T017, T022, T023

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Multi-fixture integration covering SC-002 and SC-003 (decision test 3).

**Files:**
- Create: `packages/core/test/token-governor/integration-governor.test.ts`

**Interfaces:**
- Consumes: temp hive, MCP handlers or direct module calls
- Produces: tests for budget deny, steer→constrain→stop sequence, forecast gate

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";

describe("governor e2e fixtures", () => {
  it("denies dispatch when forecast exceeds remaining budget", async () => {
    expect(await runBudgetDenyFixture()).toEqual({ allow: false, reasonClass: "budget_exceed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/integration-governor.test.ts`
Expected: FAIL assertion false

- [ ] **Step 3: Write minimal implementation**

Replace with seeded spend, budget cap, loop injection, and Ask-Me list assertions using temp hive from P-001 test helpers.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/integration-governor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/token-governor/integration-governor.test.ts
git commit -m "test(token-governor): budget and breaker e2e for FR-005"
```

---


### Task T022: dispatch-task-only beforeDispatch wiring (FR-024)

**Implements:** FR-024

**Depends on:** T011, T016

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Proves OD-010 ordering and `DISPATCH_PATH_REQUIRED` on stray `begin-task` (decision test 3).

**Files:**
- Create: `packages/core/test/token-governor/integration-dispatch-task.test.ts`
- Modify: `packages/core/src/command-plane/dispatch-task.ts` (assert hook call site only here — P-001)

**Interfaces:**
- Consumes: P-001 `runDispatchTask`, forge `beginTask` handler, mock `TokenHooks.beforeDispatch`
- Produces: test proof that `beforeDispatch` call count increments only via `dispatch-task`; direct `begin-task` returns `DISPATCH_PATH_REQUIRED` without invoking token gate

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";

describe("dispatch-task hook wiring", () => {
  it("does not run beforeDispatch on external begin-task", async () => {
    const r = await runBeginTaskWithoutDispatchPath({ featureId: "004-ira-token-context", taskId: "T001" });
    expect(r.code).toBe("DISPATCH_PATH_REQUIRED");
    expect(r.beforeDispatchCalls).toBe(0);
  });

  it("runs beforeDispatch once on dispatch-task success path", async () => {
    const r = await runDispatchTaskFixture({ featureId: "004-ira-token-context", taskId: "T001" });
    expect(r.beforeDispatchCalls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/integration-dispatch-task.test.ts`
Expected: FAIL helpers not defined

- [ ] **Step 3: Write minimal implementation**

Add test helpers wrapping P-001 dispatch-task and forge begin-task MCP handlers with a counting token hook stub; ensure idle/away fixtures call `dispatch-task` in comments only (covered by P-001 plan).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/integration-dispatch-task.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/token-governor/integration-dispatch-task.test.ts
git commit -m "test(token-governor): beforeDispatch only on dispatch-task for FR-024"
```

---

### Task T023: Budget-metered failover re-gate (FR-025)

**Implements:** FR-025

**Depends on:** T011, T005

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Failover ladder must skip unmetered rungs and re-invoke gate per rung (decision test 3).

**Files:**
- Create: `packages/core/src/token-governor/failover-gate.ts`
- Test: `packages/core/test/token-governor/failover-gate.test.ts`

**Interfaces:**
- Consumes: P-006 catalog `emitsTokenSignals`, enforced numeric caps from `getEnforcedRemaining`, `tokenHooksImpl.beforeDispatch`
- Produces: `selectSignalCapableRung(candidates, ctx): { rung } | { accepted: false; reason: "budget_unmetered_rung" }`, `reGateBeforeSpawn(effectiveEngine, effectiveModel, ctx): Promise<DispatchGate>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { selectSignalCapableRung } from "../../src/token-governor/failover-gate.js";

describe("failover-gate", () => {
  it("rejects ladder when only remaining rung lacks token signals under numeric cap", () => {
    const r = selectSignalCapableRung(
      [
        { engineId: "local-opaque", emitsTokenSignals: false },
      ],
      { numericBudgetCapSet: true },
    );
    expect(r).toEqual({ accepted: false, reason: "budget_unmetered_rung" });
  });

  it("allows signal-capable rung when numeric cap set", () => {
    const r = selectSignalCapableRung(
      [{ engineId: "cursor-agent", emitsTokenSignals: true }],
      { numericBudgetCapSet: true },
    );
    expect(r).toEqual({ rung: { engineId: "cursor-agent", emitsTokenSignals: true } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/failover-gate.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

When `numericBudgetCapSet` is false, do not filter on `emitsTokenSignals`. When true, filter candidates; wire `EngineHooks.dispatch` (P-006) to call `reGateBeforeSpawn` after each rung change before `{ accepted: true }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/failover-gate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/token-governor/failover-gate.ts packages/core/test/token-governor/failover-gate.test.ts
git commit -m "feat(token-governor): budget-metered failover gate for FR-025"
```

---

### Task T024: Token hook throw fail-closed (FR-026)

**Implements:** FR-026

**Depends on:** T011

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** OD-015 boundary behavior for token hooks (decision test 2).

**Files:**
- Test: `packages/core/test/token-governor/hook-isolation.test.ts`
- Modify: `packages/core/src/command-plane/hooks.ts` (ensure try/catch maps token throws — P-001)

**Interfaces:**
- Consumes: `registerCommandPlaneHooks` wrapper from P-001
- Produces: proof that throwing `beforeDispatch` yields `{ allow: false, reasonClass: "budget_exceed", detail: { hookFailed: true, reason: "HOOK_FAILED_CLOSED" } }` and does not throw to MCP caller

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { invokeTokenBeforeDispatchSafely } from "../../src/command-plane/hooks.js";

describe("token hook isolation", () => {
  it("maps beforeDispatch throw to budget_exceed deny", async () => {
    const gate = await invokeTokenBeforeDispatchSafely(async () => {
      throw new Error("forecast blew up");
    });
    expect(gate.allow).toBe(false);
    if (!gate.allow) {
      expect(gate.reasonClass).toBe("budget_exceed");
      expect(gate.detail?.reason).toBe("HOOK_FAILED_CLOSED");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/hook-isolation.test.ts`
Expected: FAIL export missing

- [ ] **Step 3: Write minimal implementation**

Export test helper that mirrors production try/catch; production path opens Ask-Me `budget_exceed` via command-plane when writable.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/hook-isolation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/token-governor/hook-isolation.test.ts packages/core/src/command-plane/hooks.ts
git commit -m "test(token-governor): hook throw fail-closed for FR-026"
```

---

### Task T019: Public package exports

**Implements:** FR-020

**Depends on:** T011, T013

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Re-export types only (decision test 1).

**Files:**
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: export token governor types and `registerTokenGovernor` for in-process P-006 adapters

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { registerTokenGovernor } from "@superspec-dev/core";

describe("package exports", () => {
  it("exports registerTokenGovernor", () => {
    expect(typeof registerTokenGovernor).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/token-governor/exports.test.ts`
Expected: FAIL export missing

- [ ] **Step 3: Write minimal implementation**

Add exports to `index.ts` and create `exports.test.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/token-governor/exports.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/token-governor/exports.test.ts
git commit -m "feat(token-governor): export public API for FR-020"
```

---

### Task T025: Verify token-governor suite and lint-plan gate

**Implements:** FR-001, FR-020, FR-021, FR-024, FR-025, FR-026

**Depends on:** T019, T022, T023, T024

**Kind:** verify

**Complexity:** mechanical

**Complexity rationale:** Read-only verification commands (decision test 5).

**Files:**
- Test: all `packages/core/test/token-governor/*.test.ts`

**Interfaces:**
- Consumes: completed implementation tasks T001–T024

- [ ] **Step 1: Run full token-governor Vitest suite**

Run: `pnpm exec vitest run packages/core/test/token-governor`
Expected: all tests PASS

- [ ] **Step 2: Run plan lint on this feature plan**

Run: `pnpm dlx tsx packages/core/src/plan-lint.ts specs/004-ira-token-context/plan.md`
Expected: exit code 0 with no findings

- [ ] **Step 3: Run build-matrix for FR traceability**

Run: `pnpm exec superspec build-matrix specs/004-ira-token-context/plan.md specs/004-ira-token-context/spec.md`
Expected: PASS with zero uncovered FR-### requirements

- [ ] **Step 4: Confirm route-model tiers unchanged**

Run: `pnpm exec vitest run packages/core/test/model-router.test.ts`
Expected: PASS — only `economy` | `standard` | `frontier`

- [ ] **Step 5: Sign-off record**

Owner: @qa — mark plan phase complete when Steps 1–4 pass; do not merge forge branch if any gate fails.

## FR coverage matrix

| FR | Tasks |
|----|-------|
| FR-001 | T002, T003, T004, T025 |
| FR-002 | T001, T003 |
| FR-003 | T005 |
| FR-004 | T005, T011, T018, T025 |
| FR-005 | T006, T018 |
| FR-006 | T006, T018 |
| FR-007 | T006, T008, T018 |
| FR-008 | T006, T012, T018 |
| FR-009 | T010, T013 |
| FR-010 | T010, T013 |
| FR-011 | T009, T011 |
| FR-012 | T009 |
| FR-013 | T009 |
| FR-014 | T009, T017 |
| FR-015 | T007, T011 |
| FR-016 | T007, T011, T018 |
| FR-017 | T008, T014 |
| FR-018 | T008, T014 |
| FR-019 | T008, T014 |
| FR-020 | T002, T004, T013, T015, T019, T025 |
| FR-021 | T011, T013, T016, T017, T021, T025 |
| FR-022 | T011, T016 |
| FR-023 | T012 |
| FR-024 | T011, T022, T018, T025 |
| FR-025 | T023, T018, T025 |
| FR-026 | T024, T025 |

