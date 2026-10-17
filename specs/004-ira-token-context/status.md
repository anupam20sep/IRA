# Status: 004-ira-token-context

**Last updated**: 2026-10-17T09:15:35.444Z
**Tasks**: 24/24 done · 0 in progress · 0 blocked · 0 pending

## Functional requirements

| FR | Status | Tasks | Requirement |
| --- | --- | --- | --- |
| FR-001 | ✅ done | T002, T003, T004, T025 | System MUST persist a durable spend ledger that tracks **token counts and estima |
| FR-002 | ✅ done | T001, T003 | Each spend event MUST record agent, session, feature (when known), engine, model |
| FR-003 | ✅ done | T005 | Operator MUST be able to set **token and/or USD budgets** per agent and/or per f |
| FR-004 | ✅ done | T005, T011, T018 | System MUST **enforce** budgets: a dispatch that would exceed remaining agent or |
| FR-005 | ✅ done | T006, T018 | System MUST implement a three-stage circuit breaker — **steer**, then **constrai |
| FR-006 | ✅ done | T006, T018 | **Steer** MUST notify the worker and Operator to change approach or wrap up **wi |
| FR-007 | ✅ done | T006, T018 | **Constrain** MUST reduce spend or risk while allowing the current task to conti |
| FR-008 | ✅ done | T006, T012, T018 | **Stop** MUST halt the worker, persist the halt reason, and escalate to the Oper |
| FR-009 | ✅ done | T010 | System MUST expose a **context-window utilization** measure per worker when the  |
| FR-010 | ✅ done | T010 | When utilization is not measurable, the system MUST expose an explicit **unavail |
| FR-011 | ✅ done | T009, T011 | On every successful or failed forge `record-result`, the system MUST **compact o |
| FR-012 | ✅ done | T009 | Compaction MUST treat **task completion** as the primary semantic boundary; a ra |
| FR-013 | ✅ done | T009 | Compaction MUST apply a cheap-to-expensive tier: drop tool noise first, then ded |
| FR-014 | ✅ done | T009, T017 | Compaction or context clear MUST NOT delete, truncate, or relocate the spend led |
| FR-015 | ✅ done | T007 | Before dispatch, the system SHOULD **forecast** expected cost from similar past  |
| FR-016 | ✅ done | T007, T011, T018 | If forecasted cost exceeds remaining agent or feature budget, the system MUST wa |
| FR-017 | ✅ done | T008, T014 | `route-model` MUST remain the default tiering of **economy**, **standard**, and  |
| FR-018 | ✅ done | T008, T014 | When quota or subscription remaining is known and below the configured low thres |
| FR-019 | ✅ done | T008, T014 | Missing or stale quota signals MUST NOT block routing; the system MUST fall back |
| FR-020 | ✅ done | T002, T004, T013, T015, T019, T025 | CLI and MCP MUST expose current spend, remaining budget, circuit-breaker stage,  |
| FR-021 | ✅ done | T021, T011, T013, T016, T017, T025 | Existing SuperSpec forge tools (`next-task`, `begin-task`, `record-result`, `syn |
| FR-022 | ✅ done | T011, T016 | Fresh-subagent dispatch MUST remain the default worker execution model where the |
| FR-023 | ✅ done | T012 | Budget-exceed confirmations and circuit-breaker **stop** events MUST be queryabl |
| FR-024 | ✅ done | T011, T018, T022, T025 | `TokenHooks.beforeDispatch` MUST run **only** as step 4 of unified **`dispatch-t |
| FR-025 | ✅ done | T018, T023, T025 | When a **numeric** agent or feature budget cap is set (not null / unlimited), au |
| FR-026 | ✅ done | T024, T025 | Token hook implementations MUST assume OD-015 isolation: exceptions in `beforeDi |

## Task progress

| Task | Status | FRs | Title |
| --- | --- | --- | --- |
| T001 | done | FR-002 | Token governor Zod schemas and types |
| T002 | done | FR-001, FR-020 | Token hive paths and settings bootstrap |
| T021 | done | FR-021 | Slice A side-effect guard (OD-020) |
| T003 | done | FR-001, FR-002 | Append-only spend ledger |
| T004 | done | FR-001, FR-020 | Spend rollups and query totals |
| T005 | done | FR-003, FR-004 | Budget caps, remaining, and tighter-cap enforcement |
| T006 | done | FR-005, FR-006, FR-007, FR-008 | Circuit breaker steer → constrain → stop |
| T007 | done | FR-015, FR-016 | Pre-dispatch cost forecast |
| T008 | done | FR-017, FR-018, FR-019 | Quota-aware routing hints and tier overrides |
| T009 | done | FR-011, FR-012, FR-013, FR-014 | Semantic compaction on record-result |
| T010 | done | FR-009, FR-010 | Context-window gauges |
| T011 | done | FR-004, FR-011, FR-016, FR-021, FR-022, FR-024 | TokenHooks adapter (beforeDispatch, recordSpend, onRecordResult) |
| T012 | done | FR-008, FR-023 | Ask-Me `circuit_breaker_stop` critical class |
| T013 | done | FR-020, FR-021 | MCP token-* tools |
| T014 | done | FR-017, FR-018, FR-019 | Extend MCP `route-model` optional quota fields |
| T015 | done | FR-020 | CLI token subcommands |
| T016 | done | FR-021, FR-022 | Auto-register TokenHooks after hive init |
| T017 | done | FR-014, FR-021 | Integration test — distill before compact on record-result |
| T018 | done | FR-004, FR-005, FR-006, FR-007, FR-008, FR-016, FR-024, FR-025 | End-to-end breaker and budget fixtures |
| T022 | done | FR-024 | dispatch-task-only beforeDispatch wiring (FR-024) |
| T023 | done | FR-025 | Budget-metered failover re-gate (FR-025) |
| T024 | done | FR-026 | Token hook throw fail-closed (FR-026) |
| T019 | done | FR-020 | Public package exports |
| T025 | done | FR-001, FR-020, FR-021, FR-024, FR-025, FR-026 | Verify token-governor suite and lint-plan gate |

## Notes

This file is updated by `@superspec-dev/core sync-status` (or MCP `sync-status`) during forge. Commit it to share FR progress with your team.
