# Design: Ira Command Plane

**Revision**: 2026-10-16 | **Status**: DRAFT | **Owner**: @grok

**Input**: Feature specification from `specs/001-ira-command-plane/spec.md`

## Required Reading / Prior Art

| Path | Reason |
|------|--------|
| `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` | LOCKED production remediation. Supersedes conflicting Decisions in this design |
| `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md` | Parent requirements. OD-001–OD-008 stay closed except the missing-signal sentence replaced by OD-013 |
| `specs/001-ira-command-plane/spec.md` | FR-001–FR-034, including Session 2026-10-16 |

`docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` is LOCKED. If this design disagrees with that amendment, the amendment wins.

## Summary

Ira (**Intelligent Resource Automation**, callsign **Ira**) is the GOD orchestrator for a SuperSpec repository. P-001 adds a Command Plane to the existing `@superspec-dev/core` CLI and MCP server so an Operator can brief a feature, staff a hive task ledger from `plan.md`, route Ask-Me escalations, and let Ira assign the next DAG-ready task — without a web UI and without Ira editing feature source.

The hive is project-local machine state at `<repository-root>/.superspec/hive/`, anchored to the main git worktree that contains `program.md`. Per-feature forge execution state stays at `specs/<feature>/.superspec/state.json`. Forge remains the sole writer of that file. The hive mirrors it under an exclusive lock after each successful forge write. Sync is best-effort: a sync failure does not roll back forge state and does not change the forge tool’s success result. This is parent **Option D**: one local CLI/MCP API, files on disk, Command Center (P-002) as a later consumer. Orchestrator and executor stay separate (Ruflo division of labor): Ira routes, records, escalates, and replans; fresh subagents write code.

## Production invariants

Fail-closed means: on a violated gate the command returns a non-zero outcome, writes no partial steer effect, and does not substitute a nearby success path. Source: `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` (LOCKED). Rows below are the amendment invariants that name spec 001. OD-016 (non-blocking distill) is owned by P-003; this design does not await distill on the `record-result` return path.

| Invariant | Fail-closed behavior |
|-----------|----------------------|
| OD-009 Host engines default to host spawn | Engine ids `claude`, `codex`, and `cursor-agent` (alias `cursor` maps to `cursor-agent`) are host engines. `EngineHooks.dispatch` returns `null` and MUST NOT spawn them. Ira MUST NOT parent a host engine from an IDE-attached MCP process. Away and idle wake persist a `DispatchIntent` and MUST NOT start `claude`, `codex`, or `cursor-agent`. A detached supervisor child is permitted only for `opencode`, `crush`, `aider`, and `custom`. `delegateToHost: null`, an away pid match, or `engines hooks install` MUST NOT flip a host engine into Ira-parent spawn. Violation returns `HOST_SPAWN_FORBIDDEN` and starts no child. |
| OD-010 One dispatch path | The only steer command is `dispatch-task` (CLI and MCP, same JSON). Order is fixed: `TokenHooks.beforeDispatch` → `EngineHooks.dispatch` → `begin-task` only after the hook allows and dispatch returns `null` (host) or `{ accepted: true }`. `{ allow: false }` or `{ accepted: false }` MUST NOT call `begin-task`. The board, away tick, and idle wake MUST call `dispatch-task` and MUST NOT argv `begin-task`. When the hive exists, a `begin-task` call that is not the internal call from `dispatch-task` returns `DISPATCH_PATH_REQUIRED` and does not mark the task in progress. When the hive is absent, `begin-task` stays the pre-Ira forge command. |
| OD-011 Hold ≠ fail | Pause sets hive-only `hold: true` on the ledger task and appends `task.held`. It MUST NOT call `record-result`, MUST NOT increment `reviewFailures`, and MUST NOT change forge failure state. `dispatch-task` on a held task returns `DISPATCH_HELD`. Abort is `task-abort` with `confirm: true` only. Abort MUST NOT call `record-result --passed false`. If the only available transition would increment `reviewFailures`, abort returns `ABORT_UNSUPPORTED` and writes nothing. `reviewFailures` increments only on a real review outcome of `passed: false`. |
| OD-012 Locks | The only lock implementation is `withLock` in `@superspec-dev/core`. Lock body is `{ pid, nonce }` created with flag `wx`. Steal (unlink + retry) is permitted only when `process.kill(pid, 0)` fails and a re-read shows the same `nonce`. Age, including `acquiredAt` older than 30 seconds, MUST NOT steal. Release unlinks only when the caller’s nonce equals the file nonce. The Command Center MUST NOT contain a lock-file implementation. Hive writes from the board go through a core CLI/MCP command. A second lock copy is a defect. |
| OD-013 Away + CI | `allowAbsentCi` defaults to `false`. Missing CI and CI state `absent` block away dispatch with reason `ci_absent` unless the persisted value is exactly `true`. State `red` always blocks with `ci_not_green`. State `green` passes the CI gate only. Each away tick writes `<hiveRoot>/away.heartbeat` (`{ pid, at }`, mode `0600`) before any dispatch. Heartbeat write failure skips dispatch with `heartbeat_failed`. Doctor finding `AWAY_PID_STALE` is severity `error` when `away.pid` exists and the pid is dead, or `awayMode` is true and the heartbeat is missing or older than `2 * pollIntervalMs`. Doctor MUST NOT delete `away.pid`. |
| OD-014 Doctor readiness split | Doctor returns `hiveReady` and `engineRungReady` as separate booleans. `hiveReady` is coordination-store health. `engineRungReady` is rung health and is P-006. An engine finding MUST NOT set `hiveReady` false. A legacy `ready` field, if emitted, MUST equal `hiveReady` and MUST NOT be the conjunction of the two booleans. Dispatch requires `hiveReady`. |
| OD-015 Process isolation | Non-host engine children run only inside a detached supervisor (`detached: true`, `shell: false`, stdio not the MCP stdio pipes, parent unref). The IDE-attached MCP server MUST NOT be the parent of those children and MUST NOT run the supervisor in-process. `registerCommandPlaneHooks` catches every hook exception. A throw becomes `{ allow: false }` or `{ accepted: false }` plus event `hook.failed` with reason `HOOK_FAILED_CLOSED`. The forge tool’s already-successful `saveState` result, stdout, and exit code stay success. A hook MUST NOT exit the process. |
| OD-017 Loopback auth | P-001 does not bind a port. The Command Center mutation surface is not unauthenticated. The bridge (P-002) binds `127.0.0.1` only and requires `Authorization: Bearer <token>` on POST, PUT, PATCH, and DELETE. OPEN-007 multi-user auth stays open. The token is a local mutation gate, not a user directory. |
| OD-019 Env scrub and sandbox | Supervisor `env` is a new object, not `process.env`. Doctor `worktreeKind` (`main` or `linked`) and `sandboxed` are independent. `sandboxed: true` is legal only when that child was started under an OS sandbox wrapper. A linked worktree MUST NOT set `sandboxed` true (`WORKTREE_IS_NOT_SANDBOX`). Slice A has no sandbox wrapper, so `sandboxed` is `false`. |
| OD-020 Forge Slice A | Until doctor reports `sliceAValidated: true`, the only live Ira surfaces are P-001, P-006 host-delegate (`null`, no host-CLI spawn), the board Dispatch control calling `dispatch-task`, and Ask-Me create/list/answer. Distill writes, spend and breaker side effects, persona/roster writes, and detached spawn of `opencode` / `crush` / `aider` / `custom` are no-ops that return `SLICE_A_ONLY` and perform no side effect. `TokenHooks.beforeDispatch` stays live as a gate. Forge `saveState` / `record-result` persistence stays live. Pause or abort uses OD-011 and MUST NOT call `record-result`. `sliceAValidated` is recomputed by doctor from the four OD-020 checks, not from a hand-edited flag. |

## Technical Context

**Language/Version**: TypeScript 5.5, Node.js >= 20, ESM (`"type": "module"`), NodeNext. Same toolchain as the `superspec` npm workspaces root and `@superspec-dev/core` 0.2.x.

**Primary Dependencies**: Existing `@superspec-dev/core` runtime only: `@modelcontextprotocol/sdk`, `zod`, `yaml`, `@superspec-dev/render`, and Node built-ins (`node:fs/promises`, `node:path`, `node:crypto`, `node:child_process` `execFile`/`spawn`). No new runtime dependency. No Electron. No HTTP server in this feature.

**Storage**: JSON and append-only JSONL files under `<repository-root>/.superspec/hive/`. Forge state remains `specs/<feature>/.superspec/state.json` (already gitignored). Coordinator handoff remains `specs/<feature>/.superspec/coordinator.md`. No SQLite and no user-global hive in P-001.

**Testing**: Vitest, matching `packages/core/test/`. Unit tests for pure transitions (status map, replan policy, Ask-Me ordering, path resolution). Contract tests for MCP tool schemas and CLI JSON. Integration tests use a temporary directory with a synthetic main worktree and a linked worktree (`.git` file plus `commondir`) so hive anchoring is proven without a second hive.

**Target Platform**: Local Node process on the Operator machine. Hosts are the existing SuperSpec CLI (`bin/superspec.js`) and the stdio MCP server named `superspec`. Cross-harness (Cursor, Claude Code, Codex) by keeping the tool surface on that one server.

**Project Type**: Library modules plus CLI subcommands and MCP tools inside the existing `@superspec-dev/core` package.

**Performance Goals**: `brief-submit` on a 50-task plan finishes in under 1 second on local SSD (SC-001's five-minute figure is Operator time, not server time). Idle-wake calls `dispatch-task` inside the `record-result` path and returns before the tool response (SC-004's 30-second bound). Distill is not awaited on that path. Away-mode work is a poll every 60 seconds, not a latency path. Hive status reads the ledger and the tail of the event log (default last 200 events) rather than the whole log. Forge persistence returns without waiting on distill, supervisor spawn, or a second lock implementation.

**Constraints**: Local-first (no cloud control plane). Hive contents gitignored. Telemetry of prompts and code off by default. Single Operator. Multi-user auth stays open (parent OPEN-007). P-001 does not bind an HTTP server. Command Center mutations are not unauthenticated: P-002 requires the loopback bearer token (OD-017). That token is a local mutation gate, not a user directory. Critical classes never silent-approve and never time out into approval. Existing forge MCP tools stay callable and keep their response text when the hive is absent. When the hive exists, steer goes through `dispatch-task`. Ira does not write feature source and does not parent host engines.

**Scale/Scope**: One hive per repository, one Operator, tens of roster agents, hundreds of tasks per feature, multiple features namespaced by `featureId`. Event log is append-only; doctor warns above 50 MB. v1 does not rotate or compact the log.

## Architecture

### System Structure

Ira sits in-process beside the forge loop. The Operator talks only to the existing `superspec` CLI or MCP server. Those handlers call Command Plane modules, which read and write the hive and call the existing forge functions (`loadState`, `saveState`, `nextTask`, `markInProgress`, `recordResult`, `parsePlan`, `writeCoordinatorBrief`, `appendCoordinatorLog`). Workers receive a dispatch intent and run as fresh subagents. They do not open a second hive.

```text
Operator
  |  superspec CLI  or  MCP stdio (server name "superspec")
  v
packages/core  cli.ts + mcp-server.ts
  |  existing forge tools unchanged when hive is absent
  |  when hive exists, they call sync after a successful forge write
  v
command-plane/   Ira (route, staff, adjudicate, replan, escalate)
  |              does not edit feature source and does not parent host engines
  +------------------+-------------------+----------------------+
  |                  |                   |                      |
  v                  v                   v                      v
.superspec/hive/   specs/<feature>/    coordinator.md      Hook registry
roster, ledger,    .superspec/         (existing lean      LearningHooks
blackboard,        state.json          loop; still the     TokenHooks
events.jsonl,      (forge writer)      handoff file)       HireHooks
mailboxes,                                                 EngineHooks
ask-me, settings                                           no-op until P-003..P-006
  |
  v
dispatch-task
  TokenHooks.beforeDispatch --> EngineHooks.dispatch --> begin-task
  host engine: null + queued DispatchIntent (no host CLI spawn)
  non-host, after Slice A: detached supervisor only (never the MCP parent)
```

Component responsibilities:

| Module | Responsibility |
|--------|----------------|
| `paths.ts` | Resolve the main worktree, hive root, and feature directory. Reject path traversal. |
| `store.ts` | Atomic JSON replace, locked JSONL append. Lock files only through `withLock`. |
| `ledger-sync.ts` | Map plan + `ForgeState` onto hive tasks. Forge status and `reviewFailures` win on conflict. |
| `brief.ts` | Persist a goal brief and staff ledger rows plus one assignment. |
| `ask-me.ts` | Critical-class inbox, ordering, answer, unblock. |
| `replan.ts` | Below-ceiling retry policy after a real review failure. At ceiling, open Ask-Me and stop. Pause is `hold`, not a failure. |
| `dispatch.ts` | `dispatch-task` order: token gate, engine hook, then internal `begin-task`. |
| `away.ts` | Manual away flag, heartbeat, and 60-second `forge-status` poll. Calls `dispatch-task`. |
| `mailbox.ts` | Inbox/outbox append with role checks. |
| `blackboard.ts` | Single-scribe feature snapshot. |
| `doctor.ts` | Integrity, gitignore, MCP tool presence, `hiveReady`, next setup steps. `engineRungReady` is reported and owned by P-006. |
| `hooks.ts` | Interfaces and no-op defaults for P-003, P-004, P-005, P-006. |

Governance gates (TDD, traceability completeness, constitution checks) stay in `constitution.md` and `superspec-validate`. This design does not restate them as runtime policy beyond the doctor checks and the dispatch refusal for code tasks that lack FR tags.

### Project Structure

#### Documentation (this feature)

```text
specs/001-ira-command-plane/
├── spec.md
├── design.md
├── plan.md              # produced later by superspec-plan
└── adr/                 # optional extracts; decisions below are normative
```

#### Source Code (repository root)

```text
packages/core/src/command-plane/
├── paths.ts
├── schema.ts            # zod schemas; contract source of truth
├── types.ts
├── store.ts
├── persona.ts           # callsign Ira, expansion Intelligent Resource Automation
├── brief.ts
├── roster.ts
├── ledger-sync.ts
├── ask-me.ts
├── replan.ts
├── dispatch.ts
├── away.ts
├── mailbox.ts
├── blackboard.ts
├── doctor.ts
├── hooks.ts
└── index.ts

packages/core/src/cli.ts          # new subcommands; forge commands kept
packages/core/src/mcp-server.ts   # new tools registered beside existing ones
packages/core/src/forge-loop.ts   # add reconcileState; do not change recordResult semantics
packages/core/src/index.ts        # re-export command-plane public types and hooks

packages/core/test/command-plane/
├── paths.test.ts
├── ledger-sync.test.ts
├── ask-me.test.ts
├── replan.test.ts
├── away.test.ts
├── mailbox.test.ts
├── doctor.test.ts
└── contracts.test.ts
```

**Structure Decision**: Extend `@superspec-dev/core` with a `command-plane/` directory. The published bin stays `superspec`. The MCP server stays a single stdio server. Hive files live only under the main worktree `.superspec/hive/`. P-002 may become its own web package later; it is not part of this layout. See the package-boundary decision for why a second npm package is rejected for P-001.

## Decisions

### Decision: Extend `@superspec-dev/core` instead of publishing `@superspec-dev/command-plane`

**Rationale**:

Problem statement: Parent OPEN-008 asks whether Ira's writer lives in the core package or in a new `@superspec-dev/command-plane` package.

Context: FR-001 and FR-018 require the Command Plane to extend the current CLI and MCP tools, not replace them. FR-021 requires CLI and MCP to share state. Hive sync has to run after `saveState` inside `begin-task`, `record-result`, and `sync-status`. Those handlers live in `packages/core/src/cli.ts` and `packages/core/src/mcp-server.ts`. `recordResult` in `forge-loop.ts` already owns `reviewFailures` and `maxReviewFailures`.

The Command Plane is a module namespace inside `@superspec-dev/core`: `packages/core/src/command-plane/`. New tools are appended in `buildToolDefinitions()`. New subcommands are appended in `runCliInner`. Public types and hook registration are re-exported from `packages/core/src/index.ts`. No second stdio server and no second bin.

A separate package is the right shape for the P-002 web app later, because that app only reads this API. It is the wrong shape for the hive writer.

**Alternatives considered**:

- **New `@superspec-dev/command-plane` package with its own MCP server**: Rejected. Hosts would register two servers, and forge handlers could not sync the hive in the same process after `saveState`. A post-hoc watcher would race the forge writer.
- **New package that `@superspec-dev/core` depends on**: Rejected. It inverts the layering (the engine would depend on a feature) and still couples the packages through the forge handlers.
- **Runtime plugin loaded from a sibling package**: Rejected. Extra install and doctor wiring, with no isolation benefit, because ledger status and forge status must commit together.

### Decision: Hive layout on disk

**Rationale**:

Problem statement: FR-012, FR-013, FR-014, FR-015, and FR-028 require one durable store for roster, blackboard, ledger, mailboxes, and an append-only event log, at `<repository-root>/.superspec/hive/`.

Context: Munder `HIVE.md` and `src/main/hive.ts` are the protocol reference (single-writer inbox/outbox, shared board). SuperSpec APIs must return structured JSON (FR-001, SC-007), so the adaptation uses JSON documents and JSONL logs rather than markdown mailboxes. Markdown remains the coordinator handoff, which already exists. MIT attribution goes in file headers of modules that adapt that protocol. No Munder source is copied.

Layout (all paths relative to the hive root):

```text
.superspec/hive/
├── hive.json                      # schemaVersion 1, repositoryRoot, persona
├── settings.json                  # AutonomySettings
├── roster.json                    # RosterAgent[]
├── blackboard.json                # single-scribe snapshot
├── briefs/<featureId>.json
├── ledger/<featureId>.json        # tasks for one feature
├── ask-me/<itemId>.json
├── events/events.jsonl            # append-only
├── mailboxes/<agentId>/inbox.jsonl
├── mailboxes/<agentId>/outbox.jsonl
├── locks/                         # ephemeral exclusive locks; only withLock creates or removes them
├── dispatch-queue/<featureId>/<taskId>.json  # host DispatchIntent, mode 0600
├── quarantine/                    # only after an explicit repair
├── away.pid                       # only while the poller runs; doctor never deletes it
└── away.heartbeat                 # { pid, at }, mode 0600, rewritten each tick before dispatch
```

`featureId` and `agentId` are single path segments. `featureId` matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$` and must equal the directory name under `specs/`. `agentId` matches `^[a-z0-9][a-z0-9-]{0,63}$`. Reject `..`, separators, and absolute paths.

Writer rules:

| Path | Writer | Enforcement |
|------|--------|-------------|
| `ledger/<featureId>.json` | Ira sync only | Exclusive lock `locks/ledger-<featureId>.lock` during read-modify-write |
| `blackboard.json` | Ira scribe only | Exclusive lock `locks/blackboard.lock`. Second writer gets `SCRIBE_BUSY` immediately (no wait) |
| `events/events.jsonl` | Ira only | Exclusive lock `locks/events.lock`, then one `appendFile` of a single line |
| `mailboxes/<id>/inbox.jsonl` | Ira router only | Role `worker` is rejected with `MAILBOX_ROLE` |
| `mailboxes/<id>/outbox.jsonl` | That agent only | Role `ira` is rejected. Lock `locks/mailbox-<id>-outbox.lock` so two appends cannot interleave |
| `settings.json`, `roster.json`, `briefs/`, `ask-me/` | Ira API handlers | Atomic write: temp file in the same directory, then `rename` |
| `specs/<feature>/.superspec/state.json` | Existing forge functions only | Hive code must not `writeFile` this path |

JSONL readers ignore a trailing partial line. Doctor reports any earlier line that is not valid JSON. `hive-init` is idempotent when `schemaVersion` is 1. A different version returns `HIVE_SCHEMA_MISMATCH` and does not rewrite. `hive-init --repair` moves unreadable files into `quarantine/<timestamp>/` and recreates empty valid files; without `--repair`, dispatch and away continuation refuse with `HIVE_CORRUPT`.

`hive-init` and doctor ensure the repository `.gitignore` contains the line `.superspec/hive/`. Doctor fails readiness when that path is not ignored. The whole hive directory is machine state, including locks and `away.pid`.

**Alternatives considered**:

- **Markdown inbox/outbox files, copied from Munder**: Rejected. The Command Plane contract is structured JSON for CLI and MCP. Markdown stays the human coordinator brief.
- **One JSON file for the entire hive**: Rejected. Ledger updates would rewrite the event log and break append-only semantics.
- **SQLite**: Rejected for P-001. The parent pattern store (P-003) already owns a SQLite FTS index. The hive needs a gitignored directory an Operator can inspect and doctor can parse without a driver.
- **Per-feature hive under `specs/<feature>/.superspec/`**: Rejected. OD-007 forbids a per-feature hive root. Forge state already lives there.

### Decision: Sync forge state into the hive without a second writer

**Rationale**:

Problem statement: FR-003 and user story 3 require the hive ledger to follow plan tasks and forge transitions without dual-writer corruption. Forge status vocabulary is `pending | in_progress | done | blocked`. Hive status vocabulary is `todo | doing | blocked | done`.

Context: `ForgeState` is `{ tasks: Record<taskId, { status, reviewFailures }> }` stored at `specs/<feature>/.superspec/state.json`. `saveState` / `loadState` are the only writers. `recordResult` increments `reviewFailures` and blocks at `maxReviewFailures`.

Authority split:

| Field | Authority |
|-------|-----------|
| `status`, `reviewFailures` | Forge `state.json`, then mirrored |
| `title`, `implementsFr`, `dependsOn`, `kind`, `complexity` | `plan.md` via `parsePlan`, copied on staff and sync |
| `assigneeAgentId`, Ask-Me link, replan metadata, drift, `hold`, `abortReason` | Hive ledger |

Status map (one function, used in both directions only as specified):

| Forge | Hive |
|-------|------|
| `pending` | `todo` |
| `in_progress` | `doing` |
| `blocked` | `blocked` |
| `done` | `done` |

Hive code never writes `state.json` except by calling `markInProgress`, `recordResult`, `saveState`, or the new `reconcileState` helper. `reconcileState(tasks, previous)` adds missing task ids as `pending` / `reviewFailures: 0`, leaves existing rows untouched, and does not delete ids missing from the plan.

When `hive.json` is absent, `begin-task`, `next-task`, `record-result`, `sync-status`, `forge-status`, and `coordinator-brief` behave exactly as they do today (same arguments, same stdout). They do not create the hive. Command Plane tools return `HIVE_NOT_INITIALIZED` and a doctor hint. This keeps FR-017 and FR-018.

When the hive exists, those forge handlers call `syncHiveFromForge(featureId)` after the forge write and coordinator append succeed, and before the tool returns. `dispatch-task` uses the same rule: forge `begin-task` writes `state.json`, then hive sync to `doing` is best-effort. Sync failure does not roll back forge state and does not change the forge tool's stdout. It appends `hive.sync_failed` when the event log is writable, and doctor reports the divergence. The next `hive-sync` or forge tool retries. That retry is the "one sync cycle" in SC-003. If `begin-task` itself fails, forge state is unchanged, a queued host intent file is deleted, hive status is not left `doing`, and a non-host child that already started is terminated.

Conflict rule: if a human edits the ledger so hive status or `reviewFailures` disagree with forge, forge wins for those two fields. Hive-only fields are kept. An event `hive.reconciled` records before and after. Plan drift: a task in the plan but not the ledger is inserted as `todo` with `drift: "added"`. A ledger task missing from the plan is kept, marked `drift: "removed"`, and doctor reports it. If that removed task is `todo` or `doing`, Ira opens Ask-Me class `ambiguous_requirement`. Done rows are not deleted.

`featureId` on every ledger file prevents cross-feature assignment (edge case in the spec). Sync of feature A never opens feature B's ledger.

**Alternatives considered**:

- **Hive as the only status store, forge state derived on read**: Rejected. It would replace the forge spine and break every current skill that reads `state.json`.
- **Bidirectional last-write-wins by timestamp**: Rejected. Two writers of `state.json` are the corruption case user story 3 forbids.
- **Auto-create the hive on the first forge call**: Rejected. It changes the behavior of forge tools in repositories that have not opted into Ira.

### Decision: Ask-Me persistence and critical-class mapping

**Rationale**:

Problem statement: FR-004, FR-009, and FR-010 require a durable inbox for critical escalations, queryable and answerable from CLI and MCP, with no silent approval.

Context: Parent §5.3 lists the critical classes. Munder `askMeOrder.ts` is the ordering reference: severity first, then age. Non-critical routing questions in Supervised mode are answered by Ira from artifacts (spec, plan, constitution, brief) and do not create an item (user story 2).

Every Ask-Me item is one JSON file `ask-me/<itemId>.json`, created with flag `wx`. `itemId` is `ask_` plus a UUID. State is only `open` → `resolved`. There is no expired state and no timeout transition. An answer with empty text is rejected.

`reasonClass` enum, stored on the item and used as the list sort key (higher first, then `createdAt` ascending):

| Class | Weight | Opens when |
|-------|--------|------------|
| `budget_exceed` | 100 | Token hook denies dispatch, or a worker/outbox asserts this class. Ira does not invent spend numbers |
| `destructive_git` | 90 | Dispatch intent or worker message would force-push, hard-reset, delete history, handle secrets, or deploy to production |
| `constitution_violation` | 80 | Doctor or a worker reports a constitution breach on the task |
| `spec_scope_change` | 70 | Replan or a worker asks to add or change an FR or acceptance criterion, including a plan edit that adds a `T00X` |
| `untrusted_import` | 60 | Hire hook (P-005) or a worker requests spawn/import. P-001 only stores the item |
| `repeated_review_failure` | 50 | `reviewFailures` has reached the feature ceiling |
| `ambiguous_requirement` | 40 | Ira cannot resolve a clarification from artifacts, or plan drift removes an open task |

Routine work does not open an item: pick next DAG-ready task, assign an idle worker, retry tier under the ceiling, compact-on-complete via the token hook, failover via the engine hook when that hook says it is routine.

Resolving an item appends `ask_me.resolved` and requires `action`:

| Action | Effect |
|--------|--------|
| `retry` | If the linked task is `blocked` only because of this item, set forge status to `pending` through a hive-owned helper that does not increment `reviewFailures`. Hive status becomes `todo`. The ceiling is unchanged, so the next failure blocks again |
| `keep_blocked` | Task stays `blocked`. No replan |
| `acknowledge` | For items with no linked task (mode questions, drift notices). No forge write |

Unanswered items stay `open`. Status queries include `ageSeconds` from `createdAt`. Away continuation refuses while any critical item for that feature is `open` (FR-026). An item with no `featureId` blocks away continuation for every feature.

**Alternatives considered**:

- **Single `ask-me.json` array**: Rejected. Two answers could drop an item on whole-file replace. One file per item plus `wx` create makes the race visible.
- **Auto-resolve after a timeout**: Rejected. The spec forbids silent timeout approval.
- **A separate non-critical queue**: Rejected for v1. If Ira cannot answer from artifacts, the item is `ambiguous_requirement` and is critical. A second queue would be a second inbox.

### Decision: Away mode is an in-process 60-second forge-status poll

**Rationale**:

Problem statement: FR-007, FR-025, and FR-026 require night/away continuation from exactly two triggers: a manual away toggle, and a local poll of forge status every 60 seconds while away is on. No inbound webhook, cron expression, or external scheduler.

Context: `forgeStatus` already summarizes `ForgeState`. OD-005 still requires a present CI signal to be green. OD-013 replaces the missing-signal clause: `allowAbsentCi` defaults to `false`, and a missing or `absent` CI signal blocks away dispatch.

`settings.awayMode` is the toggle. `settings.allowAbsentCi` is boolean. A missing field means `false`. `settings.pollIntervalMs` defaults to `60000` and must be >= `10000`. Settings keys named `cron` or `webhook` fail doctor with `UNSUPPORTED_TRIGGER`.

Commands:

- `away on` sets `awayMode: true` and starts the poller if it is not running.
- `away off` sets `awayMode: false` and stops the poller.
- `away start` runs the loop in the foreground. `away start --detach` spawns the same `superspec` bin with an internal `away run-loop` and writes `away.pid`.
- `away tick` runs one iteration immediately (tests and Operator nudge). It does not sleep.
- A second start returns `AWAY_ALREADY_RUNNING`.

Each tick writes `<hiveRoot>/away.heartbeat` (`{ pid, at }`, mode `0600`) and fsyncs it before any feature is considered. A failed write appends `away.tick` with `dispatched: false` and reason `heartbeat_failed`, and skips dispatch for that tick.

Then, for every feature that has a brief and a ledger:

1. Load forge state and compute `forgeStatus` (the same function the `forge-status` tool uses).
2. Continue only when all of these hold: `awayMode`, `autonomy === "autonomous"`, no open Ask-Me for that feature, `hiveReady`, and `nextTask` returns a pending task whose dependencies are `done` and whose `hold` is not true. CI gate, before `dispatch-task`:

| CI state | `allowAbsentCi: false` (default) | `allowAbsentCi: true` |
|----------|----------------------------------|------------------------|
| `green` | pass | pass |
| `red` | stop `ci_not_green` | stop `ci_not_green` |
| `absent` or field missing | stop `ci_absent` | pass |

3. On pass, call `dispatch-task`. Do not argv `begin-task`. Away does not start `claude`, `codex`, or `cursor-agent`.
4. Otherwise append the tick with `dispatched: false` and a reason (`away_off`, `autonomy_supervised`, `autonomy_observe`, `ask_me_open`, `ci_not_green`, `ci_absent`, `heartbeat_failed`, `no_ready_task`, `hive_corrupt`, `dispatch_held`). Supervised mode still idle-wakes on `record-result` through `dispatch-task` (FR-006). It does not auto-dispatch from the away poll. Overnight continuation is Autonomous plus away mode.

CI is a gate, not a third trigger. Nothing listens on a port. `hive-ci-set` is a local CLI/MCP write of `{ state: "green" | "red" | "absent" }` onto that feature's blackboard entry so tests and a local reporter can seed the gate. Cron and inbound webhooks stay forbidden.

The poller does not parent engine children. A successful `dispatch-task` returns a `DispatchIntent` for a host engine (`null`, queued, no host CLI) or `{ accepted: true }` only after a detached non-host supervisor is allowed by Slice A. See the dispatch decision.

Doctor finding `AWAY_PID_STALE` is severity `error` when `away.pid` exists and the pid is dead, or `awayMode` is true and the heartbeat is missing or older than `2 * pollIntervalMs`. Remedy text names `superspec away off`. Doctor does not delete `away.pid`. The pid-file read is side-effect free.

**Alternatives considered**:

- **Cron or OS scheduler**: Rejected. FR-026 forbids cron and an external scheduler.
- **Inbound CI webhook**: Rejected. FR-026 forbids it. CI is a blackboard field the local `hive-ci-set` command writes.
- **Continue when CI is absent**: Rejected. OD-013 replaces that clause. Absence blocks unless `allowAbsentCi` is exactly `true`.
- **Polling inside every forge-status call**: Rejected. Forge status would gain a side effect and would not run when the Operator is away.

### Decision: Replan and review failures share `maxReviewFailures`, default 3

**Rationale**:

Problem statement: FR-005 and FR-027 (OD-006) require one counter per task, the forge field `reviewFailures`, with a default ceiling of 3 matching the hardcoded value in `cli.ts` and `mcp-server.ts` `record-result`. The ceiling is configurable per feature. Below the ceiling Ira may replan. At the ceiling Ira opens Ask-Me, the task is `blocked`, and Ira must not silently replan.

Context: `recordResult` already does `reviewFailures += 1` and sets `blocked` when `reviewFailures >= maxReviewFailures`, otherwise `pending`. Hive must not keep a second counter.

`AutonomySettings.maxReviewFailures` defaults to 3. `AutonomySettings.featureCeilings[featureId]` overrides it. When the hive exists, `record-result` (CLI and MCP) reads that ceiling and passes it as `ForgeOptions.maxReviewFailures`. When the hive is absent, the argument stays 3 so current tests and skills stay valid.

On `passed: false`:

| After `recordResult` | Ira |
|----------------------|-----|
| Status `pending` and `reviewFailures === 1` | `retry_tier`. `route-model` attempt is `reviewFailures + 1` (attempt 2 floors at `standard`) |
| Status `pending` and `reviewFailures === 2` | `reassign` to another `idle` roster agent when one exists; otherwise `retry_tier` (attempt 3 is `frontier`) |
| Status `blocked` because `reviewFailures >= ceiling` | Open Ask-Me `repeated_review_failure` if one is not already open for this task. Do not call `route-model` for another silent attempt |

`split` does not edit `plan.md` or spec FRs. A worker request to add a task or FR is class `spec_scope_change`. A split that only records `replan.substeps[]` on the same `T00X` is allowed when the worker outbox asks for it and the task stays under the ceiling. Ira does not invent substeps on her own; the default actions are `retry_tier` then `reassign`, which are deterministic for tests.

The replan event stores `{ kind, reviewFailures, ceiling, attempt, fromAgentId, toAgentId }`. Resolving the Ask-Me item with `retry` is what allows another attempt. That path does not reset `reviewFailures`.

Operator pause is not a review failure (OD-011). `task-hold` sets or clears hive-only `hold` and does not call `recordResult`. The ceiling path (`repeated_review_failure`, status `blocked` at `maxReviewFailures`) runs only after a review `record-result` with `passed: false`.

`task-abort` requires `confirm: true`. Missing `confirm` writes nothing. On success: hive status `blocked`, `hold: false`, `abortReason` set, event `task.aborted`, and the forge attempt leaves `in_progress` through a helper that does not increment `reviewFailures` (same class of write as the Ask-Me `retry` helper, not `record-result --passed false`). If the only available transition would increment `reviewFailures`, the command returns `ABORT_UNSUPPORTED` and writes nothing. `reviewFailures` increments only inside `recordResult` on `passed: false`.

**Alternatives considered**:

- **A separate hive `replanAttempts` counter**: Rejected. OD-006 says one counter, the forge field.
- **Pause via `record-result --passed false`**: Rejected. OD-011. Pause is `hold` and does not burn the ceiling.
- **Raising the default above 3**: Rejected. The forge CLI and MCP already default to 3.
- **Automatic plan.md split**: Rejected. Adding a `T00X` or FR is a scope change and is critical class.

### Decision: Resolve hive root to the main worktree so hires do not fork a second hive

**Rationale**:

Problem statement: FR-028 places the hive at the SuperSpec root that contains `program.md`. A git linked worktree also contains `program.md` once that file is committed. `findProjectRoot` in `persona-discovery.ts` stops at the first `.git` marker, which in a linked worktree is a file, so it returns the worktree root. Using it for the hive would create `<worktree>/.superspec/hive/` and split roster, ledger, and mailboxes. P-005 and P-006 will set `RosterAgent.workspace` to a linked worktree for code edits. That path must not become the hive root.

Context: `superspec-worktree` creates isolated checkouts under `.worktrees/` or `worktrees/`. Those checkouts share the object database and, if hive resolution is naive, would not share the hive.

Normative resolution (`resolveRepositoryRoot(cwd)`):

1. Walk parents from `cwd` to the first `.git` entry.
2. If `.git` is a directory, the candidate main root is its parent.
3. If `.git` is a file, read the `gitdir:` path. Read `commondir` inside that git dir (relative to the git dir). Resolve it to the shared git directory. The main root is `dirname` of that shared git directory.
4. The repository root is the main root when `<main-root>/program.md` exists. Hive root is `<main-root>/.superspec/hive`.
5. If `program.md` is missing on the main root, return `HIVE_ROOT_UNRESOLVED`. Do not fall back to a linked worktree even when that worktree contains `program.md`.
6. If no `.git` entry exists, walk parents for `program.md` and use that directory. This covers a plain copy that is not a git checkout.

`SUPERSPEC_ROOT` overrides the walk for tests. Doctor reports when it is set.

Persona discovery is unchanged and may still scan the worktree's agent directories. Dispatch intents include both `workspace` (the hire's worktree, or null) and `hiveRoot` (always the main hive). Workers must use `hiveRoot` from the intent. They must not call `findProjectRoot` to locate the hive.

Doctor reports absolute `repositoryRoot`, `hiveRoot`, `cwd`, `worktreeKind` (`main` or `linked`), `sandboxed`, whether `program.md` is present, and whether the hive directory is writable. `worktreeKind` and `sandboxed` are independent. `sandboxed: true` is legal only with evidence of an OS sandbox wrapper on the supervisor child. A check that sets `sandboxed` from `worktreeKind`, `workspace`, or `worktreePolicy` is finding `WORKTREE_IS_NOT_SANDBOX`, and the reported `sandboxed` value is corrected to `false`. Slice A has no sandbox wrapper, so `sandboxed` is `false`. A linked `cwd` whose hive resolves to the main root is healthy, not a second hive, and is not a sandbox.

**Alternatives considered**:

- **Hive inside each worktree**: Rejected. OD-007 forbids a second hive root, and hires would not see each other's ledger or Ask-Me inbox.
- **User-global hive keyed by repo id**: Rejected. OD-007 forbids a user-global hive.
- **`findProjectRoot` plus a symlink from each worktree**: Rejected. Symlinks break on Windows checkouts and still look like a second hive to doctor. One resolved absolute path is simpler.

### Decision: Dispatch is `dispatch-task`; Ira does not parent host engines or write feature code

**Rationale**:

Problem statement: FR-020 requires fresh subagent dispatch where the host supports it. Parent §7.3 says the GOD plane routes and records and does not write feature code. P-006 owns engine spawn. P-001 must still staff and assign.

Context: Idle wake (FR-006) and away continuation need a concrete handoff the host can execute today, before any engine adapter exists.

`DispatchIntent` is the handoff inside `dispatch-task`. It is not a second steer path. Idle wake (supervised or autonomous, after a passing `record-result`), the away tick (autonomous only), the board Dispatch control, and the `dispatch-task` CLI/MCP tool are the only steer callers. Each calls `dispatch-task`. None of them argv `begin-task`.

`dispatch-task` order, with no reorder and no bypass:

1. Resolve the hive. `hiveReady` false → `HIVE_NOT_READY`. No `begin-task`.
2. Refuse when the task is not DAG-ready, `hold` is true (`DISPATCH_HELD`), an Ask-Me item is open for that feature, the CI gate fails (OD-013 table: `red` is `ci_not_green`; `absent` or missing is `ci_absent` unless `allowAbsentCi` is exactly `true`), or a code task has an empty `implementsFr`. No `begin-task`. Away also evaluates that gate before it calls `dispatch-task`, so a failed gate is recorded on `away.tick` and the hooks do not run.
3. Build `DispatchIntent` with `freshSubagent: true`. A false value is `INVALID_INPUT`. No spawn.
4. Call `TokenHooks.beforeDispatch`. `{ allow: false }` stops the command. No `EngineHooks.dispatch`. No `begin-task`. Until `sliceAValidated`, a host engine is `{ allow: true }` with no spend write, and a `byok` or `local` supervisor rung is `{ allow: false, reason: "SLICE_A_ONLY" }`.
5. Call `EngineHooks.dispatch`. A failover rung change calls `TokenHooks.beforeDispatch` again on the effective engine and model before spawn and before `{ accepted: true }`. A deny returns `{ accepted: false }`.
6. Call forge `begin-task` only when step 4 allowed and step 5 returned `null` or `{ accepted: true }`. Then sync the hive to `doing`. Sync failure does not roll back `state.json`.
7. If `begin-task` fails after a non-host child started, the supervisor terminates that child and the command returns the forge error. If `begin-task` fails after a host intent was queued, the command deletes that queue file and does not leave hive status `doing`.

Host engines (`claude`, `codex`, `cursor-agent`; alias `cursor`) return `null` from `EngineHooks.dispatch`, persist the intent at `dispatch-queue/<featureId>/<taskId>.json` (mode `0600`), return that intent to an attached host session, and start no process whose argv0 is `claude`, `codex`, `cursor-agent`, or `agent`. Away and idle wake use that persist and do not start those binaries. `delegateToHost: null`, an away pid match, and `engines hooks install` do not authorize host spawn. A violation is `HOST_SPAWN_FORBIDDEN` and starts no child.

Detached supervisor spawn is legal only for `opencode`, `crush`, `aider`, and `custom`, only after OD-020 allows it, and only as a detached child (`detached: true`, `shell: false`, stdio `ignore` or a private pipe pair, parent unref, env a new object that is not `process.env`). Any other id returns `{ accepted: false }` and starts no child. The IDE-attached MCP server is not the parent and does not run the supervisor in-process (`SUPERVISOR_IN_MCP_FORBIDDEN`). A hook throw is `HOOK_FAILED_CLOSED` and does not change an already-successful forge `saveState` result.

When the hive exists, a `begin-task` call that is not this internal step returns `DISPATCH_PATH_REQUIRED` and does not mark the task in progress. When the hive is absent, `begin-task` stays the pre-Ira forge command so existing skills keep working.

Observe mode emits `task.recommended` and does not set an assignee and does not call `dispatch-task`.

Idle wake and away fill `assigneeAgentId` when it is empty before the hook calls, and emit `task.assigned` or `task.dispatched` from the `dispatch-task` result. They do not call `markInProgress` themselves. `begin-task` inside `dispatch-task` is what moves forge to `in_progress` and hive to `doing`.

Assignment order: the worker who just finished if they are `idle` and capability tags match; otherwise the first `idle` roster agent whose tags intersect; otherwise leave the task unassigned and emit `task.unassigned`. Empty task tags match any idle agent. Tag matching is delegated to `HireHooks.matchCapabilities` when registered; the default is intersection, then any idle agent when the task has no tags.

If the roster is empty at `brief-submit`, Ira inserts one placeholder:

```json
{
  "id": "agent-host",
  "name": "Host worker",
  "personaPath": null,
  "capabilityTags": [],
  "status": "idle",
  "engine": null,
  "model": null,
  "workspace": null,
  "worktreePolicy": "shared"
}
```

`personaPath` is set when `discoverPersonas` finds an implementer persona; otherwise it stays null. This row is not a hire and does not spawn a process. It exists so the brief has one recorded assignment (user story 1). P-005 may add real roster rows later. Ira will not overwrite a non-placeholder row.

Code tasks (`kind: "code"`) with an empty `implementsFr` are stored and doctor reports `TRACEABILITY_GAP`. Ira will not assign or dispatch them. While the hive exists, raw `begin-task` is not a steer path (`DISPATCH_PATH_REQUIRED`). While the hive is absent, raw `begin-task` still works so existing skills are not blocked.

**Alternatives considered**:

- **Ira parents Claude, Cursor, or Codex from the MCP process**: Rejected. OD-009. Host engines return `null`. A later hook must not spawn those CLIs.
- **Board or idle wake argv `begin-task` and skip the hooks**: Rejected. OD-010. `begin-task` runs only after allow and host `null` or `{ accepted: true }`.
- **Idle wake calls `begin-task` before the engine hook accepts**: Rejected. The task would be `doing` with no accepted handoff.
- **Refuse to staff until a hire exists**: Rejected. P-005 is not required for the P-001 independent test. `agent-host` is the explicit placeholder.

### Decision: Local exclusive lock files, no new dependency

**Rationale**:

Problem statement: User story 3 requires two concurrent scribes to serialize or reject without corrupting ledger files. Core's dependencies stay MCP SDK, render, yaml, and zod.

`withLock(lockPath, { waitMs }, fn)` in `@superspec-dev/core` is the only creator and the only remover of hive lock files. The body is `{ pid, nonce }`, created with flag `wx`. `acquiredAt` may be stored for logs. The steal predicate does not read it.

Steal algorithm:

1. Read `{ pid, nonce }`. Malformed file: unlink and retry once, then return the busy code.
2. If `process.kill(pid, 0)` succeeds, the holder is alive. Wait up to `waitMs`. Do not unlink. Then return `LEDGER_BUSY`, `MAILBOX_BUSY`, `EVENT_BUSY`, or `SCRIBE_BUSY` as that path already specifies. A lock older than 30 seconds with a live pid stays in place.
3. If the pid is dead, keep nonce `N`, re-read, and unlink only when the nonce is still `N`. If it changed, go back to step 1.
4. Create a new file with `wx` and a new nonce. The function passes that nonce to the holder.
5. The holder unlinks only when the file nonce is still its nonce.

Age does not steal. Blackboard wait is 0 ms (`SCRIBE_BUSY`). Ledger, mailbox, and event locks wait up to 2000 ms. JSON document updates use temp-file plus `rename` while the lock is held. The Command Center does not contain a lock-file implementation. Hive writes from the board go through a core CLI/MCP command. A second lock copy is a defect.

This is a local trust boundary. `role` on mailbox calls is an argument, not a credential. OPEN-007 multi-user auth is out of scope. The lock still prevents interleaved JSONL lines from two local processes.

**Alternatives considered**:

- **`proper-lockfile` or a native flock binding**: Rejected. A new dependency for a single-machine directory lock is not justified.
- **Steal when `acquiredAt` is older than 30 seconds**: Rejected. OD-012. A live pid keeps the lock regardless of age.
- **Last-write-wins with no lock**: Rejected. It corrupts JSONL lines and loses ledger updates.

### Decision: Telemetry stays off, and the v1 sink is a no-op

**Rationale**:

Problem statement: FR-024 requires prompt and code telemetry off by default. Any analytics must be opt-in and anonymized.

`AutonomySettings.telemetry` is `"off"` or `"opt-in"`, default `"off"`. `emitTelemetry` returns without writing when the mode is `"off"`. Event `data` is an allowlist per event type (see Contracts). Keys named `prompt`, `code`, `diff`, `token`, `secret`, or `authorization` are stripped before append in every mode. `"opt-in"` still writes no network payload in v1; it only records that the Operator enabled the flag, so a later spec can attach a sink. Doctor reports the flag.

**Alternatives considered**:

- **Ship an analytics client behind the flag**: Rejected. P-001 has no analytics endpoint, and a client would be a new dependency and a privacy hazard.
- **Omit the flag until a later spec**: Rejected. FR-024 and FR-025 require the setting to be inspectable now.

## Data Model

Identifiers are strings. Timestamps are ISO-8601 UTC. Schema version for hive files is `1`.

### Brief

Persisted at `briefs/<featureId>.json`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | `brief_` + UUID. Primary key |
| `featureId` | string | yes | Directory name under `specs/` |
| `outcome` | string | yes | Non-empty, max 4000 chars |
| `constraints` | string[] | yes | May be empty. Each max 500 chars |
| `budgetTokens` | number or null | yes | Null means unset, not zero |
| `budgetUsd` | number or null | yes | Null means unset, not zero. Non-negative when set |
| `deliverable` | string | yes | Feature, spec, or plan reference. Max 1000 chars |
| `createdAt` | timestamp | yes | |
| `updatedAt` | timestamp | yes | |
| `createdBy` | `"operator"` | yes | Single Operator in v1 |

Relationships: one current brief per `featureId` (later submits replace the file and keep the same `id` if one exists, updating `updatedAt`). Has many ledger tasks via `featureId`.

Invariants: submitting a brief staffs the ledger from `plan.md` in the same call. A numeric budget does not by itself open Ask-Me. Exceed is an observed deny from `TokenHooks.beforeDispatch` or an explicit worker assertion.

### RosterAgent

Persisted as an array in `roster.json`. P-001 reads and writes status and the placeholder row. P-005 writes hire fields through the same file using the hive lock. P-001 will not delete a row whose `origin` is `"hire"`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Primary key. Slug |
| `name` | string | yes | Display name |
| `personaPath` | string or null | yes | Path from persona discovery, or null |
| `capabilityTags` | string[] | yes | Lowercase tags. Empty matches any untagged task |
| `engine` | string or null | yes | Placeholder. P-006 fills it. Null in P-001 |
| `model` | string or null | yes | Vendor id or abstract tier. Null in P-001 |
| `budgetTokens` | number or null | no | Placeholder for P-004 / P-005 |
| `budgetUsd` | number or null | no | Placeholder |
| `workspace` | string or null | yes | Absolute worktree path for code, or null. Never a hive root |
| `worktreePolicy` | `"isolated"` or `"shared"` | yes | Stored for P-006. Placeholder uses `shared` |
| `allowedSkills` | string[] | no | Default deny when omitted. P-005 |
| `allowedMcp` | string[] | no | Default deny when omitted. P-005 |
| `status` | `idle` \| `busy` \| `blocked` \| `offline` | yes | |
| `origin` | `"placeholder"` \| `"hire"` \| `"manual"` | yes | |
| `featureId` | string or null | no | Feature currently assigned, if any |

Relationships: assigned tasks reference `id` as `assigneeAgentId`. Mailboxes use the same `id`.

Invariants: at most one row per `id`. `workspace` is ignored by `resolveRepositoryRoot`. Status `offline` or `blocked` is not eligible for assignment.

### Task (hive ledger entry)

Persisted in `ledger/<featureId>.json` under `tasks[]`. Primary key is `(featureId, id)`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Plan id `T00X` from `parsePlan` |
| `featureId` | string | yes | |
| `title` | string | yes | From the plan |
| `implementsFr` | string[] | yes | Copied from plan `frRefs` |
| `dependsOn` | string[] | yes | Plan dependency ids |
| `assigneeAgentId` | string or null | yes | |
| `status` | `todo` \| `doing` \| `blocked` \| `done` | yes | Mirror of forge status |
| `kind` | `code` \| `verify` \| `provision` \| `signoff` \| `doc-sync` | yes | Plan `TaskKind` |
| `complexity` | `mechanical` \| `moderate` \| `complex` | yes | |
| `reviewFailures` | number | yes | Copy of forge. Ira does not increment it. Only a real review `passed: false` increments the forge field |
| `hold` | boolean | yes | Hive-only. Default `false`. Pause does not change forge status or `reviewFailures` |
| `abortReason` | string or null | no | Set by `task-abort`. Null until abort |
| `ceiling` | number | yes | Ceiling in force at last sync. Default 3 |
| `resultRef` | string or null | no | Report or commit reference |
| `blockedByAskMeId` | string or null | no | |
| `drift` | `ok` \| `added` \| `removed` \| `changed` | yes | |
| `replan` | object or null | no | Last replan: `kind` `retry_tier` \| `reassign` \| `split`, `substeps[]`, attempt, agents |
| `capabilityTags` | string[] | yes | Default `[]`. P-005 may set them |
| `humanQA` | object or null | no | `{ question, answer, state }` embedded copy. Critical routing uses Ask-Me, not this field |
| `updatedAt` | timestamp | yes | |

File envelope: `{ featureId, planPath, specDir, maxReviewFailures, updatedAt, tasks }`.

State machine (hive view):

```text
todo --dispatch-task internal begin-task--> doing --record pass--> done
todo --record fail below ceiling--> todo (after replan)
doing --record fail below ceiling--> todo
doing or todo --record fail at ceiling--> blocked
blocked --Ask-Me action retry--> todo
blocked --Ask-Me action keep_blocked--> blocked
todo or doing --task-hold true--> same status, hold true (forge unchanged)
hold true --task-hold false--> same status, hold false, event task.resumed
todo or doing --task-abort confirm--> blocked, hold false, reviewFailures unchanged
```

Invariants: `dependsOn` entries reference task ids in the same feature. A task is DAG-ready when status is `todo`, drift is not `removed`, `hold` is false, every dependency is `done` in forge state, and `blockedByAskMeId` is null. Code tasks with empty `implementsFr` are not DAG-ready for Ira. `hold` is not a forge field. Direct `begin-task` while the hive exists does not enter `doing`.

### AskMeItem

Persisted at `ask-me/<id>.json`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | `ask_` + UUID. Primary key |
| `featureId` | string or null | yes | Null blocks all away continuation |
| `taskId` | string or null | yes | |
| `agentId` | string or null | yes | |
| `reasonClass` | critical class enum | yes | See Ask-Me decision |
| `question` | string | yes | Non-empty, max 4000 chars |
| `answer` | string or null | yes | Null while open |
| `action` | `retry` \| `keep_blocked` \| `acknowledge` or null | yes | Null while open |
| `state` | `open` \| `resolved` | yes | |
| `createdAt` | timestamp | yes | |
| `resolvedAt` | timestamp or null | yes | |

Relationships: belongs to a feature and optionally a task and agent. Referenced by `Task.blockedByAskMeId`.

Invariants: `resolved` requires non-empty `answer`, an `action`, and `resolvedAt`. No transition back to `open`. Duplicate open items for the same `(featureId, taskId, reasonClass)` are not created; the existing id is returned.

### Event

Append-only line in `events/events.jsonl`. Primary key `id`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | `evt_` + UUID |
| `type` | string | yes | See event schema |
| `version` | `1` | yes | |
| `ts` | timestamp | yes | |
| `featureId` | string or null | yes | |
| `actor` | object | yes | `{ kind: "ira" \| "operator" \| "worker" \| "system", id: string }` |
| `data` | object | yes | Type-specific allowlist. No prompt or code bodies |

Relationships: references feature, task, agent, and Ask-Me ids inside `data`. The log is the timeline. It is not compacted in v1.

Invariants: files are only appended. Repair quarantines a corrupt log and starts a new one; it does not rewrite history in place. Order is file order. A single lock holder writes one line at a time.

### AutonomySettings

Persisted at `settings.json`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `schemaVersion` | `1` | yes | |
| `autonomy` | `observe` \| `supervised` \| `autonomous` | yes | Default `supervised` on init |
| `awayMode` | boolean | yes | Default `false` |
| `allowAbsentCi` | boolean | no | Missing means `false`. Exactly `true` is the only value that lets CI `absent` pass |
| `pollIntervalMs` | number | yes | Default `60000`, minimum `10000` |
| `maxReviewFailures` | number | yes | Default `3`, minimum `1` |
| `featureCeilings` | map of featureId to number | yes | Overrides the default per feature |
| `telemetry` | `"off"` \| `"opt-in"` | yes | Default `"off"` |
| `updatedAt` | timestamp | yes | |

Relationships: read by replan, away, and forge `record-result` when the hive exists.

Invariants: mode switches append `autonomy.changed`. Away toggles append `away.changed`. New installs created by `hive-init` use supervised, away off, `allowAbsentCi` false, ceiling 3, telemetry off.

### Supporting records

**Blackboard** (`blackboard.json`): `{ scribe: "ira", updatedAt, features: { [featureId]: { planPath, specDir, forge: ForgeStatus, ci: { state: "green" \| "red" \| "absent", source, at } \| null } } }`. One scribe.

**Mail message** (JSONL): `{ id, ts, fromAgentId, toAgentId, kind: "clarify" \| "result" \| "handoff" \| "escalate", body, relatedTaskId, featureId }`. `body` max 65536 characters. `kind: "escalate"` addressed to `ira` is adjudicated into an Ask-Me item or an artifact answer.

**Hive manifest** (`hive.json`): `{ schemaVersion: 1, repositoryRoot, createdAt, persona: { callsign: "Ira", expansion: "Intelligent Resource Automation" } }`.

## Contracts

Command Plane CLI stdout is one JSON object. Exit code `0` on success and `1` on failure. Existing forge commands keep their current human-readable stdout and exit behavior. MCP tools return the same JSON as text content, including failures (`ok: false`), so the agent can read `hint`.

Shared error envelope:

```json
{
  "ok": false,
  "error": "HIVE_NOT_INITIALIZED",
  "message": "Hive is not initialized.",
  "hint": "Run superspec hive init, then superspec doctor"
}
```

Error codes: `HIVE_NOT_INITIALIZED`, `HIVE_NOT_READY`, `HIVE_ROOT_UNRESOLVED`, `HIVE_SCHEMA_MISMATCH`, `HIVE_CORRUPT`, `HIVE_NOT_WRITABLE`, `SCRIBE_BUSY`, `LEDGER_BUSY`, `MAILBOX_BUSY`, `MAILBOX_ROLE`, `EVENT_BUSY`, `ASK_ME_NOT_FOUND`, `ASK_ME_ALREADY_RESOLVED`, `INVALID_INPUT`, `FEATURE_NOT_FOUND`, `AWAY_ALREADY_RUNNING`, `TRACEABILITY_GAP`, `UNSUPPORTED_TRIGGER`, `DISPATCH_PATH_REQUIRED`, `DISPATCH_HELD`, `HOST_SPAWN_FORBIDDEN`, `ABORT_UNSUPPORTED`, `HOOK_FAILED_CLOSED`, `SUPERVISOR_IN_MCP_FORBIDDEN`, `SLICE_A_ONLY`, `TOKEN_FILE_MODE`. Away skip reasons are not error codes: `ci_absent`, `ci_not_green`, `heartbeat_failed`.

Shared success fields include `persona: { "callsign": "Ira", "expansion": "Intelligent Resource Automation" }` on `hive-status`, `brief-show`, `doctor`, and `autonomy-show`.

### MCP tools

Registered in `buildToolDefinitions()` beside the current tools. Names are kebab-case. Existing tools (`build-matrix`, `lint-plan`, `lint-spec`, `lint-design`, `route-model`, `scaffold`, `init`, `sync-status`, `coordinator-brief`, `begin-task`, `next-task`, `record-result`, `forge-status`, `list-personas`) stay valid. When the hive is absent, their response text does not change. When the hive exists, `record-result` and `sync-status` call hive sync after a successful forge write. That sync is best-effort and does not roll back `state.json` or change the forge success result. A direct `begin-task` while the hive exists returns `DISPATCH_PATH_REQUIRED` and does not mark the task in progress. The internal `begin-task` from `dispatch-task` is the only `begin-task` that proceeds, and it syncs the hive to `doing` after the forge write.

#### `hive-init`

Request:

```json
{ "cwd": "optional absolute or relative path", "repair": false }
```

Response:

```json
{
  "ok": true,
  "created": true,
  "repositoryRoot": "/abs/main",
  "hiveRoot": "/abs/main/.superspec/hive",
  "worktreeKind": "main",
  "persona": { "callsign": "Ira", "expansion": "Intelligent Resource Automation" }
}
```

#### `hive-status`

Request: `{ "cwd": "optional", "featureId": "optional" }`

Response:

```json
{
  "ok": true,
  "repositoryRoot": "/abs/main",
  "hiveRoot": "/abs/main/.superspec/hive",
  "worktreeKind": "linked",
  "writable": true,
  "schemaVersion": 1,
  "autonomy": "supervised",
  "awayMode": false,
  "features": [
    {
      "featureId": "001-ira-command-plane",
      "taskCounts": { "todo": 1, "doing": 1, "blocked": 0, "done": 1 },
      "openAskMe": 0
    }
  ],
  "persona": { "callsign": "Ira", "expansion": "Intelligent Resource Automation" }
}
```

#### `hive-sync`

Request:

```json
{
  "featureId": "001-ira-command-plane",
  "specDir": "specs/001-ira-command-plane",
  "planPath": "specs/001-ira-command-plane/plan.md"
}
```

`specDir` is the forge state directory (the feature directory). Paths are resolved against the repository root and must stay inside it.

Response:

```json
{
  "ok": true,
  "featureId": "001-ira-command-plane",
  "upserted": ["T001", "T002"],
  "drift": [],
  "forge": { "total": 2, "done": 0, "blocked": 0, "pending": 2, "inProgress": 0, "complete": false }
}
```

#### `brief-submit`

Request:

```json
{
  "featureId": "001-ira-command-plane",
  "outcome": "Ship the command plane API",
  "constraints": ["no UI"],
  "budgetTokens": null,
  "budgetUsd": 25,
  "deliverable": "specs/001-ira-command-plane"
}
```

Response:

```json
{
  "ok": true,
  "brief": { "id": "brief_...", "featureId": "001-ira-command-plane", "outcome": "Ship the command plane API", "budgetUsd": 25 },
  "tasks": [{ "id": "T001", "status": "todo", "implementsFr": ["FR-001"], "dependsOn": [], "assigneeAgentId": "agent-host" }],
  "assignment": { "taskId": "T001", "agentId": "agent-host" }
}
```

#### `brief-show`

Request: `{ "featureId": "001-ira-command-plane" }`

Response: `{ "ok": true, "brief": { }, "persona": { "callsign": "Ira", "expansion": "Intelligent Resource Automation" } }`

#### `roster-list`

Request: `{}`

Response: `{ "ok": true, "agents": [ { "id": "agent-host", "status": "idle", "origin": "placeholder", "workspace": null } ] }`

#### `ask-me-list`

Request: `{ "state": "open", "featureId": "optional" }`

`state` is `open`, `resolved`, or omitted for both. Order is critical weight descending, then `createdAt` ascending.

Response:

```json
{
  "ok": true,
  "items": [
    {
      "id": "ask_...",
      "reasonClass": "budget_exceed",
      "state": "open",
      "featureId": "001-ira-command-plane",
      "taskId": "T002",
      "agentId": "agent-host",
      "question": "Budget would be exceeded",
      "ageSeconds": 120
    }
  ]
}
```

#### `ask-me-show`

Request: `{ "id": "ask_..." }`

Response: `{ "ok": true, "item": { } }` or `ASK_ME_NOT_FOUND`.

#### `ask-me-answer`

Request:

```json
{
  "id": "ask_...",
  "text": "Retry once at the same ceiling",
  "action": "retry"
}
```

Response:

```json
{
  "ok": true,
  "item": { "id": "ask_...", "state": "resolved", "action": "retry" },
  "task": { "id": "T002", "status": "todo", "reviewFailures": 3 }
}
```

#### `autonomy-show` / `autonomy-set`

Show request: `{}`. Show response: `{ "ok": true, "settings": { }, "persona": { } }`.

Set request: `{ "autonomy": "autonomous" }`. Response echoes `settings` and appends `autonomy.changed`.

#### `away-set` / `away-tick`

Set request: `{ "awayMode": true, "pollIntervalMs": 60000 }`. Response: `{ "ok": true, "settings": { }, "poller": { "running": true, "pid": 123 } }`.

Tick request: `{ "featureId": "optional" }`. Response:

```json
{
  "ok": true,
  "ticks": [
    {
      "featureId": "001-ira-command-plane",
      "dispatched": false,
      "reason": "autonomy_supervised",
      "intent": null
    }
  ]
}
```

When `dispatched` is true, `intent` is a `DispatchIntent` returned by `dispatch-task`. The tick does not argv `begin-task`.

#### `dispatch-task`

Request: `{ "featureId": "001-ira-command-plane", "taskId": "T003", "cwd": "optional" }`

CLI and MCP return the same JSON. Order is `TokenHooks.beforeDispatch`, then `EngineHooks.dispatch`, then internal `begin-task` only after allow and `null` or `{ accepted: true }`.

Host accept:

```json
{
  "ok": true,
  "accepted": null,
  "began": true,
  "intent": { "featureId": "001-ira-command-plane", "taskId": "T003", "freshSubagent": true },
  "hiveStatus": "doing"
}
```

`accepted: null` means the host engine returned `null` and no host CLI was spawned. `{ accepted: true }` means a detached non-host supervisor is allowed and the child pid exists. `{ allow: false }` or `{ accepted: false }` returns `ok: false`, does not call `begin-task`, and leaves hive status unchanged.

#### `task-hold`

Request: `{ "featureId": "001-ira-command-plane", "taskId": "T003", "hold": true }`

Response: `{ "ok": true, "task": { "id": "T003", "hold": true, "reviewFailures": 0 } }`. No `passed` field. Forge `reviewFailures` is unchanged. `hold: false` appends `task.resumed`.

#### `task-abort`

Request: `{ "featureId": "001-ira-command-plane", "taskId": "T003", "confirm": true, "abortReason": "operator stop" }`

Missing `confirm` writes nothing. Success sets hive status `blocked`, `hold: false`, `abortReason`, and appends `task.aborted` without incrementing `reviewFailures`. The command does not call `record-result`.

#### `doctor`

Request: `{ "cwd": "optional" }`

Response:

```json
{
  "ok": true,
  "hiveReady": true,
  "engineRungReady": true,
  "sliceAValidated": false,
  "ready": true,
  "repositoryRoot": "/abs/main",
  "hiveRoot": "/abs/main/.superspec/hive",
  "hivePresent": true,
  "writable": true,
  "gitignore": true,
  "worktreeKind": "main",
  "sandboxed": false,
  "mcpTools": ["hive-init", "dispatch-task", "doctor"],
  "findings": [],
  "nextSteps": [],
  "telemetry": "off",
  "persona": { "callsign": "Ira", "expansion": "Intelligent Resource Automation" }
}
```

Findings use `{ code, severity: "error" | "warning", message, remedy }`. `hiveReady` is coordination-store health. It is false when any of these findings is present: unreadable ledger JSON, missing `program.md`, hive not writable, `.superspec/hive/` not gitignored, `schemaVersion` mismatch, command-plane tool missing from `buildToolDefinitions()`, `AWAY_PID_STALE`, `TOKEN_FILE_MODE`. Constitution or template drift is reported and does not by itself set `hiveReady` false. `engineRungReady` is rung health and is P-006. `ENGINE_SPAWN_UNSUPPORTED` and `ENGINE_NONE_HEALTHY` set `engineRungReady` false and leave `hiveReady` unchanged. A legacy `ready` field equals `hiveReady` and is not the conjunction of `hiveReady` and `engineRungReady`. Dispatch requires `hiveReady`. `AWAY_PID_STALE` is severity `error`. Doctor does not delete `away.pid`. Remedy text names `superspec away off`. `sliceAValidated` is recomputed every run from the four OD-020 checks. `sandboxed` is `false` in Slice A. `worktreeKind` does not set `sandboxed`.

#### `mailbox-post` / `mailbox-read`

Post request:

```json
{
  "role": "worker",
  "agentId": "agent-host",
  "box": "outbox",
  "message": {
    "toAgentId": "ira",
    "kind": "escalate",
    "body": "This would force-push",
    "relatedTaskId": "T003",
    "featureId": "001-ira-command-plane"
  }
}
```

Response: `{ "ok": true, "id": "msg_...", "askMeId": "ask_..." }` when Ira escalates, or `{ "ok": true, "id": "msg_...", "answered": true }` when Ira resolves a non-critical clarify from artifacts.

Read request: `{ "role": "worker", "agentId": "agent-host", "box": "inbox", "limit": 50 }`

Response: `{ "ok": true, "messages": [] }`

#### `hive-ci-set`

Local gate only. Not a webhook.

Request: `{ "featureId": "001-ira-command-plane", "state": "green", "source": "test-stub" }`

Response: `{ "ok": true, "ci": { "state": "green", "source": "test-stub", "at": "2026-10-15T00:00:00.000Z" } }`

### CLI commands

All of the following print the MCP JSON above. Flags mirror the request fields. `--cwd` overrides the start directory for root resolution.

| Command | Required flags |
|---------|----------------|
| `superspec hive init` | `--repair` optional |
| `superspec hive status` | `--feature` optional |
| `superspec hive sync` | `--feature`, `--dir`, `--plan` |
| `superspec hive ci-set` | `--feature`, `--state green\|red\|absent` |
| `superspec brief submit` | `--feature`, `--outcome`, `--deliverable`; optional `--constraint` repeatable, `--budget-usd`, `--budget-tokens` |
| `superspec brief show` | `--feature` |
| `superspec roster list` | |
| `superspec ask-me list` | `--state`, `--feature` optional |
| `superspec ask-me show` | `--id` |
| `superspec ask-me answer` | `--id`, `--text`, `--action retry\|keep_blocked\|acknowledge` |
| `superspec autonomy show` | |
| `superspec autonomy set` | `--mode observe\|supervised\|autonomous` |
| `superspec away on\|off\|status\|tick\|start\|stop` | `start` accepts `--detach`; `on` accepts `--interval-ms`. Optional `--allow-absent-ci true\|false` |
| `superspec dispatch-task` | `--feature`, `--task` |
| `superspec task hold` | `--feature`, `--task`, `--hold true\|false` |
| `superspec task abort` | `--feature`, `--task`, `--confirm`, `--reason` |
| `superspec mailbox post` | `--role`, `--agent`, `--box outbox`, `--to`, `--kind`, `--body` |
| `superspec mailbox read` | `--role`, `--agent`, `--box inbox\|outbox` |
| `superspec doctor` | |

`superspec` help text gains these commands and still lists the existing forge commands.

### DispatchIntent

Returned by `dispatch-task` (including away tick and idle wake) and stored on `task.dispatched` event data. P-006 may consume it. P-001 does not parent a host CLI from it. Host dispatch persists this object at `dispatch-queue/<featureId>/<taskId>.json` (mode `0600`) and returns `null`.

```json
{
  "featureId": "001-ira-command-plane",
  "taskId": "T003",
  "agentId": "agent-host",
  "personaPath": null,
  "workspace": null,
  "hiveRoot": "/abs/main/.superspec/hive",
  "specDir": "/abs/main/specs/001-ira-command-plane",
  "attempt": 1,
  "tier": "economy",
  "freshSubagent": true
}
```

`tier` comes from `routeModel` when the plan task is known. `freshSubagent` is always true in v1.

### Extension hooks

Declared in `packages/core/src/command-plane/hooks.ts` and re-exported from `@superspec-dev/core`. Defaults are no-ops. Sibling packages call `registerCommandPlaneHooks` at their module init. Unregistered hooks are skipped. P-001 does not implement learning, token ledgers, hire gallery, or engine adapters.

`registerCommandPlaneHooks` wraps `beforeDispatch`, `dispatch`, `normalizeEvent`, `onRecordResult`, `onUntrustedImport`, and `matchCapabilities` in `try/catch`. A throw is swallowed. The catch path appends `hook.failed` with reason `HOOK_FAILED_CLOSED` when the event log is writable and returns `{ allow: false }` or `{ accepted: false }`. The forge tool’s already-successful `saveState` result, stdout, and exit code stay success. A hook does not exit the process.

```ts
export interface RetrieveContext {
  featureId: string;
  taskId: string;
  implementsFr: string[];
  kind: string;
  complexity: string;
  capabilityTags: string[];
}

export interface InjectionSummary {
  text: string;
  patternIds: string[];
}

export interface DistillContext {
  featureId: string;
  taskId: string;
  passed: boolean;
  reviewFailures: number;
}

export interface LearningHooks {
  retrieve?(ctx: RetrieveContext): Promise<InjectionSummary | null>;
  distill?(ctx: DistillContext): Promise<void>;
}

export interface SpendEventInput {
  ts: string;
  agentId: string;
  featureId: string | null;
  engine: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  usdEstimate: number | null;
  source: "transcript" | "api" | "estimate";
}

export interface DispatchContext {
  intent: DispatchIntent;
  brief: { budgetTokens: number | null; budgetUsd: number | null };
}

export type DispatchGate =
  | { allow: true }
  | { allow: false; reasonClass: AskMeReasonClass; detail: string };

export interface TokenHooks {
  beforeDispatch?(ctx: DispatchContext): Promise<DispatchGate>;
  recordSpend?(event: SpendEventInput): Promise<void>;
  onRecordResult?(ctx: DistillContext): Promise<void>;
}

export interface HireHooks {
  matchCapabilities?(task: { capabilityTags: string[] }, roster: RosterAgent[]): RosterAgent | null;
  onUntrustedImport?(input: { featureId: string | null; agentId: string | null; detail: string }): Promise<{ askMeId: string }>;
}

export interface EnginePresence {
  engineId: string;
  installed: boolean;
}

export interface EngineHooks {
  detectInstalled?(): Promise<EnginePresence[]>;
  dispatch?(intent: DispatchIntent): Promise<{ accepted: boolean } | null>;
  normalizeEvent?(raw: { type: string; agentId?: string; engineId?: string; data?: Record<string, unknown> }): Promise<IraEvent | null>;
}

export function registerCommandPlaneHooks(partial: {
  learning?: LearningHooks;
  token?: TokenHooks;
  hire?: HireHooks;
  engine?: EngineHooks;
}): void;
```

Call order on a passing or failing `record-result` when the hive exists:

1. Forge `saveState` / `recordResult`. This is the only write to `state.json`.
2. Hive sync. Failure does not roll back forge state and does not fail the forge result.
3. Return the forge success JSON. On failure below the ceiling, replan runs before that return. On pass, idle wake calls `dispatch-task` before that return.
4. Schedule distill off the returned call. The handler does not await distill, a distill timeout, or CONSOLIDATE. Distill failure does not fail `record-result`.

`TokenHooks.onRecordResult` (compact) is a P-004 side effect. Until `sliceAValidated`, it is a no-op and does not run on the `record-result` stack. After Slice A it stays off the success condition: the handler does not await it before returning forge success.

`dispatch-task` order (also the order before `task.dispatched`):

1. Hive, hold, Ask-Me, CI (away), and traceability gates. Any miss returns before hooks. No `begin-task`.
2. `LearningHooks.retrieve` when registered. A summary is attached to the intent as `patternSummary` when present. The field is omitted when the hook is absent. Until `sliceAValidated`, retrieve does not write a pattern file.
3. `TokenHooks.beforeDispatch`. `{ allow: false }` opens Ask-Me when the reason is a critical class and does not dispatch. No `EngineHooks.dispatch`. No `begin-task`. When the hook is absent, Ira does not invent spend and does not treat a configured budget as an exceed by itself. Doctor adds a warning `budget_unmetered` when a brief has a numeric budget and the token hook is not registered. Until `sliceAValidated`: `{ allow: true }` for a host engine with no spend write; `{ allow: false, reason: "SLICE_A_ONLY" }` for a `byok` or `local` supervisor rung.
4. `EngineHooks.dispatch`. Host engine: return `null`, persist `DispatchIntent`, spawn nothing. Non-host after Slice A: detached supervisor only, then `{ accepted: true }` after the child pid exists. Otherwise `{ accepted: false }`. `{ accepted: false }` leaves hive status unchanged and does not call `begin-task`.
5. On `null` or `{ accepted: true }`: forge `begin-task`, then hive sync to `doing`.

A hook throw at step 3 or 4 is `HOOK_FAILED_CLOSED`, treated as deny. Forge state already saved by a previous command stays saved.

`HireHooks.onUntrustedImport` is how P-005 opens class `untrusted_import`. If that hook is absent, a mailbox `escalate` that names this class still opens the item directly.

`EngineHooks.normalizeEvent` may append to `events.jsonl` only by returning an `IraEvent`. Adapters do not write the file themselves.

### Event schema

Channel: file `<hiveRoot>/events/events.jsonl`. Version `1`. Ordering is append order under `locks/events.lock`. Retention is unbounded; doctor warns above 50 MB. Consumers tail the file. Unknown `type` values are ignored by readers and preserved on disk.

```json
{
  "id": "evt_00000000-0000-4000-8000-000000000000",
  "type": "task.started",
  "version": 1,
  "ts": "2026-10-15T16:20:00.000Z",
  "featureId": "001-ira-command-plane",
  "actor": { "kind": "ira", "id": "ira" },
  "data": { "taskId": "T002", "agentId": "agent-host" }
}
```

| `type` | `data` fields |
|--------|----------------|
| `brief.submitted` | `briefId`, `featureId` |
| `task.upserted` | `taskId`, `drift` |
| `task.assigned` | `taskId`, `agentId` |
| `task.recommended` | `taskId`, `agentId` or null |
| `task.dispatched` | `taskId`, `agentId`, `attempt`, `tier` |
| `task.started` | `taskId`, `agentId` |
| `task.completed` | `taskId`, `agentId` |
| `task.held` | `taskId`, `hold` |
| `task.resumed` | `taskId`, `hold` |
| `task.aborted` | `taskId`, `abortReason` |
| `task.failed` | `taskId`, `reviewFailures`, `ceiling` |
| `task.blocked` | `taskId`, `askMeId` |
| `task.replanned` | `taskId`, `kind`, `reviewFailures`, `attempt`, `fromAgentId`, `toAgentId` |
| `task.unassigned` | `taskId`, `reason` |
| `ask_me.opened` | `askMeId`, `reasonClass`, `taskId` |
| `ask_me.resolved` | `askMeId`, `action` |
| `autonomy.changed` | `from`, `to` |
| `away.changed` | `awayMode` |
| `away.tick` | `dispatched`, `reason` |
| `hook.failed` | `hook`, `reason` (`HOOK_FAILED_CLOSED`) |
| `hive.reconciled` | `taskId`, `field`, `forgeValue`, `hiveValue` |
| `hive.sync_failed` | `message` |
| `mailbox.routed` | `messageId`, `fromAgentId`, `toAgentId` |
| `doctor.ran` | `hiveReady`, `engineRungReady`, `ready`, `errorCount` |

Actor `ira` uses id `ira`. Operator actions use kind `operator` and id `operator`.

### Integration points

| Integration | Protocol | Notes |
|-------------|----------|-------|
| Forge loop | In-process function calls | `loadState`, `saveState`, `nextTask`, `markInProgress`, `recordResult`, `forgeStatus`, `reconcileState` |
| Plan and spec parsers | In-process | `parsePlan` for staffing and FR tags. `buildMatrix` stays the validate path |
| Coordinator | Existing files | `writeCoordinatorBrief` and `appendCoordinatorLog` still run. Hive sync follows them |
| Model router | In-process | `routeModel` for replan attempt tiers. No vendor model ids in P-001 |
| Persona discovery | In-process | `discoverPersonas` to fill `agent-host.personaPath` only |
| Git | `execFile("git", ...)` or the `.git`/`commondir` walk | Argument array only. Used for doctor cross-check and gitignore probe |
| P-003..P-006 | `registerCommandPlaneHooks` | Optional. Core runs without them |

No network calls are made by P-001.

### Consumed From Other Specs

P-001 does not consume a contract from another feature spec. Forge types (`ForgeState`, `Task`, `routeModel`) are exports of `@superspec-dev/core`, not spec contracts. Sibling `design.md` files are not inputs to this design.

| Source spec | Contract | Version / stability | Notes |
|-------------|----------|---------------------|-------|
| (none) | package exports of `@superspec-dev/core` | core 0.2.x | Forge state, plan parser, MCP server, persona discovery, model router |

### Produced For Other Specs

| Target spec / consumer | Contract | Version / stability | Notes |
|------------------------|----------|---------------------|-------|
| `specs/002-ira-command-center` | CLI/MCP JSON for hive-status, brief-show, roster-list, ask-me-list, ask-me-answer, autonomy-show, away-set, `dispatch-task`, `task-hold`, `task-abort`, doctor | v1, additive fields only | UI reads this API. Board Dispatch calls `dispatch-task` only. Pause is `task-hold`. Abort is `task-abort`. No UI-only state. No lock-file copy |
| `specs/002-ira-command-center` | `events.jsonl` event schema v1 | v1, new `type` values allowed | Activity timeline |
| `specs/003-ira-learning-memory` | `LearningHooks.retrieve` and `LearningHooks.distill` | v1 | Called around `record-result` when registered |
| `specs/004-ira-token-context` | `TokenHooks.beforeDispatch`, `recordSpend`, `onRecordResult` | v1 | Deny opens Ask-Me `budget_exceed` and stops before `EngineHooks.dispatch`. `beforeDispatch` is the first gate inside `dispatch-task`. Until Slice A, host allow writes no spend |
| `specs/004-ira-token-context` | `ask-me-list` item with `reasonClass` `budget_exceed` | v1 | Same inbox. P-004 does not create a second inbox |
| `specs/005-ira-hire-gallery` | `RosterAgent` in `roster.json` and `HireHooks` | v1 | P-005 writes `origin: "hire"` rows. `workspace` is not a hive root |
| `specs/005-ira-hire-gallery` | Ask-Me `reasonClass` `untrusted_import` | v1 | Confirm or reject via `ask-me-answer` |
| `specs/006-ira-engine-adapters` | `DispatchIntent` and `EngineHooks` | v1 | Host `dispatch` returns `null` and starts no host CLI. `engineRungReady` is P-006. Detached supervisor only for `opencode`, `crush`, `aider`, `custom` after Slice A |
| `specs/006-ira-engine-adapters` | `events.jsonl` append via `normalizeEvent` | v1 | Adapters do not write the log file directly |

## Appendix: FR Coverage

| FR | Where this design satisfies it |
|----|--------------------------------|
| FR-001 | MCP tools and CLI commands in Contracts; JSON for both |
| FR-002 | `brief-submit` staffs ledger rows and records an assignment, including `agent-host` |
| FR-003 | Ledger task shape, `hive-sync`, plan field copy |
| FR-004 | Ask-Me store, mailbox escalate path, artifact answers for non-critical clarifies |
| FR-005 | Replan decision: `retry_tier`, `reassign`, constrained `split` |
| FR-006 | Idle wake calls `dispatch-task` inside the `record-result` path for supervised and autonomous |
| FR-007 | Away poller, heartbeat, and continuation gates |
| FR-008 | `AutonomySettings.autonomy`, default supervised on `hive-init` |
| FR-009 | `ask-me-list`, `ask-me-show`, `ask-me-answer` |
| FR-010 | Critical class table; no timeout; token-hook deny; destructive and scope classes |
| FR-011 | `persona.ts` and `persona` on hive-status, brief-show, doctor, autonomy-show |
| FR-012 | Hive directory layout and JSON/JSONL store |
| FR-013 | Inbox/outbox writer rules and mailbox locks |
| FR-014 | Blackboard single scribe, `SCRIBE_BUSY` |
| FR-015 | `events.jsonl` schema, allowlist, append-only |
| FR-016 | Coordinator files still written; hive sync runs after them |
| FR-017 | Forge tools unchanged when hive is absent; no UI required |
| FR-018 | Existing MCP tool names kept when the hive is absent. When it exists, direct `begin-task` is `DISPATCH_PATH_REQUIRED`. Sync after a successful forge write does not roll back `state.json` |
| FR-019 | `implementsFr` copied from the plan; Ira does not dispatch code tasks with an empty list; matrix tool unchanged |
| FR-020 | `DispatchIntent.freshSubagent: true`; Ira does not execute the task |
| FR-021 | Same JSON from CLI and MCP; no UI-only fields |
| FR-022 | `doctor` returns `hiveReady` separately from `engineRungReady` (P-006). `ready` equals `hiveReady`. `AWAY_PID_STALE` is an error and is not deleted |
| FR-023 | Doctor `nextSteps` after detecting the `superspec` CLI, hive path, and autonomy default |
| FR-024 | `telemetry` default `off`; no-op sink; sensitive keys stripped |
| FR-025 | `settings.json` via autonomy and away commands |
| FR-026 | Manual toggle plus 60-second poll; `allowAbsentCi` default false; heartbeat before dispatch; no webhook or cron |
| FR-027 | One `reviewFailures` counter; ceiling default 3; Ask-Me and block only after a real review failure. Pause does not increment the counter |
| FR-028 | Main-worktree `.superspec/hive/`; doctor reports absolute path and writability; gitignore; forge remains the only writer of `state.json` |
| FR-029 | `dispatch-task` CLI and MCP; hook order; internal `begin-task` only after accept or host `null` |
| FR-030 | `task-hold` and `task-abort`; `hold` does not burn `reviewFailures` |
| FR-031 | `withLock` only; steal on dead pid plus matching nonce; no age steal |
| FR-032 | Host engines return `null`; `HOST_SPAWN_FORBIDDEN` starts no child |
| FR-033 | Detached supervisor; hook exceptions become `HOOK_FAILED_CLOSED` and do not fail a completed `saveState` |
| FR-034 | Doctor `sliceAValidated` from the four OD-020 checks; deferred side effects return `SLICE_A_ONLY` |
