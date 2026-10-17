# Ira Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superspec-forge to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a loopback web Command Center at `apps/command-center` that renders Ira’s GOD board over P-001 CLI JSON and read-only hive files, with Ira Glass chrome, SSE live updates, and amendment-conformant steer (Plane commands only).

**Architecture:** A Node bridge on `127.0.0.1:4731` serves Vite-built static assets and HTTP/SSE APIs. Reads use `execFile` on the `superspec` binary plus ledger and event file reads at `hiveRoot` (read-only). Every mutation verifies `Authorization: Bearer` against `<hiveRoot>/auth/loopback.token` before spawning CLI (OD-017). Steer spawns only `dispatch-task`, `task-hold`, `task-abort`, and `task-reassign` — never raw forge `begin-task`, never `record-result` for pause or abort, never bridge ledger or lock writes (OD-010, OD-011, OD-012). The browser never opens hive paths directly.

**Tech Stack:** TypeScript 5.5, Node >= 20, Vite (client), Vitest, plain DOM client (no React), P-001 CLI contracts from `specs/001-ira-command-plane/design.md`.

## Global Constraints

- Bind `127.0.0.1` only; default port `4731`; env `COMMAND_CENTER_PORT`, `SUPERSPEC_BIN` (design.md).
- Loopback auth (OD-017, FR-010a): token file `<hiveRoot>/auth/loopback.token` (dir `0700`, file `0600`). Every POST, PUT, PATCH, DELETE requires `Authorization: Bearer <token>`. Missing or invalid token → `401` `TOKEN_REQUIRED`, no CLI spawn, no hive write. No query-string tokens. Token must not appear in events, bridge logs, or HTML.
- Steer (OD-010, OD-011, FR-010): Dispatch → `dispatch-task` only (never argv `begin-task` while hive exists). Pause → `task-hold --hold true`. Abort → `task-abort --confirm true`. Reassign → `task-reassign`. Pause and abort MUST NOT call `record-result` or increment `reviewFailures`.
- Locks and ledger (OD-012): Bridge MUST NOT implement `withLock`, MUST NOT write `locks/*.lock`, MUST NOT patch `ledger/*.json`. All hive mutations go through P-001 CLI handlers.
- Doctor split (OD-014, FR-010b): Full-board degradation uses `doctor.hiveReady`. `engineRungReady: false` shows engine banner only; must not blank the board when hive coordination data is healthy.
- Learning (OD-016): Snapshot and steer handlers MUST NOT await DISTILL or CONSOLIDATE.
- No `@superspec-dev/core` import; no Electron; no Hermes/OpenClaw (FR-019).
- No speech capture, synthesis, wake-word, or voice settings in v1 (FR-021, OD-003).
- No second ledger for tasks, roster, spend, patterns, or approvals (FR-018).
- Memory/Spend show truthful empty/unavailable until P-003/P-004 queries exist (FR-005, FR-006).
- Board primary; no spatial floor route in v1 (FR-015).
- SuperSpec CLI/MCP MUST work with the Command Center process stopped (FR-025).
- Calls sign **Ira** (title case), expansion **Intelligent Resource Automation** from Plane `persona` JSON (FR-017).
- Ira Glass tokens and motion per `design.md` token table; one 28px arc in header only (FR-016).
- Testing: **Kind: code** tasks use red-green-refactor with `pnpm exec vitest run <file>` from repo root after T001 adds the include glob.

---

## Tier P0 — Slice A board Dispatch (OD-020)

Doctor Slice A requires a live board **Dispatch** control that calls `dispatch-task` only. Land these tasks before other GOD views or polish. Pause, abort, and reassign follow in the same steer module (T011) but Dispatch is the Slice A gate.

| Task | P0 deliverable |
|------|----------------|
| T001 | `apps/command-center` workspace |
| T007 | Loopback bearer verification (`auth.ts`) |
| T008 | CLI JSON wrapper (`execFile`, no shell) |
| T006 | Dispatch guard predicates (DAG-ready, `hiveReady`, not held) |
| T011 | `POST /api/tasks/dispatch` → `dispatch-task` argv only |
| T012 | Loopback server + authenticated dispatch route |
| T015 | Tasks kanban Dispatch control wired to authenticated API |

---

## Phase 1: Workspace and pure helpers

### Task T001: Command Center workspace bootstrap

**Implements:** FR-001, FR-025

**Depends on:** none

**Forge tier:** P0

**Kind:** provision

**Complexity:** mechanical

**Complexity rationale:** Design lists exact workspace files; deterministic checklist.

**Files:**
- Create: `apps/command-center/package.json`, `apps/command-center/tsconfig.json`, `apps/command-center/vite.config.ts`, `apps/command-center/index.html`
- Modify: `pnpm-workspace.yaml`, root `package.json` workspaces, `vitest.config.ts`
- Test: (covered in T024)

**Interfaces:**
- Consumes: design.md project structure
- Produces: private package `@superspec-dev/command-center` with scripts `dev`, `build`, `start`; vitest include `apps/command-center/test/**/*.test.ts`

- [ ] **Step 1: Provision checklist**

Run: `test -f apps/command-center/package.json && echo OK || echo MISSING`
Expected: after edits, `pnpm install` at repo root succeeds and `pnpm --filter @superspec-dev/command-center exec vitest run --passWithNoTests` exits 0

- [ ] **Step 2: Wire workspaces**

Add `apps/*` to `pnpm-workspace.yaml` and root `package.json` workspaces array per design.md.

- [ ] **Step 3: Extend Vitest include**

Append `apps/command-center/test/**/*.test.ts` to root `vitest.config.ts` `include`.

- [ ] **Step 4: Commit**

Stage workspace files and commit with message `chore(command-center): bootstrap apps/command-center workspace`.

---

### Task T002: Board snapshot TypeScript contracts

**Implements:** FR-018

**Depends on:** T001

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Multi-entity DTOs must mirror P-001 fields without renaming.

**Files:**
- Create: `apps/command-center/src/shared/snapshot-types.ts`
- Test: `apps/command-center/test/snapshot-types.test.ts`

**Interfaces:**
- Consumes: P-001 Task, RosterAgent, Event, AskMeItem shapes from `specs/001-ira-command-plane/design.md`
- Produces: exported types `BoardSnapshot`, `SnapshotTask` (`readiness: "ready" | "waiting"`, optional `hold: boolean`), `SnapshotAgent`, `SnapshotEvent`, `SnapshotAskMe`, `DoctorSlice` (`hiveReady`, `engineRungReady`), `AutonomySlice`

- [ ] **Step 1: Write the failing test**

Add Vitest cases that `SnapshotTask` allows `readiness` on `todo` tasks and that `DoctorSlice` includes separate `hiveReady` and `engineRungReady` booleans.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/snapshot-types.test.ts`
Expected: FAIL with cannot find module `snapshot-types.js`

- [ ] **Step 3: Write minimal implementation**

Implement `snapshot-types.ts` with fields from design.md GET `/api/snapshot` example (`generatedAt`, `stale`, `features[]`, `agents`, `askMe`, `events`, `doctor`, etc.).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/snapshot-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage types and test; commit `feat(command-center): add board snapshot types`.

---

### Task T003: Ira Glass tokens and no-voice client guard

**Implements:** FR-016, FR-021

**Depends on:** T001

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Token table plus static guard that client tree excludes speech APIs.

**Files:**
- Create: `apps/command-center/src/client/tokens.css`
- Test: `apps/command-center/test/no-voice-client.test.ts`

**Interfaces:**
- Consumes: design.md Ira Glass variable table
- Produces: CSS variables file; test helper that scans `src/client` for forbidden speech-related identifiers

- [ ] **Step 1: Write the failing test**

Add Vitest that asserts every `--ira-*` variable from design.md exists in `tokens.css` and that no `SpeechRecognition`, `speechSynthesis`, or wake-word strings appear under `src/client`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/no-voice-client.test.ts`
Expected: FAIL (missing `tokens.css` or ENOENT)

- [ ] **Step 3: Write minimal implementation**

Create `tokens.css` with every variable from design.md. Do not add speech-related strings under `src/client`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/no-voice-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage tokens and test; commit `feat(command-center): Ira Glass tokens and voice-free client guard`.

---

### Task T004: DAG-ready and kanban readiness

**Implements:** FR-002, FR-010

**Depends on:** T002

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Readiness rule matches P-001 dispatch guards including `implementsFr` for code tasks.

**Files:**
- Create: `apps/command-center/src/client/dag.ts`
- Test: `apps/command-center/test/dag.test.ts`

**Interfaces:**
- Consumes: `SnapshotTask`, ledger task fields from T002
- Produces: `computeReadiness(task, tasksById): "ready" | "waiting"`; `isDagReadyForDispatch(task, tasksById): boolean` (respects `hold`, dependencies, Ask-Me blocks, empty `implementsFr` on code tasks)

- [ ] **Step 1: Write the failing test**

Cover waiting when dependency not `done`, ready when dependencies satisfied, and dispatch false when `hold` is true or `implementsFr` empty on code tasks.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/dag.test.ts`
Expected: FAIL with cannot find module `dag.js`

- [ ] **Step 3: Write minimal implementation**

Port P-001 DAG-ready predicates from design.md steer table.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/dag.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage `dag.ts` and test; commit `feat(command-center): DAG readiness for kanban and dispatch`.

---

### Task T005: Morning brief copy builder

**Implements:** FR-009, FR-024

**Depends on:** T002

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Fixed sentence order from design; zero in-flight edge case.

**Files:**
- Create: `apps/command-center/src/client/brief-copy.ts`
- Test: `apps/command-center/test/brief-copy.test.ts`

**Interfaces:**
- Consumes: counts `{ done, blocked, doing, openAskMe, pollIntervalMs, awayMode }`
- Produces: `buildMorningBriefLines(input): string[]` matching design.md morning brief template

- [ ] **Step 1: Write the failing test**

Assert lines contain done/blocked counts, `Quota: unknown`, `Spend: none recorded`, and `Nothing in flight` when all work counts are zero.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/brief-copy.test.ts`
Expected: FAIL with cannot find module `brief-copy.js`

- [ ] **Step 3: Write minimal implementation**

Implement exact line order from design.md (`Needs you: nothing`, away trigger lines).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/brief-copy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage brief copy module and test; commit `feat(command-center): morning brief copy builder`.

---

### Task T006: Steer guard pure functions

**Implements:** FR-010, FR-020

**Depends on:** T004

**Forge tier:** P0

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Guards must mirror P-001 refusal rules without treating pause as review failure (OD-011).

**Files:**
- Create: `apps/command-center/src/client/steer-guards.ts` (shared by client and server)
- Test: `apps/command-center/test/steer-guards.test.ts`

**Interfaces:**
- Consumes: task status, `hold`, assignee agent status, `confirm` flag, `doctor.hiveReady`, DAG helpers from T004
- Produces: `canDispatch`, `canPause`, `canAbort`, `canReassign` each returning `{ ok: true } | { ok: false; message: string }` — pause allowed on `doing` only; abort requires `confirm: true` and refuses `done`; dispatch requires `hiveReady` and DAG-ready

- [ ] **Step 1: Write the failing test**

Refuse abort on `done` tasks; refuse dispatch when `hold` true or `hiveReady` false; refuse reassign to `offline` agent; allow pause on `doing` without requiring `confirm`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/steer-guards.test.ts`
Expected: FAIL with cannot find module `steer-guards.js`

- [ ] **Step 3: Write minimal implementation**

Encode design.md steer guard table. Do not encode `record-result` or review-failure ceiling as pause preconditions.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/steer-guards.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage steer guards and test; commit `feat(command-center): steer guard predicates`.

---

## Phase 2: Bridge — auth, CLI, snapshot, SSE, steer, HTTP

### Task T007: Loopback bearer auth

**Implements:** FR-010a

**Depends on:** T001

**Forge tier:** P0

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Fail-closed before any CLI spawn; token file mode checks per OD-017.

**Files:**
- Create: `apps/command-center/src/server/auth.ts`
- Test: `apps/command-center/test/auth.test.ts`

**Interfaces:**
- Consumes: `hiveRoot`, request headers
- Produces: `verifyBearerToken(req, hiveRoot): { ok: true } | { ok: false; status: 401; error: "TOKEN_REQUIRED"; message: string }`; reads `<hiveRoot>/auth/loopback.token` for comparison only; never logs token value

- [ ] **Step 1: Write the failing test**

Missing `Authorization` header returns not ok with `TOKEN_REQUIRED`. Wrong token same. Valid Bearer matching file contents returns ok. No CLI invocation on failure paths (mock spawn counter).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/auth.test.ts`
Expected: FAIL with cannot find module `auth.js`

- [ ] **Step 3: Write minimal implementation**

Constant-time compare of bearer token to file contents; reject query-string token patterns in URL if passed through.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage auth module and test; commit `feat(command-center): loopback bearer auth gate`.

---

### Task T008: Superspec CLI subprocess wrapper

**Implements:** FR-018

**Depends on:** T001

**Forge tier:** P0

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** JSON parse rules and timeouts differ for reads vs brief/steer.

**Files:**
- Create: `apps/command-center/src/server/cli.ts`
- Test: `apps/command-center/test/cli.test.ts`

**Interfaces:**
- Consumes: `repositoryRoot`, env `SUPERSPEC_BIN`
- Produces: `runSuperspec(argv: string[], opts: { cwd: string; timeoutMs: number }): Promise<{ ok: true; json: unknown } | { ok: false; error: string }>` using `execFile` with argv array only (no shell)

- [ ] **Step 1: Write the failing test**

Successful `doctor --json` invocation parses single JSON object; non-JSON stdout is failure.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/cli.test.ts`
Expected: FAIL with cannot find module `cli.js`

- [ ] **Step 3: Write minimal implementation**

Implement timeouts 10s reads, 30s steer and brief-submit per design.md.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage CLI wrapper and test; commit `feat(command-center): superspec CLI JSON wrapper`.

---

### Task T009: Snapshot builder from CLI and hive files

**Implements:** FR-018, FR-020, FR-005, FR-006, FR-010b

**Depends on:** T002, T008

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Multi-source snapshot with path safety, stale flag, and doctor split.

**Files:**
- Create: `apps/command-center/src/server/snapshot.ts`
- Test: `apps/command-center/test/snapshot.test.ts`

**Interfaces:**
- Consumes: `runSuperspec`, `hiveRoot`, feature id regex, read-only ledger paths
- Produces: `buildSnapshot(ctx): Promise<BoardSnapshot>`; `detectPatternsDirState(repoRoot): "empty" | "unavailable" | "files-no-query"`; set `stale: true` when `hiveReady` false; expose `engineRungReady` separately for banner copy

- [ ] **Step 1: Write the failing test**

Pattern dir missing → `empty`; markdown present → `files-no-query`; snapshot marks stale when doctor reports `hiveReady: false` but still returns last good coordination fields when available.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/snapshot.test.ts`
Expected: FAIL with cannot find module `snapshot.js`

- [ ] **Step 3: Write minimal implementation**

Implement doctor/hive-status/roster/ask-me/autonomy calls plus read-only ledger read and event tail; never write hive bytes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/snapshot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage snapshot builder and test; commit `feat(command-center): snapshot builder and pattern dir probe`.

---

### Task T010: SSE tail of events.jsonl

**Implements:** FR-013

**Depends on:** T009

**Kind:** code

**Complexity:** complex

**Complexity rationale:** fs.watch reliability fallback and Last-Event-ID replay.

**Files:**
- Create: `apps/command-center/src/server/sse.ts`
- Test: `apps/command-center/test/sse.test.ts`

**Interfaces:**
- Consumes: `buildSnapshot`, hive `events/events.jsonl` (read-only)
- Produces: `handleSseRequest(req, res, ctx): void` emitting `snapshot` then `hive` frames with 1s heartbeats; refetch triggers per design.md event type prefixes

- [ ] **Step 1: Write the failing test**

Parse helper extracts event id and type from JSONL line; ignores partial trailing line.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/sse.test.ts`
Expected: FAIL with cannot find module `sse.js`

- [ ] **Step 3: Write minimal implementation**

Implement tail reader, 500ms size poll fallback, reconnect with `Last-Event-ID`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/sse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage SSE module and test; commit `feat(command-center): SSE hive event tail`.

---

### Task T011: Steer mutations via Plane commands only

**Implements:** FR-010

**Depends on:** T006, T007, T008

**Forge tier:** P0

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Serializes per `featureId`; argv must match amendment steer table exactly.

**Files:**
- Create: `apps/command-center/src/server/steer.ts`
- Test: `apps/command-center/test/steer.test.ts`

**Interfaces:**
- Consumes: `steer-guards`, `verifyBearerToken`, `runSuperspec`
- Produces: `steerArgvDispatch`, `steerArgvPause`, `steerArgvAbort`, `steerArgvReassign` building argv arrays; handlers return P-001 error envelope on refusal; MUST NOT include `begin-task`, `record-result`, `locks/`, or ledger write helpers

- [ ] **Step 1: Write the failing test**

Dispatch argv contains `dispatch-task` with `--feature` and `--task`. Pause argv contains `task-hold` and `--hold` `true`. Abort argv contains `task-abort` and `--confirm` `true`. Reassign argv contains `task-reassign`. Static assertion: steer module source must not contain substring `begin-task` or `record-result`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/steer.test.ts`
Expected: FAIL (missing exports or forbidden argv substrings present)

- [ ] **Step 3: Write minimal implementation**

Wire guards; spawn CLI only after auth ok; one in-flight steer per feature returns `INVALID_INPUT` message from design.md; refetch snapshot after success (caller in T012).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/steer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage steer module and test; commit `feat(command-center): Plane-only steer handlers`.

---

### Task T012: Loopback HTTP server and routes

**Implements:** FR-001, FR-010a, FR-011, FR-012, FR-018, FR-019

**Depends on:** T007, T009, T010, T011

**Forge tier:** P0

**Kind:** code

**Complexity:** complex

**Complexity rationale:** All POST routes authenticated; bind refusal for non-loopback.

**Files:**
- Create: `apps/command-center/src/server/main.ts`
- Test: `apps/command-center/test/http-routes.test.ts`

**Interfaces:**
- Consumes: snapshot, sse, steer handlers, auth, Vite middleware in dev
- Produces: routes `/api/health`, `/api/snapshot`, `/api/events`, `/api/brief`, `/api/ask-me/answer`, `/api/tasks/dispatch`, `/api/tasks/pause`, `/api/tasks/abort`, `/api/tasks/reassign` per design.md; mutations call `verifyBearerToken` before steer or brief/ask-me CLI

- [ ] **Step 1: Write the failing test**

`createApp` refuses `0.0.0.0` host. Unauthenticated POST to `/api/tasks/dispatch` returns 401 `TOKEN_REQUIRED` without spawning CLI (mock).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/http-routes.test.ts`
Expected: FAIL with cannot find module `main.js`

- [ ] **Step 3: Write minimal implementation**

Listen `127.0.0.1` only; static serve; passthrough Plane error envelope; GET/SSE never return token.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/http-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage HTTP server and test; commit `feat(command-center): loopback HTTP server and API routes`.

---

## Phase 3: Client shell and GOD views

### Task T013: Board shell and navigation chrome

**Implements:** FR-001, FR-007, FR-015, FR-016, FR-017, FR-022

**Depends on:** T003, T002

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Munder-like IA links, amber lamp from openAskMe, persona header.

**Files:**
- Create: `apps/command-center/src/client/shell.ts`
- Test: `apps/command-center/test/shell.test.ts`

**Interfaces:**
- Consumes: `BoardSnapshot`, hash routes from design.md
- Produces: `renderShell(root, snapshot): void`; `navHref(view): string`; engine degradation banner when `engineRungReady` false and `hiveReady` true

- [ ] **Step 1: Write the failing test**

Shell renders links for all seven GOD views plus brief; shows Ira callsign from snapshot persona; amber lamp when `openAskMe > 0`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/shell.test.ts`
Expected: FAIL with cannot find module `shell.js`

- [ ] **Step 3: Write minimal implementation**

Apply `tokens.css`; single arc mark in header only.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/shell.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage shell and test; commit `feat(command-center): board shell and navigation`.

---

### Task T014: Client bootstrap, SSE, bearer token, and degraded polling

**Implements:** FR-013, FR-010a, FR-020

**Depends on:** T012, T013

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Operator-supplied bearer in session storage; stale snapshot when SSE down.

**Files:**
- Create: `apps/command-center/src/client/main.ts`
- Modify: `apps/command-center/index.html`
- Test: `apps/command-center/test/client-bootstrap.test.ts`

**Interfaces:**
- Consumes: API origin, `EventSource`, session storage key for bearer token (never log token)
- Produces: fetch wrapper adding `Authorization` on mutating requests; 1s snapshot poll when SSE errors; `stale` overlay when heartbeat missed

- [ ] **Step 1: Write the failing test**

Mutating fetch includes Bearer header when token stored; SSE error starts poll interval mock.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/client-bootstrap.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Wire hash routing to view modules; refetch snapshot on steer success without optimistic status paint.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/client-bootstrap.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage client bootstrap and test; commit `feat(command-center): client bootstrap and live updates`.

---

### Task T015: Tasks kanban view and steer controls

**Implements:** FR-002, FR-010, FR-010b

**Depends on:** T004, T006, T014

**Forge tier:** P0

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Ready vs Waiting columns; Dispatch is Slice A control surface.

**Files:**
- Create: `apps/command-center/src/client/views/tasks.ts`
- Test: `apps/command-center/test/tasks-view.test.ts`

**Interfaces:**
- Consumes: snapshot tasks, steer guards, authenticated POST helpers from T014
- Produces: kanban columns Ready, Waiting, Doing, Blocked, Done; Dispatch calls `/api/tasks/dispatch` only when guards allow; Pause → `/api/tasks/pause`; Abort with confirmation → `/api/tasks/abort`; Reassign picker → `/api/tasks/reassign`; held badge when `hold: true`; helper text for pause: `Sets hold on the task; does not record a failed review.`

- [ ] **Step 1: Write the failing test**

Waiting task has no Dispatch button; ready task posts dispatch path; abort dialog requires confirm before POST.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/tasks-view.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Use `computeReadiness` for column placement; disable steer when snapshot `stale` or `hiveReady` false.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/tasks-view.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage tasks view and test; commit `feat(command-center): tasks kanban and steer controls`.

---

### Task T016: Fleet view and context gauge

**Implements:** FR-003, FR-014, FR-010b

**Depends on:** T014

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Join roster to ledger for current task; gauge only when ratio present.

**Files:**
- Create: `apps/command-center/src/client/views/fleet.ts`
- Test: `apps/command-center/test/fleet-view.test.ts`

**Interfaces:**
- Consumes: `SnapshotAgent`, ledger tasks from snapshot
- Produces: worker cards with status, engine/model or `unknown`, current task line, optional context gauge

- [ ] **Step 1: Write the failing test**

Busy agent without `contextUsedRatio` shows gauge label `unknown`; offline not offered as reassign target in tasks view integration note.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/fleet-view.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Render engine degradation copy when `engineRungReady` false.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/fleet-view.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage fleet view and test; commit `feat(command-center): fleet view`.

---

### Task T017: Activity append-only stream view

**Implements:** FR-004

**Depends on:** T014

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Append order and earlier-page load without reorder.

**Files:**
- Create: `apps/command-center/src/client/views/activity.ts`
- Test: `apps/command-center/test/activity-view.test.ts`

**Interfaces:**
- Consumes: snapshot `events`, SSE `hive` frames
- Produces: scrollable list oldest-above-newest; load earlier via `eventsBefore` query

- [ ] **Step 1: Write the failing test**

Three events render in file order; empty log shows `No events recorded.`

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/activity-view.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Append-only client list; no demo rows.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/activity-view.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage activity view and test; commit `feat(command-center): activity stream view`.

---

### Task T018: Ask-Me inbox and answer flow

**Implements:** FR-007, FR-011, FR-023

**Depends on:** T014

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Critical inbox only; confirmation on answer POST.

**Files:**
- Create: `apps/command-center/src/client/views/ask-me.ts`
- Test: `apps/command-center/test/ask-me-view.test.ts`

**Interfaces:**
- Consumes: snapshot `askMe`, authenticated POST `/api/ask-me/answer`
- Produces: inbox list from open items; detail with `ask-me-show` data when selected; answer requires non-empty text, action enum, `confirm: true`

- [ ] **Step 1: Write the failing test**

Open item renders question; submit without confirm refused client-side.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/ask-me-view.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Do not synthesize inbox rows from routine event types.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/ask-me-view.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage Ask-Me view and test; commit `feat(command-center): Ask-Me inbox and answers`.

---

### Task T019: Morning brief and goal brief submit view

**Implements:** FR-009, FR-012, FR-024

**Depends on:** T005, T014

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Required field validation before authenticated brief POST.

**Files:**
- Create: `apps/command-center/src/client/views/brief.ts`
- Test: `apps/command-center/test/brief-view.test.ts`

**Interfaces:**
- Consumes: `buildMorningBriefLines`, POST `/api/brief` with bearer
- Produces: morning brief panel; goal brief form with outcome and deliverable required

- [ ] **Step 1: Write the failing test**

Omitting deliverable blocks submit; successful response shows acknowledgement from CLI JSON fields.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/brief-view.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Refetch snapshot after brief submit.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/brief-view.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage brief view and test; commit `feat(command-center): morning and goal brief views`.

---

### Task T020: Memory patterns placeholder view

**Implements:** FR-005

**Depends on:** T009, T014

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Fixed copy from design; no pattern parse.

**Files:**
- Create: `apps/command-center/src/client/views/memory.ts`
- Test: `apps/command-center/test/memory-view.test.ts`

**Interfaces:**
- Consumes: `detectPatternsDirState` result exposed on snapshot or feature flags
- Produces: empty or unavailable strings from design.md; no sqlite access

- [ ] **Step 1: Write the failing test**

Empty dir message `No patterns are stored yet.`; files present message defers to P-003 query surface.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/memory-view.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Static render only.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/memory-view.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage memory view and test; commit `feat(command-center): memory placeholder view`.

---

### Task T021: Spend placeholder view

**Implements:** FR-006

**Depends on:** T014

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Fixed absent spend copy; doctor finding passthrough optional.

**Files:**
- Create: `apps/command-center/src/client/views/spend.ts`
- Test: `apps/command-center/test/spend-view.test.ts`

**Interfaces:**
- Consumes: snapshot doctor findings (e.g. `budget_unmetered`)
- Produces: `No spend recorded.` and `Budgets: unset.`; no synthesized currency

- [ ] **Step 1: Write the failing test**

View text matches design.md absent spend strings.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/spend-view.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

No breaker UI until P-004 contract exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/spend-view.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage spend view and test; commit `feat(command-center): spend placeholder view`.

---

### Task T022: Triggers and away schedule view

**Implements:** FR-008

**Depends on:** T014, T002

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Single away-poll row from autonomy settings and tail events.

**Files:**
- Create: `apps/command-center/src/client/views/triggers.ts`
- Test: `apps/command-center/test/triggers-view.test.ts`

**Interfaces:**
- Consumes: `AutonomySlice`, latest away.tick from events tail
- Produces: row `away-poll` with enabled/disabled copy from design.md

- [ ] **Step 1: Write the failing test**

`awayMode` false headline `Nothing is scheduled.`; true shows poll interval text.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/command-center/test/triggers-view.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Board does not call `away-set`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/command-center/test/triggers-view.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Stage triggers view and test; commit `feat(command-center): triggers view`.

---

### Task T023: App README and Munder attribution headers

**Implements:** FR-022

**Depends on:** T015, T016, T017, T018

**Kind:** doc-sync

**Complexity:** mechanical

**Complexity rationale:** Documentation and MIT attribution only.

**Files:**
- Create: `apps/command-center/README.md`
- Modify: view source files that adapt Munder panel names (comment headers only)

**Interfaces:**
- Consumes: design.md prior art table
- Produces: README with dev/start instructions, loopback token note, steer command summary; MIT attribution comments on adapted IA files

- [ ] **Step 1: Sync README**

Document bind address, bearer token setup, and that steer uses `dispatch-task`, `task-hold`, `task-abort`, `task-reassign` only.

- [ ] **Step 2: Add attribution headers**

Add MIT attribution comment blocks to Tasks, Fleet, Ask-Me view files per design.md.

- [ ] **Step 3: Commit**

Stage README and headers; commit `docs(command-center): README and Munder attribution`.

---

### Task T024: Automated test suite verification

**Implements:** FR-025, FR-020, FR-021

**Depends on:** T012, T014, T015, T016, T017, T018, T019, T020, T021, T022

**Kind:** verify

**Complexity:** mechanical

**Complexity rationale:** Aggregate vitest gate before sign-off.

**Files:**
- Test: all files under `apps/command-center/test/`

- [ ] **Step 1: Run command-center tests**

Run: `pnpm exec vitest run apps/command-center/test`
Expected: all tests PASS

- [ ] **Step 2: Run core smoke (CLI independence)**

Run: `pnpm exec vitest run packages/core/test/smoke.test.ts`
Expected: PASS

- [ ] **Step 3: Amendment steer static check**

Run: `pnpm exec vitest run apps/command-center/test/steer.test.ts`
Expected: PASS — argv helpers exclude `begin-task` and `record-result`

---

### Task T025: Visual and acceptance sign-off checklist

**Implements:** FR-016, FR-001

**Depends on:** T023, T024

**Kind:** signoff

**Complexity:** mechanical

**Complexity rationale:** Human SC-008 and P1 scenario checklist.

**Files:**
- Modify: `specs/002-ira-command-center/checklists/requirements.md`

**Interfaces:**
- Consumes: SC-001 through SC-010 from spec.md
- Produces: checked checklist entries with owner sign-off record

- [ ] **Step 1: Record Ira Glass review**

Owner: @tech-lead — confirm SC-008 visual criteria against running shell.

- [ ] **Step 2: Record Slice A Dispatch sign-off**

Owner: @backend — seeded hive: Dispatch from board calls `dispatch-task`; doctor Slice A path satisfied.

- [ ] **Step 3: Record steer sign-off**

Owner: @backend — pause uses `task-hold`; abort uses `task-abort`; reassign uses `task-reassign`; no ledger files written by bridge.

- [ ] **Step 4: Update checklist markdown**

Sync `checklists/requirements.md` with pass/fail notes and date.

---

## Plan metrics

| Metric | Count |
|--------|------:|
| Tasks | 25 |
| P0 (Slice A Dispatch) tasks | 7 |
| Code tasks | 22 |
| Provision tasks | 1 |
| Verify tasks | 1 |
| Doc-sync tasks | 1 |
| Signoff tasks | 1 |
| Functional requirements referenced | 25 (FR-001–FR-025) |
| Amendment invariants encoded | OD-010, OD-011, OD-012, OD-014, OD-016, OD-017, OD-020 |
