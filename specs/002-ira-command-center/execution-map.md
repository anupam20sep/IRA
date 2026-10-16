# Execution Map: Ira Command Center

Parallel execution schedule for feature `002-ira-command-center`. Persona discovery via `list-personas({ projectRoot: "/Users/macky/IRA/superspec" })` returned no custom agents; this map uses **fallback** roles from `superspec-route` (`@frontend`, `@backend`, `@qa`, `@tech-lead`, `@security`).

**Amendment alignment:** Steer window tasks MUST NOT plan ledger locks or direct hive writes. Model routing cells use **tiers only** (`economy`, `standard`, `frontier`).

## Dependency DAG

| From | To | Reason |
|------|----|--------|
| T001 | T002 | App package and vitest include must exist |
| T001 | T003 | Client tree under `apps/command-center` |
| T001 | T007 | Auth module scaffold |
| T001 | T008 | CLI wrapper lives in app package |
| T002 | T004 | Snapshot task types |
| T002 | T005 | Brief copy uses snapshot counts shape |
| T002 | T009 | BoardSnapshot shape |
| T002 | T013 | Shell renders snapshot persona |
| T004 | T006 | Dispatch guards use DAG-ready |
| T004 | T015 | Kanban readiness columns |
| T003 | T013 | Ira Glass tokens in shell |
| T008 | T009 | Snapshot calls superspec CLI |
| T009 | T010 | SSE initial snapshot frame |
| T006 | T011 | Steer guards |
| T007 | T011 | Bearer verified before CLI spawn |
| T008 | T011 | Plane argv via CLI wrapper |
| T009 | T011 | Refetch after steer |
| T009 | T010 | Snapshot builder for SSE connect |
| T007 | T012 | Auth on all mutations |
| T009 | T012 | GET /api/snapshot |
| T010 | T012 | GET /api/events |
| T011 | T012 | POST steer routes |
| T013 | T014 | Shell before client bootstrap |
| T012 | T014 | API origin for EventSource |
| T005 | T019 | Morning brief lines |
| T006 | T015 | Steer guard UI enablement |
| T014 | T015 | Authenticated fetch for steer |
| T014 | T016 | Fleet view |
| T014 | T017 | Activity view |
| T014 | T018 | Ask-Me view |
| T014 | T019 | Brief view |
| T014 | T020 | Memory view mount |
| T014 | T021 | Spend view |
| T014 | T022 | Triggers view |
| T009 | T020 | Pattern dir probe copy |
| T015 | T023 | Attribution on tasks panel |
| T016 | T023 | Attribution on fleet panel |
| T017 | T023 | Activity panel docs |
| T018 | T023 | Ask-Me attribution |
| T012 | T024 | HTTP integration tests |
| T014 | T024 | Client tests |
| T015–T022 | T024 | View unit tests |
| T024 | T025 | Sign-off after automated green |
| T023 | T025 | README before acceptance notes |

**Graphical representation:**

```text
T001
 ├──► T007 ──► T011 ──┐
 ├──► T008 ──► T009 ──► T010 ──┼──► T012 ──► T014 ──► T015 (P0 Dispatch) ──► …
 ├──► T002 ──► T004 ──► T006 ──┘              ▲
 │         ├──► T005 ───────────────► T019     │
 │         ├──► T009 ──────────────────────────┘
 │         └──► T013 ───────────────────────────┘
 └──► T003 ──► T013
```

**Slice A critical path (P0):** T001 → T007 → T008 → T006 → T011 → T012 → T015.

Independent after bootstrap: **T002**, **T003**, **T007**, **T008** (once **T001** completes).

## Parallel Windows

| Window | Tasks | Tier routing | Parallelization boundary |
|--------|-------|--------------|---------------------------|
| **W1: Bootstrap** | T001 | `economy` | Root workspace + app scaffold only. |
| **W2: Foundations** | T002, T003, T007, T008 | T002: `standard`; T003: `standard`; T007: `standard`; T008: `standard` | Separate files; no shared writes. ⚠️ Requires W1. |
| **W3: Pure logic & shell** | T004, T005, T013 | T004: `frontier`; T005: `standard`; T013: `standard` | `dag.ts`, `brief-copy.ts`, `shell.ts`. ⚠️ Requires T002; T013 also T003. |
| **W4: Guards & snapshot** | T006, T009 | T006: `frontier`; T009: `frontier` | `steer-guards.ts` vs `snapshot.ts`. ⚠️ T006 needs T004; T009 needs T002+T008. |
| **W5: SSE** | T010 | `frontier` | Exclusive `sse.ts`. ⚠️ Requires T009. |
| **W6: Plane steer** | T011 | `frontier` | Exclusive `steer.ts` — `dispatch-task`, `task-hold`, `task-abort`, `task-reassign` only. ⚠️ Requires T006, T007, T008. |
| **W7: HTTP server** | T012 | `frontier` | `main.ts` + routes; loopback bind + Bearer gate. ⚠️ Requires T007, T009, T010, T011. |
| **W8: Client bootstrap** | T014 | `standard` | `client/main.ts` + token header wiring. ⚠️ Requires T012 and T013. |
| **W9: P0 kanban Dispatch** | T015 | `standard` | `views/tasks.ts` Dispatch control for OD-020. ⚠️ Requires W8, T004, T006. |
| **W10: Remaining GOD views** | T016, T017, T018, T019, T020, T021, T022 | T016–T019, T022: `standard`; T020–T021: `economy` | One file per view; no cross-file writes. ⚠️ Requires W8; T019 also T005; T020 also T009. |
| **W11: Doc sync** | T023 | `economy` | README + comment headers only. ⚠️ Requires T015–T018 for attribution targets. |
| **W12: Verify** | T024 | `economy` | Read-only test execution. |
| **W13: Sign-off** | T025 | `economy` | Checklist markdown only. |

**Parallelization constraints:**

- ⚠️ Do not run **W2** before **W1** completes.
- ⚠️ Do not run **T011** before **T007** (auth) completes — mutations must fail closed without token.
- ⚠️ Do not run **T012** before **T009**, **T010**, and **T011** complete.
- ⚠️ Do not run **T015 (P0 Dispatch)** before **T014** completes.
- ⚠️ **W10** view tasks must not edit the same view file concurrently (isolated by filename).
- ⚠️ **W13** must run last.

## Model Routing

| Task | Complexity | Tier | Rationale |
|------|------------|------|-----------|
| T001 | `mechanical` | `economy` | Workspace checklist |
| T002 | `moderate` | `standard` | P-001-aligned DTOs |
| T003 | `moderate` | `standard` | Tokens + client scan |
| T004 | `complex` | `frontier` | DAG-ready parity with P-001 |
| T005 | `moderate` | `standard` | Brief copy rules |
| T006 | `complex` | `frontier` | Steer guards (OD-011) |
| T007 | `moderate` | `standard` | Loopback bearer auth (OD-017) |
| T008 | `moderate` | `standard` | CLI JSON subprocess |
| T009 | `complex` | `frontier` | Multi-source snapshot + doctor split |
| T010 | `complex` | `frontier` | SSE tail + reconnect |
| T011 | `complex` | `frontier` | Plane-only steer argv |
| T012 | `complex` | `frontier` | Full HTTP surface + auth |
| T013 | `moderate` | `standard` | Shell IA + lamps |
| T014 | `moderate` | `standard` | SSE client + bearer on mutations |
| T015 | `moderate` | `standard` | Kanban + Dispatch (P0) |
| T016 | `moderate` | `standard` | Fleet cards + gauge |
| T017 | `moderate` | `standard` | Activity ordering |
| T018 | `moderate` | `standard` | Ask-Me answer flow |
| T019 | `moderate` | `standard` | Goal brief form |
| T020 | `mechanical` | `economy` | Fixed Memory copy |
| T021 | `mechanical` | `economy` | Fixed Spend copy |
| T022 | `moderate` | `standard` | Triggers/away row |
| T023 | `mechanical` | `economy` | README + attribution |
| T024 | `mechanical` | `economy` | Vitest verification |
| T025 | `mechanical` | `economy` | Human sign-off checklist |

**Tier mapping:** `mechanical→economy`; `moderate→standard`; `complex→frontier`. Call MCP `route-model` at forge time for role/attempt/kind biases.

## Personas

| Window | Primary persona | Secondary persona | Responsibilities |
|--------|-----------------|-------------------|------------------|
| W1 | @tech-lead | — | Workspace layout vs P-001 package boundary |
| W2 | @backend | @frontend | Auth, CLI wrapper, types, tokens |
| W3 | @frontend | @backend | DAG/brief pure logic + shell chrome |
| W4 | @backend | @tech-lead | Snapshot and steer guard correctness |
| W5 | @backend | — | SSE reliability |
| W6 | @backend | @tech-lead | Plane steer parity (no ledger writes) |
| W7 | @backend | @security | Loopback bind, Bearer gate, error envelope |
| W8 | @frontend | @backend | Live updates, bearer header, stale mode |
| W9 | @frontend | @backend | Slice A Dispatch control |
| W10 | @frontend | @qa | Remaining GOD views and empty states |
| W11 | @frontend | — | Docs and MIT attribution |
| W12 | @qa | @security | Full vitest + steer argv gate |
| W13 | @tech-lead | @qa | SC-008 visual sign-off |

**Fallback persona definitions:**

- **@frontend**: Client UI, Ira Glass shell, view modules, Vite client build.
- **@backend**: Node bridge, CLI/hive read I/O, Plane steer handlers.
- **@qa**: Test execution, acceptance scenario coverage, empty/degraded cases.
- **@tech-lead**: Architecture alignment with P-001 contracts and amendment, sign-off gates.
- **@security**: Loopback bind, token file mode, mutation auth fail-closed behavior.

## Rollback

| Window | Rollback strategy |
|--------|-------------------|
| W1 | Revert workspace commits; remove `apps/command-center` and workspace glob lines. |
| W2–W7 | Revert commits touching `apps/command-center/src/server/`; no hive schema impact. |
| W8–W10 | Revert client commits; `sessionStorage` view and token keys are ephemeral. |
| W11–W13 | Revert docs/checklist commits only. |

**General rollback process:**

1. Identify the window to undo and list its task commits (`git log --oneline`).
2. Revert the commit range on the feature branch (`git revert -n <oldest>^..<newest> && git commit -m "revert: command-center Wn"`).
3. Run `pnpm exec vitest run apps/command-center/test` and core smoke tests.
4. Confirm loopback server still refuses non-`127.0.0.1` bind and unauthenticated steer returns `401 TOKEN_REQUIRED`.
5. Do not merge if W12 verify gate fails.

## Verification Gates

| Gate | Applies to | Criteria | Owner |
|------|------------|----------|-------|
| Plan lint | Pre-forge | `lintPlan(plan.md)` returns zero findings | @tech-lead |
| Unit tests | W12 | `pnpm exec vitest run apps/command-center/test` — all pass | @qa |
| CLI independence | W12 | `pnpm exec vitest run packages/core/test/smoke.test.ts` — PASS (FR-025) | @qa |
| Loopback bind | W7 | Startup throws or refuses `0.0.0.0` / non-loopback host | @security |
| Bearer fail-closed | W7 | Unauthenticated POST steer returns `401 TOKEN_REQUIRED` without CLI spawn | @security |
| No bridge ledger writes | W6–W7 | No `locks/` or ledger patch code in bridge; reassign uses `task-reassign` only | @backend |
| Steer argv | W6, W12 | Steer tests assert no `begin-task` or `record-result` in argv helpers | @backend |
| Slice A Dispatch | W9 | Manual: board Dispatch succeeds via `dispatch-task` on seeded hive (OD-020) | @backend |
| No fabricated state | W10 | Empty hive and unreachable Plane checks show degraded/empty copy (FR-020) | @qa |
| Voice absence | W3, W12 | `no-voice-client.test.ts` PASS | @qa |
| Ira Glass review | W13 | SC-008 checklist signed in requirements.md | @tech-lead |
| Hold/abort path | W6–W9 | Pause → `task-hold`; abort → `task-abort`; no `reviewFailures` bump from pause | @backend |

**Gate policy:** Any failed gate blocks merge for that window and downstream windows until fixed in place or reverted.

## Execution map metrics

| Metric | Count |
|--------|------:|
| Tasks scheduled | 25 |
| Parallel windows | 13 |
| P0 window | W9 (T015 Dispatch) |
| Verification gates | 12 |
| DAG edges | 44 |
