# Design: Ira Command Center

**Revision**: 2026-10-16 | **Status**: DRAFT | **Owner**: @grok

**Input**: Feature specification from `specs/002-ira-command-center/spec.md`

**Note**: This unified design document merges Spec Kit's separate plan/research/data-model/contracts artifacts into one tier per SuperSpec's 4-layer architecture.

## Required Reading / Prior Art

| Path | Reason |
|------|--------|
| `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` | LOCKED production invariants for dispatch, hold/abort, locks, doctor split, loopback auth |

`docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` is LOCKED. If this design disagrees with that amendment, the amendment wins.

## Summary

Ira’s Command Center is a thin local web board (parent Option D) for one Operator. It shows Tasks, Fleet, Activity, Memory, Spend, Ask-Me, and Triggers, plus a morning brief, over the same hive and CLI state the Command Plane (P-001) already records. It is not a second ledger.

The app lives in `apps/command-center`. A Node bridge on `127.0.0.1` serves the page and forwards mutations to the `superspec` CLI after validating the loopback bearer token (OD-017). Steer mutations use Plane commands only (`dispatch-task`, `task-hold`, `task-abort`, `task-reassign`); the bridge never argv’s raw forge `begin-task`, never writes ledger or lock files, and never copies `withLock`. Reads use the P-001 JSON commands where those commands return the body, and the hive files P-001 already persists where the CLI only returns counts (`ledger/<featureId>.json`, `events/events.jsonl`). Live updates are server-sent events that tail the event log, with a one-second snapshot poll only while the stream is down.

Visual language is locked Ira Glass: CSS variables below, system fonts, one arc mark in the header, short panel reveals, and status-lamp pulses. v1 has no Electron shell and no voice.

Memory and Spend render empty or unavailable until P-003 and P-004 publish query contracts. The board does not invent patterns, currency, quotas, or breaker stages.

## Technical Context

**Language/Version**: TypeScript 5.5 on Node.js 20 (repo `engines.node`). Browser client is plain TypeScript compiled by Vite, no React.

**Primary Dependencies**: Vite for the client build and dev middleware. Node `http` and `fs` for the bridge. The `superspec` CLI from `@superspec-dev/core` is invoked with `execFile` and an argument array. This package does not depend on `@superspec-dev/core`, the MCP SDK, Electron, a speech library, or a CSS kit.

**Storage**: None of its own. Hive documents and the append-only event log under `<repository-root>/.superspec/hive/` remain the system of record (P-001, OD-007). This app writes no hive bytes; reassign and every other mutation go through CLI/MCP handlers that own locks and events (OD-012). View selection is `sessionStorage` key `ira.commandCenter.view` and is not Plane state. The bridge may read `<hiveRoot>/auth/loopback.token` (mode `0600`) for auth verification only. No SQLite, no pattern index, no cost ledger.

**Testing**: Vitest, same runner as `packages/core`. Pure tests for DAG-ready, morning-brief copy, steer guards, and snapshot degradation. Bridge tests use a temporary hive directory. Extend the root Vitest `include` with `apps/command-center/test/**/*.test.ts` when the app is added. No browser harness is required for v1 logic; Ira Glass review (SC-008) stays a visual check of the running shell.

**Target Platform**: Operator machine, desktop browser, loopback HTTP. Minimum layout width 1100px. Below that the shell shows a single line that a desktop width is required. Mobile layout is out of scope.

**Project Type**: Local web application (static client plus a loopback bridge). Not a published library and not a desktop shell.

**Performance Goals**: An open board reflects a new hive event within 2 seconds on a local SSD (SC-003, parent NFR-003). Building a snapshot for one hive of about 200 tasks and a 200-line event tail completes in under 200ms on that machine. A `brief-submit` of a 50-task plan stays under the P-001 bound of 1 second; the bridge allows the CLI 30 seconds before it reports failure.

**Constraints**: Bind `127.0.0.1` only; non-loopback bind is a startup refusal (OD-017). Every POST, PUT, PATCH, and DELETE requires `Authorization: Bearer <token>` matching `<hiveRoot>/auth/loopback.token` (directory `0700`, file `0600`). Missing or wrong token returns `401` `TOKEN_REQUIRED` and must not spawn CLI or write the hive. The token must not appear in events, bridge logs, or HTML. Multi-user auth remains OPEN-007; the loopback token is a local mutation gate only. No Electron. No speech capture, speech synthesis, or wake-word (OD-003). No Hermes or OpenClaw. No second task, roster, spend, pattern, or approval store. Prompt and brief bodies are not written to bridge logs. Hive contents stay gitignored by P-001; this app adds no hive paths and implements no lock files.

**Scale/Scope**: One repository, one Operator, tens of roster agents, hundreds of tasks per feature, seven GOD views plus the morning brief. Activity shows the tail first (default 200 events, the P-001 read window) and can load earlier lines without reordering them.

## Architecture

### System Structure

The browser never opens hive files and never speaks MCP stdio. The bridge is a transport in front of the Command Plane CLI and the hive files that CLI already owns.

```text
Browser (Ira Glass shell)
  hash views: brief, tasks, fleet, activity, memory, spend, ask-me, triggers
        |  GET /api/snapshot
        |  GET /api/events          (SSE)
        |  POST steer / brief / answer (+ Bearer token)
        v
apps/command-center bridge  127.0.0.1:4731
        |  verify loopback.token (0600)
        |  execFile(superspec, argv)     no shell, no ledger/lock writes
        |  read hive JSON / tail events.jsonl
        v
P-001 superspec CLI / MCP JSON     (same handlers)
        v
.superspec/hive/                    system of record
specs/<feature>/.superspec/state.json   forge writer, not this app
```

The bridge starts from a checkout that contains `program.md`. It resolves the hive the way P-001 does: `superspec doctor` and `superspec hive status` return `repositoryRoot` and `hiveRoot`. Later reads use that `hiveRoot`. A linked worktree still shows the main hive. The app does not create `.superspec/hive/`.

Snapshot refresh is pull. Activity growth is push. After every mutation the client discards optimistic status and applies the next snapshot. If a CLI operator writes the same task, the next snapshot replaces the card. Plane state wins.

Degraded mode: the CLI cannot be spawned, `doctor.hiveReady` is false, hive status returns `ok: false`, or two SSE heartbeats are missed. The shell keeps the last snapshot on screen, marks it stale with the snapshot time, and does not present it as current. It does not fill empty views with sample tasks, agents, spend, patterns, or approvals. First open with no Plane shows the same degraded empty shell.

When `hiveReady` is true and `engineRungReady` is false, the board stays fully navigable and shows coordination data; a persistent banner or Fleet copy states that no healthy engine rung is available (OD-014). Engine findings must not flip `hiveReady` false in the snapshot the board uses for full degradation.

### Project Structure

#### Documentation (this feature)

```text
specs/002-ira-command-center/
├── spec.md
├── design.md
├── plan.md
└── adr/
```

Decisions for v1 are inline below. `adr/` stays empty until a later revision splits one out.

#### Source Code (repository root)

```text
apps/command-center/
├── package.json                 # private @superspec-dev/command-center
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── server/
│   │   ├── main.ts              # listen 127.0.0.1
│   │   ├── cli.ts               # execFile superspec
│   │   ├── snapshot.ts          # CLI JSON + hive reads
│   │   ├── sse.ts               # tail events.jsonl
│   │   ├── steer.ts             # dispatch-task, task-hold, task-abort, task-reassign
│   │   └── auth.ts              # Bearer verify against loopback.token
│   ├── client/
│   │   ├── main.ts
│   │   ├── shell.ts
│   │   ├── tokens.css
│   │   ├── dag.ts
│   │   ├── brief-copy.ts
│   │   └── views/
│   │       ├── brief.ts
│   │       ├── tasks.ts
│   │       ├── fleet.ts
│   │       ├── activity.ts
│   │       ├── memory.ts
│   │       ├── spend.ts
│   │       ├── ask-me.ts
│   │       └── triggers.ts
│   └── shared/
│       └── snapshot-types.ts
└── test/
    ├── dag.test.ts
    ├── brief-copy.test.ts
    ├── steer.test.ts
    ├── snapshot.test.ts
    └── sse.test.ts
```

Root `package.json` `workspaces` and `pnpm-workspace.yaml` gain `apps/*` when this package is added. Root `vitest.config.ts` `include` gains `apps/command-center/test/**/*.test.ts`. The app is not added to `tsconfig.json` project references. `tsc -b` for the libraries stays independent of the UI.

**Structure Decision**: `apps/command-center`, private package `@superspec-dev/command-center`. P-001 already rejected folding the web app into `@superspec-dev/core` and reserved a separate package that only reads the Plane API. `packages/core` and `packages/render` are published libraries on the `tsc -b` graph. This board is a runnable loopback process plus browser assets, and it must not be imported by those libraries. Placing it under `packages/` would put a server and a Vite app on the library workspace and invite a publishable UI package. `apps/` keeps the dependency one-way: the process spawns the `superspec` binary and does not link core’s writers. The workspace glob change is one line in each of the two workspace files.

## Decisions

### Decision: Ship a loopback web app in `apps/command-center`, with no Electron and no core import

**Rationale**:

Problem statement: CP-002 and FR-001 require a web Command Center over Command Plane state. FR-018 forbids a second system of record. The spec forbids an Electron requirement. P-001’s package ADR says a separate package is appropriate later because the UI only reads the API.

Context: The repo publishes `@superspec-dev/core` and `@superspec-dev/render` from `packages/*`. Node is already `>=20`. One Operator, localhost only.

The board is a private app. Its process parses CLI JSON and hive files. It does not import `@superspec-dev/core`, so it cannot call `saveState`, `recordResult`, or hive sync helpers except by going through the CLI that P-001 wraps with sync. The default binary is `node` on `<repositoryRoot>/packages/core/bin/superspec.js`. `SUPERSPEC_BIN` overrides that path. Arguments are an array passed to `execFile`. The bridge never uses a shell.

Listen address is `127.0.0.1`. Default port is `4731`. `COMMAND_CENTER_PORT` overrides the port. A bind to `0.0.0.0` or any non-loopback address is refused at startup. There is no login screen; the Operator supplies the bearer token to the client (for example pasted once into session storage) after the bridge process creates or validates `<hiveRoot>/auth/loopback.token` at mode `0600`. GET and SSE never return the token.

**Alternatives considered**:

- **`packages/command-center`**: Rejected. It matches today’s workspace glob, but it treats a loopback server as a library sibling of core and render.
- **Electron, adapting Munder’s shell**: Rejected. FR-001 is a browser board. Munder is an IA reference only. LimeZu assets are not copied. MIT attribution goes in the header of files that adapt panel names (`Tasks`, `Fleet`, `Ask-Me`, `Memory`, `Spend`).
- **In-process import of hive writers**: Rejected. That skips the CLI handlers P-001 uses to sync forge state and makes the UI a second scribe.

### Decision: Live updates are SSE from a tail of `events/events.jsonl`

**Rationale**:

Problem statement: FR-013 and SC-003 require the open board to show Plane changes within 2 seconds without a restart. Parent UI-003 allows SSE, WebSocket, or poll. The browser cannot watch hive files.

Context: P-001’s event contract says consumers tail `events/events.jsonl`. Order is file order. Readers ignore a trailing partial line. `hive-status` already uses a 200-event tail. The log is not compacted in v1.

`GET /api/events` is `text/event-stream`. On connect the bridge emits one `snapshot` frame (the same JSON as `GET /api/snapshot`), then one `hive` frame per complete line appended after the current EOF. Heartbeat comments go out every 1 second. The bridge watches the file with `fs.watch` and also checks size every 500ms, because watch notifications are not reliable on every volume. Unknown event `type` values are forwarded and not dropped (P-001: unknown types stay on disk and readers ignore them).

The client appends `hive` frames to Activity in file order and refetches `/api/snapshot` when `type` starts with `task.`, `ask_me.`, `brief.`, `away.`, `autonomy.`, `hive.`, or equals `doctor.ran`. Cards are never edited in place from a guess. Reconnect sends `Last-Event-ID`. The bridge scans forward from that id. If the id is gone, it sends a fresh snapshot and resumes at EOF.

If `EventSource` errors, the client polls `GET /api/snapshot` every 1 second until the stream returns. That fallback exists so a dead watch still meets the 2-second bound. The primary path is the tail.

**Alternatives considered**:

- **Poll only**: Rejected as the primary path. A one-second poll of every ledger meets the timer but does the same work when the hive is idle, and Activity would only move on the poll boundary.
- **WebSocket**: Rejected. SSE is one-way, matches an append-only log, and needs no extra library.
- **Browser file access or a second watcher inside Vite**: Rejected. The page must keep working against the bridge origin only.

### Decision: Ira Glass tokens, system fonts, one presence mark, no voice

**Rationale**:

Problem statement: FR-016, FR-017, FR-021, and OD-001/OD-003 lock the look and defer voice. Exact tokens, typefaces, and motion timings are this design’s job.

Context: The surface must be original. It must not be a cinematic-assistant clone, a KITT scanner bar, a Marvel or arc-reactor kit, a holographic-dashboard skin, or a pixel office. v1 journeys are pointer and keyboard only.

Tokens, in `src/client/tokens.css`:

| Variable | Value | Use |
|----------|-------|-----|
| `--ira-field` | `#0e1114` | Page background, near-black graphite |
| `--ira-field-raised` | `#161b20` | Header bar |
| `--ira-glass` | `rgba(168, 198, 210, 0.07)` | Panel fill |
| `--ira-glass-border` | `rgba(176, 208, 220, 0.35)` | Panel edge |
| `--ira-glass-highlight` | `rgba(214, 232, 240, 0.12)` | Top inner line on a panel |
| `--ira-text` | `#d7dee6` | Prose |
| `--ira-text-dim` | `#8e9aa6` | Labels |
| `--ira-telemetry` | `#d5e0d2` | Counts and ids |
| `--ira-lamp-cool` | `#6ec8c0` | Done or healthy, steady |
| `--ira-lamp-amber` | `#d59a45` | Open Ask-Me, pulse |
| `--ira-lamp-red` | `#c45448` | Blocked or stop only, pulse |
| `--ira-presence` | `#b7d4e4` | The single arc stroke |
| `--ira-reveal-ms` | `160ms` | Panel enter |
| `--ira-lamp-period` | `1600ms` | Lamp pulse |

Type: prose is `ui-sans-serif, system-ui, sans-serif`. Telemetry is `ui-monospace, "SF Mono", Menlo, Consolas, monospace`. No webfont request and no vendored font file. The board is local and must render offline.

Motion: when the hash view changes, that panel fades and moves 4px upward over `--ira-reveal-ms`. Status lamps use cool for done and healthy, amber when `openAskMe > 0`, red only when a visible task is `blocked` or a breaker stage is `stop`. Cool lamps do not pulse. Amber and red pulse between opacity 0.55 and 1 over `--ira-lamp-period`. `prefers-reduced-motion: reduce` turns both off. There is no scanner sweep, scanline overlay, or repeating entrance animation on snapshot refresh.

Identity: the header contains the word `Ira` (title case, never `IRA`) and the expansion `Intelligent Resource Automation` once. Exactly one presence mark, a 28px SVG arc (stroke only, about three-quarters of a circle), sits in that header. It is not repeated inside panels, including the brief. The brief is the view under that header, so the header mark is the brief anchor. Copy addresses the Operator. It does not use “sir”.

v1 ships no `SpeechRecognition`, `speechSynthesis`, microphone permission, wake-word, or voice setting. A unit test fails if those strings appear under `src/client`. FR-021’s later rules (no silent spend, spawn, or destructive action; ambiguous speech is not approval) are not implemented here.

**Alternatives considered**:

- **A downloaded display face or a HUD component kit**: Rejected. Network fonts break the offline board, and a kit skin is the look FR-016 forbids.
- **A second arc inside the brief panel**: Rejected. SC-008 allows one presence core.
- **A voice toggle that is present but disabled**: Rejected. OD-003 says v1 ships no speech control.

### Decision: Read CLI JSON for bodies it returns, and hive files only where the CLI returns counts

**Rationale**:

Problem statement: FR-018 requires the board to show the same state an Operator can read without the UI. P-001’s produced list for this spec is CLI/MCP JSON for a named set of tools, plus the event schema. `hive-status` returns task counts, not task cards. Kanban cards need `ledger/<featureId>.json`.

Context: P-001 forbids a UI-only store. Inventing `ledger-list` or a different task JSON would be a parallel API. The ledger file is the Plane’s schema.

The bridge builds a snapshot from:

| Need | Call or file |
|------|----------------|
| Ready / degraded | `superspec doctor`, `superspec hive status` |
| Roster cards | `superspec roster list` |
| Ask-Me inbox | `superspec ask-me list --state open`, then `superspec ask-me show --id` when a row is opened |
| Autonomy, away interval | `superspec autonomy show` |
| Goal brief echo | `superspec brief show --feature` |
| Task cards | `ledger/<featureId>.json` at `hiveRoot` |
| Activity | tail of `events/events.jsonl` |
| Triggers | `autonomy-show` plus `away.changed` and `away.tick` lines already in the tail |

`featureId` must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$` before it is used as a path segment. `agentId` must match `^[a-z0-9][a-z0-9-]{0,63}$`. Paths are resolved under `hiveRoot` or `repositoryRoot` and rejected when they escape that root.

Command-plane commands are parsed as one JSON object. Exit code `0` and `ok: true` is success. Steer spawns `dispatch-task`, `task-hold`, `task-abort`, and `task-reassign` only — not raw `begin-task` or `record-result` (OD-010, OD-011). Brief and Ask-Me use their Plane commands. Non-JSON stdout is a failure. The bridge does not trust exit codes alone when stdout is not JSON.

The board does not call `away-set`, `autonomy-set`, `hive-init`, `hive-sync`, `mailbox-post`, or `hive-ci-set`. Those mutate or repair the Plane and are not required to draw the views.

**Alternatives considered**:

- **A new MCP `ledger-list` tool defined here**: Rejected. That is a Command Plane API change and belongs in P-001 if the counts-only status is later extended. Until then the ledger file is the body behind the counts.
- **MCP stdio client inside the bridge**: Rejected. P-001 states CLI JSON matches MCP JSON. One subprocess path is enough.
- **Reading forge `state.json` to draw the kanban**: Rejected. The hive ledger is the board’s view of status (`todo | doing | blocked | done`). Forge remains the writer of its own file. After successful `dispatch-task`, `task-hold`, `task-abort`, or `task-reassign`, the CLI handler syncs or updates the hive; the board refetches the ledger.

### Decision: Steer only through Plane `dispatch-task`, `task-hold`, `task-abort`, and `task-reassign`

**Rationale**:

Problem statement: FR-010 and user story 2 require dispatch, pause, abort, and reassign from the board, recorded by the Command Plane, with the kanban matching afterward. Amendment OD-010 fixes the only dispatch path as `dispatch-task` (CLI and MCP, same JSON); OD-011 separates hold and abort from review failures; OD-012 forbids a bridge lock copy or direct ledger writes.

Context: Assumptions in the spec: abort and critical answers require an explicit confirmation; pause and dispatch of ready work do not. Abort of a done task must not be sent. Reassign to an offline worker must warn and must not be reported as success. `reviewFailures` increments only on a real review `record-result` with `passed: false` — not on operator pause or abort.

The bridge serializes steer per `featureId`. Every steer POST is authenticated (OD-017). The client does not paint a new status until the snapshot returns.

| Control | When the bridge sends it | Plane command (argv via `execFile`) | Kanban after refetch |
|---------|--------------------------|-------------------------------------|----------------------|
| Dispatch | Task is DAG-ready, `hold` is false, status is `todo`, assignee not `offline`, and local guards match P-001 refusal rules (empty `implementsFr` on code tasks, open Ask-Me, etc.). `doctor.hiveReady` must be true. | `superspec dispatch-task --feature <featureId> --task <taskId> [--cwd <repositoryRoot>]` | `doing` on success, or unchanged with Plane error (`DISPATCH_HELD`, `HIVE_NOT_READY`, `DISPATCH_PATH_REQUIRED`, etc.) |
| Pause | Status is `doing` (or `todo` when the Plane allows resume semantics only via `task-hold false` — v1 Pause sets hold). | `superspec task-hold --feature <featureId> --task <taskId> --hold true` | Task remains in its status column; `hold: true` shows a held badge. `dispatch-task` on held tasks returns `DISPATCH_HELD`. Activity shows `task.held`. |
| Abort | Status is `todo` or `doing`, POST includes `confirm: true`. | `superspec task-abort --feature <featureId> --task <taskId> --confirm true` | `blocked`, `hold: false`, `abortReason` set; Activity shows `task.aborted`. `reviewFailures` unchanged. |
| Reassign | Status is `todo` or `doing`. Target `agentId` on roster and not `offline`. | `superspec task-reassign --feature <featureId> --task <taskId> --agent <agentId>` | Same status, new `assigneeAgentId`; Activity shows the Plane-emitted reassign event. |

Guards that send nothing (401 if token missing; otherwise `INVALID_INPUT` or Plane code):

- Dispatch when not DAG-ready, `hold` is true, assignee is `offline`, status is not `todo`, or `hiveReady` is false.
- Pause when status is not `doing` (resume uses `task-hold --hold false` when exposed later).
- Abort when status is `done` or already aborted/blocked per Plane rules, or `confirm` is not `true`.
- Reassign when target is missing or `offline`, or task is `done`.

Pause has no confirmation dialog. Helper text is fixed: `Sets hold on the task; does not record a failed review.` The board shows `hold: true` on the card; it does not fake a `todo` transition via `record-result`.

The bridge MUST NOT argv forge `begin-task` for operator dispatch while the hive exists. MUST NOT argv `record-result` for pause or abort. MUST NOT write `locks/*.lock` or patch `ledger/*.json`. Reassign MUST NOT bypass `task-reassign`.

A code task with an empty `implementsFr` is stored and shown, and Dispatch is refused, matching P-001’s refusal inside `dispatch-task`.

**Alternatives considered**:

- **Raw `begin-task` from the board**: Rejected. Non-conformant with OD-010; returns `DISPATCH_PATH_REQUIRED` when the hive exists.
- **`record-result --passed false` for pause or abort**: Rejected. Burns `reviewFailures` and violates OD-011.
- **Bridge ledger lock + assignee patch**: Rejected. Violates OD-012; reassign must emit a Plane event via `task-reassign`.
- **UI-only paused or assignee flags**: Rejected. P-001 forbids UI-only state.

## Production invariants (fail-closed)

This board MUST conform to the amendment fail-closed table rows that apply to P-002:

| Invariant | Fail-closed behavior (Command Center) |
|-----------|----------------------------------------|
| OD-010 One dispatch path | Dispatch control calls only `dispatch-task`. Never raw `begin-task`. Deny paths write no partial steer effect. |
| OD-011 Hold ≠ fail | Pause → `task-hold`. Abort → `task-abort` with `confirm: true`. No `record-result` for either. |
| OD-012 Locks | No `withLock` copy, no `locks/*.lock` writes, no direct ledger JSON mutation. Reassign → `task-reassign` only. |
| OD-014 Doctor split | Full degradation when `hiveReady` is false. `engineRungReady` false shows engine banner only; board data stays visible when the hive is healthy. |
| OD-017 Loopback auth | Bind `127.0.0.1`. Token file mode `0600`. Every mutating POST/PUT/PATCH/DELETE requires Bearer token; else `401` `TOKEN_REQUIRED`, no CLI spawn. |
| OD-016 Learning (display) | Snapshot and steer handlers do not await DISTILL/CONSOLIDATE; Memory view stays truthful when index is absent. |

### Decision: Memory and Spend stay empty until P-003 and P-004 expose queries

**Rationale**:

Problem statement: FR-005 and FR-006 require truthful Memory and Spend views. User story 9 and 7 require empty views to invent nothing. P-003 owns `.superspec/patterns/` and a read-only query that is not in P-001’s produced table. P-004 owns spend, budgets, breaker stage, quota, and context gauges, and its design is not published. OD-002 and the token spec are not a license for this app to parse a private schema.

Context: The spec’s assumptions say this board displays what those planes expose and shows empty states when they do not. P-001’s token and learning hooks are no-ops. Doctor may report `budget_unmetered` when a brief has a numeric budget and the token hook is absent.

Memory:

- If `<repositoryRoot>/.superspec/patterns/` is missing or contains no `*.md` files, the view text is `No patterns are stored yet.`
- If markdown files are present, the view text is `Patterns are on disk. Summaries stay hidden until the learning-memory query surface is available.` It does not open `index.sqlite`, does not read front matter, and does not invent `success` or `failure` rows.
- Compaction does not change this view, because the app never deletes pattern files.

Spend:

- The view text is `No spend recorded.` and `Budgets: unset.` Totals are not zero currency; they are absent. No per-agent or per-feature money is synthesized from event payloads (P-001 strips token-like keys from event data anyway).
- Circuit-breaker chrome is omitted. `budget_unmetered` from `doctor` findings is shown as that finding’s `message`, which is Plane output.
- Morning-brief spend is `none recorded`. Quota is `unknown`.

Fleet context: a gauge renders only when `roster-list` includes a finite `contextUsedRatio` from 0 through 1 on that agent. Absent field means the label `unknown`, including when status is busy. A present `0` is a real measurement. The app does not compute tokens.

An additive `breaker` value of `steer`, `constrain`, or `stop` on a future spend query is out of scope until P-004’s design names the command. This revision does not call a spend CLI.

**Alternatives considered**:

- **Parse pattern markdown and a guessed cost file**: Rejected. That would freeze a schema P-003 and P-004 have not published and could show lessons or currency the Plane did not return.
- **Hide the Memory and Spend navigation entries**: Rejected. FR-022 and SC-002 require those views from the shell, including when they are empty.

## Data Model

The board does not define a new persisted store. Rows below are projections of P-001 documents plus one derived brief. Identifiers and timestamps match P-001 (strings, ISO-8601 UTC). Schema version remains `1`.

### Entities

| Entity | Fields the view uses | Primary Key | Relationships | Notes |
|--------|----------------------|-------------|---------------|-------|
| Board snapshot | `generatedAt`, `stale`, `repositoryRoot`, `hiveRoot`, `doctor` (`hiveReady`, `engineRungReady`, optional legacy `ready === hiveReady`), `autonomy`, `features[]` | `generatedAt` | has many view models | Rebuilt on each GET. `stale: true` when `hiveReady` is false, CLI fails, or heartbeat missed. |
| Task card | P-001 Task fields plus derived `readiness` | `(featureId, id)` | belongs to feature; assignee points at RosterAgent | `readiness` is `ready` or `waiting` when `status` is `todo`. Not written back. |
| Worker card | P-001 RosterAgent plus `currentTaskId`, gauge | `id` | has at most one `doing` task | `engine` or `model` null renders `unknown`. Status outside `idle \| busy \| blocked \| offline` renders `unknown`, not `busy`. |
| Activity event | P-001 Event | `id` | data may cite task, agent, ask id | File order. Window default 200 from the tail. |
| Ask-Me item | P-001 AskMeItem | `id` | optional task and agent | Inbox is `state: open` only. List order is the CLI order. |
| Trigger row | `id: "away-poll"`, `enabled`, `pollIntervalMs`, last tick | `away-poll` | from AutonomySettings | One row. No cron, no webhook. |
| Morning brief | counts and sentences | none | derived | Not stored. |
| Goal brief | P-001 Brief input | `featureId` | staffs ledger via CLI | `budgetTokens` and `budgetUsd` null means unset. |

**Task card**

- `readiness`: `ready` when P-001’s DAG-ready rule holds and `hold` is not true, otherwise `waiting` for any other `todo` task. `doing`, `blocked`, and `done` keep those words. Waiting or held tasks do not show Dispatch.
- `hold`: when true, show held badge; Pause on `doing` sets hold via `task-hold`; Dispatch refused with `DISPATCH_HELD` if the Operator bypasses UI guards.
- Columns: Ready, Waiting, Doing, Blocked, Done. Ready and Waiting are both hive `todo`.
- `drift: removed` tasks stay visible and are not Dispatch targets.
- Invariants: the client does not invent a status. After steer, the snapshot’s `status` replaces the card.

**Worker card**

- Current task: the ledger task with `assigneeAgentId === agent.id` and `status === doing`. If several, the latest `updatedAt` wins. If none, the task line is `none recorded`.
- `contextUsedRatio` absent: gauge label `unknown`.
- Invariants: `workspace` is not a hive root and is not shown as one. `offline` is not eligible in the reassign picker as a successful target; it appears with the warning and cannot be submitted.

**Activity event**

- Rendered fields: `ts`, `type`, `featureId`, `actor.kind`, `actor.id`, and the allowlisted `data` keys from P-001’s event table.
- The visible window is in append order (older above newer). The view scrolls to the newest line so recent events are on screen. “Earlier” prepends the previous 200 lines and does not sort by `type`.
- Empty file: `No events recorded.` No sample rows.
- Invariants: the client does not rewrite a line and does not drop a line it has shown.

**Ask-Me item**

- Inbox fields from `ask-me-list`: `id`, `reasonClass`, `state`, `featureId`, `taskId`, `agentId`, `question`, `ageSeconds`.
- Open detail uses `ask-me-show` for the full item.
- Answer POST requires non-empty `text` and `action` of `retry`, `keep_blocked`, or `acknowledge`, after a confirmation step.
- Invariants: routine events (`task.assigned`, `task.recommended`, `away.tick`, pattern-less idle wake) are not turned into inbox rows. A new `ask_me.opened` while another view is showing pulses the amber lamp and increments the header count. The app does not answer it.

**Trigger row**

- `enabled` is `AutonomySettings.awayMode`.
- Interval text uses `pollIntervalMs` (default `60000` when the field is missing, matching P-001).
- When `awayMode` is false, the headline is `Nothing is scheduled.` The row stays visible with state `off` so the poll is disarmed rather than hidden.
- When `awayMode` is true, state is `on` and the next line is `Next poll within <pollIntervalMs> ms of the last away tick`, or `Next poll on the away interval` when no `away.tick` is in the loaded tail.
- P-001 has no exhausted counter. The view does not render an exhausted chip. A doctor finding `UNSUPPORTED_TRIGGER` is shown as doctor text if present.
- Invariants: the board does not call `away-set`.

**Morning brief**

Derived only. Lead with numbers, in this shape:

```text
{done} done. {blocked} blocked. {doing} in progress.
Spend: none recorded. Quota: unknown.
Needs you: {openAskMe | nothing}.
Next trigger: {nothing scheduled | away poll every {pollIntervalMs} ms}.
```

When `done`, `blocked`, and `doing` are all zero, the first line is preceded by `Nothing in flight.` Quota is the word `unknown`, never a percentage. `Needs you: nothing` when `openAskMe` is 0.

**Goal brief**

- Required to submit: non-empty `outcome` (max 4000) and non-empty `deliverable` (max 1000). The client and the bridge both refuse otherwise, and the bridge does not spawn `brief-submit`.
- `constraints`: string array, may be empty, each max 500.
- `budgetTokens` and `budgetUsd`: `null` when the input is blank. A negative number is refused locally. `0` is sent as `0`, not as unset.
- `featureId` must match the P-001 segment regex, and `<repositoryRoot>/specs/<featureId>/plan.md` must exist. Otherwise the bridge sends nothing.
- `createdBy` is not sent; P-001 sets `operator`.

State transitions the board causes go only through Plane steer commands:

```text
todo (ready, not held) --dispatch-task--> doing
doing --task-hold hold true--> doing + hold (badge)
doing + hold --task-hold hold false--> doing (when resume is offered)
todo or doing --task-abort confirm--> blocked (reviewFailures unchanged)
todo or doing --task-reassign--> same status, new assigneeAgentId + event
```

`done` is not an abort, pause, or reassign source. Review failure transitions (`record-result` with `passed: false`) are not operator board actions. Ask-Me `retry` / `keep_blocked` / `acknowledge` stay on `ask-me-answer` and follow P-001’s effects.

## Contracts

### API / Service Interfaces

The HTTP routes are a loopback transport. They are not a second Command Plane. Request and response bodies use the P-001 error envelope on failure:

```json
{
  "ok": false,
  "error": "HIVE_NOT_INITIALIZED",
  "message": "Hive is not initialized.",
  "hint": "Run superspec hive init, then superspec doctor"
}
```

Plane error codes pass through unchanged (`HIVE_NOT_INITIALIZED`, `HIVE_ROOT_UNRESOLVED`, `HIVE_SCHEMA_MISMATCH`, `HIVE_CORRUPT`, `HIVE_NOT_WRITABLE`, `DISPATCH_PATH_REQUIRED`, `DISPATCH_HELD`, `HIVE_NOT_READY`, `TOKEN_REQUIRED`, `ASK_ME_NOT_FOUND`, `ASK_ME_ALREADY_RESOLVED`, `INVALID_INPUT`, `FEATURE_NOT_FOUND`, `ABORT_UNSUPPORTED`, and the rest of P-001’s list). Local refusals use `INVALID_INPUT` with a `message` that states the action was not sent. Missing bearer on mutations returns `401` with `error: "TOKEN_REQUIRED"`. The page shows `message` and `hint`. It does not show stack traces, the token, or host paths beyond `hiveRoot` as doctor already prints it.

All routes below that mutate state require header `Authorization: Bearer <token>`.

Successful CLI JSON is returned inside the snapshot or as the POST body with `ok: true`. `persona` on Plane responses stays `{ "callsign": "Ira", "expansion": "Intelligent Resource Automation" }` when the command includes it. The header reads that object. It does not hard-code a different expansion.

#### GET /api/health

Response `200`:

```json
{ "ok": true, "bind": "127.0.0.1", "port": 4731 }
```

This route does not read the hive. The shell uses snapshot failure, not health failure, to enter degraded mode.

#### GET /api/snapshot

Response `200` when the process is up, including when the Plane is down (`stale: true`, empty arrays):

```json
{
  "ok": true,
  "generatedAt": "2026-10-15T16:20:00.000Z",
  "stale": false,
  "repositoryRoot": "/abs/main",
  "hiveRoot": "/abs/main/.superspec/hive",
  "persona": { "callsign": "Ira", "expansion": "Intelligent Resource Automation" },
  "doctor": { "ok": true, "hiveReady": true, "engineRungReady": true, "ready": true, "findings": [] },
  "autonomy": { "autonomy": "supervised", "awayMode": false, "pollIntervalMs": 60000 },
  "features": [
    {
      "featureId": "002-ira-command-center",
      "taskCounts": { "todo": 1, "doing": 0, "blocked": 0, "done": 0 },
      "openAskMe": 0,
      "tasks": [],
      "brief": null
    }
  ],
  "agents": [],
  "askMe": [],
  "events": []
}
```

`tasks` elements are P-001 ledger tasks plus `readiness`. `events` is the oldest-to-newest tail of at most 200 parsed lines. `askMe` is the `ask-me-list` `items` array in CLI order.

Query `eventsBefore=<event id>&limit=200` on this route returns the next older page in append order. It does not change the live tail.

#### GET /api/events

`Content-Type: text/event-stream`. First frame `event: snapshot` with the snapshot JSON. Later frames `event: hive` and `id: <event id>` with the raw line as `data`. Comment lines starting with `:` are heartbeats.

#### POST /api/brief

Requires `Authorization: Bearer <token>`.

```json
{
  "featureId": "002-ira-command-center",
  "outcome": "Ship the command center shell",
  "constraints": ["no voice"],
  "budgetTokens": null,
  "budgetUsd": null,
  "deliverable": "specs/002-ira-command-center"
}
```

Bridge checks outcome, deliverable, and `plan.md`, then runs:

```text
superspec brief submit --cwd <repositoryRoot> --feature <id> --outcome <text> --deliverable <text>
  [--constraint <text> ...] [--budget-usd <n>] [--budget-tokens <n>]
```

Blank budgets omit the budget flags (P-001 treats omitted as null). The response is the CLI JSON (`brief`, `tasks`, `assignment`). The client then refetches the snapshot. Acknowledgement copy uses that JSON: feature id, brief id, and task count. It does not claim staffing that the response did not list.

#### POST /api/ask-me/answer

Requires `Authorization: Bearer <token>`.

```json
{ "id": "ask_...", "text": "Retry at the same ceiling", "action": "retry", "confirm": true }
```

Requires `confirm: true` and non-empty `text`. Spawns `superspec ask-me answer --id --text --action`. The response is the CLI JSON (`item`, optional `task`). The item leaves the open inbox when `state` is `resolved`.

#### POST /api/tasks/dispatch

Requires `Authorization: Bearer <token>`.

```json
{ "featureId": "002-ira-command-center", "taskId": "T001" }
```

Spawns `dispatch-task` under the steer guards. Response is the Plane JSON (same as MCP). After refetch, the ledger task is `doing` when dispatch succeeded. Engine spawn is host-delegate or supervisor per P-006 inside `dispatch-task`; this board never argv’s `begin-task`.

#### POST /api/tasks/pause

Requires `Authorization: Bearer <token>`.

```json
{ "featureId": "002-ira-command-center", "taskId": "T001" }
```

Spawns `task-hold --hold true` under the pause guard. No `confirm` field. Does not change `reviewFailures`.

#### POST /api/tasks/abort

Requires `Authorization: Bearer <token>`.

```json
{ "featureId": "002-ira-command-center", "taskId": "T001", "confirm": true }
```

Spawns `task-abort --confirm true` under the abort guards. `confirm` must be true. Does not call `record-result`.

#### POST /api/tasks/reassign

Requires `Authorization: Bearer <token>`.

```json
{ "featureId": "002-ira-command-center", "taskId": "T001", "agentId": "agent-host" }
```

Spawns `task-reassign`. Success returns Plane JSON; Activity gains the reassign event from the Plane, not a bridge-only ledger patch.

#### Integration points

| Integration | Protocol | Notes |
|-------------|----------|-------|
| P-001 CLI | `execFile` argv, JSON stdout | Reads; mutations via `dispatch-task`, `task-hold`, `task-abort`, `task-reassign`, `brief-submit`, `ask-me-answer`. Timeout 10s for reads, 30s for `brief-submit` and steer. |
| Hive files | Read-only JSON and JSONL | Ledger body and event tail only. `hiveRoot` from `hive status`. |
| Forge `state.json` | Not opened by this app | Forge handlers inside Plane commands own it. |
| Loopback token | Read `<hiveRoot>/auth/loopback.token` | Verify Bearer on every mutation; never log or echo token. |
| P-003 patterns | Directory presence only | No sqlite, no markdown parse. |
| P-004 spend and gauges | Not called | Empty spend. Gauge only from additive `contextUsedRatio` on `roster-list`. |
| Hermes, OpenClaw, voice, Electron | None | Not linked. |

Rate limits do not apply. One Operator, one loopback process. A second steer POST for the same feature while one is running returns `INVALID_INPUT` with message `A steer action is already running.`

### Consumed From Other Specs

| Source spec | Contract | Version / stability | Notes |
|-------------|----------|---------------------|-------|
| specs/001-ira-command-plane | CLI/MCP JSON for hive-status, brief-show, roster-list, ask-me-list, ask-me-answer, autonomy-show, away-set, doctor, dispatch-task, task-hold, task-abort, task-reassign | v1, additive fields only | The board calls every name in this list except `away-set`, which would toggle away. It also calls `brief-submit` and `ask-me-show`. It does not argv raw `begin-task` or `record-result` for steer. It does not define new tool names. |
| specs/001-ira-command-plane | events.jsonl event schema v1 | v1, new type values allowed | Activity and the SSE tail. Unknown types are shown as their `type` string, not dropped. |

`dispatch-task` internally calls `begin-task` only after hooks allow; the board never invokes that step directly. Steer commands sync the hive before they return. The board treats non-JSON stdout as failure and refetches the ledger either way.

Ledger files, `settings.json`, `briefs/<featureId>.json`, and `ask-me/<id>.json` are the P-001 data model behind those commands. The snapshot copies them. It does not rename fields.

### Produced For Other Specs

| Target spec / consumer | Contract | Version / stability | Notes |
|------------------------|----------|---------------------|-------|
| (none) | (none) | n/a | This board publishes no API. Closing the process does not stop forge. P-003 and P-004 do not read this UI. |

### Event Schema (if applicable)

The board publishes no hive events. It consumes P-001’s line schema (`id`, `type`, `version: 1`, `ts`, `featureId`, `actor`, `data`). Channel remains `<hiveRoot>/events/events.jsonl`. Ordering and retention are P-001’s (append order, doctor warns above 50 MB, no compaction).

SSE is a transport frame, not a new hive type:

```text
event: hive
id: evt_00000000-0000-4000-8000-000000000000
data: {"id":"evt_...","type":"task.started","version":1,"ts":"2026-10-15T16:20:00.000Z","featureId":"002-ira-command-center","actor":{"kind":"ira","id":"ira"},"data":{"taskId":"T002","agentId":"agent-host"}}
```

Reassign event `type` and payload come from P-001 `task-reassign`; the bridge does not append events.

## Appendix: FR Coverage

| FR | Where this design satisfies it |
|----|--------------------------------|
| FR-001 | Loopback shell over doctor (`hiveReady`) and hive status |
| FR-002 | Ledger tasks, Ready vs Waiting from the DAG-ready rule |
| FR-003 | `roster-list` plus ledger join for the current task |
| FR-004 | Event tail, append order, earlier page |
| FR-005 | Memory empty or unavailable, no second store |
| FR-006 | Spend absent, budgets unset, doctor `budget_unmetered` passed through |
| FR-007 | `ask-me-list` / `ask-me-show`, amber lamp |
| FR-008 | Away poll row from `autonomy-show` and away events |
| FR-009 | Derived morning brief |
| FR-010 | Steer decision: `dispatch-task`, `task-hold`, `task-abort`, `task-reassign`; OD-017 Bearer on mutations |
| FR-010a | `auth.ts` + `401 TOKEN_REQUIRED` on unauthenticated mutations |
| FR-010b | Degrade on `hiveReady`; engine banner on `engineRungReady` false |
| FR-011 | `ask-me-answer` after confirmation |
| FR-012 | `brief-submit` after local required-field checks |
| FR-013 | SSE tail plus 1s snapshot fallback |
| FR-014 | Gauge only from `contextUsedRatio` when present |
| FR-015 | No floor route |
| FR-016 | Token table, motion, one arc |
| FR-017 | Header callsign from `persona` |
| FR-018 | CLI and hive files; no private ledger |
| FR-019 | No Hermes or OpenClaw modules |
| FR-020 | Stale and empty copy; refusals send nothing |
| FR-021 | No speech APIs in the client |
| FR-022 | Header links for all seven views plus brief |
| FR-023 | Inbox is only `ask-me-list` items |
| FR-024 | Morning-brief sentence order |
| FR-025 | Forge CLI remains the writer; the board is optional |

---

<!-- Adapted from SK: templates/plan-template.md (MIT). See /NOTICE. -->
