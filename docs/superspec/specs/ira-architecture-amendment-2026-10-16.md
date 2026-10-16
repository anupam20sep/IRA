# Ira Architecture Amendment — 2026-10-16

**Status**: LOCKED | **Supersedes**: conflicting Decisions in `specs/001-ira-command-plane/design.md` through `specs/006-ira-engine-adapters/design.md` where they disagree
**Parent**: `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md`
**Date**: 2026-10-16

This file is normative. `MUST` and `MUST NOT` are requirements. A design sentence, plan task, or implementation that disagrees with this file is non-conformant. This file does not edit those plans. Implementers follow this file and skip the contradicting plan step.

Preserved, and not reopened: parent **Option D** (one CLI/MCP API; the Command Center is a thin consumer of that API and keeps no UI-only task state), **engines write code** (Ira routes and records; she does not edit feature source), and the **SuperSpec spine** (forge owns `specs/<feature>/.superspec/state.json`; `plan.md` and spec FRs stay the traceability source; validate and the matrix stay the ship gate; one hive at the main worktree that contains `program.md`).

Parent decisions OD-001 through OD-008 stay as already closed, except where a row below names the exact sentence it replaces. Parent OPEN-007 (multi-user auth) stays open. The loopback token in OD-017 is a local mutation gate, not a user directory.

## Purpose

Production-grade, fast, fail-proof Ira while keeping Option D, engines-write-code, SuperSpec spine.

Fail-closed means: on a violated gate the command returns a non-zero outcome, writes no partial steer effect, and does not substitute a nearby success path. Speed means forge persistence returns without waiting on distill, supervisor spawn, or a second lock implementation. Fail-proof means pause cannot burn a review, a live lock cannot be stolen by age, a host CLI cannot be parented by IDE-attached MCP, and a hook throw cannot take down forge.

## Precedence

1. This amendment wins over every Decision in `specs/001`–`specs/006` `design.md` that conflicts with it.
2. This amendment wins over `plan.md` and `execution-map.md` tasks that encode a conflicting Decision. Those files stay on disk unchanged until a later plan revision.
3. Non-conflicting design text remains in force. In particular: one hive, forge as the writer of `state.json`, `DispatchIntent.freshSubagent: true`, critical Ask-Me classes never silent-approve, no second event log, no second MCP server, catalog strategies for observation, and the 65536 local-context gate.
4. Absence of a behavior from this file is not permission to keep a conflicting design sentence. The twelve rows below are the closed set.

## Production invariants (fail-closed table)

| Invariant | Fail-closed behavior | Specs |
|-----------|----------------------|-------|
| OD-009 Host engines default to host spawn | Engine ids `claude`, `codex`, and `cursor-agent` (alias `cursor` maps to `cursor-agent`) are host engines. `EngineHooks.dispatch` returns `null` and MUST NOT spawn them. Ira MUST NOT parent a host engine from an IDE-attached MCP process. Away and idle wake persist a `DispatchIntent` and MUST NOT start `claude`, `codex`, or `cursor-agent`. A detached supervisor child is permitted only for `opencode`, `crush`, `aider`, and `custom`. `delegateToHost: null`, an away pid match, or `engines hooks install` MUST NOT flip a host engine into Ira-parent spawn. Violation returns `HOST_SPAWN_FORBIDDEN` and starts no child. | 001, 006 |
| OD-010 One dispatch path | The only steer command is `dispatch-task` (CLI and MCP, same JSON). Order is fixed: `TokenHooks.beforeDispatch` → `EngineHooks.dispatch` → `begin-task` only after the hook allows and dispatch returns `null` (host) or `{ accepted: true }`. `{ allow: false }` or `{ accepted: false }` MUST NOT call `begin-task`. The board, away tick, and idle wake MUST call `dispatch-task` and MUST NOT argv `begin-task`. When the hive exists, a `begin-task` call that is not the internal call from `dispatch-task` returns `DISPATCH_PATH_REQUIRED` and does not mark the task in progress. When the hive is absent, `begin-task` stays the pre-Ira forge command. | 001, 002, 004, 006 |
| OD-011 Hold ≠ fail | Pause sets hive-only `hold: true` on the ledger task and appends `task.held`. It MUST NOT call `record-result`, MUST NOT increment `reviewFailures`, and MUST NOT change forge failure state. `dispatch-task` on a held task returns `DISPATCH_HELD`. Abort is `task-abort` with `confirm: true` only. Abort MUST NOT call `record-result --passed false`. If the only available transition would increment `reviewFailures`, abort returns `ABORT_UNSUPPORTED` and writes nothing. `reviewFailures` increments only on a real review outcome of `passed: false`. | 001, 002 |
| OD-012 Locks | The only lock implementation is `withLock` in `@superspec-dev/core`. Lock body is `{ pid, nonce }` created with flag `wx`. Steal (unlink + retry) is permitted only when `process.kill(pid, 0)` fails and a re-read shows the same `nonce`. Age, including `acquiredAt` older than 30 seconds, MUST NOT steal. Release unlinks only when the caller’s nonce equals the file nonce. The Command Center MUST NOT contain a lock-file implementation. Hive writes from the board go through a core CLI/MCP command. A second lock copy is a defect. | 001, 002 |
| OD-013 Away + CI | `allowAbsentCi` defaults to `false`. Missing CI and CI state `absent` block away dispatch with reason `ci_absent` unless the persisted value is exactly `true`. State `red` always blocks with `ci_not_green`. State `green` passes the CI gate only. Each away tick writes `<hiveRoot>/away.heartbeat` (`{ pid, at }`, mode `0600`) before any dispatch. Heartbeat write failure skips dispatch with `heartbeat_failed`. Doctor finding `AWAY_PID_STALE` is severity `error` when `away.pid` exists and the pid is dead, or `awayMode` is true and the heartbeat is missing or older than `2 * pollIntervalMs`. Doctor MUST NOT delete `away.pid`. | 001 |
| OD-014 Doctor readiness split | Doctor returns `hiveReady` and `engineRungReady` as separate booleans. `hiveReady` is coordination-store health (schema, parseable ledger, gitignore, writability, lock module present, away pid not stale). `engineRungReady` is rung health (a host-delegate target, or, after Slice A validates, a healthy `opencode` / `crush` / `aider` / `custom` rung). An engine finding MUST NOT set `hiveReady` false. A legacy `ready` field, if emitted, MUST equal `hiveReady` and MUST NOT be the conjunction of the two booleans. Dispatch requires `hiveReady`. Engine work additionally requires `engineRungReady` or a host-delegate `null` return. | 001, 006 |
| OD-015 Process isolation | Non-host engine children run only inside a detached supervisor (`detached: true`, `shell: false`, stdio not the MCP stdio pipes, parent unref). The IDE-attached MCP server MUST NOT be the parent of those children and MUST NOT run the supervisor in-process. `registerCommandPlaneHooks` catches every hook exception. A throw becomes `{ allow: false }` or `{ accepted: false }` plus event `hook.failed` with reason `HOOK_FAILED_CLOSED`. The forge tool’s already-successful `saveState` result, stdout, and exit code stay success. A hook MUST NOT exit the process. | 001, 006 |
| OD-016 Learning non-blocking | After `saveState` succeeds, `record-result` returns without awaiting DISTILL or CONSOLIDATE. Distill failure MUST NOT fail `record-result` and MUST NOT roll back forge state. Markdown files under `.superspec/patterns/` are canonical. SQLite FTS is a derived index. If `better-sqlite3` is missing, the native module fails to load, or the index cannot be opened, retrieve and distill MUST use the markdown files and MUST NOT fail the forge call. CONSOLIDATE MUST NOT run on the `record-result` stack. | 003 |
| OD-017 Loopback auth | The bridge binds `127.0.0.1` only. Non-loopback bind is refused. Token file is `<hiveRoot>/auth/loopback.token`, directory mode `0700`, file mode `0600` (Windows: ACL for the current user only; any ACE for Users, Everyone, or Authenticated Users is `TOKEN_FILE_MODE`). Wider mode: the process MUST NOT listen. Every POST, PUT, PATCH, and DELETE requires header `Authorization: Bearer <token>`. Missing or wrong token returns `401` `TOKEN_REQUIRED` and MUST NOT spawn CLI or write the hive. Query-string tokens are forbidden. The token MUST NOT appear in events, bridge logs, or HTML. | 001, 002 |
| OD-018 Hire confirm | Ask-Me action `acknowledge` on `reasonClass: "untrusted_import"` cancels the review (same writes as `hire-spawn-cancel`): no persona file, no roster upsert. The only command that writes a persona and a hire roster row is `hire-spawn-confirm`. Warning string is the single constant `Untrusted import — review all fields before spawn.` for file, URL, paste, and gallery. `trustHint` MUST NOT replace or shorten it. A different warning returns `HIRE_WARNING_LENGTH_MISMATCH` and confirm MUST NOT run. | 005 |
| OD-019 Env scrub and sandbox | Supervisor `env` is a new object, not `process.env`. Base allowlist is only `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `TMPDIR`, `TMP`, `TEMP`, `SystemRoot`, `ComSpec`, `PATHEXT`, `SHELL`, `SUPERSPEC_ROOT`, `SUPERSPEC_ENGINE_SESSION`, `SUPERSPEC_HIVE_ROOT`. A catalog `byokEnvAllowlist` name is copied only when the effective rung is `byok`. Every other variable whose name matches `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, or `CREDENTIAL` is dropped. Doctor `worktreeKind` (`main` or `linked`) and `sandboxed` are independent. `sandboxed: true` is legal only when that child was started under an OS sandbox wrapper. A linked worktree MUST NOT set `sandboxed` true. Doing so is finding `WORKTREE_IS_NOT_SANDBOX`. Slice A has no sandbox wrapper, so `sandboxed` is `false`. | 001, 006 |
| OD-020 Forge Slice A | Until doctor reports `sliceAValidated: true`, the only live Ira surfaces are P-001, P-006 host-delegate (`null`, no host-CLI spawn), the board Dispatch control calling `dispatch-task`, and Ask-Me create/list/answer. P-003 distill writes, P-004 spend and breaker side effects, P-005 persona/roster writes, and P-006 detached spawn of `opencode` / `crush` / `aider` / `custom` are no-ops that return `SLICE_A_ONLY` and perform no side effect. `TokenHooks.beforeDispatch` stays live as a gate: `{ allow: true }` for a host engine with no spend write; `{ allow: false, reason: "SLICE_A_ONLY" }` for a `byok` or `local` supervisor rung. Forge `saveState` / `record-result` persistence stays live. A pause or abort control that exists MUST use OD-011 and MUST NOT call `record-result`. `sliceAValidated` is computed by doctor from the four checks in OD-020 below, not from a hand-edited flag. | 001–006 |

## Normative rules

### OD-009 — Host spawn

Host engines are exactly `claude`, `codex`, and `cursor-agent`. The id `cursor` is an input alias of `cursor-agent` and is a host engine.

`EngineHooks.dispatch` for a host engine:

- returns `null`;
- persists the `DispatchIntent` at `<hiveRoot>/dispatch-queue/<featureId>/<taskId>.json` (mode `0600`) when the caller is away or idle wake, and returns that intent to an attached host session;
- starts no process whose argv0 is `claude`, `codex`, `cursor-agent`, or `agent`.

Away matching `away.pid` does not authorize spawn. Default and explicit `delegateToHost: null` do not authorize spawn. `engines hooks install` does not authorize spawn.

Detached supervisor spawn is legal only when the effective engine id is `opencode`, `crush`, `aider`, or `custom`, and only after OD-020 allows it. Any other id returns `{ accepted: false }` and starts no child.

Supersedes `specs/006-ira-engine-adapters/design.md` “Host versus adapter spawn” (default `delegateToHost` null so the supervisor spawns; away pid match does not return null) and the catalog rows that describe Ira as the parent of `claude`, `codex`, or `cursor-agent`.

### OD-010 — Dispatch path

`dispatch-task` request fields: `featureId`, `taskId`, optional `cwd`. CLI and MCP return the same JSON object.

Internal order, with no reorder and no bypass:

1. Resolve the hive. `hiveReady` false → `HIVE_NOT_READY`. No `begin-task`.
2. Refuse when the task is not DAG-ready, `hold` is true, an Ask-Me item is open for that feature, the CI gate fails (OD-013), or a code task has an empty `implementsFr`. No `begin-task`.
3. Build `DispatchIntent` with `freshSubagent: true`. A false value is `INVALID_INPUT`. No spawn.
4. Call `TokenHooks.beforeDispatch`. `{ allow: false }` stops the command. No `EngineHooks.dispatch`. No `begin-task`.
5. Call `EngineHooks.dispatch`. Inside that call, a failover rung change MUST call `TokenHooks.beforeDispatch` again on the effective engine and model before spawn and before `{ accepted: true }`. A deny returns `{ accepted: false }`.
6. Call forge `begin-task` only when step 4 allowed and step 5 returned `null` or `{ accepted: true }`. Then sync the hive to `doing`.
7. If `begin-task` fails after a non-host child started, the supervisor MUST terminate that child and the command MUST return the forge error. If `begin-task` fails after a host intent was queued, the command MUST delete that queue file and MUST NOT leave hive status `doing`.

The board Dispatch control’s only mutation is `dispatch-task`. It MUST NOT send `begin-task`.

Supersedes `specs/002-ira-command-center/design.md` Decision “Steer with forge CLI for dispatch, pause, and abort” (Dispatch row that argv’s `begin-task`) and `specs/001-ira-command-plane/design.md` Decision “Dispatch is an intent” where it says raw forge `begin-task` remains the steer path while the hive exists.

### OD-011 — Hold and abort

Ledger field `hold` is boolean, default `false`, hive-only. Forge `reviewFailures` is unchanged by hold.

`task-hold` with `hold: true` sets the flag, sets `updatedAt`, appends `task.held`, and returns. `task-hold` with `hold: false` clears the flag and appends `task.resumed`. Neither call accepts `passed`.

`task-abort` requires `confirm: true`. Effects on success: hive status `blocked`, `hold: false`, `abortReason` set, event `task.aborted`, forge attempt cleared from `in_progress` by a transition that leaves `reviewFailures` unchanged. Missing `confirm` writes nothing.

The board Pause control calls `task-hold`. The board Abort control calls `task-abort`. Neither control calls `record-result`. Helper text that says pause records a failed attempt is non-conformant.

The ceiling path (`repeated_review_failure`, status `blocked` at `maxReviewFailures`) applies only after a review `record-result` with `passed: false`.

Supersedes the Pause and Abort rows in `specs/002-ira-command-center/design.md` Decision “Steer with forge CLI for dispatch, pause, and abort”, and any reading of `specs/001-ira-command-plane/design.md` Decision “Replan and review failures share `maxReviewFailures`” that treats operator pause as a review failure. The ceiling counter itself stays.

### OD-012 — Locks

`withLock(lockPath, { waitMs }, fn)` is the only creator and the only remover of hive lock files.

Steal algorithm:

1. Read `{ pid, nonce }`. Malformed file: unlink and retry once, then return the busy code.
2. If `process.kill(pid, 0)` succeeds, the holder is alive. Wait up to `waitMs`. Do not unlink. Then return `LEDGER_BUSY`, `MAILBOX_BUSY`, `EVENT_BUSY`, or `SCRIBE_BUSY` as that path already specifies.
3. If the pid is dead, keep nonce `N`, re-read, and unlink only when the nonce is still `N`. If it changed, go back to step 1.
4. Create a new file with `wx` and a new nonce. The function passes that nonce to the holder.
5. The holder unlinks only when the file nonce is still its nonce.

`acquiredAt` MAY be stored for logs. It MUST NOT be read by the steal predicate. A lock older than 30 seconds with a live pid MUST be left in place.

Wait bounds stay: blackboard `0` ms, ledger and mailbox and events `2000` ms.

The board MUST NOT write `locks/*.lock`. Reassign is core command `task-reassign`, which calls `withLock` and changes `assigneeAgentId` and `updatedAt` only.

Supersedes the 30-second steal sentence in `specs/001-ira-command-plane/design.md` Decision “Local exclusive lock files, no new dependency” and the copied steal sentence in `specs/002-ira-command-center/design.md` Decision “Steer with forge CLI…”.

### OD-013 — Away and CI

Settings field `allowAbsentCi` is boolean. Missing field means `false`.

Away dispatch CI gate, evaluated before `dispatch-task`:

| CI state | `allowAbsentCi: false` (default) | `allowAbsentCi: true` |
|----------|----------------------------------|------------------------|
| `green` | pass | pass |
| `red` | stop `ci_not_green` | stop `ci_not_green` |
| `absent` or field missing | stop `ci_absent` | pass |

Heartbeat path: `<hiveRoot>/away.heartbeat`. The tick writes it, fsyncs it, then considers dispatch. A failed write is `dispatched: false`, reason `heartbeat_failed`.

`AWAY_PID_STALE` remedy text MUST name `superspec away off` as the clear path. Doctor’s read of the pid file is side-effect free.

Supersedes the sentence in `specs/001-ira-command-plane/design.md` Decision “Away mode is an in-process 60-second forge-status poll” that says an absent `ci` field does not skip dispatch. Parent OD-005’s “missing signal must not block” is replaced by this table. A present non-green signal still blocks. Cron and inbound webhooks stay forbidden.

### OD-014 — Doctor

Doctor JSON MUST include:

```json
{
  "hiveReady": true,
  "engineRungReady": true,
  "sliceAValidated": false,
  "worktreeKind": "main",
  "sandboxed": false
}
```

`hiveReady` is false when any of these findings is present: unreadable ledger JSON, missing `program.md`, hive not writable, `.superspec/hive/` not gitignored, `schemaVersion` mismatch, command-plane tool missing, `AWAY_PID_STALE`, `TOKEN_FILE_MODE`.

`engineRungReady` is false when no host engine is delegable and no post-Slice-A non-host rung is healthy. `ENGINE_SPAWN_UNSUPPORTED` and `ENGINE_NONE_HEALTHY` are engine findings. They set `engineRungReady` false. They leave `hiveReady` unchanged.

Supersedes `specs/001-ira-command-plane/design.md` `doctor` response text that uses a single `ready` flag as the conjunction of every error finding, including engine and stale-pid findings mixed into one bit. `specs/006-ira-engine-adapters/design.md` stays in force where it says one degraded engine does not by itself mark the hive corrupt.

### OD-015 — Isolation

Supervisor invocation, when OD-020 allows it:

- argv is `superspec engines supervise` plus an intent path argument array;
- `detached: true`;
- `shell: false`;
- stdio is `ignore` or a pipe pair created for that child;
- the child is `unref`’d;
- env is the OD-019 object.

The MCP server’s stdin and stdout MUST NOT be in that stdio set. An in-process call to the supervisor function from the MCP request handler is `SUPERVISOR_IN_MCP_FORBIDDEN`.

Hook boundary: `try/catch` around `beforeDispatch`, `dispatch`, `normalizeEvent`, `onRecordResult`, `onUntrustedImport`, and `matchCapabilities`. The catch path records `hook.failed` when the event log is writable and returns the deny result. It MUST swallow the exception.

Supersedes `specs/006-ira-engine-adapters/design.md` where the session supervisor runs inside the MCP or CLI process that shares the request lifetime, and where an away poller parents engine children.

### OD-016 — Learning

`record-result` order when the hive exists:

1. Forge `saveState` / `recordResult`.
2. Hive sync.
3. Return the forge success JSON.
4. Schedule distill off the returned call. The handler MUST NOT `await` distill, a distill timeout, or CONSOLIDATE.

The 30-second on-stack distill wait is forbidden. A microtask that the handler still awaits is forbidden.

Index failure uses markdown scan for that operation, logs `PATTERNS_INDEX_UNAVAILABLE`, and continues. Pattern `*.md` stays the source that `patterns reindex` can rebuild from when SQLite is present.

Supersedes `specs/003-ira-learning-memory/design.md` Decision “DISTILL errors never fail `record-result`” where the default is await-with-timeout, and Decision “Hybrid markdown canonical + derived SQLite FTS5 index” where a missing SQLite binding rejects the markdown path. Markdown remains canonical. SQLite remains the derived index when it loads. CONSOLIDATE stays off the forge return path; it is not part of the `record-result` success condition.

### OD-017 — Loopback token

Token creation: 32 cryptographically random bytes, base64url, one line, write `wx`, then chmod `0600`. If the file exists, use it only after the mode check passes.

Mutating routes require the header. GET and SSE on loopback do not accept a mutation. A GET MUST NOT return the token after creation. The creating process prints the file path on its own terminal once.

Bind address other than `127.0.0.1` is a startup refusal. `0.0.0.0` is a startup refusal.

Supersedes `specs/002-ira-command-center/design.md` Decision “Ship a loopback web app…” where it says there is no authentication and no login gate on mutations, and `specs/001-ira-command-plane/design.md` “Single Operator, no auth” for the Command Center mutation surface. OPEN-007 multi-user auth is not decided here.

### OD-018 — Hire

`ask-me-answer` with `action: "acknowledge"` and `reasonClass: "untrusted_import"`:

- sets the linked review to `cancelled`;
- resolves the Ask-Me item;
- writes no persona and no roster row;
- returns `HIRE_ACK_CANCELS` in the result payload so callers cannot treat it as spawn.

`hire-spawn-confirm` is the only writer of hire personas and `origin: "hire"` roster rows. Confirm from any other tool, including Ask-Me `acknowledge`, returns `HIRE_SPAWN_CONFIRM_REQUIRED`.

`uiCopy.trustBanner` MUST equal `Untrusted import — review all fields before spawn.` for every `sourceKind`, including `gallery`. `approvalCopyVariant: "curated_catalog"` MUST NOT change that string. `trustHint` MAY be a separate label field.

Supersedes `specs/005-ira-hire-gallery/design.md` Decision “One pipeline for file, URL, paste, and gallery” where confirm may resolve Ask-Me with `acknowledge`, and where curated entries MAY use a shorter warning. The pipeline order (acquire, parse, sanitize, review, explicit confirm) stays. Gallery still opens `untrusted_import`.

### OD-019 — Environment and sandbox

The supervisor env builder is a pure function of the allowlist plus, only for rung `byok`, the catalog `byokEnvAllowlist` for that engine id. It MUST NOT spread `process.env`.

Doctor MUST emit both:

- `worktreeKind`: `main` or `linked`, from the git `commondir` walk in P-001;
- `sandboxed`: `true` only with evidence of an OS sandbox wrapper on the supervisor child.

A doctor check that sets `sandboxed` from `worktreeKind`, from `workspace`, or from `worktreePolicy` is finding `WORKTREE_IS_NOT_SANDBOX` and the reported `sandboxed` value MUST be corrected to `false`.

### OD-020 — Slice A

Doctor sets `sliceAValidated` true only when all four checks pass in the same run:

1. `hiveReady` is true.
2. A host-engine `dispatch-task` queues a `DispatchIntent` and starts no host CLI (no child of `claude`, `codex`, or `cursor-agent`).
3. The board Dispatch control invokes `dispatch-task` and does not invoke `begin-task`.
4. Ask-Me create, list, and answer round-trips for one critical class without spawning a worker.

Until that conjunction is true:

| Surface | Behavior |
|---------|----------|
| P-001 hive, locks, doctor, `dispatch-task`, Ask-Me, `task-hold`, `task-abort` | Live, under the rules above |
| P-006 host engine | `null` + queued intent. No host spawn |
| Board Dispatch | `dispatch-task` with the OD-017 token |
| P-003 distill / consolidate writes | No-op. No pattern file |
| P-004 spend, breaker, compaction | No-op. `beforeDispatch` does not write a ledger |
| P-005 `hire-spawn-confirm` | No-op `SLICE_A_ONLY`. No persona write |
| P-006 supervisor for `opencode`, `crush`, `aider`, `custom` | No-op `SLICE_A_ONLY`. No child |

A no-op returns `{ ok: false, code: "SLICE_A_ONLY" }` for a command whose only job is the deferred side effect. It returns forge success for `record-result` after `saveState`, with the deferred hook skipped. It MUST NOT half-apply the deferred write.

`sliceAValidated` MUST be recomputed on every doctor run. A file that claims `validated: true` without the four checks passing MUST be ignored.

## Dispatch sequence (normative)

1. Steer caller is the board Dispatch control, `dispatch-task` CLI, `dispatch-task` MCP, idle wake, or away tick. Any other steer caller is refused with `DISPATCH_PATH_REQUIRED`.
2. `dispatch-task` checks `hiveReady`, hold, Ask-Me, CI (OD-013), and traceability. Any miss returns before hooks. No `begin-task`.
3. `TokenHooks.beforeDispatch`. Deny ends the command. Host-engine Slice A: allow, no spend write. Non-host rung before Slice A validates: deny `SLICE_A_ONLY`.
4. `EngineHooks.dispatch`. Host engine: return `null`, persist `DispatchIntent`, spawn nothing. Non-host after Slice A: detached supervisor only, then `{ accepted: true }` after the child pid exists. Otherwise `{ accepted: false }`.
5. On deny or `{ accepted: false }`: stop. Hive status stays unchanged. No `begin-task`.
6. On `null` or `{ accepted: true }`: call `begin-task`, then hive sync to `doing`. Failure rolls back the queue file or the child, as OD-010 step 7 requires.
7. A hook throw at step 3 or 4 is `HOOK_FAILED_CLOSED`, treated as deny. Forge state already saved by a previous command stays saved.

```text
steer (board | CLI | MCP | idle-wake | away-tick)
        |
        v
   dispatch-task
        |
        +-- hive / hold / Ask-Me / CI / FR tags -- fail --> STOP
        |
        v
 TokenHooks.beforeDispatch
        |
        +-- allow false --> STOP (no EngineHooks, no begin-task)
        |
        v
 EngineHooks.dispatch
        |
        +-- accepted false ----------> STOP (no begin-task)
        |
        +-- null + host engine ------> queue DispatchIntent (no host spawn)
        |
        +-- accepted true
        |     opencode|crush|aider|custom
        |     detached supervisor only
        |
        v
   begin-task
        |
        v
   hive status doing
```

## OD crosswalk

| ID | Locked decision | Supersedes |
|----|-----------------|------------|
| OD-009 | Host engines (`claude`, `codex`, `cursor-agent`) default to host spawn. Away queues `DispatchIntent`. Detached supervisor only for `opencode`, `crush`, `aider`, `custom`. Never parent host engines from IDE-attached MCP. | 006 “Host versus adapter spawn”; 006 catalog text that parents `claude` / `codex` / `cursor-agent`; 001 dispatch handoff where a later hook parents those CLIs |
| OD-010 | One path: `dispatch-task` = `TokenHooks.beforeDispatch` → `EngineHooks.dispatch` → `begin-task`. Board never raw `begin-task` for steer. | 002 Dispatch row (`begin-task` argv); 001 “raw forge `begin-task` still works” while the hive exists |
| OD-011 | Hold is a hive flag. Abort is `task-abort`. Pause does not increment `reviewFailures`. | 002 Pause and Abort rows (`record-result --passed false`); 001 ceiling path applied to operator pause |
| OD-012 | Single core `withLock`. Steal only dead pid plus nonce re-read. No age steal. Board has no lock copy. | 001 30-second steal; 002 in-bridge lock copy and 30-second steal |
| OD-013 | `allowAbsentCi` default `false`. Heartbeat required. Stale `away.pid` is doctor error `AWAY_PID_STALE`. | 001 “if `ci` is absent, do not skip”; parent OD-005 missing-signal clause |
| OD-014 | Doctor reports `hiveReady` and `engineRungReady` separately. | 001 single `ready` bit that folds every error, including engine findings, into one flag |
| OD-015 | Detached supervisor child. Hooks cannot crash forge or the MCP server. | 006 in-process supervisor and away-parent spawn |
| OD-016 | Distill is non-blocking after `saveState`. SQLite is optional. Markdown is the fallback and the canonical store. | 003 await-with-timeout distill; 003 rejection of markdown when SQLite is absent |
| OD-017 | Loopback token file mode `0600`. Mutating POSTs require the bearer token. | 002 “no authentication”; 001 “no auth” on the board mutation surface |
| OD-018 | `acknowledge` cancels `untrusted_import`. Spawn writes happen only in `hire-spawn-confirm`. Warning string is identical for every source, including gallery. | 005 confirm-via-acknowledge; 005 shorter curated `trustBanner` |
| OD-019 | Supervisor env is scrubbed unless the BYOK allowlist applies. Doctor `worktreeKind` is not `sandboxed`. | Any 001 or 006 doctor text that treats a linked worktree or `workspace` as a sandbox; inherited `process.env` on engine spawn |
| OD-020 | Slice A is P-001 + P-006 host-delegate + board `dispatch-task` + Ask-Me. Every other Ira side effect is a no-op until those four checks pass. | 002–006 designs where pause-as-failure, hire spawn, distill, spend, or non-host spawn run before this slice is validated |

## Required citation

Every `design.md` in `specs/001-ira-command-plane`, `specs/002-ira-command-center`, `specs/003-ira-learning-memory`, `specs/004-ira-token-context`, `specs/005-ira-hire-gallery`, and `specs/006-ira-engine-adapters` MUST cite this file under the heading `Required Reading / Prior Art`.

The citation MUST include this sentence:

`docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` is LOCKED. If this design disagrees with that amendment, the amendment wins.

A design that lacks the heading or the sentence is non-conformant. This amendment does not itself patch those files. The next edit to each design adds the citation and removes the superseded sentences named above. Until that edit, this file still wins.

## Document history

| Date | Change |
|------|--------|
| 2026-10-16 | Locked OD-009 through OD-020. Production fail-closed remediations for spawn, dispatch, hold, locks, away CI, doctor, isolation, learning, loopback auth, hire, env scrub, and Slice A. |
