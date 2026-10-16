# Execution Map: Ira Hire Gallery

Parallel windows, model tiers (`economy` | `standard` | `frontier` only), verification gates, and rollback for feature `005-ira-hire-gallery`.

**Amendment:** OD-018 (2026-10-16) — Ask-Me `acknowledge` on `untrusted_import` **cancels** (`HIRE_ACK_CANCELS`, no persona/roster writes); only **`hire-spawn-confirm`** spawns; **`uiCopy.trustBanner`** identical for all `sourceKind`; **`SLICE_A_ONLY`** on confirm until doctor `sliceAValidated: true` (OD-020).

**Persona discovery:** `list-personas({ projectRoot: "/Users/macky/IRA/superspec" })` returned **no custom agents**; this map uses **fallback** roles from `superspec-route` (`@backend`, `@qa`, `@tech-lead`, `@security`).

**Upstream:** Forge assumes `specs/001-ira-command-plane` hive store, Ask-Me, roster, and hook registry are landed before **W10** (`T014`).

## Dependency DAG

| From | To | Reason |
|------|----|--------|
| T001 | T002 | Parse validates against hire schema |
| T002 | T003 | Sanitize runs on parsed manifest |
| T001 | T005 | Review JSON validates against schema |
| T003 | T005 | Review stores sanitization report + manifest |
| T001 | T007 | Gallery index zod schema |
| T005 | T006 | Ask-Me links to persisted review |
| T003 | T008 | Import pipeline sanitizes |
| T005 | T008 | Import creates review |
| T006 | T008 | Import opens Ask-Me |
| T007 | T008 | Gallery source loads catalog bytes |
| T005 | T009 | Review edits update stored review |
| T005 | T010 | Spawn loads pending review |
| T006 | T010 | Confirm resolves Ask-Me |
| T009 | T010 | Confirm merges operator edits and consents |
| T010 | T011 | Rollback tests extend spawn |
| T005 | T012 | Cancel/acknowledge loads review |
| T006 | T012 | Cancel/acknowledge resolves Ask-Me |
| T012 | T014 | Ask-Me answer delegate for `HIRE_ACK_CANCELS` |
| T004 | T013 | Matching uses normalized tags |
| T013 | T014 | Hook impl registered |
| T006 | T014 | `onUntrustedImport` delegate |
| T010 | T015 | Scoring attaches to spawned agents |
| T008 | T016 | CLI import handler |
| T009 | T016 | CLI review update |
| T010 | T016 | CLI `hire confirm` → `hireSpawnConfirm` only |
| T012 | T016 | CLI cancel + error codes |
| T016 | T017 | MCP mirrors CLI |
| T007 | T018 | Catalog consumed by gallery tests |
| T010 | T019 | Spawn writes persona paths |
| T014 | T019 | Doctor/hook bootstrap loaded |
| T008 | T020 | Pipeline import + equal warning |
| T010 | T020 | `hire-spawn-confirm` + `SLICE_A_ONLY` E2E |
| T012 | T020 | Acknowledge cancel E2E |
| T014 | T020 | Hooks registered in E2E |
| T018 | T020 | Curated gallery scenario |
| T014 | T021 | Exports after hooks |
| T017 | T021 | Exports include MCP wiring |
| T021 | T022 | Verify runs last |

**Graphical representation:**

```text
T001 ──┬──► T002 ──► T003 ──► T005 ──┬──► T006 ──► T008 ──► T010 ──┬──► T011
T004 ──┼──► T013 ─────────────────────┤         │              ├──► T012 ──► T014
       │                               ├──► T009 ─┘              ├──► T015
       └──► T007 ──► T018 ─────────────┘                         └──► T016 ──► T017 ──► T021 ──► T022
                    T010,T014 ──► T019
                    T008,T010,T012,T014,T018 ──► T020
```

Independent starts in **W1:** **T001**, **T004**.

## Parallel Windows

| Window | Tasks | Model class | Parallelization Boundary |
|--------|-------|-------------|---------------------------|
| **W1: Schema & tags** | T001, T004 | T001: `standard`; T004: `economy` | `schema.ts` / `constants.ts` vs `capabilities.ts`; no shared writes. |
| **W2: Parse & match prep** | T002, T013 | T002: `standard`; T013: `frontier` | `manifest.ts` vs `hooks-impl.ts` / capabilities tests. |
| **W3: Sanitize** | T003 | `frontier` | Untrusted-input + equal report shape (FR-013); single module. |
| **W4: Review store** | T005 | `frontier` | Hive JSON + `uiCopy.trustBanner`; blocks import/spawn. |
| **W5: Ask-Me & gallery** | T006, T007 | T006: `frontier`; T007: `standard` | `ask-me-bridge.ts` vs `gallery.ts`. |
| **W6: Edits & catalog ship** | T009, T018 | T009: `standard`; T018: `economy` | Review/skills vs repo `hire-gallery/` tree. |
| **W7: Import pipeline** | T008 | `frontier` | Unified `import.ts`; equal `trustBanner` for gallery/file; ⚠️ requires W3–W6. |
| **W8: hire-spawn-confirm** | T010 | `frontier` | Sole spawn writer; `SLICE_A_ONLY` + `HIRE_WARNING_LENGTH_MISMATCH` gates. |
| **W9: Spawn edge cases** | T011, T012 | T011: `frontier`; T012: `standard` | Rollback vs cancel/**acknowledge** (`HIRE_ACK_CANCELS`); run **T011** then **T012** (shared `spawn.ts`). |
| **W10: Hook registration** | T014 | `standard` | CLI/MCP bootstrap + Ask-Me answer delegate; needs **T012** + P-001 hooks. |
| **W11: Hire scoring** | T015 | `standard` | `score.ts` read-only on ledger signals. |
| **W12: CLI surface** | T016 | `standard` | `cli.ts` hire subcommands; confirm maps to `hire-spawn-confirm` only. |
| **W13: MCP surface** | T017 | `standard` | `mcp-server.ts` tool registration. |
| **W14: Discovery & E2E** | T019, T020 | `frontier` | SC-003 + OD-018 pipeline integration tests. |
| **W15: Package exports** | T021 | `economy` | `index.ts` re-exports. |
| **W16: Verify gate** | T022 | `economy` | Read-only suite + lint-plan + matrix. |

**Parallelization constraints:**

- ⚠️ Do not run **T008** before **W3** and **W4** and **W5** complete.
- ⚠️ Do not run **T014** before **T013**, **T006**, and **T012**; confirm P-001 Ask-Me + hook registry exist.
- ⚠️ In **W9**, land **T011** before **T012** (same `spawn.ts` writer).
- ⚠️ **W16** must run after **T021**.
- ⚠️ **W8** must not merge until tests prove `sliceAValidated: false` → `SLICE_A_ONLY` with zero roster/persona writes.

## Model Routing

| Task | Complexity | Model class | Rationale |
|------|------------|-------------|-----------|
| T001 | `moderate` | `standard` | Multi-schema zod + OD-018 banner constant |
| T002 | `moderate` | `standard` | Parse + size gates |
| T003 | `complex` | `frontier` | Untrusted-input sanitization + report parity |
| T004 | `mechanical` | `economy` | Deterministic tag normalization |
| T005 | `complex` | `frontier` | Locked review persistence |
| T006 | `complex` | `frontier` | HITL Ask-Me integration |
| T007 | `moderate` | `standard` | Gallery index + search |
| T008 | `complex` | `frontier` | Four-source import + equal warning |
| T009 | `moderate` | `standard` | Review edits + consents |
| T010 | `complex` | `frontier` | Sole spawn writer + Slice A gate |
| T011 | `complex` | `frontier` | Rollback + conflict semantics |
| T012 | `moderate` | `standard` | Cancel + acknowledge (`HIRE_ACK_CANCELS`) |
| T013 | `complex` | `frontier` | Capability routing tie-breaks |
| T014 | `moderate` | `standard` | Hook + Ask-Me answer wiring |
| T015 | `moderate` | `standard` | Score aggregation |
| T016 | `moderate` | `standard` | CLI JSON parity |
| T017 | `moderate` | `standard` | MCP contracts |
| T018 | `mechanical` | `economy` | Curated catalog provision |
| T019 | `complex` | `frontier` | list-personas timing (SC-003) |
| T020 | `complex` | `frontier` | SC-002 + OD-018 E2E |
| T021 | `mechanical` | `economy` | Index exports |
| T022 | `mechanical` | `economy` | Verify-only gate |

**Tier mapping:** `mechanical→economy`; `moderate→standard`; `complex→frontier`. Use MCP `route-model` at forge time for role/attempt/kind biases.

## Personas

| Window | Primary Persona | Secondary Persona | Responsibilities |
|--------|-----------------|---------------------|------------------|
| W1–W3 | @backend | @security | Schema, sanitize rules, executable rejection, report parity |
| W4–W7 | @backend | @tech-lead | Review store, Ask-Me, import pipeline, equal `trustBanner` |
| W8–W9 | @backend | @security | `hire-spawn-confirm` only, rollback, cancel, acknowledge cancel |
| W10–W11 | @tech-lead | @backend | HireHooks + capability routing |
| W12–W13 | @backend | — | CLI/MCP JSON parity (FR-009) |
| W14 | @qa | @security | Integration: OD-018 + SC-002/SC-003 |
| W15 | @backend | — | Public exports |
| W16 | @qa | @tech-lead | Full verify, lint-plan, matrix |

**Persona definitions (fallback):**

- `@backend`: Owns `packages/core/src/hire/*`, hive hire paths, CLI/MCP handlers.
- `@qa`: Owns Vitest hire suite, SC-002/SC-003 integration proofs, OD-018 E2E.
- `@tech-lead`: Owns cross-feature contracts with P-001 (`HireHooks`, Ask-Me `untrusted_import`, `hire-spawn-confirm` boundary).
- `@security`: Reviews sanitization, default-deny allowlists, FR-013/OD-018 same-path policy.

## Rollback

| Window | Rollback Strategy |
|--------|-------------------|
| W1–W3 | Revert commits touching `packages/core/src/hire/schema.ts`, `constants.ts`, `manifest.ts`, `sanitize.ts`, `capabilities.ts`; no hive hire data. |
| W4–W7 | Revert hire review/import modules; delete `.superspec/hive/hire/reviews/*.json` if created in bad runs. |
| W8–W9 | Revert `spawn.ts` / `ask-me-bridge.ts`; remove stray persona files under `.cursor/agents/`, `.claude/agents/`, `.codex/agents/`; repair roster via hive doctor / manual edit of `roster.json`. |
| W10 | Revert hook registration commits; Command Plane falls back to no-op `HireHooks`. |
| W11–W13 | Revert score/CLI/MCP commits; hive hire scores directory safe to delete. |
| W14 | Revert integration tests only. |
| W15 | Revert export commits. |
| W16 | No rollback — fix failures in place; do not merge if verify gate fails. |

**General rollback process:**

1. Identify the failed window and task ids.
2. Gather commits: `git log --oneline -- packages/core/src/hire packages/core/src/cli.ts packages/core/src/mcp-server.ts hire-gallery/`
3. Revert the range: `git revert -n <oldest>^..<newest> && git commit -m "revert: 005-ira-hire-gallery window Wn"`
4. Run `pnpm exec vitest run packages/core/test/hire` and lint-plan on `specs/005-ira-hire-gallery/plan.md`.
5. If hive hire JSON is corrupt, delete `.superspec/hive/hire/` and re-import reviews (no roster impact if spawn never confirmed).

## Verification Gates

| Gate | Applies To | Criteria | Type | Blocks | Owner |
|------|------------|----------|------|--------|-------|
| **Unit tests (hire/**)** | W1–W11 | `pnpm exec vitest run packages/core/test/hire` exits 0 | automated | forge | @qa |
| **Sanitize rejection** | W3, W14 | Tests prove 100% executable/secret fixtures rejected (SC-005) | automated | forge | @security |
| **Equal trustBanner (OD-018)** | W7, W14 | Gallery and file import responses share identical `uiCopy.trustBanner`; curated may add `trustHint` only | automated | forge | @security |
| **Acknowledge cancels (OD-018)** | W9, W14 | `handleUntrustedImportAskMeAnswer` with `acknowledge` returns `HIRE_ACK_CANCELS`; roster count unchanged | automated | forge | @qa |
| **hire-spawn-confirm only (FR-014)** | W8, W12–W13 | No persona/roster write except via `hire-spawn-confirm` handler; other paths return `HIRE_SPAWN_CONFIRM_REQUIRED` where applicable | automated | forge | @tech-lead |
| **Slice A spawn no-op (OD-020)** | W8, W14 | `hireSpawnConfirm` with `sliceAValidated: false` → `SLICE_A_ONLY`; zero persona/roster writes | automated | forge | @tech-lead |
| **SC-002 no pre-confirm spawn** | W14 | `pipeline.integration.test.ts` passes — roster count 0 before confirm | automated | forge | @qa |
| **SC-003 list-personas** | W14 | `list-personas.integration.test.ts` — new persona within 5s after confirm (Slice A true) | automated | forge | @qa |
| **CLI/MCP parity** | W12–W13 | `contracts.test.ts` lists all `hire-*` tools; CLI JSON matches MCP shapes | automated | forge | @backend |
| **Curated catalog** | W6 | `hire-gallery/index.json` validates; gallery search returns ≥2 entries | automated | forge | @backend |
| **Typecheck** | W15–W16 | `pnpm exec tsc -p packages/core` exits 0 | automated | ship | @tech-lead |
| **lint-plan** | W16 | `lintPlan(plan.md)` returns zero findings | automated | plan, forge | @tech-lead |
| **build-matrix** | W16 | MCP `build-matrix` reports 0 FR gaps for FR-001–FR-014 | automated | forge | @tech-lead |
| **P-001 hook smoke** | W10, W16 | Idle dispatch uses registered `matchCapabilities` in command-plane tests | automated | forge | @tech-lead |
| **Architecture sign-off** | W16 | @tech-lead confirms OD-018: acknowledge cancels; confirm-only spawn; equal warning; no engine spawn on hire confirm | human | ship | @tech-lead |

**Gate policy:**

- Any automated gate failure blocks merging that window’s commits.
- Human sign-off on W16 required before Command Center (P-002) wires hire panels to live APIs.
- Untrusted-import Ask-Me items must remain open until **`hire-spawn-confirm`**, **`hire-spawn-cancel`**, or **`acknowledge`** (cancel) in all automated scenarios.
