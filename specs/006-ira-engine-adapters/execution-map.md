# Execution Map: Ira Engine Adapters

An execution map coordinates parallel task windows, model routing (tiers only), persona assignments, and verification gates for feature `006-ira-engine-adapters`. Persona discovery via `list-personas({ projectRoot: "/Users/macky/IRA/superspec" })` returned no registered agents; this map uses **fallback** roles from `superspec-route` (`@backend`, `@qa`, `@tech-lead`, `@security`).

**Amendment alignment:** OD-009 (host `null`, `HOST_SPAWN_FORBIDDEN`, supervisor allowlist), OD-015 (detached supervisor, hook fail-closed), OD-019 (env scrub, worktree ≠ sandbox), OD-020 (Slice A P0 vs deferred non-host spawn), OD-014 (`hiveReady` vs `engineRungReady`).

**Forge gate:** Do not start **DW1–DW3** until doctor reports `sliceAValidated: true` (see `program.md` forge order).

## Dependency DAG

| From | To | Reason |
|------|----|--------|
| T001 | T002 | Catalog uses engine zod types |
| T001 | T004 | Policy schema types |
| T001 | T009 | Normalizer uses event types |
| T002 | T003 | Detection reads catalog binaries |
| T002 | T005 | Bind validates presets |
| T002 | T007 | Matrix lists catalog rows |
| T002 | T012 | Model allowlists from catalog |
| T002 | T016 | MCP detect uses catalog version |
| T003 | T005 | Bind requires installed check |
| T003 | T006 | Health refresh uses detect |
| T003 | T016 | engines-detect handler |
| T004 | T005 | Bind writes via engines store |
| T004 | T006 | health.json layout |
| T004 | T008 | local-pack.json path |
| T004 | T010 | Failover reads policy |
| T004 | T011 | Review policy flag in policy.json |
| T005 | T012 | Resolve model reads roster row |
| T005 | T014 | Dispatch loads roster binding |
| T005 | T016 | engines-bind handler |
| T006 | T007 | Matrix reads health cache |
| T006 | T010 | Failover uses health |
| T006 | T011 | Review picks healthy engines |
| T006 | T018 | Doctor uses health |
| T007 | T009 | Normalizer uses redact helper |
| T008 | T010 | Local rung context gate |
| T008 | T012 | Local-pack model resolution |
| T008 | T016 | local-pack-set tool |
| T008 | T018 | Doctor context findings |
| T009 | T013 | Env scrub / spawn spec uses normalizer types |
| T009 | T015 | hook-ingest uses normalizer |
| T010 | T014 | Dispatch failover selection |
| T011 | T014 | Cross-engine review in dispatch |
| T012 | T013 | Spawn spec needs vendor model |
| T012 | T014 | Dispatch resolves model |
| T013 | T014 | Dispatch uses spawn spec + env scrub |
| T014 | T019 | register exports EngineHooks impl |
| T015 | T019 | hook-ingest registered on CLI |
| T016 | T017 | CLI mirrors MCP handlers |
| T016 | T019 | MCP tools live before registration |
| T015 | T018 | Doctor checks hook install |
| T019 | T020 | Slice A integration needs registered hooks |
| T020 | T021 | Slice A verify after integration |
| T021 | T022 | Deferred spawn after Slice A track verified |
| T014 | T022 | Dispatch connects to live supervisor |
| T022 | T023 | Post–Slice A integration |
| T023 | T024 | Full verify last |

**Graphical representation:**

```text
Slice A (P0):
T001 ──┬──► T002 ──► T003 ──┬──► T005 ──► T012 ──► T013 ──► T014 ──► T019 ──► T020 ──► T021
       │                    │         │                              ▲
       ├──► T004 ───────────┼──► T006 ──► T007 ──► T009 ──► T015 ───┤
       │                    │         │         │                    │
       │                    │         ├──► T010 ──┘                    │
       │                    │         └──► T011 ──────────────────────┘
       │                    └──► T008 ──► T010
T016 ──► T017        T018 (after T006,T008,T015)

Post–Slice A (deferred, gated):
T021 ──► T022 ──► T023 ──► T024
         ▲
         └── requires sliceAValidated + T014 dispatch wiring
```

Independent after **T001**: **T004** (parallel with **T002** once T001 done). **T008** starts after **T004**, parallel with **T003** chain.

## Parallel Windows — Slice A (P0)

| Window | Tasks | Model class | Parallelization Boundary |
|--------|-------|-------------|---------------------------|
| **W1: Schemas** | T001 | `standard` | Single `schema.ts` / `types.ts`. |
| **W2: Catalog & hive layout** | T002, T004 | `standard` | `catalog.ts` vs `paths.ts` / `store.ts`; no shared writes. |
| **W3: Detect & local pack** | T003, T008 | T003: `economy`; T008: `frontier` | `detect.ts` vs `local-pack.ts`. Requires T004 from W2. |
| **W4: Bind & health** | T005, T006 | T005: `frontier`; T006: `standard` | `bind.ts` vs `health.ts`. |
| **W5: Matrix & failover** | T007, T010, T011 | T007: `standard`; T010: `frontier`; T011: `standard` | Separate modules; depend on W4. |
| **W6: Normalize & resolve model** | T009, T012 | T009: `frontier`; T012: `standard` | T009 needs T007; T012 needs T005 + T008. |
| **W7: Env scrub & spawn spec** | T013 | `frontier` | Exclusive on `env-scrub.ts` + spawn spec (no live child). |
| **W8: Dispatch Slice A** | T014 | `frontier` | `dispatch.ts`, `dispatch-queue.ts`, `host-spawn-guard.ts`. |
| **W9: Hook bridge & MCP** | T015, T016 | `standard` | `hook-ingest.ts` vs `mcp-handlers.ts`. |
| **W10: CLI mirror** | T017 | `economy` | `cli-engines.ts` after MCP handlers. |
| **W11: Doctor split readiness** | T018 | `standard` | `doctor-findings.ts`; `hiveReady` ≠ `engineRungReady`. |
| **W12: Registration** | T019 | `standard` | Hook try/catch + startup wiring. |
| **W13: Slice A integration** | T020 | `frontier` | Host null, queue, `SLICE_A_ONLY`, zero host spawn. |
| **W14: Slice A verify** | T021 | `economy` | Lint + vitest (exclude post–Slice A integration). |

**Slice A constraints:**

- ⚠️ Do not run **T014** before **T005**, **T010**, **T011**, **T012**, and **T013** complete.
- ⚠️ Do not run **T019** before **T014**, **T015**, and **T016** complete.
- ⚠️ **W14** must run after **T020**; marks Slice A forge complete, not full P-006.

## Parallel Windows — Post–Slice A deferred

| Window | Tasks | Model class | Gate |
|--------|-------|-------------|------|
| **DW1: Detached supervisor** | T022 | `frontier` | `sliceAValidated: true`; only `opencode`/`crush`/`aider`/`custom`. |
| **DW2: Post–Slice A integration** | T023 | `frontier` | After DW1; detached pid ≠ MCP pid; env scrub fixtures. |
| **DW3: Full verify** | T024 | `economy` | Full vitest + build-matrix zero uncovered FRs. |

**Deferred constraints:**

- ⚠️ **DW1–DW3** MUST NOT start until doctor `sliceAValidated: true` and **T021** passes.
- ⚠️ Do not forge **T022** while Slice A doctor checks still fail.

## Model Routing

| Task | Complexity | Model class | Rationale |
|------|------------|-------------|-----------|
| T001 | `moderate` | `standard` | Multi-entity zod contracts |
| T002 | `moderate` | `standard` | Versioned preset table |
| T003 | `mechanical` | `economy` | PATH lookup recipe |
| T004 | `moderate` | `standard` | Hive engines bootstrap |
| T005 | `complex` | `frontier` | Roster bind validation + atomic write |
| T006 | `moderate` | `standard` | Auth/health signal mapping |
| T007 | `moderate` | `standard` | Matrix projection + redaction |
| T008 | `complex` | `frontier` | Multi-backend 64k probes, fail-closed |
| T009 | `complex` | `frontier` | Event allowlist and token honesty |
| T010 | `complex` | `frontier` | Failover ladder + beforeDispatch re-entry |
| T011 | `moderate` | `standard` | Cross-engine review policy |
| T012 | `moderate` | `standard` | Tier vs vendor model resolution |
| T013 | `complex` | `frontier` | OD-019 env scrub + spawn spec |
| T014 | `complex` | `frontier` | Host null, queue, SLICE_A_ONLY |
| T015 | `moderate` | `standard` | Hook ingest + install bridge |
| T016 | `moderate` | `standard` | MCP JSON tool registration |
| T017 | `mechanical` | `economy` | CLI mirror of MCP |
| T018 | `moderate` | `standard` | hiveReady vs engineRungReady |
| T019 | `moderate` | `standard` | Hook fail-closed registration |
| T020 | `complex` | `frontier` | Slice A integration fixtures |
| T021 | `mechanical` | `economy` | Slice A verify gate |
| T022 | `complex` | `frontier` | Live detached supervisor |
| T023 | `complex` | `frontier` | SC-011/SC-012 integration |
| T024 | `mechanical` | `economy` | Full FR verify |

**Tier mapping:** `mechanical→economy`; `moderate→standard`; `complex→frontier`.

## Personas

| Window | Primary Persona | Secondary Persona | Responsibilities |
|--------|-----------------|-------------------|------------------|
| W1–W2 | @tech-lead | @backend | Schema/catalog vs amendment invariants |
| W3–W6 | @backend | @security | Detection, health, matrix redaction, local gate |
| W7–W8 | @backend | @tech-lead | Env scrub, host-delegate dispatch, spawn guards |
| W9–W10 | @backend | — | MCP/CLI JSON parity (Option D) |
| W11 | @backend | @qa | Doctor split + worktree/sandbox independence |
| W12–W13 | @backend | @tech-lead | Hook registration + Slice A integration |
| W14 | @qa | @tech-lead | Slice A verification gate |
| DW1–DW2 | @backend | @security | Detached supervisor + env scrub proof |
| DW3 | @qa | @tech-lead | Full FR matrix sign-off |

## Rollback

| Window | Rollback Strategy |
|--------|-------------------|
| W1–W2 | Revert commits touching `engines/types.ts`, `catalog.ts`, `paths.ts`. |
| W3–W6 | Revert module commits; delete test hive dirs under `/tmp`. |
| W7–W10 | Revert dispatch-queue / env-scrub / MCP commits; vitest `packages/core/test/engines`. |
| W11–W14 | Revert doctor/register/integration commits; revert entrypoint hook init. |
| DW1–DW3 | Revert `supervise-runner` and post–Slice A tests only; Slice A path remains live. |

**General rollback process:**

1. Identify window (W1–W14 or DW1–DW3).
2. `git log --oneline -- packages/core/src/engines specs/006-ira-engine-adapters/`
3. `git revert -n <range> && git commit -m "revert: engines window Wn"`
4. Run vitest for affected `packages/core/test/engines` paths.
5. Do not enable non-host supervisor spawn until DW3 passes.

## Verification Gates

| Gate | Applies To | Criteria | Owner |
|------|------------|----------|-------|
| Schema/catalog | W1–W2 | `pnpm exec vitest run packages/core/test/engines/schema.test.ts packages/core/test/engines/catalog.test.ts` PASS | @backend |
| Secret-free matrix | W5 | Matrix JSON has zero forbidden key names; no `sk-`/`ghp_` substrings | @security |
| Local 64k fail-closed | W3, W5, W11 | Below/unknown context → engine finding only; `hiveReady` unchanged in tests | @backend |
| Host spawn forbidden | W8, W13 | Integration: zero children argv0 `claude`/`codex`/`cursor-agent`/`agent`; queue file mode `0600` | @tech-lead |
| SLICE_A_ONLY pre-validate | W8, W13 | 100% `opencode`/`crush`/`aider`/`custom` dispatch → `SLICE_A_ONLY`, zero children | @tech-lead |
| Env scrub | W7, DW2 | Supervisor env = allowlist only; no spread of `process.env` | @security |
| Doctor split | W11 | `engineRungReady` false does not force `hiveReady` false | @qa |
| Hook fail-closed | W12 | Hook throw → deny; MCP process does not exit | @tech-lead |
| MCP/CLI parity | W9–W10 | Same JSON for `engines-detect` MCP vs CLI | @backend |
| Plan lint clean | W14, DW3 | `lint-plan` on `plan.md` returns `[]` | @qa |
| FR traceability | DW3 | `build-matrix plan.md spec.md` zero uncovered FRs | @qa |
| Tier invariant | DW3 | `model-router.test.ts` PASS — tiers `economy` \| `standard` \| `frontier` only | @qa |

**Gate policy:** W14 gates Slice A forge. DW3 gates full P-006 ship including detached supervisor.
