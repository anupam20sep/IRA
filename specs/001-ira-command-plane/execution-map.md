# Execution Map: Ira Command Plane

Post–**2026-10-16 amendment** execution map for feature `001-ira-command-plane`. Persona discovery `list-personas({ projectRoot: "/Users/macky/IRA/superspec" })` returned no custom agents; fallback roles from `superspec-route` (`@backend`, `@qa`, `@tech-lead`).

## Slice A / P0 windows

**Forge through W12 before treating P-003–P-006 side effects as live.** P0 tasks: T001–T008, T010, T012–T014, T018 (doctor `sliceAValidated`). W13–W16 complete CLI/MCP parity and verification.

| P0 window | Tasks | Outcome |
|-----------|-------|---------|
| W1–W2 | T001–T005 | OD-012 locks, fail-closed hooks |
| W3–W5 | T006–T008 | Hive init, ledger, `DISPATCH_PATH_REQUIRED` |
| W6–W8 | T009–T012 | Brief, Ask-Me, **`dispatch-task`** |
| W9 | T013–T014 | **`task-hold` / `task-abort`**, idle wake |
| W10–W11 | T015–T017 | Mailboxes, CI/`allowAbsentCi`, away heartbeat |
| **W12** | **T018** | **`hiveReady`**, **`sliceAValidated`** four checks |

---

## Dependency DAG

| From | To | Reason |
|------|----|--------|
| T001 | T003 | Store validates JSON against schemas |
| T002 | T003 | Lock paths under hive root |
| T001 | T005 | Hook types reference command-plane types |
| T002 | T006 | Hive init needs repository root |
| T003 | T006 | Hive init uses atomic writes |
| T004 | T006 | Hive manifest embeds Ira persona |
| T005 | T006 | Settings and hook surface at init |
| T006 | T007 | Ledger sync requires hive layout |
| T007 | T008 | Forge sync calls ledger sync |
| T007 | T009 | Brief staffing upserts ledger |
| T006 | T010 | Ask-Me stores under hive |
| T003 | T010 | Ask-Me uses store locks |
| T006 | T016 | Blackboard file at init |
| T003 | T016 | Blackboard scribe lock |
| T008 | T011 | Replan runs on record-result path |
| T010 | T011 | At ceiling opens Ask-Me |
| T008 | T012 | dispatch-task uses begin-task guard |
| T005 | T012 | Hook order in dispatch |
| T010 | T012 | Ask-Me gate in dispatch |
| T011 | T012 | Replan context for dispatch |
| T007 | T013 | Hold/abort updates ledger |
| T012 | T013 | Abort interacts with dispatch state |
| T009 | T014 | Idle wake needs staffed ledger |
| T012 | T014 | Idle wake calls dispatch-task |
| T011 | T014 | Policy context for idle wake |
| T003 | T015 | Mailboxes use JSONL store |
| T010 | T015 | Escalate opens Ask-Me |
| T014 | T017 | Away tick reuses dispatch |
| T016 | T017 | Away CI gate from blackboard |
| T010 | T017 | Away blocked on open Ask-Me |
| T012 | T017 | Away calls dispatch-task |
| T006 | T018 | Doctor checks hive layout |
| T007 | T018 | Doctor checks ledger |
| T017 | T018 | AWAY_PID_STALE finding |
| T012 | T018 | Slice A host dispatch check |
| T010 | T018 | Slice A Ask-Me round-trip |
| T013 | T018 | Pause/abort paths for Slice A |
| T018 | T019 | CLI exposes doctor and steer commands |
| T019 | T020 | MCP mirrors CLI |
| T020 | T021 | Contract tests cover tools |
| T020 | T022 | Integration drives dispatch path |
| T020 | T023 | Exports follow wired modules |
| T023 | T024 | Verify gate after exports |

**Graphical representation:**

```text
T001 ──┬──► T003 ──► T006 ──► T007 ──► T008 ──► T011 ──► T012 ──┬──► T013 ──► T018 ──► T019 ──► T020 ──┬──► T021 ──► T024
T002 ──┘         │              │         │              │       ├──► T014 ──► T017 ──┘              ├──► T022 ──┘
T004 ────────────┘              │         │              │       └──► (dispatch)                       └──► T023 ──┘
T005 ───────────────────────────┘         │              │
                                          ├──► T009 ──────┘
                                          ├──► T010 ──► T015
                                          └──► T016 ───────────────► T017
```

Independent starts: **T001**, **T002**, **T004**.

---

## Parallel Windows

| Window | Tasks | Model class | Parallelization Boundary |
|--------|-------|-------------|---------------------------|
| **W1: Contracts & persona (P0)** | T001, T002, T004 | T001: `standard`; T002: `frontier`; T004: `economy` | Separate files; no shared writes. |
| **W2: Store & hooks (P0)** | T003, T005 | T003: `frontier`; T005: `frontier` | `store.ts` vs `hooks.ts`. ⚠️ Requires W1 complete. |
| **W3: Hive bootstrap (P0)** | T006 | `standard` | Single writer for hive layout. |
| **W4: Ledger sync (P0)** | T007 | `frontier` | `ledger-sync.ts` only. |
| **W5: Forge bridge (P0)** | T008 | `frontier` | Touches `forge-loop.ts`, `cli.ts`, `mcp-server.ts` — exclusive. |
| **W6: Coordination inputs (P0)** | T009, T010, T016 | T009: `standard`; T010: `frontier`; T016: `standard` | Brief, Ask-Me, blackboard modules — distinct files. |
| **W7: Replan (P0)** | T011 | `frontier` | Depends on forge + Ask-Me. |
| **W8: dispatch-task (P0)** | T012 | `frontier` | **`dispatch-task`**, host queue, Slice A gate — exclusive. |
| **W9: Hold & idle (P0)** | T013, T014 | T013: `standard`; T014: `frontier` | `task-control.ts` vs idle-wake wiring; ⚠️ both depend on T012. |
| **W10: Mailboxes** | T015 | `standard` | After Ask-Me from W6. |
| **W11: Away mode (P0)** | T017 | `frontier` | **`allowAbsentCi`**, heartbeat, **`dispatch-task`** tick. |
| **W12: Doctor Slice A (P0 gate)** | T018 | `frontier` | **`hiveReady`**, **`engineRungReady`**, **`sliceAValidated`**. |
| **W13: CLI surface** | T019 | `standard` | `cli.ts` steer commands. |
| **W14: MCP surface** | T020 | `standard` | `mcp-server.ts` registration. |
| **W15: Contracts & ship** | T021, T022, T023 | `economy` | Test-only + `index.ts` — no overlapping production files. |
| **W16: Verify gate** | T024 | `economy` | Read-only verification. |

**Parallelization constraints:**

- ⚠️ Do not start **W3** until **W2** completes (**T003**, **T005**).
- ⚠️ **W8 `dispatch-task`** blocks **W9** hold/idle and **W11** away.
- ⚠️ **W12 doctor** must pass before treating Slice A as validated in production checks.
- ⚠️ Do not parallelize **W5** with any task touching `mcp-server.ts` / `cli.ts`.

---

## Model Routing

| Task | Complexity | Model class (tier) | Rationale |
|------|------------|--------------------|-----------|
| T001 | moderate | `standard` | Multi-schema contracts |
| T002 | complex | `frontier` | Worktree/hive root correctness |
| T003 | complex | `frontier` | OD-012 lock protocol |
| T004 | mechanical | `economy` | Fixed persona strings |
| T005 | complex | `frontier` | Fail-closed hook boundary |
| T006 | moderate | `standard` | Hive init layout |
| T007 | complex | `frontier` | Ledger authority split |
| T008 | complex | `frontier` | Forge guard + sync |
| T009 | moderate | `standard` | Brief staffing |
| T010 | complex | `frontier` | Ask-Me critical classes |
| T011 | complex | `frontier` | Replan + ceiling |
| T012 | complex | `frontier` | **dispatch-task** pipeline |
| T013 | moderate | `standard` | **task-hold / task-abort** |
| T014 | complex | `frontier` | Idle wake steer path |
| T015 | moderate | `standard` | Mailbox protocol |
| T016 | moderate | `standard` | CI gate helper |
| T017 | complex | `frontier` | Away OD-013 |
| T018 | complex | `frontier` | Doctor + Slice A |
| T019 | moderate | `standard` | CLI wiring |
| T020 | moderate | `standard` | MCP wiring |
| T021 | mechanical | `economy` | Contract assertions |
| T022 | complex | `frontier` | Integration scenarios |
| T023 | mechanical | `economy` | Package exports |
| T024 | mechanical | `economy` | Verify checklist |

Summary: `mechanical→economy`; `moderate→standard`; `complex→frontier`.

---

## Personas

| Window | Primary Persona | Secondary Persona | Responsibilities |
|--------|-----------------|-------------------|------------------|
| W1–W2 | @backend | @tech-lead | Core types, paths, locks, hooks |
| W3–W5 | @backend | @tech-lead | Hive init, ledger, forge bridge |
| W6–W9 | @backend | @qa | Ask-Me, **dispatch-task**, hold/abort |
| W10–W12 | @backend | @tech-lead | Away CI, **doctor Slice A** |
| W13–W14 | @backend | @qa | CLI/MCP parity |
| W15–W16 | @qa | @tech-lead | Contracts, integration, verify gate |

**Persona definitions (fallback):**

- **@backend** — Owns `packages/core/src/command-plane/*` and forge integration.
- **@qa** — Owns vitest suites, amendment SC scenarios, contract parity.
- **@tech-lead** — Owns window gates, Slice A sign-off, rollback approval.

---

## Rollback

| Window | Rollback Strategy |
|--------|-------------------|
| W1–W2 | Revert commits; no hive persisted yet in dev fixtures. |
| W3–W5 | Revert commits; delete local `.superspec/hive/` test dirs only. |
| W6–W12 | Revert command-plane module commits; run `superspec away off` if away.pid left from manual test. |
| W13–W15 | Revert CLI/MCP registration commits; forge tools unchanged when hive absent. |
| W16 | Fix forward — verify task does not mutate product code. |

**General rollback process:**

1. Identify last green window (git log on feature branch).
2. `git revert -n <range>` for the window’s commits.
3. Run `pnpm exec vitest run packages/core/test`.
4. Run plan lint on `specs/001-ira-command-plane/plan.md`.
5. Re-run doctor on a fixture hive to confirm `hiveReady`/`sliceAValidated` expectations.

---

## Verification Gates

| Gate | Applies To | Criteria | Owner |
|------|------------|----------|-------|
| OD-012 lock tests | W2 | Vitest proves live pid is not stolen by age; steal only dead pid + stable nonce | @qa |
| DISPATCH_PATH_REQUIRED | W5, W8 | Direct `begin-task` rejected when hive exists; internal path only via `dispatch-task` | @qa |
| dispatch-task hook order | W8 | Tests: deny before `begin-task`; host `null` queues intent, no host CLI | @qa |
| Hold ≠ review | W9 | `task-hold` / `task-abort` do not increment `reviewFailures` | @qa |
| Away CI table | W11 | `ci_absent` when `allowAbsentCi` false; heartbeat failure skips dispatch | @qa |
| Doctor readiness split | W12 | `hiveReady` independent of `engineRungReady`; `ready === hiveReady` | @tech-lead |
| Slice A four checks | W12 | Doctor sets `sliceAValidated` only when all OD-020 checks pass same run | @tech-lead |
| CLI/MCP parity | W15 | `contracts.test.ts` PASS; shared JSON for `dispatch-task`, `task-hold`, `task-abort` | @qa |
| Core suite | W16 | `pnpm exec vitest run packages/core/test` all PASS | @qa |
| Plan lint | W16 | `pnpm dlx tsx` + `lintPlan(plan.md)` returns `[]` | @tech-lead |

**Gate policy:** Any failing gate blocks merging the window; downstream windows must not start until the gate owner records pass.
