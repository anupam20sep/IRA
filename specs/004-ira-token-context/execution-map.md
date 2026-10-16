# Execution Map: Ira Token Context

An execution map coordinates parallel task windows, model routing (SuperSpec tiers), persona assignments, and verification gates for feature `004-ira-token-context`. Persona discovery via `list-personas({ projectRoot: "/Users/macky/IRA/superspec" })` returned no custom agents; this map uses the **fallback** roles from `superspec-route` (`@backend`, `@qa`, `@tech-lead`).

**Amendment anchors (2026-10-16):** `TokenHooks.beforeDispatch` runs **only** on P-001 **`dispatch-task`** (T022). Slice A (T021) keeps `beforeDispatch` live as a gate with **no spend/breaker/compaction writes** until `sliceAValidated`. Numeric budget caps forbid auto-failover to non-`emitsTokenSignals` rungs (T023).

## Dependency DAG

| From | To | Reason |
|------|----|--------|
| T001 | T002 | Paths validate settings schema |
| T001 | T008 | Routing hints use ModelTier types |
| T002 | T021 | Slice A guard needs token layout |
| T002 | T003 | Spend ledger writes under token root |
| T002 | T009 | Compaction uses token layout |
| T002 | T010 | Gauges persist to gauges.json |
| T021 | T003 | Spend append guarded by Slice A |
| T021 | T006 | Breaker writes guarded by Slice A |
| T021 | T009 | Compaction writes guarded by Slice A |
| T021 | T011 | beforeDispatch Slice A branch |
| T003 | T004 | Rollups read spend.jsonl |
| T004 | T005 | Budget remaining uses spend totals |
| T004 | T007 | Forecast reads historical rollups |
| T005 | T006 | Breaker budget trigger uses remaining |
| T005 | T011 | beforeDispatch enforces budgets |
| T005 | T023 | Failover gate reads numeric caps |
| T006 | T011 | Breaker signals feed dispatch context |
| T006 | T012 | Ask-Me stop wires into breaker |
| T007 | T011 | beforeDispatch compares forecast |
| T009 | T011 | onRecordResult runs compaction |
| T003 | T013 | MCP spend-record handler |
| T005 | T013 | MCP budget tools |
| T006 | T013 | MCP breaker tools |
| T007 | T013 | MCP forecast tool |
| T008 | T013 | MCP tier-override tool |
| T009 | T013 | MCP compaction-list |
| T010 | T013 | MCP gauge tools |
| T008 | T014 | route-model wrapper |
| T013 | T014 | route-model registered in same server |
| T013 | T015 | CLI mirrors MCP handlers |
| T011 | T016 | registerTokenGovernor export |
| T002 | T016 | ensureTokenLayout on hive init |
| T011 | T017 | Integration uses token hooks |
| T016 | T017 | Registration must exist before pipeline test |
| T011 | T022 | dispatch-task wiring tests hooks |
| T016 | T022 | Hive + dispatch-task harness |
| T011 | T023 | reGateBeforeSpawn calls beforeDispatch |
| T011 | T024 | Hook isolation tests token impl |
| T012 | T018 | E2E stop opens Ask-Me class |
| T013 | T018 | E2E uses MCP/query surface |
| T017 | T018 | Hook order prerequisite |
| T022 | T018 | FR-024 path in E2E fixtures |
| T023 | T018 | FR-025 failover fixtures |
| T011 | T019 | Public export of registerTokenGovernor |
| T013 | T019 | Export surface includes MCP module |
| T019 | T025 | Verify runs after exports |
| T022 | T025 | dispatch-task contract verified |
| T023 | T025 | Failover gate verified |
| T024 | T025 | Hook isolation verified |

**Graphical representation:**

```text
T001 ──┬──► T002 ──► T021 ──┬──► T003 ──► T004 ──┬──► T005 ──► T006 ──┬──► T011 ──┬──► T016 ──► T017 ──► T018 ──► T025
       │                     │                    │                    │           │
       │                     ├──► T009 ────────────┼────────────────────┘           ├──► T022 ──┐
       │                     └──► T010 ─────────────┤                                ├──► T023 ──┤
       └──► T008 ──────────────────────────────────┼──► T007 ──────────────────────┘           ├──► T024 ──┘
                                                    │                                           │
                                                    └──► T013 ──► T014 ──► T015                  └──► T019 ──┘
                                                         T012 (after T006, parallel T011)
```

Independent starts after **T001**: **T008** (with **T002**). **T009** and **T010** can run once **T002** completes, in parallel with **T003→T004** chain (after **T021** lands for guarded writes).

## Parallel Windows

| Window | Tasks | Model class | Parallelization Boundary |
|--------|-------|-------------|---------------------------|
| **W1: Schemas** | T001 | `standard` | Single file `schema.ts` / `types.ts`. |
| **W2: Paths & routing math** | T002, T008 | `standard` | `paths.ts` vs `routing-hints.ts`; no shared writes. |
| **W3: Slice A guard** | T021 | `standard` | `slice-a.ts` only; blocks W4 spend/breaker/compaction side effects until merged. |
| **W4: Ledger & side modules** | T003, T009, T010 | T003: `standard`; T009: `frontier`; T010: `standard` | Separate modules; all depend on W2+W3. ⚠️ T003 must finish before T004. |
| **W5: Rollups** | T004 | `standard` | Exclusive on `rollup.ts`. |
| **W6: Budget & forecast** | T005, T007 | T005: `frontier`; T007: `standard` | Different files (`budgets.ts`, `forecast.ts`). |
| **W7: Circuit breaker** | T006 | `frontier` | Stage machine and tier-down logic. |
| **W8: Hooks & Ask-Me** | T011, T012 | T011: `frontier`; T012: `standard` | `hooks-impl.ts` vs `breaker.ts` + schema enum — no same-file conflict. |
| **W9: MCP token tools** | T013 | `standard` | Touches `mcp-server.ts` exclusively in this window. |
| **W10: route-model extension** | T014 | `standard` | Sequential MCP edit after W9. |
| **W11: CLI** | T015 | `economy` | `cli.ts` + `cli-token.ts`. |
| **W12: Hive registration** | T016 | `standard` | `init.ts` registration path. |
| **W13: Hook-order integration** | T017 | `frontier` | Pipeline test only. |
| **W14: Dispatch & failover contracts** | T022, T023, T024 | T022: `frontier`; T023: `frontier`; T024: `standard` | Separate test/module files; shared read of T011 only. |
| **W15: Governor E2E** | T018 | `frontier` | Integration fixtures; depends on W8–W14. |
| **W16: Package exports** | T019 | `economy` | `index.ts` re-exports. |
| **W17: Verify gate** | T025 | `economy` | Read-only verification. |

**Parallelization constraints:**

- ⚠️ Do not run **W4** before **W3** (`T021` guard required for Slice A semantics).
- ⚠️ Do not run **T004** before **T003** completes.
- ⚠️ Do not run **W14** before **W8** (`T011` hooks).
- ⚠️ Do not run **W15** before **W14** (E2E assumes dispatch-task + failover contracts).
- ⚠️ **W17** must run last.

## Model Routing

| Task | Complexity | Model class | Rationale |
|------|------------|-------------|-----------|
| T001 | `moderate` | `standard` | Multi-entity zod contracts |
| T002 | `moderate` | `standard` | Hive path bootstrap |
| T021 | `moderate` | `standard` | Slice A guard semantics |
| T003 | `moderate` | `standard` | JSONL append + locks |
| T004 | `moderate` | `standard` | Rollup aggregation |
| T005 | `complex` | `frontier` | Tighter-cap enforcement |
| T006 | `complex` | `frontier` | Breaker stage machine |
| T007 | `moderate` | `standard` | Forecast median math |
| T008 | `moderate` | `standard` | routeModel wrapper |
| T009 | `complex` | `frontier` | Compaction pipeline |
| T010 | `moderate` | `standard` | Gauge unavailable state |
| T011 | `complex` | `frontier` | Dispatch gate + Slice A |
| T012 | `moderate` | `standard` | Ask-Me enum additive |
| T013 | `moderate` | `standard` | MCP handler surface |
| T014 | `moderate` | `standard` | Additive route-model fields |
| T015 | `mechanical` | `economy` | CLI mirror |
| T016 | `moderate` | `standard` | Hive init registration |
| T017 | `complex` | `frontier` | Hook order integration |
| T018 | `complex` | `frontier` | E2E fixtures SC-002/003 |
| T022 | `complex` | `frontier` | dispatch-task-only FR-024 |
| T023 | `complex` | `frontier` | Budget-metered failover FR-025 |
| T024 | `moderate` | `standard` | Hook throw FR-026 |
| T019 | `mechanical` | `economy` | Package exports |
| T025 | `mechanical` | `economy` | Vitest + lint-plan gate |

**Tier mapping:** `mechanical→economy`; `moderate→standard`; `complex→frontier`. Use MCP `route-model` at forge time for role/attempt/kind biases.

## Personas

| Window | Primary Persona | Secondary Persona | Responsibilities |
|--------|-----------------|-------------------|------------------|
| W1–W3 | @backend | @tech-lead | Schemas, paths, Slice A guard vs OD-020 |
| W4–W7 | @backend | @tech-lead | Ledger, budgets, breaker, forecast |
| W8 | @backend | @tech-lead | TokenHooks + Ask-Me stop |
| W9–W11 | @backend | — | MCP/CLI/route-model surface |
| W12–W13 | @backend | @qa | Registration and hook order |
| W14 | @tech-lead | @backend | dispatch-task-only + failover + isolation |
| W15 | @qa | @backend | E2E budget/breaker/dispatch fixtures |
| W16–W17 | @qa | @tech-lead | Exports and plan lint gate |

**Fallback persona definitions:**

- **@backend**: `token-governor/` modules, hive token store, MCP/CLI handlers, hook wiring with P-001.
- **@qa**: Vitest suites, SC-002/003/009 fixtures, lint-plan and build-matrix verification.
- **@tech-lead**: OD-010 dispatch path, OD-020 Slice A, FR-025 failover invariants, gate approval.

## Rollback

| Window | Rollback Strategy |
|--------|-------------------|
| W1–W3 | Revert commits touching `packages/core/src/token-governor/{schema,types,paths,init-token,slice-a}.ts`; no hive data migration. |
| W4–W7 | Revert ledger/budget/breaker/forecast modules; delete test fixtures under `test/token-governor/`. |
| W8–W11 | Revert hooks + MCP/CLI; restore prior `mcp-server.ts` tool list. |
| W12–W16 | Revert integration tests and exports; command-plane hook registration revert if needed. |
| W17 | No code rollback — re-run verify after fix-forward. |

**General rollback process:**

1. Identify the failed window from forge status.
2. `git log --oneline` for commits in that window’s task IDs.
3. `git revert -n <sha>..<sha> && git commit -m "revert: token-governor Wn"`.
4. Run `pnpm exec vitest run packages/core/test/token-governor` on the reverted branch.
5. Re-run `lint-plan` on `specs/004-ira-token-context/plan.md` before resuming forge.

## Verification Gates

| Gate | Applies To | Criteria | Owner |
|------|------------|----------|-------|
| Schema parse | W1 | All zod schemas round-trip design.md samples | @backend |
| Slice A no-write | W3–W4 | With `sliceAActive: true`, spend/breaker/compaction mutators return `SLICE_A_ONLY` and leave JSONL byte length unchanged | @tech-lead |
| dispatch-task-only | W14 | External `begin-task` → `DISPATCH_PATH_REQUIRED` with zero `beforeDispatch` calls; `dispatch-task` → exactly one call | @tech-lead |
| Budget-metered failover | W14 | Under numeric cap, ladder excluding all `emitsTokenSignals: true` rungs → `{ accepted: false, reason: "budget_unmetered_rung" }` | @tech-lead |
| Hook fail-closed | W14 | Throwing `beforeDispatch` → deny + `HOOK_FAILED_CLOSED`; MCP process stays alive | @backend |
| Token vitest suite | W17 | `pnpm exec vitest run packages/core/test/token-governor` all PASS | @qa |
| lint-plan clean | W17 | `lint-plan` on `plan.md` returns zero findings | @qa |
| build-matrix FR | W17 | `build-matrix plan.md spec.md` zero uncovered FR-### | @qa |
| route-model tiers | W17 | `model-router.test.ts` PASS — only `economy` \| `standard` \| `frontier` | @qa |

**Gate policy:** Any failed gate blocks forge merge for the window and downstream windows until fix-forward passes the same gate.
