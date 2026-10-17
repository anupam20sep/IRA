# Program Backlog

**Mode**: full  
**Program**: Ira (Intelligent Resource Automation)  
**Last updated**: 2026-10-17T11:30:00+05:30  
**Requirements source**: `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md`  
**Architecture amendment (LOCKED)**: `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` — wins over conflicting design text

Multi-spec workstream tracker for Ira. Each row is owned by the agent/human working that spec — edit only your row; re-read this file before updating.

**Lifecycle**: Slice A **closed**. **P-003** shipped. **P-004** token-context forge+validate **COMPLETE** (24/24; 88 LM-governor + 752 core).  
**Model routing**: complex → Grok 4.7; otherwise → Composer.

## Forge order (OD-020 Slice A) — COMPLETE

1. ~~**P-001** Command Plane~~ shipped
2. ~~**P-006** host-delegate~~ Slice A validated (T022–T024 deferred)
3. ~~**P-002** board Dispatch~~ shipped
4. ~~Ask-Me create/list/answer round-trip~~ proven via `doctor.checks.askMeRoundTrip` + board answer path

**Post–Slice A (unlocked):** P-003 distill writes, P-004 spend/breaker, P-005 hire, P-006 T022–T024 supervisor spawn — still gated per-command until a live hive reports `sliceAValidated: true`.

## Backlog

| ID | Feature | Priority | Owner | Stage | Spec Path | Notes |
|----|---------|----------|-------|-------|-----------|-------|
| P-001 | ira-command-plane | P1 | @composer | ship | specs/001-ira-command-plane | Shipped to anupam20sep/IRA; matrix clean, 390/390 tests |
| P-002 | ira-command-center | P1 | @composer | ship | specs/002-ira-command-center | Shipped to origin/master @ d8c48a0; validate COMPLETE; 25/25; T025 signed |
| P-003 | ira-learning-memory | P1 | @composer | ship | specs/003-ira-learning-memory | Shipped origin+ira @ 41a75dc; 21/21; validate COMPLETE |
| P-004 | ira-token-context | P1 | @composer | ship | specs/004-ira-token-context | Validate COMPLETE 2026-10-17; 24/24; 88 token-governor + 752 core |
| P-005 | ira-hire-gallery | P2 | @composer | route | specs/005-ira-hire-gallery | Remediated; plan 22 tasks + map; lint OK; spawn after Slice A |
| P-006 | ira-engine-adapters | P2 | @composer | validate-slice-a | specs/006-ira-engine-adapters | Slice A validated 2026-10-16; 572 tests; T022–T024 deferred |
| P-007 | ira-integrations | P3 | @composer | deferred | specs/007-ira-integrations | INT-* Hermes/OpenClaw nice-to-have |

## Open Decisions

| ID | Decision | Affects | Owner | Status | Resolution |
|----|----------|---------|-------|--------|------------|
| OD-001 | Command Center visual language | P-002 | Operator | resolved | Locked: Ira Glass (see prior resolution). |
| OD-002 | Pattern store tech | P-003 | Operator | resolved | Locked: markdown canonical + SQLite FTS; no embeddings. SQLite optional at runtime (OD-016). |
| OD-003 | Voice timing for Ira | P-002 | Operator | resolved | Deferred past v1 Command Center. |
| OD-004 | Prefer adapt Munder+Ruflo vs greenfield | All | Operator | resolved | Prefer reference/adapt MIT patterns; cite paths. |
| OD-005 | Night mode v1 trigger catalog | P-001 | Operator | resolved | Manual away + forge-status poll; no webhook/cron. **OD-013 supersedes** the “missing CI does not block” clause: `allowAbsentCi` defaults **false**. |
| OD-006 | Default replan attempt budget | P-001 | Operator | resolved | Shared forge `maxReviewFailures`; default 3. Pause does **not** burn this (OD-011). |
| OD-007 | Hive store path | P-001 | Operator | resolved | Project-local `.superspec/hive/` only. |
| OD-008 | Gallery trust tiers | P-005 | Operator | resolved | Same review path. **OD-018 supersedes** shorter curated warning: warning string identical for all sources. |
| OD-009 | Host engine spawn ownership | P-001, P-006 | Operator | resolved | Host engines `claude`/`codex`/`cursor-agent` always host-spawn (`dispatch` returns null). Detached supervisor only for opencode/crush/aider/custom. See amendment. |
| OD-010 | Unified dispatch path | P-001, P-002, P-004, P-006 | Operator | resolved | Only `dispatch-task`: beforeDispatch → EngineHooks.dispatch → begin-task. Board never raw begin-task while hive exists. |
| OD-011 | Hold vs fail / abort | P-001, P-002 | Operator | resolved | Hive `hold` for pause; `task-abort` for abort; neither burns `reviewFailures` unless real review fail. |
| OD-012 | Lock steal policy | P-001, P-002 | Operator | resolved | Single core `withLock`; steal only dead pid + matching nonce; no age steal; board has no lock copy. |
| OD-013 | Away CI when absent | P-001 | Operator | resolved | `allowAbsentCi` default false; heartbeat required; stale `away.pid` is doctor error `AWAY_PID_STALE`. |
| OD-014 | Doctor readiness split | P-001, P-006 | Operator | resolved | Separate `hiveReady` and `engineRungReady`; engine findings must not clear hiveReady. |
| OD-015 | Supervisor process isolation | P-001, P-006 | Operator | resolved | Detached supervisor child; not inside MCP stdio; hook throws fail-closed without crashing forge. |
| OD-016 | Learning non-blocking | P-003 | Operator | resolved | Distill after saveState, non-blocking; markdown fallback if SQLite unavailable. |
| OD-017 | Loopback board auth | P-001, P-002 | Operator | resolved | Token file mode 0600; mutating POSTs require Bearer token. Not multi-user auth (OPEN-007 stays open). |
| OD-018 | Hire acknowledge vs spawn | P-005 | Operator | resolved | `acknowledge` cancels untrusted_import; only `hire-spawn-confirm` spawns; identical warning string. |
| OD-019 | Env scrub / worktree sandbox claim | P-001, P-006 | Operator | resolved | Scrubbed supervisor env; worktreeKind ≠ sandboxed unless OS sandbox wrapper proven. |
| OD-020 | Forge Slice A gate | All | Operator | resolved | Live only P-001 + host-delegate P-006 + board dispatch-task + Ask-Me until `sliceAValidated`. |

## Prior Art Index (reuse first)

### Munder Difflin (MIT) — https://github.com/chaitanyagiri/munder-difflin

| Concern | Upstream reference |
|---------|-------------------|
| Hive design | `HIVE.md`, `MEMORY_GRAPH_SPEC.md` |
| Command Center | blog + `CommandCenterPanel`, `TasksKanban`, `AskMeTab` (see repo `src/renderer`) |
| Hire gallery | https://munderdiffl.in/blog/how-to-hire-from-the-agent-gallery/ ; hire manifest untrusted-input posts |
| Budgets / cost | Command Center guide: per-agent budgets, circuit breaker, transcript cost ledger |
| Multi-engine | README supported agents / engine presets |

### Ruflo (MIT) — https://github.com/ruvnet/ruflo

| Concern | Upstream reference |
|---------|-------------------|
| Learning loop | `plugins/ruflo-intelligence/README.md` — RETRIEVE→JUDGE→DISTILL→CONSOLIDATE |
| Pattern/memory skills | `.agents/skills/agentdb-*`, `reasoningbank-*`, `memory-management` |
| Orchestrator≠executor | `AGENTS.md` division of labor |
| Policy / doctor | metaharness docs; policy verify commands |

### SuperSpec (this repo)

| Concern | Path |
|---------|------|
| Forge loop | `packages/core/src/forge-loop.ts`, MCP forge tools |
| Personas | `packages/core/src/persona-discovery.ts` |
| Model tiers | `packages/core/src/model-router.ts` |
| Dispatch | `docs/explanation/dispatch-and-context.md` |
| Prod amendment | `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` |

## Learnings

- Ira = Intelligent Resource Automation (GOD persona callsign **Ira**).
- Delivery: Option D (core/MCP + web Command Center).
- Hermes/OpenClaw = nice-to-have only (P-007 deferred).
- Production remediation 2026-10-16: host engines never Ira-parented from IDE MCP; one `dispatch-task` path; hold≠fail; fail-closed locks/CI/auth; Slice A before breadth.
