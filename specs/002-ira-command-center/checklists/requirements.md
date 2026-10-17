# Specification Quality Checklist: Ira Command Center

**Purpose**: Validate `spec.md` completeness and quality before refine / architect  
**Created**: 2026-09-06  
**Feature**: `specs/002-ira-command-center`  
**Type**: product  
**Validator**: superspec-scope (P-002)

## Content Quality

- [x] **PASS** — Functional requirements stay WHAT/WHY (no languages, frameworks, or transport choices in FRs)
- [x] **PASS** — Spec is written for stakeholders (Operator, Ira, views, outcomes) rather than implementers
- [x] **PASS** — All mandatory template sections are filled (Required Reading, stories, FRs, entities, SCs, Assumptions)
- [x] **PASS** — **Type**: product is set (not a template placeholder)
- [x] **PASS** — Visual language is explicitly OPEN (FR-016 / OD-001); no art direction locked
- [x] **PASS** — Voice is P3 / OPEN (User Story 12, FR-021 / OD-003) and does not gate P1

## Requirement Completeness

- [x] **PASS** — `[NEEDS CLARIFICATION]` count is 2 (max 3)
- [x] **PASS** — Every FR is concrete and testable (Given/When/Then or measurable board behavior)
- [x] **PASS** — No FR line contains TBD / TODO / FIXME
- [x] **PASS** — Success criteria are measurable and technology-agnostic (time, counts, 100% cases, 5-of-5 actions)
- [x] **PASS** — Success criteria do not name frameworks, languages, or protocols
- [x] **PASS** — Edge cases cover Plane-down, empty stores, dual steer, stale data, voice misfire, illegal transitions
- [x] **PASS** — Scope is bounded (depends on P-001; siblings own hive/learn/spend-write/hire/engines)
- [x] **PASS** — Dependencies and assumptions are explicit (P-001, Munder IA, localhost Operator, no Electron required)

## User Stories

- [x] **PASS** — 12 stories, each independently demonstrable
- [x] **PASS** — Priorities assigned (P1 × 4, P2 × 7, P3 × 1)
- [x] **PASS** — Every story has Why, Independent Test, and Given/When/Then scenarios
- [x] **PASS** — P1 slice (open board + kanban steer + Ask-Me + brief) is a viable oversight MVP
- [x] **PASS** — Voice (UI-007) is isolated as P3 and cannot block P1 (SC-007)

## Feature Readiness

- [x] **PASS** — UI-001…UI-007 and CP-002 are crosswalked to FR-###
- [x] **PASS** — GOD views covered: Tasks, Fleet, Activity, Memory/patterns, Spend, Ask-Me, Triggers, morning brief
- [x] **PASS** — Prior art cites Munder `CommandCenterPanel`, `TasksKanban`, `AskMeTab`, `WorkersTab`, `CostHud` plus NEXUS-7 / Sentient-OS / KITT inspiration URLs
- [x] **PASS** — IA preference is adapt-Munder-board, not a new invention (FR-022)
- [x] **PASS** — Option D invariant stated: board is not a second system of record (FR-018)
- [ ] **FAIL (expected)** — Zero `[NEEDS CLARIFICATION]` remaining — 2 remain for `superspec-refine` (see below)

## Clarifications (≤3)

| # | Marker | Location | Why it cannot be defaulted |
|---|--------|----------|----------------------------|
| 1 | Visual language / art direction | FR-016; User Story 11; OD-001 / OPEN-001 | Parent forbids silently locking look; inspiration only |
| 2 | Voice timing and speech approach | FR-021; User Story 12; OD-003 / UI-007 | In vision; P3; STT/TTS/wake-word unset |

No third marker. Access (localhost Operator), IA (adapt Munder), and live-update *transport* were defaulted in Assumptions.

## Notes

- Prior Art lists upstream **file paths and URLs** for later architect/forge. That is citation, not an implementation choice in the FRs.
- Next stage: `superspec-refine` to resolve OD-001 and OD-003, or `superspec-architect` if those stay explicitly OPEN into design.
- Sibling specs (P-001, P-003, P-004) may still be in scope; empty-state FRs are written so this board can be demonstrated before those stores fill.

---

# Forge Acceptance Sign-off: Ira Command Center

**Purpose**: Close T025 / execution-map W13 gates after automated forge (T001–T024)  
**Feature**: `specs/002-ira-command-center`  
**Signed**: 2026-10-17  
**Owners**: @tech-lead (SC-008), @backend (Dispatch + steer)

## SC-001 … SC-010

| SC | Result | Evidence |
|----|--------|----------|
| SC-001 | PASS | Shell + Tasks/Fleet/brief views surface done/blocked/doing from snapshot (`shell.test.ts`, `tasks-view.test.ts`, `brief-view.test.ts`) |
| SC-002 | PASS | `shell.test.ts` renders brief + seven GOD hash routes; `ShellView` has no floor route (FR-015) |
| SC-003 | PASS | SSE + 1s poll fallback (`sse.test.ts`, `client-bootstrap.test.ts`) |
| SC-004 | PASS | Board HTTP → Plane argv: dispatch / pause / abort / reassign / ask-me answer (`http-routes.test.ts`, `ask-me-view.test.ts`) |
| SC-005 | PASS | `brief-copy.test.ts` / `brief-view.test.ts` — counts, Quota unknown, Spend none, Needs you |
| SC-006 | PASS | Empty memory/spend/activity copy; no fabricated rows (`memory-view`, `spend-view`, `activity-view`) |
| SC-007 | PASS | `no-voice-client.test.ts` — no STT/TTS/wake-word under `src/client` |
| SC-008 | PASS | See Ira Glass review below |
| SC-009 | PASS | Ask-Me inbox from open items + amber lamp (`ask-me-view.test.ts`, `shell.test.ts`) |
| SC-010 | PASS | Core smoke + CLI independence (`packages/core/test/smoke.test.ts`, FR-025 / T024) |

## Ira Glass review (SC-008) — @tech-lead

- [x] **PASS** — Near-black graphite field + glass panels: `--ira-field` `#0e1114`, `--ira-glass` / border / highlight in `apps/command-center/src/client/tokens.css`
- [x] **PASS** — Monospaced telemetry + lamp semantics: `--ira-telemetry`, `--ira-lamp-cool` / amber / red; amber pulse only for Ask-Me (`shell.ts` `.ira-lamp-amber`)
- [x] **PASS** — Exactly one arc presence mark: single `data-ira-arc` SVG stroke `var(--ira-presence)` in header (`shell.ts`); tests assert one arc
- [x] **PASS** — Motion limited to `--ira-reveal-ms` / `--ira-lamp-period`; `prefers-reduced-motion` disables pulse
- [x] **PASS** — Forbidden looks absent: no scanner/KITT/Marvel/arc-reactor/pixel-office strings under `src/client` (repo scan 2026-10-17)
- [x] **PASS** — Voice absent (SC-007 / FR-021)

## Slice A Dispatch sign-off (OD-020) — @backend

- [x] **PASS** — Authenticated `POST /api/tasks/dispatch` spawns argv containing `dispatch-task --feature --task` only after bearer check (`http-routes.test.ts` “dispatches through dispatch-task…”)
- [x] **PASS** — Unauthenticated dispatch returns `401 TOKEN_REQUIRED` and does not spawn CLI
- [x] **PASS** — Tasks kanban: Waiting has no Dispatch; Ready posts `/api/tasks/dispatch` (`tasks-view.test.ts`)
- [x] **PASS** — Steer module source excludes `begin-task` and `record-result` (`steer.test.ts`)

## Steer path sign-off (OD-010 / OD-011 / OD-012) — @backend

- [x] **PASS** — Pause → `task-hold --hold true` (`http-routes.test.ts`)
- [x] **PASS** — Abort → `task-abort --confirm true` with reason (`http-routes.test.ts`)
- [x] **PASS** — Reassign → `task-reassign --agent …` (`http-routes.test.ts`); hyphenated CLI aliases in `packages/core`
- [x] **PASS** — Pause helper copy: “Sets hold on the task; does not record a failed review.” (`tasks.ts`)
- [x] **PASS** — Bridge server has no `locks/` writers / `record-result` / `begin-task` (source scan 2026-10-17); ledger reads are read-only in `snapshot.ts`

## Notes

- Visual SC-008 signed from locked Ira Glass tokens + shell chrome tests and forbidden-look scan (running browser eyeball optional follow-up; criteria met in shipped assets).
- Manual seeded-hive Operator click path covered by HTTP+kanban contract tests that assert the same Plane argv the UI invokes.
