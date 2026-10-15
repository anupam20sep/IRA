# Requirements Quality Checklist: Ira Token Context (P-004)

**Spec**: [`../spec.md`](../spec.md)  
**Validated**: 2026-09-06  
**Stage**: scope (superspec-scope)

## Content Completeness

| # | Check | Result | Notes |
|---|-------|--------|-------|
| C1 | Spec follows project template structure (header, Required Reading, stories, FRs, SCs, assumptions) | **PASS** | All mandatory sections present |
| C2 | Feature type declared (`platform`) | **PASS** | Header `Type: platform` |
| C3 | Status and branch metadata present | **PASS** | Draft; branch `004-ira-token-context` |
| C4 | Required Reading includes parent requirements doc | **PASS** | `2026-09-06-agent-command-plane-requirements.md` |
| C5 | Required Reading includes prior-art reuse map | **PASS** | `ira-prior-art-reuse-map.md` |
| C6 | Required Reading includes program.md P-004 context | **PASS** | `program.md` |
| C7 | Prior Art cites Munder costLedger / realtimeCost / CostHud / Command Center guide | **PASS** | Adapt table; visual HUD deferred to P-002 |
| C8 | Compaction research cited as references, not dependencies | **PASS** | blakecrosley SelfCompact + PydanticAI tiered compaction |
| C9 | SuperSpec `route-model` tiers preserved | **PASS** | FR-017, FR-007, SC-009 |
| C10 | Parent TK-* → FR crosswalk complete | **PASS** | TK-001…TK-009 plus HITL/SS/CP/LR-006 |
| C11 | Sibling ownership explicit (P-001/002/003/006) | **PASS** | Deferred table + assumptions |
| C12 | P-004 scope excludes Command Center chrome | **PASS** | FR-020; CostHud is data contract only |

## User Stories

| # | Check | Result | Notes |
|---|-------|--------|-------|
| S1 | P1: ledger + budgets | **PASS** | Story 1 |
| S2 | P1: circuit breaker steer→constrain→stop | **PASS** | Story 2 |
| S3 | P1: compact-on-`record-result` + semantic tiers | **PASS** | Story 3 |
| S4 | P2: context gauges | **PASS** | Story 4 |
| S5 | P2: cost forecast | **PASS** | Story 5 |
| S6 | P3: quota-aware routing hints + `route-model` | **PASS** | Story 6 |
| S7 | Each story has Why / Independent Test / Given-When-Then | **PASS** | 3 scenarios per story |
| S8 | Stories independently testable as vertical slices | **PASS** | Ledger, breaker, compact, gauge, forecast, routing |

## Requirements Quality

| # | Check | Result | Notes |
|---|-------|--------|-------|
| R1 | FRs describe WHAT/WHY; implementation paths confined to Required Reading / Prior Art | **PASS** | Existing SuperSpec tool/tier names used as contracts |
| R2 | Each FR is testable and unambiguous | **PASS** | CLI/MCP/HITL/compaction-record observables |
| R3 | Success criteria are measurable and technology-agnostic | **PASS** | SC-001–SC-010 with counts, rates, or time |
| R4 | Edge cases identified | **PASS** | Eleven edge cases |
| R5 | Key entities documented | **PASS** | SpendEvent, Budget, CircuitBreakerState, ContextGauge, CostForecast, RoutingHint, TierOverride, CompactionRecord |
| R6 | Assumptions document reasonable defaults | **PASS** | Unset budget, tighter-cap, breaker windows, 20% low-quota, distill-then-compact |
| R7 | `[NEEDS CLARIFICATION]` count ≤ 3 | **PASS** | 0 markers — defaults recorded in Assumptions |
| R8 | No TBD/TODO/FIXME in FR lines | **PASS** | Lint-friendly wording |
| R9 | FR and story counts documented | **PASS** | 23 FRs; 6 stories |

## Traceability & Governance

| # | Check | Result | Notes |
|---|-------|--------|-------|
| T1 | All parent TK-001…TK-009 mapped; no orphan TK in P-004 scope | **PASS** | Crosswalk table |
| T2 | HITL spend-exceed and breaker-stop captured | **PASS** | FR-004, FR-008, FR-016, FR-023 |
| T3 | Forge MCP tools remain valid extensions | **PASS** | FR-021 |
| T4 | Fresh-subagent default preserved | **PASS** | FR-022 |
| T5 | Pattern store survives compaction | **PASS** | FR-014 / LR-006 / SC-005 |
| T6 | Option D: CLI/MCP without UI | **PASS** | FR-020, SC-010 |

## Non-Goals / Anti-Patterns

| # | Check | Result | Notes |
|---|-------|--------|-------|
| N1 | No Command Center visual language prescribed | **PASS** | OD-001 left to P-002 |
| N2 | No Pydantic/SelfCompact runtime dependency | **PASS** | Research citations only |
| N3 | No replacement of `route-model` tiers | **PASS** | FR-017, SC-009 |
| N4 | No engine adapter / quota-scrape implementation | **PASS** | Signals consumed; adapters → P-006 |
| N5 | No personal-assistant or billing-product scope creep | **PASS** | SuperSpec delivery spend only |
| N6 | No implementation prescription (DB, framework, language) in FR/SC | **PASS** | Storage/API behavior only |

## Parent Requirement Coverage

| Parent ID | Covered by FR | Status |
|-----------|---------------|--------|
| TK-001 | FR-001, FR-002 | **PASS** |
| TK-002 | FR-003, FR-004 | **PASS** |
| TK-003 | FR-005, FR-006, FR-007, FR-008 | **PASS** |
| TK-004 | FR-009, FR-010 | **PASS** |
| TK-005 | FR-011, FR-014 | **PASS** |
| TK-006 | FR-012, FR-013 | **PASS** |
| TK-007 | FR-015, FR-016 | **PASS** |
| TK-008 | FR-007, FR-017 | **PASS** |
| TK-009 | FR-018, FR-019 | **PASS** |
| SS-002 | FR-021 | **PASS** |
| SS-004 | FR-022 | **PASS** |
| LR-006 | FR-014 | **PASS** |

## Summary

| Metric | Value |
|--------|-------|
| **Total checks** | 35 content/story/quality/trace/nongoal rows + 12 parent-coverage rows |
| **Fail** | 0 |
| **FR count** | 23 |
| **SC count** | 10 |
| **User story count** | 6 (P1: 3, P2: 2, P3: 1) |
| **NEEDS CLARIFICATION** | 0 |

**Verdict**: **READY for `superspec-architect`** (or `superspec-refine` if the Operator wants to lock breaker-window numerics and the 20% low-quota default as constitution-level rather than assumption-level).
