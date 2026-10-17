# Status: 006-ira-engine-adapters

**Last updated**: 2026-10-17T04:13:48.366Z
**Tasks**: 21/24 done · 0 in progress · 3 blocked · 0 pending

## Functional requirements

| FR | Status | Tasks | Requirement |
| --- | --- | --- | --- |
| FR-001 | ✅ done | T005, T024 | System MUST bind each roster entry to **persona + engine + model + budget + work |
| FR-002 | ✅ done | T002, T003, T021 | System MUST support this target engine set — Claude Code, Codex, Cursor Agent, O |
| FR-003 | ✅ done | T005, T012 | System MUST allow **per-agent model assignment** so different roster entries MAY |
| FR-004 | ✅ done | T011, T023 | System SHOULD support **cross-engine review** as an Operator-configurable policy |
| FR-005 | ✅ done | T012 | When Claude/Cursor-class proprietary engines are unavailable, the **same SuperSp |
| FR-006 | ✅ done | T008, T018, T020 | The local OpenCode + Ollama path MUST enforce a **minimum advertised context of  |
| FR-007 | ✅ done | T008 | Local-pack model backends MUST include **Ollama, LM Studio, vLLM, and BYOK** as  |
| FR-008 | ✅ done | T004, T010, T014, T020 | System MUST apply a **failover ladder** of subscription-backed CLI → API/BYOK →  |
| FR-009 | ✅ done | T006, T007, T021 | System MUST expose a **credential/subscription matrix** of per-engine auth mode  |
| FR-010 | ✅ done | T009, T015, T022, T023 | The engine adapter layer SHOULD normalize lifecycle events — **start, tool, stop |
| FR-011 | ✅ done | T007 | Credentials MUST NOT be written to the hive, pattern store, roster dump, or matr |
| FR-012 | ✅ done | T010 | Failover for rate-limit, quota exhaustion, missing CLI, or auth/health failure M |
| FR-013 | ✅ done | T010, T014 | Failover and engine changes MUST take effect at **task/dispatch boundaries** (fr |
| FR-014 | ✅ done | T006, T008, T015, T018 | Doctor MUST report missing target engines, per-engine auth health, and local-pac |
| FR-015 | ✅ done | T003, T018 | Install/onboarding MUST detect installed CLIs and suggest available engines for  |
| FR-016 | ✅ done | T012, T021 | SuperSpec `route-model` economy / standard / frontier MUST remain the default ti |
| FR-017 | ✅ done | T006, T010 | When quota or subscription signals are available, they MUST influence routing (p |
| FR-018 | ✅ done | T014, T019 | Fresh subagent dispatch MUST remain the default worker execution model where the |
| FR-019 | ✅ done | T005, T014, T018 | Worktree isolation SHOULD be the default for spawned workers that write code. Do |
| FR-020 | ✅ done | T001, T002, T004 | The engine adapter catalog MUST be **versioned** and MUST accept a custom comman |
| FR-021 | ✅ done | T005, T016, T017, T019, T021 | Engine detection, roster binds, failover state, Doctor findings, and the credent |
| FR-022 | ✅ done | T009, T022 | Custom command engines MUST be bindable with identity and spawn command; when th |
| FR-023 | ✅ done | T014, T020, T021 | Host engines are exactly `claude`, `codex`, and `cursor-agent`. When the Command |
| FR-024 | ✅ done | T013, T014, T020, T022, T023 | Away and idle wake for a host engine MUST persist a durable `DispatchIntent` at  |
| FR-025 | ✅ done | T013, T019, T022 | Non-host engine children MUST run only inside a detached supervisor process with |
| FR-026 | ✅ done | T013, T023 | Supervisor `env` MUST be a new object, not a spread of `process.env`. The base a |
| FR-027 | ✅ done | T014, T020, T021, T024 | Until doctor reports `sliceAValidated: true`, the live P-006 surface is host-del |

## Task progress

| Task | Status | FRs | Title |
| --- | --- | --- | --- |
| T001 | done | FR-020 | Engine domain types and Zod schemas |
| T002 | done | FR-002, FR-020 | Versioned builtin engine catalog |
| T003 | done | FR-002, FR-015 | PATH-based engine detection |
| T004 | done | FR-008, FR-020 | Engines hive paths and policy bootstrap |
| T005 | done | FR-001, FR-003, FR-019, FR-021 | Roster engine bind validation and atomic write |
| T006 | done | FR-009, FR-014, FR-017 | Engine health cache and auth probes |
| T007 | done | FR-009, FR-011 | Credential matrix and secret redaction |
| T008 | done | FR-006, FR-007, FR-014 | Local pack profile and 64k context gate |
| T009 | done | FR-010, FR-022 | Normalized engine event mapping |
| T010 | done | FR-008, FR-012, FR-013, FR-017 | Failover ladder selection at dispatch boundary |
| T011 | done | FR-004 | Cross-engine review policy |
| T012 | done | FR-003, FR-016, FR-005 | Dispatch model resolution (tiers and vendor slugs) |
| T013 | done | FR-026, FR-025, FR-024 | Supervisor env scrub and detached spawn spec (no live child in Slice A) |
| T014 | done | FR-023, FR-024, FR-027, FR-018, FR-008, FR-013, FR-019 | EngineHooks dispatch — host null, dispatch-queue, SLICE_A_ONLY |
| T015 | done | FR-010, FR-014 | Hook ingest command and hooks install |
| T016 | done | FR-021 | MCP engines tools |
| T017 | done | FR-021 | CLI engines commands |
| T018 | done | FR-014, FR-015, FR-006, FR-019 | Doctor engine findings — hiveReady vs engineRungReady |
| T019 | done | FR-021, FR-018, FR-025 | Register EngineHooks at startup (hook fail-closed) |
| T020 | done | FR-023, FR-024, FR-027, FR-008, FR-006 | Slice A integration — host null, queue, SLICE_A_ONLY |
| T021 | done | FR-002, FR-009, FR-016, FR-021, FR-023, FR-027 | Slice A verification gate |
| T022 | blocked | FR-024, FR-025, FR-010, FR-022 | Detached supervisor CLI and live child spawn |
| T023 | blocked | FR-024, FR-026, FR-004, FR-010 | Post–Slice A integration — detached pid and scrubbed env |
| T024 | blocked | FR-001, FR-027 | Full P-006 verification gate |

## Notes

This file is updated by `@superspec-dev/core sync-status` (or MCP `sync-status`) during forge. Commit it to share FR progress with your team.

**Slice A (OD-020):** Validated 2026-10-16 — host-delegate path live (`claude` / `codex` / `cursor-agent` → `null` + queue; no Ira-parent host spawn). Tasks **T001–T021** done; **T022–T024** marked **blocked** (intentionally deferred post–Slice A: detached supervisor spawn / full verification). FRs covered by done Slice A tasks report ✅ even when a deferred task remains on the matrix. Program stage: `validate-slice-a`.
