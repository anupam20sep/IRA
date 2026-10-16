# Execution Map: Ira Learning Memory

An execution map coordinates parallel task windows, model routing (tiers only), persona assignments, and verification gates for feature `003-ira-learning-memory`. Persona discovery via `list-personas({ projectRoot: "/Users/macky/IRA/superspec" })` returned no custom agents; this map uses the **fallback** roles from `superspec-route` (`@backend`, `@qa`, `@tech-lead`).

**Amendment context (OD-016, OD-020):** Distill and CONSOLIDATE run off the `record-result` stack. SQLite is optional; markdown is canonical with capped scan fallback. Pattern **writes** from distill/consolidate are **post-Slice-A** only (`sliceAValidated: true`). RETRIEVE, query, and forge `saveState` stay live under Slice A.

## Post-Slice-A vs live-under-Slice-A

| Surface | Under Slice A (`sliceAValidated: false`) | Post-Slice-A |
|---------|------------------------------------------|--------------|
| Forge `record-result` / `saveState` | Live | Live |
| RETRIEVE / `begin-task` injection | Live (markdown fallback if no index) | Live |
| `patterns-list` / CLI query | Live (markdown fallback) | Live |
| DISTILL / CONSOLIDATE pattern file writes | **No-op `SLICE_A_ONLY`** | Live (off-stack) |
| Background distill scheduler registration | Live (skipped write when gated) | Live |

Windows marked **post-Slice-A** below require `sliceAValidated: true` in acceptance fixtures that assert new `*.md` files or consolidate merges.

## Dependency DAG

| From | To | Reason |
|------|----|--------|
| T003 | T004 | Config schema references pattern types |
| T002 | T006 | Pattern I/O needs resolved patternsDir |
| T003 | T006 | Frontmatter validation on write |
| T002 | T007 | Index paths and lock file |
| T003 | T007 | Meta/FTS row shape |
| T006 | T007 | Reindex reads markdown files |
| T004 | T020 | Slice gate uses config + feature scope |
| T002 | T020 | Store root for doctor probe registration |
| T020 | T010 | CONSOLIDATE write gate |
| T020 | T011 | DISTILL write gate |
| T003 | T008 | InjectionSummary types |
| T004 | T008 | Caps and judgeMinScore from config |
| T006 | T009 | Markdown scan reads pattern files |
| T007 | T009 | FTS search backend |
| T008 | T009 | JUDGE runs inside retrieve |
| T006 | T010 | Consolidate updates markdown |
| T007 | T010 | Consolidate updates index rows |
| T005 | T011 | Redact before persist |
| T006 | T011 | Write distilled markdown |
| T007 | T011 | Upsert after distill when index loads |
| T004 | T011 | Feature distill flags |
| T009 | T012 | RETRIEVE phase |
| T010 | T012 | CONSOLIDATE phase |
| T011 | T012 | DISTILL phase |
| T020 | T012 | Write gate in background chain |
| T012 | T013 | Hooks delegate to pipeline |
| T013 | T014 | Forge wiring calls install/hooks |
| T009 | T014 | RETRIEVE on begin-task / route-model |
| T012 | T014 | Off-stack scheduler on record-result |
| T014 | T021 | OD-016 / Slice A integration proofs |
| T020 | T021 | Slice A fixtures |
| T007 | T015 | Query uses index when available |
| T006 | T015 | Markdown fallback listing |
| T009 | T015 | Shared scan helpers |
| T003 | T015 | Response DTO validation |
| T015 | T016 | MCP/CLI call query module |
| T021 | T017 | Compaction test needs post-Slice-A distill fixture |
| T016 | T018 | Exports include query/install |
| T017 | T019 | Verify includes integration proof |
| T018 | T019 | Verify includes export surface |
| T021 | T019 | Verify includes OD-016 proofs |

**Graphical representation:**

```text
T001   T002   T003   T005
  |      |      |
  |      +------+------► T006 ──► T007 ──┬──► T009 ──► T012 ──► T013 ──► T014 ──► T021 ──► T017 ──┐
  |             |                        |                    |              |                      ├──► T019
  |             └──► T004 ──► T008 ──────┘                    |              |                      |
  |             |      |                                       |              └──► T016 ──► T018 ──┘
  |             |      └──► T020 ──► T011 ──► T012            |
  |             └──► T010 ◄── T007/T006/T020                   |
  └────────────────────────── T011 ──► T012
```

Independent starts: **T001**, **T002**, **T003**, **T005** (no mutual dependencies).

## Parallel Windows

| Window | Tasks | Model class | Parallelization Boundary |
|--------|-------|-------------|---------------------------|
| **W1: Bootstrap** | T001, T002, T003, T005 | T001: `economy`; T002: `frontier`; T003: `standard`; T005: `standard` | Separate files; no shared writes. |
| **W2: Config & I/O** | T004, T006 | T004: `economy`; T006: `standard` | T004 → `config.ts`; T006 → `pattern-io.ts`. ⚠️ Both require T003 complete. |
| **W2b: Slice A gate** | T020 | `standard` | Exclusive `slice-gate.ts`; requires T002 + T004. Live under Slice A; gates **post-Slice-A writes**. |
| **W3: Index (optional FTS)** | T007 | `frontier` | Single writer on `index-sqlite.ts` + `pattern-index.ts`; needs T006. Markdown fallback when binding fails (OD-016). |
| **W4: Judge & consolidate** | T008, T010 | T008: `standard`; T010: `standard` | T008 → `judge.ts`; T010 → `consolidate.ts`. ⚠️ T010 **post-Slice-A** for writes; needs T007 + T020. |
| **W5: Retrieve (live Slice A)** | T009 | `frontier` | FTS or capped markdown scan; needs T007 + T008 + T006. |
| **W6: Distill** | T011 | `frontier` | **Post-Slice-A** for pattern writes; index upsert optional; needs T020. |
| **W7: Pipeline / off-stack scheduler** | T012 | `frontier` | `scheduleLearningAfterRecordResult` — OD-016; no handler `await`. |
| **W8: Hooks** | T013 | `standard` | `hooks.ts` + `install.ts`. |
| **W9: Forge wiring** | T014 | `frontier` | Return forge JSON before background distill; touches cli/mcp/router/ledger. |
| **W9b: OD-016 / Slice A proofs** | T021 | `frontier` | Test-only; needs W9 + W2b. |
| **W10: Query module** | T015 | `standard` | Read-only; markdown fallback; sequence after W5. |
| **W11: CLI/MCP list** | T016 | `standard` | Extends cli/mcp after W10; after W9. |
| **W12: Compaction proof** | T017 | `frontier` | **Post-Slice-A** distill fixture; after W9b. |
| **W13: Exports** | T018 | `economy` | `index.ts` re-exports. |
| **W14: Verify gate** | T019 | `economy` | Read-only verification. |

**Parallelization constraints:**

- ⚠️ Do not run **T006** or **T004** before **T003** completes.
- ⚠️ Do not run **T020** before **T004** completes.
- ⚠️ Do not run **T007** before **T006** completes.
- ⚠️ Do not run **T010** or **T011** before **T020** completes (write gate).
- ⚠️ Do not run **T009** before **W3** and **T008** complete.
- ⚠️ Do not run **T014** before **T013** and **T012** complete.
- ⚠️ Do not run **T021** before **T014** completes.
- ⚠️ **T016** must not start before **T015** and **T014** (shared cli/mcp registration order).
- ⚠️ **W14** must run last.

## Model Routing

| Task | Complexity | Model class | Rationale |
|------|------------|-------------|-----------|
| T001 | `mechanical` | `economy` | Dependency + gitignore checklist |
| T002 | `complex` | `frontier` | Root resolution and traversal safety |
| T003 | `moderate` | `standard` | Zod contracts for pattern model |
| T004 | `mechanical` | `economy` | Config defaults |
| T005 | `moderate` | `standard` | Redaction heuristics |
| T006 | `moderate` | `standard` | Atomic markdown I/O |
| T007 | `complex` | `frontier` | FTS5 + optional binding degrade |
| T008 | `moderate` | `standard` | Scoring and byte caps |
| T009 | `complex` | `frontier` | Signal + FTS + markdown scan |
| T010 | `moderate` | `standard` | Merge/demote rules (gated writes) |
| T011 | `complex` | `frontier` | Distill from reports + Slice A gate |
| T012 | `complex` | `frontier` | Off-stack orchestration (OD-016) |
| T013 | `moderate` | `standard` | P-001 hook adapter |
| T014 | `complex` | `frontier` | Non-blocking forge handlers |
| T015 | `moderate` | `standard` | Query pagination + markdown fallback |
| T016 | `moderate` | `standard` | MCP/CLI parity |
| T017 | `complex` | `frontier` | Compaction survival integration |
| T018 | `mechanical` | `economy` | Package re-exports |
| T019 | `mechanical` | `economy` | Verify-only suite run |
| T020 | `moderate` | `standard` | Slice A write gate (OD-020) |
| T021 | `complex` | `frontier` | OD-016 return-path integration proofs |

**Tier mapping:** `mechanical→economy`; `moderate→standard`; `complex→frontier`. Use MCP `route-model` at forge time for role/attempt/kind biases.

## Personas

| Window | Primary Persona | Secondary Persona | Responsibilities |
|--------|-----------------|-------------------|------------------|
| W1 | @tech-lead | @backend | Path safety and schema review |
| W2 | @backend | — | Config and markdown I/O |
| W2b | @tech-lead | @backend | Slice A gate vs forge live paths |
| W3 | @backend | @tech-lead | FTS optional + reindex |
| W4 | @backend | @qa | Judge/consolidate; post-Slice-A writes |
| W5 | @backend | — | Retrieval + markdown fallback |
| W6 | @tech-lead | — | Distill semantics (gated) |
| W7 | @tech-lead | @backend | OD-016 off-stack scheduler |
| W8 | @backend | @tech-lead | Hook registration order vs P-001 |
| W9 | @tech-lead | @qa | Forge return before distill |
| W9b | @qa | @tech-lead | OD-016 / Slice A proofs |
| W10 | @backend | — | Query contract + fallback |
| W11 | @backend | @qa | MCP/CLI JSON parity |
| W12 | @qa | @tech-lead | SC-003 compaction test |
| W13 | @backend | — | Public exports |
| W14 | @qa | @tech-lead | Final gate |

**Fallback persona definitions:**

- `@backend`: database, storage, service layer, API contracts
- `@qa`: test strategy, coverage, integration scenarios
- `@tech-lead`: architecture, cross-cutting gates, hook ordering

## Rollback

| Window | Rollback Strategy |
|--------|-------------------|
| W1 | Revert commit; remove dependency if unused |
| W2–W8 | Revert commits touching `learning-memory/`; delete local `.superspec/patterns/` test artifacts |
| W9 | Revert forge handler commits; learning disabled via missing config still works |
| W9b | Revert test-only commits |
| W10–W11 | Revert query CLI/MCP registration; markdown store remains |
| W12–W13 | Revert test/export commits only |
| W14 | Fix failures in place; do not merge if gate fails |

**General rollback process:**

1. Identify the window to revert.
2. Gather commits for that window (`git log --oneline`).
3. Create revert commit: `git revert -n <range> && git commit -m "revert: learning-memory Wn"`.
4. Run `pnpm exec vitest run packages/core/test`.
5. Confirm forge tools with learning disabled match pre-feature behavior.

## Verification Gates

| Gate | Applies To | Criteria | Owner |
|------|------------|----------|-------|
| Unit tests green | W1–W13 | `pnpm exec vitest run packages/core/test/learning-memory` passes | @qa |
| Plan lint clean | W14 | `lint-plan` on `plan.md` returns zero findings | @tech-lead |
| OD-016 non-blocking | W7, W9, W9b, W14 | `record-result` returns before slow distill; distill throw does not change exit code | @qa |
| Markdown fallback | W3, W5, W10, W14 | RETRIEVE/query succeed with `indexAvailable: false` | @backend |
| Slice A no-write | W2b, W6, W9b, W14 | With `sliceAValidated: false`, zero new pattern `*.md` from distill/consolidate | @tech-lead |
| Forge standalone | W9, W14 | With `learning.json` `enabled: false`, begin-task/record-result output unchanged vs baseline | @qa |
| No secret persist | W6, W14 | Redact tests pass; distill skips credential-like strings | @security |
| Index rebuildable | W3, W14 | `reindexFromMarkdown` reproduces RETRIEVE fixtures when SQLite loads | @backend |
| Injection cap | W4, W14 | Combined injection ≤ 2048 bytes in acceptance tests (SC-005) | @qa |
| Compaction survival | W12, W14 | SC-003 test passes (10 state re-inits, post-Slice-A seed) | @qa |

**Gate policy:** Any failing gate blocks merge for the window and downstream windows until fixed. W14 must pass all gates before forge ship for P-003.
