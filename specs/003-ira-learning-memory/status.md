# Status: 003-ira-learning-memory

**Last updated**: 2026-10-17T07:18:46.503Z
**Tasks**: 21/21 done · 0 in progress · 0 blocked · 0 pending

## Functional requirements

| FR | Status | Tasks | Requirement |
| --- | --- | --- | --- |
| FR-001 | ✅ done | T011, T020, T013, T014, T021, T019 | System MUST run a **DISTILL** step after each forge `record-result` (pass or fai |
| FR-002 | ✅ done | T002, T006 | System MUST persist distilled patterns **outside worker conversational context** |
| FR-003 | ✅ done | T009, T013, T014, T019 | On `route-model`, `begin-task`, or worker brief generation, system MUST **RETRIE |
| FR-004 | ✅ done | T011, T012, T019 | The learning pipeline MUST implement **RETRIEVE → JUDGE → DISTILL → CONSOLIDATE* |
| FR-005 | ✅ done | T003, T007, T009 | Each pattern MUST be keyed or indexed by one or more signals: FR tags, task kind |
| FR-006 | ✅ done | T002, T017, T019 | Worker context compaction or clear MUST NOT delete, truncate, or relocate the pa |
| FR-007 | ✅ done | T005, T011 | DISTILL output MUST be size-bounded and MUST NOT persist secrets, credentials, A |
| FR-008 | ✅ done | T008 | The **JUDGE** phase MUST score or filter retrieved candidates for relevance; pat |
| FR-009 | ✅ done | T010, T020 | The **CONSOLIDATE** phase MUST merge or demote duplicate and near-duplicate patt |
| FR-010 | ✅ done | T001, T002, T003, T006, T007, T009, T011, T020, T021, T015, T019 | Pattern store persistence MUST use a hybrid backend. Canonical records MUST be h |
| FR-011 | ✅ done | T012, T013, T014, T016, T018, T019 | Learning hooks MUST extend existing forge MCP/CLI tools (`begin-task`, `record-r |
| FR-012 | ✅ done | T003, T015, T016, T018, T019 | System MUST expose a **read-only** pattern list or query surface (CLI and/or MCP |
| FR-013 | ✅ done | T003, T006, T011 | Each pattern record MUST include evidence references (e.g., task id, report path |
| FR-014 | ✅ done | T004 | Operator SHOULD be able to disable learning (distill and/or retrieve) per featur |

## Task progress

| Task | Status | FRs | Title |
| --- | --- | --- | --- |
| T001 | done | FR-010 | Add better-sqlite3 and gitignore index artifacts |
| T002 | done | FR-002, FR-006, FR-010 | Pattern store path resolution |
| T003 | done | FR-005, FR-013, FR-010, FR-012 | Pattern Zod schemas and shared types |
| T004 | done | FR-014 | Learning configuration loader |
| T005 | done | FR-007 | Secret redaction before persist |
| T006 | done | FR-002, FR-010, FR-013 | Atomic markdown pattern I/O |
| T007 | done | FR-010, FR-005 | SQLite FTS index, optional load, and rebuild |
| T008 | done | FR-008 | JUDGE scoring and injection cap |
| T009 | done | FR-003, FR-005, FR-010 | RETRIEVE from FTS or capped markdown scan |
| T010 | done | FR-009 | CONSOLIDATE merge and archive demotion |
| T011 | done | FR-001, FR-004, FR-007, FR-013, FR-010 | DISTILL heuristic extractor |
| T020 | done | FR-001, FR-009, FR-010 | Slice A pattern write gate (OD-020) |
| T012 | done | FR-004, FR-011 | Pipeline orchestration and error isolation |
| T013 | done | FR-011, FR-003, FR-001 | LearningHooks adapter and install |
| T014 | done | FR-003, FR-011, FR-001 | Wire retrieve and distill into forge MCP/CLI |
| T021 | done | FR-001, FR-010 | OD-016 and Slice A integration proofs |
| T015 | done | FR-012, FR-010 | Read-only pattern query module |
| T016 | done | FR-012, FR-011 | CLI patterns subcommands and MCP patterns-list |
| T017 | done | FR-006 | Compaction survival integration test |
| T018 | done | FR-011, FR-012 | Public API exports |
| T019 | done | FR-001, FR-003, FR-004, FR-006, FR-010, FR-011, FR-012 | Feature verify gate |

## Notes

This file is updated by `@superspec-dev/core sync-status` (or MCP `sync-status`) during forge. Commit it to share FR progress with your team.
