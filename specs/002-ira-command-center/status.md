# Status: 002-ira-command-center

**Last updated**: 2026-10-17T03:32:50.903Z
**Tasks**: 25/25 done · 0 in progress · 0 blocked · 0 pending

## Functional requirements

| FR | Status | Tasks | Requirement |
| --- | --- | --- | --- |
| FR-001 | ✅ done | T001, T012, T013, T025 | Operator MUST be able to open a web Command Center that presents Ira’s GOD-level |
| FR-002 | ✅ done | T004, T015 | Command Center MUST provide a Tasks view that shows work as a dependency-aware k |
| FR-003 | ✅ done | T016 | Command Center MUST provide a Fleet view of the worker roster including identity |
| FR-004 | ✅ done | T017 | Command Center MUST provide an Activity view of the append-only event log in rec |
| FR-005 | ✅ done | T009, T020 | Command Center MUST provide a Memory/patterns view of persisted learnings the Co |
| FR-006 | ✅ done | T009, T021 | Command Center MUST provide a Spend/budgets view of token use and estimated cost |
| FR-007 | ✅ done | T013, T018 | Command Center MUST provide an Ask-Me/approvals inbox for critical human-in-the- |
| FR-008 | ✅ done | T022 | Command Center MUST provide a Triggers/schedules view of idle-wake and night/awa |
| FR-009 | ✅ done | T005, T019 | Command Center MUST provide a morning/status brief that summarizes done, blocked |
| FR-010 | ✅ done | T004, T006, T011, T015 | Operator MUST be able to dispatch, pause, abort, and reassign work from the Comm |
| FR-011 | ✅ done | T012, T018 | Operator MUST be able to answer Ask-Me items from the Command Center without usi |
| FR-012 | ✅ done | T012, T019 | Operator MUST be able to submit a goal brief (outcome, constraints, budget, deli |
| FR-013 | ✅ done | T010, T014 | While the Command Center remains open, presented state MUST stay current with th |
| FR-014 | ✅ done | T016 | Fleet worker cards MUST show a context-window (or equivalent remaining-capacity) |
| FR-015 | ✅ done | T013 | Command Center MUST treat the management board as the primary fleet surface; a s |
| FR-016 | ✅ done | T003, T013, T025 | Command Center MUST present the locked **Ira Glass** visual language: holographi |
| FR-017 | ✅ done | T013 | Command Center MUST identify Ira (Intelligent Resource Automation) as the GOD fl |
| FR-018 | ✅ done | T002, T008, T009, T012 | Command Center MUST consume the same Command Plane state an operator can read wi |
| FR-019 | ✅ done | T012 | Command Center MUST remain fully usable with neither Hermes nor OpenClaw install |
| FR-020 | ✅ done | T006, T009, T014, T024 | When the Command Plane is unreachable or a view’s store is empty, Command Center |
| FR-021 | ✅ done | T003, T024 | Voice briefing, spoken status, and spoken Ask-Me approval are deferred past v1 C |
| FR-022 | ✅ done | T013, T023 | Command Center MUST use a Munder-like board information architecture (shell + GO |
| FR-023 | ✅ done | T018 | Routine automation events MUST NOT appear as Ask-Me items that require an answer |
| FR-024 | ✅ done | T005, T019 | Morning brief copy MUST lead with numbers (done / blocked / spend / quota-or-unk |
| FR-025 | ✅ done | T001, T024 | SuperSpec CLI/MCP workflows MUST remain usable with the Command Center closed (p |

## Task progress

| Task | Status | FRs | Title |
| --- | --- | --- | --- |
| T001 | done | FR-001, FR-025 | Command Center workspace bootstrap |
| T002 | done | FR-018 | Board snapshot TypeScript contracts |
| T003 | done | FR-016, FR-021 | Ira Glass tokens and no-voice client guard |
| T004 | done | FR-002, FR-010 | DAG-ready and kanban readiness |
| T005 | done | FR-009, FR-024 | Morning brief copy builder |
| T006 | done | FR-010, FR-020 | Steer guard pure functions |
| T007 | done |  | Loopback bearer auth |
| T008 | done | FR-018 | Superspec CLI subprocess wrapper |
| T009 | done | FR-018, FR-020, FR-005, FR-006 | Snapshot builder from CLI and hive files |
| T010 | done | FR-013 | SSE tail of events.jsonl |
| T011 | done | FR-010 | Steer mutations via Plane commands only |
| T012 | done | FR-001, FR-011, FR-012, FR-018, FR-019 | Loopback HTTP server and routes |
| T013 | done | FR-001, FR-007, FR-015, FR-016, FR-017, FR-022 | Board shell and navigation chrome |
| T014 | done | FR-013, FR-020 | Client bootstrap, SSE, bearer token, and degraded polling |
| T015 | done | FR-002, FR-010 | Tasks kanban view and steer controls |
| T016 | done | FR-003, FR-014 | Fleet view and context gauge |
| T017 | done | FR-004 | Activity append-only stream view |
| T018 | done | FR-007, FR-011, FR-023 | Ask-Me inbox and answer flow |
| T019 | done | FR-009, FR-012, FR-024 | Morning brief and goal brief submit view |
| T020 | done | FR-005 | Memory patterns placeholder view |
| T021 | done | FR-006 | Spend placeholder view |
| T022 | done | FR-008 | Triggers and away schedule view |
| T023 | done | FR-022 | App README and Munder attribution headers |
| T024 | done | FR-025, FR-020, FR-021 | Automated test suite verification |
| T025 | done | FR-016, FR-001 | Visual and acceptance sign-off checklist |

## Notes

This file is updated by `@superspec-dev/core sync-status` (or MCP `sync-status`) during forge. Commit it to share FR progress with your team.
