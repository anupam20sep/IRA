# Status: 001-ira-command-plane

**Last updated**: 2026-10-16T13:03:02.130Z
**Tasks**: 24/24 done · 0 in progress · 0 blocked · 0 pending

## Functional requirements

| FR | Status | Tasks | Requirement |
| --- | --- | --- | --- |
| FR-001 | ✅ done | T012, T019, T020, T021 | System MUST expose a **Command Plane API** via SuperSpec CLI and MCP that reads  |
| FR-002 | ✅ done | T009 | Operator MUST be able to submit a **goal brief** (outcome, constraints, budget,  |
| FR-003 | ✅ done | T007, T022 | Ira MUST maintain a **task ledger** compatible with SuperSpec plans (`T00X` iden |
| FR-004 | ✅ done | T010 | Ira MUST maintain an **Ask-Me inbox**; worker clarifications and critical approv |
| FR-005 | ✅ done | T011 | Ira MUST **auto-replan** remaining work on task failure (retry tier, reassign, o |
| FR-006 | ✅ done | T014 | System MUST support **idle wake**: when a worker finishes, Ira MUST assign the n |
| FR-007 | ✅ done | T017 | System MUST support **night/away mode**: continue eligible forge work when confi |
| FR-008 | ✅ done | T006 | System MUST implement autonomy modes **Observe**, **Supervised**, and **Autonomo |
| FR-009 | ✅ done | T010 | Critical-class escalations MUST be queryable and answerable via Command Plane AP |
| FR-010 | ✅ done | T010 | Ira MUST enforce the **critical HITL policy**: never silent-auto for budget exce |
| FR-011 | ✅ done | T004 | Product documentation and API responses MUST use callsign **Ira**; formal expans |
| FR-012 | ✅ done | T001, T003, T006 | System MUST provide a durable **hive** store for roster, blackboard, task ledger |
| FR-013 | ✅ done | T003, T015 | Workers MUST communicate via **inbox/outbox** (or equivalent message API) with * |
| FR-014 | ✅ done | T003, T016 | Shared plans on the **blackboard** MUST have a **single scribe** (Ira or designa |
| FR-015 | ✅ done | T001, T003 | Event log MUST be **append-only** and sufficient to reconstruct activity timelin |
| FR-016 | ✅ done | T008 | Coordinator handoff MUST remain compatible with existing `.superspec/coordinator |
| FR-017 | ✅ done | T008, T024 | Existing SuperSpec skills lifecycle MUST keep working without Command Center ins |
| FR-018 | ✅ done | T008, T020, T022, T023 | Forge loop MCP tools (`next-task`, `begin-task`, `record-result`, `sync-status`, |
| FR-019 | ✅ done | T007, T022, T024 | Traceability spine **FR ↔ task ↔ test** MUST remain mandatory for code work coor |
| FR-020 | ✅ done | T009, T012 | Fresh subagent dispatch MUST remain the default worker execution model where the |
| FR-021 | ✅ done | T019, T020, T021 | Command Plane state MUST be **UI-agnostic**: any future Command Center (P-002) M |
| FR-022 | ✅ done | T018 | `superspec doctor` (or equivalent) MUST report hive integrity, broken MCP wiring |
| FR-023 | ✅ done | T006, T018 | Install/onboarding MUST detect installed SuperSpec CLIs and suggest next setup s |
| FR-024 | ✅ done | T001, T005 | Telemetry of prompts/code MUST remain **off by default**; any usage analytics MU |
| FR-025 | ✅ done | T001, T006, T017 | Mode switching (Observe / Supervised / Autonomous) and night mode enablement MUS |
| FR-026 | ✅ done | T006, T016, T017 | Night/away mode v1 MUST honor exactly two trigger types: a manual away toggle, a |
| FR-027 | ✅ done | T008, T011 | Replan limits and review-failure limits MUST share forge `maxReviewFailures` as  |
| FR-028 | ✅ done | T002, T006 | The hive store MUST live at the project-local path `<repository-root>/.superspec |
| FR-029 | ✅ done | T008, T012, T014, T017, T022 | System MUST expose `dispatch-task` on CLI and MCP, returning the same JSON. Requ |
| FR-030 | ✅ done | T001, T011, T013, T022 | Pause MUST set hive-only ledger field `hold` (boolean, default `false`) and MUST |
| FR-031 | ✅ done | T003, T022 | The only creator and the only remover of hive lock files MUST be `withLock` in ` |
| FR-032 | ✅ done | T012 | Engine ids `claude`, `codex`, and `cursor-agent` are host engines. The id `curso |
| FR-033 | ✅ done | T005, T012 | Non-host engine children MUST run only inside a detached supervisor: argv `super |
| FR-034 | ✅ done | T005, T012, T018 | Until doctor reports `sliceAValidated: true`, the only live Ira surfaces are P-0 |

## Task progress

| Task | Status | FRs | Title |
| --- | --- | --- | --- |
| T001 | done | FR-012, FR-015, FR-025, FR-024, FR-030 | Hive Zod schemas and shared types |
| T002 | done | FR-028 | Repository root and hive path resolution |
| T003 | done | FR-012, FR-013, FR-014, FR-015, FR-031 | Atomic store and OD-012 exclusive locks |
| T004 | done | FR-011 | Ira persona constants |
| T005 | done | FR-024, FR-033, FR-034 | Hook registry with fail-closed try/catch |
| T006 | done | FR-008, FR-012, FR-023, FR-025, FR-028, FR-026 | Hive init and settings defaults |
| T007 | done | FR-003, FR-019 | Ledger sync from plan and forge |
| T008 | done | FR-016, FR-017, FR-018, FR-027, FR-029 | Forge reconcile, hive sync, DISPATCH_PATH_REQUIRED |
| T009 | done | FR-002, FR-020 | Goal brief submit and roster placeholder |
| T010 | done | FR-004, FR-009, FR-010 | Ask-Me inbox and critical classes |
| T011 | done | FR-005, FR-027, FR-030 | Replan on real review failure only |
| T012 | done | FR-001, FR-020, FR-029, FR-032, FR-033, FR-034 | dispatch-task steer command |
| T013 | done | FR-030 | task-hold and task-abort |
| T014 | done | FR-006, FR-029 | Idle wake via dispatch-task |
| T015 | done | FR-013 | Hive mailboxes single-writer |
| T016 | done | FR-014, FR-026 | Blackboard scribe and hive-ci-set |
| T017 | done | FR-007, FR-026, FR-025, FR-029 | Away mode heartbeat and dispatch-task tick |
| T018 | done | FR-022, FR-023, FR-034 | Doctor hiveReady, engineRungReady, sliceAValidated |
| T019 | done | FR-001, FR-021 | CLI JSON subcommands |
| T020 | done | FR-001, FR-018, FR-021 | MCP tool registration |
| T021 | done | FR-001, FR-021 | CLI/MCP contract parity |
| T022 | done | FR-003, FR-018, FR-019, FR-029, FR-030, FR-031 | Integration tests (dispatch path, hold, away CI) |
| T023 | done | FR-018 | Public package exports |
| T024 | done | FR-017, FR-019 | Verify core suite and plan lint |

## Notes

This file is updated by `@superspec-dev/core sync-status` (or MCP `sync-status`) during forge. Commit it to share FR progress with your team.
