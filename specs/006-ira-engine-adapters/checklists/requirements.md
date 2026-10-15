# Requirements Quality Checklist: Ira Engine Adapters (P-006)

**Spec**: [`../spec.md`](../spec.md)  
**Validated**: 2026-09-06  
**Stage**: scope (superspec-scope)

## Content Completeness

| # | Check | Result | Notes |
|---|-------|--------|-------|
| C1 | Spec follows project template structure (header, Required Reading, stories, FRs, SCs, assumptions) | **PASS** | All mandatory sections present |
| C2 | Feature type declared (`platform`) | **PASS** | Header `Type: platform` |
| C3 | Status and branch metadata present | **PASS** | Draft; branch `006-ira-engine-adapters` |
| C4 | Required Reading includes parent requirements doc | **PASS** | `2026-09-06-agent-command-plane-requirements.md` |
| C5 | Required Reading includes prior-art reuse map | **PASS** | `ira-prior-art-reuse-map.md` |
| C6 | Required Reading includes program.md P-006 | **PASS** | Program boundary vs P-002 / P-005 |
| C7 | OpenCode + Ollama docs cited as local path reference | **PASS** | https://docs.ollama.com/integrations/opencode |
| C8 | Munder multi-engine presets cited as adapt-first | **PASS** | `agentProvider.ts` + mixed-engine blog |
| C9 | Omnigent and Aegis cited as inspiration URLs only | **PASS** | Required Reading + Prior Art; no vendor/dependency |
| C10 | Prior Art / Reuse section lists concrete adapt vs inspiration | **PASS** | Adapt Munder/SuperSpec; inspiration Omnigent/Aegis |
| C11 | FR crosswalk maps all parent EN-* IDs | **PASS** | EN-001…EN-009 each have ≥1 FR |
| C12 | Out-of-scope sibling specs explicitly deferred | **PASS** | P-001 hive core, P-002 UI, P-003–P-005, P-007 |

## User Stories

| # | Check | Result | Notes |
|---|-------|--------|-------|
| S1 | P1 stories: detect/bind, mixed models, local pack ≥64k | **PASS** | Stories 1–3 |
| S2 | P2 stories: failover, cross-engine review, normalized events | **PASS** | Stories 4–6 |
| S3 | P3 story: credential/subscription matrix | **PASS** | Story 7 |
| S4 | Each story has Why / Independent Test / Given-When-Then | **PASS** | 2–3 scenarios per story |
| S5 | Stories independently testable as vertical slices | **PASS** | Each delivers CLI/MCP-inspectable value |
| S6 | Story count documented | **PASS** | 7 user stories |

## Requirements Quality

| # | Check | Result | Notes |
|---|-------|--------|-------|
| R1 | FRs describe WHAT/WHY; engine names are product capabilities | **PASS** | Target CLIs are user-facing engines, not stack choices |
| R2 | Each FR is testable and unambiguous | **PASS** | Verifiable via CLI/MCP/Doctor/fixtures |
| R3 | Success criteria are measurable and technology-agnostic | **PASS** | SC-001–SC-009 with time, %, binary outcomes |
| R4 | Edge cases identified | **PASS** | Eight edge cases |
| R5 | Key entities documented | **PASS** | Eight entities |
| R6 | Assumptions document reasonable defaults | **PASS** | Thirteen assumptions including OPEN-005 default |
| R7 | `[NEEDS CLARIFICATION]` count ≤ 3 | **PASS** | 0 markers — defaults locked |
| R8 | ≥64k local context and failover ladder are explicit | **PASS** | FR-006, FR-008, FR-013; SC-002, SC-003 |
| R9 | Secrets excluded from matrix/hive | **PASS** | FR-011, SC-007 |
| R10 | FR count documented | **PASS** | 22 functional requirements |

## Traceability & Governance

| # | Check | Result | Notes |
|---|-------|--------|-------|
| T1 | Parent EN-001 through EN-009 mapped with no orphans | **PASS** | Crosswalk table |
| T2 | Related DX-001/002, TK-008/009, SS-004/005, CP-001 covered | **PASS** | FR-010–FR-015, FR-019 |
| T3 | Option D: no UI-only engine state | **PASS** | FR-009, FR-021, Story 7 |
| T4 | HITL vs routine failover captured | **PASS** | FR-012 |
| T5 | Platform done-definition (downstream unblocked) | **PASS** | SC-009; Type platform |
| T6 | Ira target engine set not expanded to Munder’s twelve | **PASS** | FR-002 + assumptions |

## Non-Goals / Anti-Patterns

| # | Check | Result | Notes |
|---|-------|--------|-------|
| N1 | No Command Center visual requirements smuggled in | **PASS** | Matrix is API; render → P-002 |
| N2 | No hire-gallery or untrusted-manifest ownership | **PASS** | Detection signal only; P-005 owns review |
| N3 | No budget ledger / circuit breaker ownership | **PASS** | Token events + HITL only; P-004 owns TK spend |
| N4 | No Omnigent/Aegis dependency or code copy | **PASS** | Inspiration URLs only |
| N5 | No mandatory Hermes/OpenClaw | **PASS** | Deferred P-007 |
| N6 | No implementation prescription (language, DB, PTY vs ACP) | **PASS** | OPEN-005 defaulted to adapt Munder presets |

## Parent Requirement Coverage

| Parent ID | Covered by FR | Status |
|-----------|---------------|--------|
| EN-001 | FR-001 | **PASS** |
| EN-002 | FR-002, FR-020, FR-022 | **PASS** |
| EN-003 | FR-003, FR-016 | **PASS** |
| EN-004 | FR-004 | **PASS** |
| EN-005 | FR-005, FR-007 | **PASS** |
| EN-006 | FR-006, FR-014 | **PASS** |
| EN-007 | FR-008, FR-012, FR-013 | **PASS** |
| EN-008 | FR-009, FR-011, FR-021 | **PASS** (API; UI render P-002) |
| EN-009 | FR-010, FR-022 | **PASS** |
| DX-001 (engine slice) | FR-014 | **PASS** |
| DX-002 | FR-015 | **PASS** |
| TK-008 | FR-016 | **PASS** |
| TK-009 | FR-017 | **PASS** |
| SS-004 | FR-018, FR-013 | **PASS** |
| SS-005 | FR-019 | **PASS** |

## Summary

| Metric | Value |
|--------|-------|
| **Total checks** | 40 |
| **Pass** | 40 |
| **Fail** | 0 |
| **FR count** | 22 |
| **SC count** | 9 |
| **User story count** | 7 (P1: 3, P2: 3, P3: 1) |
| **NEEDS CLARIFICATION** | 0 |

**Verdict**: **READY for `superspec-architect`** — no open clarifications; defaults documented (adapt Munder presets; failover at dispatch boundary; EN-002 target set; inspiration-only Omnigent/Aegis). Optional `superspec-refine` only if the Operator wants to reopen OPEN-005 event-transport mapping.
