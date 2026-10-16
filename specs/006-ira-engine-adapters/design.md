# Design: ira-engine-adapters

**Revision**: 2026-10-16 | **Status**: DRAFT | **Owner**: @grok

**Input**: Feature specification from `specs/006-ira-engine-adapters/spec.md`

**Note**: This unified design document merges Spec Kit's separate plan/research/data-model/contracts artifacts into one tier per SuperSpec's 4-layer architecture.

## Required Reading / Prior Art

| Path | Reason |
|------|--------|
| `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` | LOCKED OD-009 (host spawn), OD-010 step 5 (failover re-enters the token gate), OD-014 (`hiveReady` / `engineRungReady`), OD-015 (detached supervisor), OD-019 (env scrub, worktree ≠ sandbox), OD-020 (Slice A) |
| `specs/006-ira-engine-adapters/spec.md` | FR-001–FR-027, Clarifications Session 2026-10-16 |
| `specs/004-ira-token-context/spec.md` | Token governor FR-025: no automatic failover onto a rung that cannot emit token usage when a numeric budget is set |

`docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` is LOCKED. If this design disagrees with that amendment, the amendment wins.

## Summary

P-006 is the engine roster for Ira. It binds each hive worker to a persona, an engine, a model, a budget, and a workspace, detects which target CLIs are installed, and admits a fresh worker only at a task boundary. Host engines (`claude`, `codex`, `cursor-agent`) stay on the attached host: `EngineHooks.dispatch` returns `null` and Ira does not parent those CLIs. Away and idle wake enqueue a durable `DispatchIntent`. OpenCode, Crush, Aider, and custom run only in a detached supervisor process, and only after Slice A. Lifecycle chatter is translated into one vocabulary — start, tool, stop, error, tokens — and appended to the Command Plane hive log that P-001 already owns.

The implementation registers P-001 `EngineHooks` inside `@superspec-dev/core`. It does not open a second hive, a second event log, or a second MCP server. Presets adapt the shape of Munder `AgentProviderPreset` (identity, spawn argv, model allowlist, transport). The transport for each engine is fixed in catalog version 1, which closes parent OPEN-005: Claude Code, Codex, and Cursor Agent are observed through native hooks on the host session; OpenCode and Crush use the Agent Client Protocol (ACP) inside the detached supervisor; Aider and custom commands use non-interactive stdio observation (the PTY class) inside that same supervisor. Local OpenCode backed by Ollama, LM Studio, vLLM, or BYOK must advertise at least 65536 tokens of context or that local rung fails. The hive coordination bit stays separate.

## Production invariants

Fail-closed: a violated gate returns a non-zero outcome, starts no child, writes no partial steer effect, and does not substitute a nearby success path.

| Invariant | Fail-closed behavior | Source |
|-----------|----------------------|--------|
| Host engines delegate | Engine ids `claude`, `codex`, and `cursor-agent` (alias `cursor` → `cursor-agent`) are host engines. When MCP is attached to that host, `delegateToHost` defaults to that host. `EngineHooks.dispatch` returns `null` and starts no process whose argv0 is `claude`, `codex`, `cursor-agent`, or `agent`. Ira MUST NOT parent those three from an IDE-attached MCP process. `delegateToHost: null`, an `away.pid` match, and `engines hooks install` MUST NOT authorize spawn. Violation returns `HOST_SPAWN_FORBIDDEN` and starts no child. | OD-009, FR-023 |
| Away queues host intent | Away and idle wake persist `DispatchIntent` at `<hiveRoot>/dispatch-queue/<featureId>/<taskId>.json` (mode `0600`) for a host engine and MUST NOT start `claude`, `codex`, or `cursor-agent`. | OD-009, FR-024 |
| Supervisor allowlist | A detached supervisor child is legal only for effective ids `opencode`, `crush`, `aider`, and `custom`, and only after OD-020 allows it. Any other id returns `{ accepted: false }` and starts no child. | OD-009, FR-024 |
| Detached supervisor | The supervisor is its own process: argv `superspec engines supervise` plus the intent path; `detached: true`; `shell: false`; stdio `ignore` or a pipe pair created for that child; the child is `unref`’d. MCP stdin and stdout are not in that stdio set. The IDE-attached MCP server is not the parent and MUST NOT call the supervisor function in-process (`SUPERVISOR_IN_MCP_FORBIDDEN`). | OD-015, FR-025 |
| Hook boundary | `registerCommandPlaneHooks` try/catch covers `beforeDispatch`, `dispatch`, `normalizeEvent`, `onRecordResult`, `onUntrustedImport`, and `matchCapabilities`. A throw becomes `{ allow: false }` or `{ accepted: false }` plus `hook.failed` / `HOOK_FAILED_CLOSED` when the event log is writable. The exception is swallowed. Forge `saveState` that already succeeded stays success. A hook MUST NOT exit the process. | OD-015, FR-025 |
| Env scrub | Supervisor `env` is a new object. Base allowlist: `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `TMPDIR`, `TMP`, `TEMP`, `SystemRoot`, `ComSpec`, `PATHEXT`, `SHELL`, `SUPERSPEC_ROOT`, `SUPERSPEC_ENGINE_SESSION`, `SUPERSPEC_HIVE_ROOT`. A catalog `byokEnvAllowlist` name is copied only when the effective rung is `byok`. Every other name matching `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, or `CREDENTIAL` is dropped. The builder MUST NOT spread `process.env`. | OD-019, FR-026 |
| Worktree ≠ sandbox | Doctor emits `worktreeKind` (`main` or `linked`) and `sandboxed` independently. `sandboxed: true` requires an OS sandbox wrapper on the supervisor child. A linked worktree MUST NOT set `sandboxed` true. Doing so is `WORKTREE_IS_NOT_SANDBOX` and the reported value is corrected to `false`. Slice A has no wrapper, so `sandboxed` is `false`. | OD-019, FR-019 |
| Doctor split | `hiveReady` and `engineRungReady` are separate. Engine findings (`ENGINE_SPAWN_UNSUPPORTED`, `ENGINE_NONE_HEALTHY`, `LOCAL_CONTEXT_BELOW_FLOOR`, `LOCAL_CONTEXT_UNKNOWN`) set `engineRungReady` false and leave `hiveReady` unchanged. Local context below 65536 or unknown fails that local rung only. A legacy `ready` field, if emitted, equals `hiveReady`. | OD-014, FR-006, FR-014 |
| Metered failover | A failover rung change calls `TokenHooks.beforeDispatch` again on the effective engine and model before spawn and before `{ accepted: true }`. When a numeric agent or feature budget is set, automatic failover MUST NOT select a rung whose preset cannot emit token usage. No signal-capable rung → `{ accepted: false }`. No silent unmetered dispatch. | OD-010 step 5, FR-012, P-004 FR-025 |
| Slice A | Until doctor reports `sliceAValidated: true`, host-delegate is live (`null`, queued intent, no host CLI). Detached spawn of `opencode`, `crush`, `aider`, and `custom` returns `{ ok: false, code: "SLICE_A_ONLY" }` and starts no child. `TokenHooks.beforeDispatch` allows a host engine with no spend write and denies a `byok` or `local` supervisor rung with `SLICE_A_ONLY`. | OD-020, FR-027 |

## Technical Context

**Language/Version**: TypeScript 5, Node.js ESM, matching `@superspec-dev/core` (`packages/core`, package version 0.2.x)

**Primary Dependencies**: Existing core dependencies only (`@modelcontextprotocol/sdk`, `@superspec-dev/render`, `yaml`, `zod`). Detection and local probes use `node:child_process` `execFile` with an argument array and `shell: false`. Non-host engine launch uses `spawn` of `superspec engines supervise` with `detached: true` and `shell: false`. The MCP process does not `execFile` `claude`, `codex`, `cursor-agent`, or `agent`. No new npm dependency for PTY libraries, ACP SDKs, or HTTP clients. HTTP probes use `fetch` in Node. MIT attribution for the preset shape cites Munder `src/shared/agentProvider.ts` in the catalog file header. No Munder source is copied.

**Storage**: The P-001 hive at `<repository-root>/.superspec/hive/`. Roster bindings stay on `roster.json`. P-006 adds `engines/policy.json`, `engines/local-pack.json`, `engines/custom.json`, and `engines/health.json` under that same hive, plus `dispatch-queue/<featureId>/<taskId>.json` (mode `0600`) for away and idle host intents. Schema version of `hive.json` stays `1`. Ephemeral session hook files live under `engines/sessions/<sessionId>/` and are deleted when the session stops. Secrets stay in the engine's own login store. They are not copied into the hive. The detached supervisor receives a new env object, not `process.env` (FR-026).

**Testing**: Vitest in `packages/core/test/engines/`. Unit tests cover detection against a fake `PATH`, bind validation, failover selection (including refusal of a rung that cannot emit tokens when a numeric budget is set), the 64k context gate (fixtures below, equal to, above, and unknown; `hiveReady` stays true), event normalization, secret redaction, host-spawn refusal (`HOST_SPAWN_FORBIDDEN`, zero host children), detached-supervisor argv (`detached`, `shell: false`, stdio not MCP pipes), and env scrub (base allowlist plus BYOK-only names). Contract tests feed recorded hook JSON, ACP notifications, and Aider stdout fixtures. Live CLIs and live Ollama are not required for unit tests.

**Target Platform**: macOS, Linux, and Windows developer machines. Path lookup uses `path.delimiter`. The same CLI and MCP JSON is the API on every platform.

**Project Type**: Library plus CLI and MCP tools inside the existing `@superspec-dev/core` package

**Performance Goals**: Detecting the seven target binaries finishes in under 2 seconds locally (parallel `--version`, 1500 ms timeout each). The next dispatch after a health-cache update selects the failover rung immediately and finishes the selection well inside the 30 second local-test bound (SC-003). Each hive append is one JSONL line under the existing event lock.

**Constraints**: Local-first. No second hive and no user-global engine store (OD-007). Failover only at a fresh-worker dispatch boundary (FR-013). No fabricated token counts (FR-010, user story 6). No secret fields in the matrix, hive, roster dump, or pattern store (FR-011). No inherited `process.env` on supervisor spawn (FR-026). Host CLIs are never children of IDE-attached MCP (FR-023). Command Center is not required (FR-021). Hive `schemaVersion` is not bumped. Adapters do not write `events/events.jsonl` themselves. The amendment file wins where this design would otherwise disagree.

**Scale/Scope**: One hive per repository, one Operator, the seven target engines plus a handful of custom commands, tens of roster rows, one child process per dispatched task. v1 does not manage a fleet of long-lived engine daemons.

## Architecture

### System Structure

Ira's dispatcher stays the one in P-001. P-006 fills `EngineHooks` and the roster fields P-001 left null. Workers remain fresh subagents (`docs/explanation/dispatch-and-context.md`). The orchestrator does not implement the task.

```text
Operator ── CLI / MCP (superspec engines …, doctor)
               │
               ▼
        packages/core/src/engines/
          catalog ── detect ── bind ── health/matrix
               │         │
               │         ▼
               │    roster.json (P-001 atomic rewrite)
               │    engines/*.json (same hive, engines lock)
               ▼
        EngineHooks.dispatch(DispatchIntent)
          resolve model (routeModel tier or explicit slug)
          failover ladder at this boundary only
          TokenHooks.beforeDispatch again on the effective rung
          refuse a rung with no token signal when a numeric budget is set
          64k gate when the rung is local (that rung only)
               │
       ┌───────┴────────────────┬─────────────────────┐
       │ null (host engine)     │ { accepted: true }  │ { accepted: false }
       ▼                        ▼                     ▼
  attached host session    detached supervisor     no spawn
  fresh subagent           own pid, not MCP stdio  Ask-Me or unassigned
  away: queue intent file  opencode|crush|aider|custom only
       │                        │
       └────────────┬───────────┘
                    ▼
        normalizeEvent(raw) → IraEvent | null
                    ▼
        P-001 append under locks/events.lock
        events/events.jsonl
```

Components:

| Module | Responsibility |
|--------|----------------|
| `catalog.ts` | Versioned presets: id, display name, binary names, strategy, spawn argv, model allowlist, auth env name, `byokEnvAllowlist`, `emits` (including whether `tokens` is a capability), rung. Custom rows load from `engines/custom.json`. |
| `detect.ts` | `PATH` lookup for the allowlisted binary names. No shell. |
| `bind.ts` | Validates and writes persona, engine, model, budget, workspace, and worktree policy onto one `RosterAgent`. |
| `health.ts` | Auth mode and health. Presence checks and exit codes only. |
| `matrix.ts` | The credential matrix projection of health plus catalog. |
| `local-pack.ts` | OpenCode-class backend profile and the 65536 context gate. |
| `failover.ts` | Subscription → BYOK → local selection. Does not edit the stored binding. |
| `review-policy.ts` | Cross-engine review, default off. |
| `normalize.ts` | Vendor payload to `IraEvent`. Allowlist and redaction. |
| `supervisor.ts` | Builds the OD-019 env object and the detached spawn spec. The MCP handler does not run this function in-process. |
| `register.ts` | `registerCommandPlaneHooks({ engine })` at MCP and CLI startup. |

Host versus detached supervisor:

- Host engines are exactly `claude`, `codex`, and `cursor-agent`. The id `cursor` is an input alias of `cursor-agent`. When the Command Plane MCP server is attached to one of those hosts, `delegateToHost` defaults to that host. `EngineHooks.dispatch` for a host engine returns `null` in every case: attached session, away, idle wake, explicit `delegateToHost: null`, and after `engines hooks install`. It starts no process whose argv0 is `claude`, `codex`, `cursor-agent`, or `agent`. The attached host performs the fresh subagent. Ira MUST NOT parent those three from the IDE-attached MCP process. A code path that would spawn one returns `HOST_SPAWN_FORBIDDEN` and starts no child.
- Away and idle wake persist the `DispatchIntent` at `<hiveRoot>/dispatch-queue/<featureId>/<taskId>.json` (mode `0600`) and return that intent to an attached host session. Matching `away.pid` does not authorize spawn. `engines hooks install` records the project hook command; it does not authorize spawn.
- Detached supervisor spawn is legal only when the effective engine id is `opencode`, `crush`, `aider`, or `custom`, and only when doctor would report `sliceAValidated: true`. Until then the call returns `{ ok: false, code: "SLICE_A_ONLY" }` and starts no child. `{ accepted: true }` is returned only after the detached supervisor pid exists. `{ accepted: false }` means spawn was refused. Any other engine id returns `{ accepted: false }` and starts no child.
- Supervisor invocation, when OD-020 allows it: argv is `superspec engines supervise` plus the intent-path argument array; `detached: true`; `shell: false`; stdio is `ignore` or a pipe pair created for that child; the child is `unref`’d; env is the OD-019 object. The MCP server’s stdin and stdout are not in that stdio set. An in-process call to the supervisor function from the MCP request handler is `SUPERVISOR_IN_MCP_FORBIDDEN`.
- A child `error` or unexpected exit marks that roster row `offline`, appends `engine.error` with `reasonClass` `adapter_crash`, and leaves every other engine dispatchable. The MCP server process stays up. A hook throw is `HOOK_FAILED_CLOSED`, treated as deny, and does not exit the process.

### Project Structure

#### Documentation (this feature)

```text
specs/006-ira-engine-adapters/
├── spec.md
├── design.md              # this document
├── plan.md                # superspec-plan, not part of this stage
└── adr/                   # optional extracts; the decisions below are normative
```

#### Source Code (repository root)

```text
packages/core/src/engines/
├── types.ts
├── catalog.ts
├── detect.ts
├── bind.ts
├── health.ts
├── matrix.ts
├── local-pack.ts
├── failover.ts
├── review-policy.ts
├── normalize.ts
├── supervisor.ts
├── redact.ts
└── register.ts

packages/core/src/cli.ts            # engines * and doctor findings
packages/core/src/mcp-server.ts     # same tools
packages/core/test/engines/
├── detect.test.ts
├── bind.test.ts
├── failover.test.ts
├── local-pack.test.ts
├── normalize.test.ts
├── matrix.test.ts
└── fixtures/             # hook JSON, ACP notifications, stdio transcripts
```

Hive additions (still under the main-worktree hive root from P-001; not a new root):

```text
.superspec/hive/engines/
├── policy.json
├── local-pack.json
├── custom.json
├── health.json
└── sessions/<sessionId>/   # ephemeral, deleted on stop
.superspec/hive/dispatch-queue/<featureId>/<taskId>.json   # mode 0600, host away/idle
```

**Structure Decision**: The engine layer lives in `@superspec-dev/core` next to the Command Plane hooks P-001 specified. A separate package would force a second process to register `EngineHooks` and would race the hive writer. Persona files stay where `discoverPersonas` already scans them (`.claude/agents`, `.cursor/agents`, `.codex/agents`, plus home). Dispatch passes those paths through. It does not copy personas into an OpenCode-specific directory. `HarnessId` in `harness-model-map.ts` stays `cursor | claude | codex` so existing `models.yaml` files keep parsing. Local engines resolve tiers through the catalog, not by widening that union.

## Decisions

### Decision: Register EngineHooks in core and append only through the P-001 hive log

**Rationale**:

Problem statement: FR-010, FR-021, and parent EN-009 require normalized engine events in the hive activity stream. P-001 already defined `EngineHooks`, `DispatchIntent`, and `events/events.jsonl`, and it forbade adapters from writing that file themselves.

Context: P-001's produced contract says `dispatch` returning null means the host harness spawns the fresh subagent, and `normalizeEvent` is the only way an adapter contributes an `IraEvent`. OD-007 forbids a second hive. The prior-art map says extend SuperSpec and adapt Munder presets, not invent another engine layer.

P-006 implements the three `EngineHooks` methods and registers them with `registerCommandPlaneHooks` when the CLI or MCP server starts. `detectInstalled` reports the target set. `dispatch` performs bind checks, failover, and optional spawn. `normalizeEvent` maps a raw observation to an `IraEvent` or returns null.

The detached supervisor never opens `events/events.jsonl` and never runs inside the MCP request. It submits normalized events through the Command Plane append entry point, which holds `locks/events.lock` and writes one line. Hive `schemaVersion` stays `1`. New files under `engines/` are optional machine state. P-001 doctor ignores unknown files; P-006 doctor reads them. `findProjectRoot` in `persona-discovery.ts` is not used to place the hive. Dispatch keeps using `DispatchIntent.hiveRoot`.

**Alternatives considered**:

- **A second event log under `.superspec/engines/`**: Rejected. P-002 tails one hive log. A parallel stream would split the activity timeline and violate the no-second-hive rule.
- **Adapters append JSONL directly**: Rejected. P-001 assigns the event lock to Ira. Two writers interleave partial lines.
- **A new `@superspec-dev/engines` package and MCP server**: Rejected for the same reason P-001 rejected a second command-plane package. Hooks must run in the process that is about to emit `task.dispatched`.

### Decision: Close OPEN-005 with one observation strategy per adapter

**Rationale**:

Problem statement: Parent OPEN-005 asks whether each CLI is observed via native hooks, PTY scraping, or ACP. The spec forbids leaving that choice open.

Context: This repository already ships hook stubs at `hooks/hooks.json` (Claude Code), `hooks/hooks-codex.json`, and `hooks/hooks-cursor.json`. OpenCode and Crush publish ACP (JSON-RPC over stdio) as their programmatic session API. Aider publishes a non-interactive CLI and does not publish hooks or ACP. Munder's preset transport field is the shape we adapt; Munder's extra engines (Grok, Kimi, Copilot, and the rest of that catalog) are not in the v1 target set.

Catalog version is the integer `1` (`ENGINE_CATALOG_VERSION`). Strategy is data on the preset, not a runtime guess. A missing ACP subcommand does not downgrade that preset to PTY. Doctor marks the engine `degraded` and names the required interface.

| Engine id | Binary allowlist | Strategy | v1 observation |
|-----------|------------------|----------|----------------|
| `claude` | `claude` | hooks | Host engine. `dispatch` returns `null`. Observation is hook stdin JSON from the **host** session: `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`. Ira does not spawn `claude` and does not read a parented `claude -p` stream. |
| `codex` | `codex` | hooks | Host engine. `dispatch` returns `null`. Observation is hook stdin in the Codex hook shape from the **host** session. Ira does not spawn `codex exec`. |
| `cursor-agent` | `cursor-agent`, then `agent` only if `--version` output contains `Cursor` | hooks | Host engine (`cursor` aliases this id). `dispatch` returns `null`. Observation is Cursor hook JSON (`sessionStart` and tool hooks) from the **host** session. Cursor is not an ACP peer. Ira does not spawn `cursor-agent` or `agent`. |
| `opencode` | `opencode` | ACP | Detached supervisor only, after Slice A. `opencode acp` JSON-RPC on the **child** stdio, not the MCP pipes. One session per task, then shutdown. |
| `crush` | `crush` | ACP | Detached supervisor only, after Slice A. `crush acp` JSON-RPC on the child stdio. One session per task. |
| `aider` | `aider` | PTY | Detached supervisor only, after Slice A. Non-interactive child: `aider --message-file <file> --yes-always --no-pretty`, cwd = workspace. Events come from supervisor spawn/exit plus an allowlisted token line. No interactive terminal is allocated. |
| `custom` | argv0 of the stored command | PTY | Same detached supervisor as Aider, after Slice A. Optional `eventMode: "jsonl"` parses stdout lines that are already the normalized event types. |

Hook bridge for the three host engines: the **host** session runs `superspec engines hook-ingest --session <sessionId>`. Ira does not parent the CLI and does not write a supervisor-owned hook file in order to spawn `claude`, `codex`, or `cursor-agent`. `hook-ingest` reads vendor JSON on stdin, calls `normalizeEvent`, asks the hive writer to append, and exits 0. Stdin is not stored. A session directory under `engines/sessions/<sessionId>/`, when the host created one, is removed on stop. `SUPERSPEC_ENGINE_SESSION` is on the supervisor allowlist for non-host children; it is not a license to spawn a host CLI.

Project hook files (`hooks/hooks.json`, `hooks/hooks-codex.json`, `hooks/hooks-cursor.json`) are not rewritten on bind. `superspec engines hooks install` appends a `hook-ingest` command beside the existing SuperSpec reminder. That install MUST NOT set Ira as the parent of the host CLI and MUST NOT change a host `dispatch` result away from `null`. Doctor emits warning `ENGINE_HOOKS_NOT_INSTALLED` when the process is inside that host and the project hook file has no `hook-ingest` command. Host dispatch still returns null; events arrive only after install. OpenCode, Crush, Aider, and custom do not depend on those project files.

ACP method map for catalog v1: a successful session start notification becomes `engine.start`; `tool_call` / `tool_call_update` become `engine.tool` with the tool name and `ok` or `error`; a usage object becomes `engine.tokens`; orderly shutdown or exit 0 becomes `engine.stop`; a JSON-RPC error or non-zero exit becomes `engine.error`. Unknown notifications are ignored.

PTY map: the supervisor emits `engine.start` when `spawn` succeeds and `engine.stop` or `engine.error` when the child exits. Aider may also emit `engine.tokens` when a line matches `^Tokens: (\d+) sent, (\d+) received`. No other stdout becomes an event. Tool events are not invented from commands Aider runs.

Spawn argv for `opencode`, `crush`, `aider`, and `custom` is catalog data consumed by the detached supervisor. Unit tests fixture it. An integration test may run `<binary> --version`. If the spawn subcommand is missing, health becomes `degraded` with finding `ENGINE_SPAWN_UNSUPPORTED`. That finding sets `engineRungReady` false when no other healthy rung remains and leaves `hiveReady` unchanged. Host-engine argv is detection and hook install only; it is never passed to `spawn` from the MCP process.

**Alternatives considered**:

- **PTY for every CLI**: Rejected. Scraping Claude, Codex, Cursor, OpenCode, or Crush discards structured tool and token records and breaks when a spinner changes. PTY is reserved for engines with no hook API and no ACP server.
- **ACP for Claude, Codex, and Cursor**: Rejected. Those products are integrated in this repo through hook files, and ACP is not their supported session API. Forcing ACP would drop the hook path that already exists.
- **Runtime fallback from ACP to PTY**: Rejected. A silent downgrade hides a broken preset and reintroduces scraping. The operator sees a degraded engine and a remedy instead.
- **Interactive PTY for Aider**: Rejected. An interactive terminal fights the TUI and cannot be fixture-tested. Non-interactive argv is the PTY-class observation without allocating a terminal.

### Decision: One normalized event allowlist, and token counts only when the engine reports them

**Rationale**:

Problem statement: User story 6 and FR-010 require start, tool, stop, error, and tokens in the hive log. FR-011 forbids secrets. Custom engines often cannot emit tool or token events (FR-022).

Context: P-001 event `data` is an allowlist. Keys named `prompt`, `code`, `diff`, `token`, `secret`, or `authorization` are stripped. Unknown `type` values are kept on disk and ignored by current readers. New `engine.*` types are additive and do not bump `version` from `1`.

`normalizeEvent` accepts raw `type` of `start`, `tool`, `stop`, `error`, or `tokens` (and the vendor aliases in the strategy table). It returns an `IraEvent` whose `type` is `engine.start`, `engine.tool`, `engine.stop`, `engine.error`, or `engine.tokens`. A second start for the same `sessionId` returns null. Tool arguments, file bodies, and stdout are dropped. `engine.tokens` is returned only when the raw payload has numeric `inputTokens` and `outputTokens`. Missing usage returns null. The supervisor does not synthesize zeros.

`engine.error` `data.message` is at most 500 characters after redaction. Redaction replaces matches of `(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+` and any string that looks like a `sk-` or `ghp_` token with `[redacted]`. `reasonClass` is the enum in the data model, never a raw vendor paragraph.

On `engine.tokens`, if `TokenHooks.recordSpend` is registered, the supervisor also calls it with `source: "transcript"` for hook and PTY lines and `source: "api"` for ACP usage. It does not call `recordSpend` when tokens were absent. P-004 owns the ledger. P-006 does not compute USD.

**Alternatives considered**:

- **Estimate tokens from character length**: Rejected. The spec says not to fabricate counts, and an estimate would look like a real spend event to P-004.
- **Store tool arguments for the activity view**: Rejected. Tool arguments contain source code. P-001 telemetry strips code and prompts. The activity row needs the tool name and status only.
- **A new event schema version**: Rejected. P-001 readers ignore unknown types. Bumping `version` would make old lines look invalid.

### Decision: Fail over only at the next fresh dispatch, down subscription then BYOK then local

**Rationale**:

Problem statement: FR-008, FR-012, and FR-013 require a ladder from subscription-backed CLIs to API/BYOK to local, as routine automation, except when the move would exceed budget or enter another critical class. Mid-turn switching is forbidden. If every rung is unhealthy, dispatch stops and does not invent an engine.

Context: P-001 already calls `TokenHooks.beforeDispatch` before `EngineHooks.dispatch`, and it treats engine failover as routine when the hook says so. `DispatchIntent.freshSubagent` is always true. `routeModel` has already stamped `intent.tier`.

Default `engines/policy.json` has `failoverEnabled: true`, `ladder: ["subscription", "byok", "local"]`, and `hitl: ["budget_exceed", "destructive_git"]`. When the MCP server is attached to `claude`, `codex`, or `cursor-agent`, the effective `delegateToHost` is that host. A persisted `null` does not mean the supervisor parents the host CLI. The stored `RosterAgent.engine` is the preference and is not rewritten when a lower rung runs.

At `dispatch` only:

1. If `failoverEnabled` is false, the preferred engine must be healthy or the call returns `{ accepted: false }`.
2. If the preferred engine is installed, authorized enough to try, and not in `rate_limited`, `quota_exhausted`, `missing`, or `unauthorized`, it is the effective engine. A local preference also has to pass the context gate.
3. Otherwise walk rungs after the preferred rung. On each rung take the first catalog engine that is installed, `health: "ok"`, and whose `authMode` equals that rung (`subscription`, `byok`, or `local`). `authMode: "unknown"` stays dispatchable only as an explicit roster preference; it is not an automatic failover candidate. Local candidates must also pass the context gate. When a numeric agent or feature budget is set (`budgetTokens` or `budgetUsd` is a number, not null), skip any candidate whose preset `emits` list does not include `tokens`. That engine has no token usage signal. If no signal-capable rung remains, return `{ accepted: false }` and do not spawn. Do not treat a missing token hook, a local rung, or `budget_unmetered` as permission to auto-select an unmetered rung under a numeric cap. This matches the token governor (P-004 FR-025). When no numeric cap is set, a rung that cannot emit tokens may still be selected. Do not infer that two engines share a quota. A future `quotaGroups` list, empty in v1, is the only way two ids stop counting as independent rungs. Doctor warning `SHARED_QUOTA_GROUP` appears when a group has more than one id. An undeclared overlap is not guessed.
4. When the effective engine differs from the preferred engine, call `TokenHooks.beforeDispatch` again on that engine and model before spawn and before `{ accepted: true }`. `{ allow: false }` returns `{ accepted: false }`, opens the existing Ask-Me path, and does not spawn. Subscription-to-subscription is not a ladder move.
5. When the effective engine changed, append `engine.failover` with `fromEngine`, `toEngine`, and `reasonClass`. Persona path and skill paths stay the same. A host-engine result returns `null` and does not spawn. A non-host result starts the detached supervisor only after Slice A and only for `opencode`, `crush`, `aider`, or `custom`, and returns `{ accepted: true }` only after that child's pid exists. A preferred host engine that did not fail over also returns `null` and does not spawn.
6. If an Ask-Me item is open for this task, the dispatcher must emit `task.blocked` and set hive status `blocked`. It must not also emit `task.unassigned`. `{ accepted: false }` with no open Ask-Me keeps the P-001 unassigned behavior.
7. If no rung is healthy, append nothing that looks like a start, return `{ accepted: false }`, add doctor error `ENGINE_NONE_HEALTHY`, and open one Ask-Me item of class `ambiguous_requirement` whose question names the dead rungs and the remedy (install, log in, or choose a model). No unregistered engine id is created.

An in-flight child is never killed in order to swap engines. The next task, or the next fresh worker after `record-result`, is the first boundary that sees the new rung.

Quota influence (FR-017): `rate_limited` or `quota_exhausted` on an engine sets its cached health to `degraded` and makes step 3 eligible. When the roster model is null, a degraded subscription engine yields to local or, if the operator's effective tier was `frontier` only because of the default map, the dispatch records the `routeModel` tier unchanged and only changes the engine. An explicit vendor model on the roster is not replaced by an economy slug. `routeModel` itself is not forked.

**Alternatives considered**:

- **Rewrite `roster.engine` on failover**: Rejected. The operator's preference would disappear, and the next healthy subscription login would not be selected.
- **Swap engines inside a running turn**: Rejected. FR-013 and fresh-subagent dispatch both forbid it.
- **A new Ask-Me reason class for an empty ladder**: Rejected. P-001's inbox and sort weights are the critical-class list. `ambiguous_requirement` is the class Ira already uses when it cannot proceed from artifacts. The question text carries the engine-specific remedy.
- **Treat two cloud CLIs as one quota automatically**: Rejected. The spec says shared-quota coupling must not be invented. Health stays per `engineId` until the operator writes `quotaGroups`.
- **Default `delegateToHost` null so Ira parents `claude`, `codex`, and `cursor-agent`**: Rejected by OD-009. When MCP is attached to a host, `delegateToHost` defaults to that host and `dispatch` returns `null`. Away queues a `DispatchIntent`. An away pid match does not authorize spawn.
- **Auto-failover onto a local or sparse rung that cannot emit tokens while a numeric budget is set**: Rejected. That was the old “local failover still proceeds” sentence. The token governor (P-004 FR-025) forbids the silent unmetered path.

### Decision: Fail closed when local context is under 65536 or unknown

**Rationale**:

Problem statement: FR-006 and FR-007 require OpenCode-class local and BYOK backends (Ollama, LM Studio, vLLM, BYOK) and a minimum advertised context of 64k. Unknown context must fail that local rung. Doctor must name the model, the floor, and a fix, and must leave `hiveReady` unchanged.

Context: Ollama's OpenCode integration is the reference path. A silent 8k or 32k window would pass spawn and fail forge quality. Persona files are shared across engines, so the gate is on the model profile, not on a second persona copy.

`LOCAL_CONTEXT_FLOOR` is `65536`. `engines/local-pack.json` names `engineId` (`opencode` or `crush`), `backend` (`ollama`, `lmstudio`, `vllm`, `byok`), a loopback `baseUrl` for the three local backends, a model id, and optional `advertisedContext`. `baseUrl` must be `http:` or `https:` and, for `ollama`, `lmstudio`, and `vllm`, the host must be loopback (`127.0.0.1` or `localhost`). BYOK may name a non-loopback URL and must not include a userinfo password or an API key.

Probe order, first defined non-negative integer wins. If the probe runs and finds no field, the result is unknown, even when the file declared a number. A declaration is used only when the probe cannot be run (BYOK, or the local binary/port is not the thing being measured).

| Backend | Probe | Fields accepted |
|---------|-------|-----------------|
| `ollama` | `execFile("ollama", ["show", model, "--json"])` | `parameters` parsed for `num_ctx`; else a numeric `context_length` under `model_info` or `details` |
| `lmstudio` | `GET {baseUrl}/v1/models` default `http://127.0.0.1:1234` | `context_length` or `max_context_length` on the named model |
| `vllm` | `GET {baseUrl}/v1/models` default `http://127.0.0.1:8000` | `max_model_len` |
| `byok` | none | `advertisedContext` in the profile is required |

Doctor findings for this gate are engine findings. They fail that local rung only. They set `engineRungReady` false when no host-delegate target and no other healthy post-Slice-A rung remain. They leave `hiveReady` unchanged. A legacy `ready` field, if emitted, equals `hiveReady` and is not the conjunction of hive health and this gate.

- `LOCAL_CONTEXT_BELOW_FLOOR` when the value is present and `< 65536`
- `LOCAL_CONTEXT_UNKNOWN` when the value is missing

Message shape: `Local model "<model>" advertises <n or unknown> context; minimum is 65536. Raise context (Ollama: set num_ctx to at least 65536) or bind another model.`

Dispatch to that local pack returns `{ accepted: false }` while either finding is active. Cloud engines are unaffected. The same persona path is passed to OpenCode or Crush as the agent file. `allowedSkills` paths are listed in the dispatch prompt file written under the workspace at `.superspec/dispatch/<taskId>.md` (gitignored). The persona markdown is not rewritten.

**Alternatives considered**:

- **Default unknown context to 65536**: Rejected. The spec requires fail closed. A missing advertisement is how an 8k model gets through.
- **Trust the profile number over a live probe**: Rejected. A stale declaration would hide a server started with a smaller `num_ctx`.
- **Block all dispatch when one local model is short**: Rejected. The floor applies to the local pack being bound, not to a healthy subscription engine.

### Decision: Publish a secret-free credential matrix and keep route-model tiers

**Rationale**:

Problem statement: FR-009 and FR-011 require a per-engine auth mode and health query with no key material. FR-002 requires detection of the target set. FR-016 requires `routeModel` economy / standard / frontier to remain the default, with a per-agent override.

Context: `routeModel` returns an abstract tier. `mapHarnessModel` turns that tier into an illustrative slug for `cursor`, `claude`, or `codex` only. `resolveDispatchModel` reads optional `.superspec/models.yaml`. P-006 must not break those functions.

Detection is an allowlisted `PATH` search (`execFile` of `--version`, never `shell: true`). `cursor-agent` is the Cursor binary. A generic `agent` binary counts only when its version text contains `Cursor`. Custom commands are detected when their argv0 is found the same way.

Auth mode and health:

| Signal | authMode | health |
|--------|----------|--------|
| Binary not on `PATH` | `unknown` | `missing` |
| Allowlisted env var is set (presence only) | `byok` | `ok`, unless a later error says otherwise |
| Preset status argv exits 0 | `subscription` | `ok` |
| Local-pack backend is `ollama`, `lmstudio`, or `vllm` and the profile is valid | `local` | `ok` when the context gate passes, else `degraded` |
| Status argv exits non-zero with an auth failure, or the last session error is `unauthorized` | unchanged | `unauthorized` |
| Last session error is `rate_limited` or `quota_exhausted` | unchanged | `degraded` |
| Installed, no status argv, no env var | `unknown` | `ok` |

Status argv is catalog data and stdout is discarded. v1 status argv: Claude `["auth", "status"]`, Codex `["login", "status"]`. If the CLI reports an unknown subcommand, the probe is ignored and mode stays `unknown` rather than `unauthorized`. Cursor has no status argv in v1. Env names checked for presence and never printed: `ANTHROPIC_API_KEY` (claude), `OPENAI_API_KEY` (codex, aider, opencode BYOK), `CURSOR_API_KEY` (cursor-agent). Credential files are not read. OS keychain items are not read. `unknown` plus `ok` means "installed, login not inspected"; the matrix shows that gap, and a later `unauthorized` error moves health.

Model resolution at dispatch:

1. Roster `model` of `economy`, `standard`, or `frontier` is the tier. It overrides `intent.tier` for that agent only.
2. Roster `model` null uses `intent.tier` from `routeModel`.
3. Any other roster `model` is an explicit vendor id. It must appear in the preset allowlist or in the live local model list. Otherwise bind and dispatch fail with `MODEL_REJECTED` and `acceptable` set to the tier names plus the allowlist. Tiers are always acceptable names.
4. Claude uses `mapHarnessModel(tier, "claude")`. Codex uses `"codex"`. Cursor Agent uses `"cursor"`. OpenCode, Crush, and Aider use `local-pack.model` unless `local-pack.tiers` maps that tier to a concrete id. One local model for every tier is valid.

Bind writes `worktreePolicy: "isolated"` when the caller omits it. Dispatch of a code-writing task with `isolated` and `workspace: null` returns `{ accepted: false }` and doctor remedy `Set workspace to a linked worktree`. P-006 does not create the worktree. `workspace` equal to the hive root, or inside `.superspec/hive`, is rejected.

**Alternatives considered**:

- **Import native credential files into the hive**: Rejected. FR-011 and the spec's assumption that secrets stay in native stores.
- **Widen `HarnessId` with opencode, crush, and aider**: Rejected. `models.yaml` and `pickHarnessOverride` only know three harnesses. Local resolution belongs on the local-pack profile.
- **Mark every keychain-backed CLI unauthorized until we can read the keychain**: Rejected. That would fail Doctor on a normal Cursor or Claude login. `unknown` is the honest mode; `unauthorized` is reserved for a failed auth probe or a failed session.

### Decision: Cross-engine review is off by default and degrades visibly when only one engine is healthy

**Rationale**:

Problem statement: FR-004 wants an optional policy that the reviewer run on a different engine from the implementer. Default off, so a single-engine shop still finishes review. When the policy is on and only one engine is healthy, Ira must not hang.

Context: `DispatchIntent` has no role field. Reviewer personas discovered by `discoverPersonas` are identifiable by a name or path basename containing `reviewer` (the existing `task-reviewer` persona).

`policy.crossEngineReview` defaults to false. When false, implementer and reviewer may share an engine and no extra engine is required.

When true, and the persona is a reviewer, the effective engine must differ from the `engineId` on the latest `engine.start` for that `taskId` whose persona was not a reviewer. If that start is missing, it must differ from the busy non-reviewer roster row on the same feature. If the reviewer's own binding already differs, keep it. If it matches, pick another healthy engine on any rung. If no other healthy engine exists, keep that only healthy engine and append `engine.policy_degraded` with `reason: "single_healthy_engine"`. A host id still returns `null`. A supervisor id still uses the detached child, and only after Slice A. Do not open Ask-Me for that degradation. If the persona cannot be classified, doctor warning `CROSS_ENGINE_REVIEW_UNBOUND` is recorded and the policy does not block the dispatch.

**Alternatives considered**:

- **Escalate to Ask-Me whenever only one engine is healthy**: Rejected. The spec allows either a degraded assignment or an escalation, and an escalation would stall a one-CLI shop that turned the policy on. The hive event is the record. Ask-Me stays reserved for budget, destructive work, and a fully dead ladder.
- **Add a required `role` field to `DispatchIntent`**: Rejected for v1. P-001's intent is already the handoff. Persona names that `discoverPersonas` returns are enough to recognize the reviewer this repo already ships.

### Decision: Custom engines are versioned catalog rows with a sparse event contract

**Rationale**:

Problem statement: FR-020 and FR-022 require a versioned adapter catalog and a custom command defined by identity plus spawn argv. Tool and token events are optional. Start, stop, and error are not.

Context: NFR-006 asks for versioned adapters. The target set is Ira's list, not Munder's twelve. Extra CLIs register as custom rows rather than new hardcoded ids in v1.

`engines/custom.json` holds `{ schemaVersion: 1, engines: [...] }`. Each row has `instanceId` (slug), `displayName`, `command` (argv array, no shell metacharacters, no empty strings), optional `model`, optional `rung` (`byok` or `local`, default `byok`), and `eventMode` of `sparse` or `jsonl`. Roster `engine` stores `custom:<instanceId>`. `schemaVersion` other than `1` yields doctor error `ENGINE_CATALOG_MISMATCH` and the file is not rewritten. Built-in presets ship in code at `ENGINE_CATALOG_VERSION = 1`.

`sparse` uses the PTY map (supervisor start/stop/error only). `jsonl` additionally accepts stdout lines whose JSON `type` is `start`, `tool`, `stop`, `error`, or `tokens` and runs them through `normalizeEvent`. Other lines are ignored. The custom command is not a shell string, so the operator cannot attach pipes in the stored command. The detached supervisor passes the argv array with `shell: false`. The MCP process does not exec that command.

**Alternatives considered**:

- **One global custom slot**: Rejected. A shop that outgrows the target set needs more than one extra CLI, and the roster engine field is a string that can carry `custom:<instanceId>`.
- **Shell strings for the spawn command**: Rejected. A shell string is an injection path into the hive. Argv arrays match the `execFile` rule used for every other engine.

## Data Model

Identifiers are strings. Timestamps are ISO-8601 UTC. Catalog version is `1`. Hive manifest version stays `1`.

### Entities

| Entity | Fields | Primary Key | Relationships | Notes |
|--------|--------|-------------|---------------|-------|
| EnginePreset | `catalogVersion`, `engineId`, `displayName`, `binaries`, `strategy`, `rung`, `spawnArgs`, `statusArgs`, `authEnv`, `byokEnvAllowlist`, `models`, `emits` | `engineId` | has many health rows and bindings | Built in for the seven ids. `strategy`: `hooks`, `acp`, `pty`. `emits` includes `tokens` only when the engine can report usage |
| CustomEngine | `instanceId`, `displayName`, `command`, `model`, `eventMode` | `instanceId` | roster `engine` = `custom:<instanceId>` | Stored in `engines/custom.json` |
| RosterEngineBinding | `personaPath`, `engine`, `model`, `budgetTokens`, `budgetUsd`, `workspace`, `worktreePolicy` | roster `id` | belongs to P-001 `RosterAgent`; persona from `discoverPersonas` | Preference, not the failover effective engine |
| LocalPackProfile | `engineId`, `backend`, `baseUrl`, `model`, `advertisedContext`, `contextSource`, `tiers` | `engineId` | belongs to an OpenCode-class preset | `backend`: `ollama`, `lmstudio`, `vllm`, `byok` |
| FailoverPolicy | `failoverEnabled`, `ladder`, `crossEngineReview`, `hitl`, `quotaGroups` | hive singleton | applied at dispatch | Ladder order is fixed to three rungs |
| CredentialMatrixRow | `engineId`, `displayName`, `installed`, `authMode`, `health`, `rung`, `binary` | `engineId` | projection of preset + health | No secret fields |
| EngineHealth | `engineId`, `authMode`, `health`, `reasonClass`, `binaryVersion`, `checkedAt` | `engineId` | updated by detect, doctor, and `engine.error` | Cache dispatch reads |
| NormalizedEngineEvent | `type`, `agentId`, `engineId`, `taskId`, `sessionId`, token fields, `reasonClass` | event `id` | line in P-001 `events.jsonl` | See event schema |
| EngineSession | `sessionId`, `agentId`, `taskId`, `engineId`, `effectiveEngine`, `pid`, `startedAt` | `sessionId` | ephemeral directory | Deleted on stop |

**EnginePreset**

- `engineId`: `claude`, `codex`, `cursor-agent`, `opencode`, `crush`, `aider`, or `custom`
- `strategy`: `hooks`, `acp`, or `pty`
- `rung`: `subscription` for `claude`, `codex`, and `cursor-agent`; `local` for `opencode` and `crush` when `local-pack.json` names that engine, otherwise `byok`; `byok` for `aider` and for custom rows unless the custom row sets `rung` to `local`
- `emits`: subset of `start`, `tool`, `stop`, `error`, `tokens`. Hooks and ACP presets emit all five when the vendor sends them. Aider emits `start`, `stop`, `error`, and optionally `tokens`. Custom sparse emits `start`, `stop`, `error`. A preset that does not list `tokens` cannot be an automatic failover target while a numeric budget is set.
- `byokEnvAllowlist`: env names copied into the supervisor env only when the effective rung is `byok`. Empty for host engines, which are not spawned.
- Invariants: builtin ids are exactly the target set. Strategy does not change at runtime. Host ids have no Ira-parent spawn.

**RosterEngineBinding**

- Uses the existing `RosterAgent` columns. P-006 is the writer of `engine`, `model`, `budgetTokens`, `budgetUsd`, `workspace`, and `worktreePolicy` after init.
- `model`: `economy`, `standard`, `frontier`, a vendor id, or null
- `workspace`: absolute path, or null. Never the hive root
- `worktreePolicy`: `isolated` or `shared`. New binds default to `isolated`
- Invariants: one row per roster id. Bind does not set `status` to `busy` and does not spawn. A missing engine, unknown engine id, or rejected model leaves the previous row unchanged.

**LocalPackProfile**

- `contextSource`: `probe` or `declared`
- `advertisedContext`: integer or null
- Invariants: values below `65536` or null after a completed probe are not dispatchable. `baseUrl` has no userinfo and no query secret.

**FailoverPolicy**

- `ladder`: exactly `["subscription", "byok", "local"]` in that order
- `hitl`: `budget_exceed` and `destructive_git`
- `crossEngineReview`: boolean, default false
- `delegateToHost`: `claude`, `codex`, `cursor-agent`, or null. When MCP is attached to one of those hosts, the effective default is that host. Persisted null does not authorize Ira-parent spawn
- `quotaGroups`: list of engine-id lists, default `[]`
- Invariants: enabling failover does not by itself spawn a worker

**CredentialMatrixRow**

- `authMode`: `subscription`, `byok`, `local`, `unknown`
- `health`: `ok`, `degraded`, `missing`, `unauthorized`
- Invariants: serialized JSON from this row contains none of `apiKey`, `token`, `secret`, `password`, `authorization`, `cookie`, or `refresh`. Tests scan the payload for those names and for `sk-` / `ghp_` prefixes.

**Engine session state machine**

```text
idle --dispatch accepted--> running --exit 0--> stopped
running --exit non-zero or signal--> errored
running --adapter crash--> errored (roster status offline)
```

There is no transition from `running` to a different `engineId`.

**Health state machine**

```text
missing --binary found--> ok | unauthorized | degraded
ok --rate_limited | quota_exhausted--> degraded
ok | degraded --auth failure--> unauthorized
degraded | unauthorized --successful status or healthy session stop--> ok
* --binary gone--> missing
```

## Contracts

### API / Service Interfaces

CLI stdout is one JSON object. Exit `0` on success and `1` on failure. MCP tools return the same JSON as text, including `ok: false`. Shared error envelope matches P-001. New error codes: `ENGINE_NOT_FOUND`, `ENGINE_MISSING`, `MODEL_REJECTED`, `LOCAL_CONTEXT_BELOW_FLOOR`, `LOCAL_CONTEXT_UNKNOWN`, `ENGINE_NONE_HEALTHY`, `ENGINE_CATALOG_MISMATCH`, `ROSTER_BUSY`, `INVALID_INPUT`, `HOST_SPAWN_FORBIDDEN`, `SUPERVISOR_IN_MCP_FORBIDDEN`, `SLICE_A_ONLY`.

Hive-not-initialized responses stay `HIVE_NOT_INITIALIZED` with the existing doctor hint. Detection does not require a hive. Bind, policy, local pack, and dispatch do.

#### `engines-detect`

Request: `{ "cwd": "optional" }`

Response:

```json
{
  "ok": true,
  "catalogVersion": 1,
  "engines": [
    {
      "engineId": "claude",
      "displayName": "Claude Code",
      "installed": true,
      "binary": "/usr/local/bin/claude"
    },
    {
      "engineId": "crush",
      "displayName": "Crush",
      "installed": false,
      "binary": null
    }
  ]
}
```

Every builtin id appears once. Custom rows appear as `custom:<instanceId>` when `custom.json` is present.

#### `engines-bind`

Request:

```json
{
  "agentId": "implementer",
  "personaPath": "/abs/repo/.claude/agents/implementer.md",
  "engine": "codex",
  "model": "gpt-5.5",
  "budgetUsd": 10,
  "budgetTokens": null,
  "workspace": "/abs/repo/.worktrees/implementer",
  "worktreePolicy": "isolated"
}
```

Response: `{ "ok": true, "agent": { "id": "implementer", "engine": "codex", "model": "gpt-5.5", "workspace": "/abs/repo/.worktrees/implementer", "worktreePolicy": "isolated" } }`

The five bindings are persona, engine, model, budget, and workspace. Budget fields may be null. An id outside the catalog returns `ENGINE_NOT_FOUND`. A known engine that is not installed returns `ENGINE_MISSING`. Neither starts a process. A model the engine does not offer returns:

```json
{
  "ok": false,
  "error": "MODEL_REJECTED",
  "message": "codex does not offer model \"nope\".",
  "acceptable": ["economy", "standard", "frontier", "gpt-5.4", "gpt-5.5", "gpt-5.5-high"]
}
```

#### `engines-matrix`

Request: `{ "cwd": "optional" }`

Response:

```json
{
  "ok": true,
  "catalogVersion": 1,
  "rows": [
    {
      "engineId": "claude",
      "displayName": "Claude Code",
      "installed": true,
      "authMode": "subscription",
      "health": "ok",
      "rung": "subscription",
      "binary": "claude"
    }
  ]
}
```

This is the payload P-002 may render later. It is complete with Command Center absent.

#### `engines-policy-show` / `engines-policy-set`

Show response:

```json
{
  "ok": true,
  "policy": {
    "schemaVersion": 1,
    "failoverEnabled": true,
    "ladder": ["subscription", "byok", "local"],
    "crossEngineReview": false,
    "delegateToHost": "claude",
    "hitl": ["budget_exceed", "destructive_git"],
    "quotaGroups": []
  }
}
```

Set accepts the same fields. `ladder` must stay the three rungs in that order. `delegateToHost` accepts `claude`, `codex`, `cursor-agent`, or null. The example above is the effective default when MCP is attached to Claude Code. A stored null is not a spawn authorization: host `dispatch` still returns `null`, and the supervisor still MUST NOT start `claude`, `codex`, or `cursor-agent`.

#### `engines-local-pack-set`

Request:

```json
{
  "engineId": "opencode",
  "backend": "ollama",
  "baseUrl": "http://127.0.0.1:11434",
  "model": "qwen2.5-coder:32b"
}
```

Response includes `advertisedContext` and `contextSource` after the probe, or `ok: false` with `LOCAL_CONTEXT_BELOW_FLOOR` or `LOCAL_CONTEXT_UNKNOWN`.

#### `engines-hook-ingest`

Reads vendor JSON on stdin. Not an Operator-facing query. Stdout is empty on success. Used as the hook command.

#### Doctor extension

`doctor` remains the P-001 tool. Findings gain engine codes without removing existing ones. Response JSON includes `hiveReady`, `engineRungReady`, `sliceAValidated`, `worktreeKind` (`main` or `linked`), and `sandboxed`. `hiveReady` is coordination-store health and is not cleared by an engine finding. `engineRungReady` is false when no host engine is delegable and no post-Slice-A `opencode`, `crush`, `aider`, or `custom` rung is healthy. A legacy `ready` field, if emitted, equals `hiveReady` and is not `hiveReady && engineRungReady`. `sandboxed` is `true` only with evidence of an OS sandbox wrapper on the supervisor child. Slice A has no wrapper, so `sandboxed` is `false`. A check that derives `sandboxed` from `worktreeKind`, `workspace`, or `worktreePolicy` records `WORKTREE_IS_NOT_SANDBOX` and reports `sandboxed: false`.

```json
{
  "hiveReady": true,
  "engineRungReady": true,
  "sliceAValidated": false,
  "worktreeKind": "main",
  "sandboxed": false
}
```

| Code | Severity | When |
|------|----------|------|
| `ENGINE_MISSING` | warning | A target binary is absent. Not an error by itself, so a partial install stays usable |
| `ENGINE_UNAUTHORIZED` | warning | Health is `unauthorized` |
| `ENGINE_SPAWN_UNSUPPORTED` | warning | Strategy subcommand missing. Sets `engineRungReady` false when that rung was required. Does not clear `hiveReady` |
| `ENGINE_HOOKS_NOT_INSTALLED` | warning | Host session without `hook-ingest` |
| `LOCAL_CONTEXT_BELOW_FLOOR` | error | Advertised context under 65536. Fails that local rung only. Does not clear `hiveReady` |
| `LOCAL_CONTEXT_UNKNOWN` | error | Context not advertised. Fails that local rung only. Does not clear `hiveReady` |
| `ENGINE_NONE_HEALTHY` | error | Dispatch found every rung unhealthy. Sets `engineRungReady` false. Does not clear `hiveReady` |
| `ENGINE_CATALOG_MISMATCH` | error | `custom.json` schema is not 1 |
| `SHARED_QUOTA_GROUP` | warning | Operator declared a quota group |
| `CROSS_ENGINE_REVIEW_UNBOUND` | warning | Policy on, persona role not recognizable |
| `HOST_SPAWN_FORBIDDEN` | error | A path tried to parent `claude`, `codex`, or `cursor-agent`. No child started |
| `SUPERVISOR_IN_MCP_FORBIDDEN` | error | Supervisor ran in-process on the MCP request or reused MCP stdio |
| `WORKTREE_IS_NOT_SANDBOX` | error | `sandboxed` was derived from worktree kind, workspace, or worktree policy. Reported `sandboxed` is `false`. Does not clear `hiveReady` |

`nextSteps` include the concrete fix already used in the context-floor message, plus "install the CLI or bind a detected engine" for `ENGINE_MISSING`.

#### CLI commands

| Command | Required flags |
|---------|----------------|
| `superspec engines detect` | |
| `superspec engines bind` | `--agent`, `--engine`, `--persona`; optional `--model`, `--budget-usd`, `--budget-tokens`, `--workspace`, `--worktree isolated\|shared` |
| `superspec engines matrix` | |
| `superspec engines policy show` | |
| `superspec engines policy set` | `--failover true\|false`, `--cross-engine-review true\|false`; optional `--delegate-to-host claude\|codex\|cursor-agent`. Omitting the flag keeps the attached-host default. The flag MUST NOT cause a host CLI spawn |
| `superspec engines supervise` | intent path argument. Detached child only. Not invoked in-process from the MCP request handler |
| `superspec engines local-pack set` | `--engine`, `--backend`, `--model`; optional `--base-url`, `--context` |
| `superspec engines hooks install` | |
| `superspec doctor` | existing command; engine findings included |

`engines hook-ingest` is hidden from the Operator summary and is valid as a hook command.

#### Function signatures

```ts
export const ENGINE_CATALOG_VERSION = 1 as const;
export const LOCAL_CONTEXT_FLOOR = 65536 as const;

export type EngineId =
  | "claude"
  | "codex"
  | "cursor-agent"
  | "opencode"
  | "crush"
  | "aider"
  | "custom";

export type EngineStrategy = "hooks" | "acp" | "pty";
export type AuthMode = "subscription" | "byok" | "local" | "unknown";
export type EngineHealth = "ok" | "degraded" | "missing" | "unauthorized";
export type LadderRung = "subscription" | "byok" | "local";

export interface EngineHooks {
  detectInstalled(): Promise<Array<{ engineId: string; installed: boolean }>>;
  dispatch(intent: DispatchIntent): Promise<{ accepted: boolean } | null>;
  normalizeEvent(raw: {
    type: string;
    agentId?: string;
    engineId?: string;
    data?: Record<string, unknown>;
  }): Promise<IraEvent | null>;
}
```

`DispatchIntent` is the P-001 object (`featureId`, `taskId`, `agentId`, `personaPath`, `workspace`, `hiveRoot`, `specDir`, `attempt`, `tier`, `freshSubagent`). P-006 does not remove fields. `freshSubagent` must stay true. A false value is `INVALID_INPUT` and does not spawn.

#### Integration points

- **P-001 hive writer**: in-process append under `locks/events.lock`. Protocol is a function call, not HTTP.
- **P-001 roster**: atomic rewrite of `roster.json` under `locks/roster.lock`. The lock file lives in the existing `locks/` directory and uses the same `withLock` rules as ledger locks (2000 ms). Timeout returns `ROSTER_BUSY`.
- **`routeModel` / `mapHarnessModel` / `resolveDispatchModel`**: in-process. Tiers stay abstract.
- **`discoverPersonas`**: in-process. Bind checks `personaPath` is one of the discovered paths or an existing `.md` / `.toml` file. The file is not copied.
- **`TokenHooks.beforeDispatch` and `recordSpend`**: in-process, when registered.
- **Target CLIs**: `execFile` argv from the catalog. No network calls except loopback model-list probes and the operator-declared BYOK base URL metadata probe, which BYOK does not perform.
- **Ollama**: local CLI `ollama show <model> --json` for context. Probe stdout is not logged. Supervisor env is the scrubbed object, not `process.env`.

### Consumed From Other Specs

| Source spec | Contract | Version / stability | Notes |
|-------------|----------|---------------------|-------|
| `specs/001-ira-command-plane` | `DispatchIntent` and `EngineHooks` | v1 | Host-engine `dispatch` returns null and does not spawn. Away persists the intent under `dispatch-queue/`. `{ accepted: false }` with an open Ask-Me blocks instead of unassigning |
| `specs/001-ira-command-plane` | `events.jsonl` append via `normalizeEvent` | v1 | Adapters return an `IraEvent`. They do not write the log file |
| `specs/001-ira-command-plane` | `events.jsonl` event schema v1 | v1, new `type` values allowed | `engine.*` types are additive. Version stays 1 |
| `specs/001-ira-command-plane` | `RosterAgent` in `roster.json` and `HireHooks` | v1 | P-006 writes engine, model, budget, workspace, and worktree policy on the same rows. `workspace` is never a hive root |
| `specs/001-ira-command-plane` | `TokenHooks.beforeDispatch`, `recordSpend`, `onRecordResult` | v1 | Called again for the post-failover candidate before spawn. A numeric budget refuses a rung that cannot emit tokens (P-004 FR-025). `recordSpend` only after a real `engine.tokens` event. Deny opens Ask-Me `budget_exceed` and returns `{ accepted: false }` |
| `specs/001-ira-command-plane` | CLI/MCP JSON for hive-status, brief-show, roster-list, ask-me-list, ask-me-answer, autonomy-show, away-set, doctor | v1, additive fields only | Doctor gains `engineRungReady`, `sliceAValidated`, and `sandboxed` beside `hiveReady` and `worktreeKind`. Engine findings do not clear `hiveReady`. Ask-Me `ambiguous_requirement` is reused when no rung is healthy |

### Produced For Other Specs

| Target spec / consumer | Contract | Version / stability | Notes |
|------------------------|----------|---------------------|-------|
| `specs/002-ira-command-center` | `engines-matrix` JSON and `engine.*` events | v1, additive fields only | UI may render the matrix and the activity stream. No UI-only state |
| `specs/002-ira-command-center` | `events.jsonl` event schema v1 | v1 | Same hive file P-001 produces. New types `engine.start`, `engine.tool`, `engine.stop`, `engine.error`, `engine.tokens`, `engine.failover`, `engine.policy_degraded` |
| `specs/004-ira-token-context` | `engine.tokens` payload | v1 | Input for `recordSpend`. Omitted when the engine reports no usage |
| `specs/005-ira-hire-gallery` | `engines-detect` result | v1 | Hire review reads `installed` before spawn. This spec does not parse manifests |

### Event Schema

Channel: `<hiveRoot>/events/events.jsonl`. Version `1`. Append order under `locks/events.lock`. Retention and the 50 MB doctor warning stay as P-001 defined them. Actor for a worker session is `{ "kind": "worker", "id": "<agentId>" }`. Failover and policy events use actor `{ "kind": "ira", "id": "ira" }`.

```json
{
  "id": "evt_00000000-0000-4000-8000-000000000000",
  "type": "engine.start",
  "version": 1,
  "ts": "2026-10-15T16:20:00.000Z",
  "featureId": "006-ira-engine-adapters",
  "actor": { "kind": "worker", "id": "implementer" },
  "data": {
    "agentId": "implementer",
    "engineId": "codex",
    "taskId": "T003",
    "sessionId": "ses_01"
  }
}
```

| `type` | `data` fields |
|--------|----------------|
| `engine.start` | `agentId`, `engineId`, `taskId`, `sessionId` |
| `engine.tool` | `agentId`, `engineId`, `taskId`, `sessionId`, `toolName`, `status` (`ok` or `error`) |
| `engine.stop` | `agentId`, `engineId`, `taskId`, `sessionId`, `exitCode` |
| `engine.error` | `agentId`, `engineId`, `taskId`, `sessionId`, `reasonClass`, `message` |
| `engine.tokens` | `agentId`, `engineId`, `taskId`, `sessionId`, `inputTokens`, `outputTokens`, `source` (`transcript` or `api`) |
| `engine.failover` | `agentId`, `taskId`, `fromEngine`, `toEngine`, `reasonClass`, `rung` |
| `engine.policy_degraded` | `taskId`, `policy` (`cross_engine_review`), `reason` (`single_healthy_engine`), `engineId` |

`reasonClass` for errors and failover: `rate_limited`, `quota_exhausted`, `missing`, `unauthorized`, `context_below_floor`, `model_rejected`, `spawn_failed`, `adapter_crash`, `unknown`.

Ordering: a session emits at most one `engine.start` and one terminal `engine.stop` or `engine.error`. `engine.tool` and `engine.tokens` sit between them when the vendor sends them. `engine.failover` is written before the start of the worker that actually runs.

## Appendix: FR Coverage

| FR | Where this design satisfies it |
|----|--------------------------------|
| FR-001 | `engines-bind` writes persona, engine, model, budget, and workspace onto `RosterAgent` |
| FR-002 | Catalog target set and `engines-detect` |
| FR-003 | Per-row engine and model; edits do not rewrite other rows |
| FR-004 | `crossEngineReview` default false; degraded event when one engine remains |
| FR-005 | Same `personaPath` and skill paths passed to OpenCode-class engines |
| FR-006 | `LOCAL_CONTEXT_FLOOR` 65536; the finding fails that local rung only and does not clear `hiveReady` |
| FR-007 | Local-pack backends `ollama`, `lmstudio`, `vllm`, `byok` |
| FR-008 | Ladder subscription → BYOK → local |
| FR-009 | `engines-matrix` |
| FR-010 | `normalizeEvent` and `engine.*` types |
| FR-011 | Matrix projection and redaction; credential files are not read |
| FR-012 | Routine failover versus `budget_exceed` / `destructive_git`; numeric budget skips rungs that do not emit `tokens` |
| FR-013 | Effective engine chosen only inside `dispatch`; no mid-turn swap |
| FR-014 | Doctor finding table; `hiveReady` and `engineRungReady` are separate booleans |
| FR-015 | `engines-detect` is the onboarding signal |
| FR-016 | `routeModel` tier, then per-agent override |
| FR-017 | Degraded quota removes a rung; explicit vendor models stay |
| FR-018 | `freshSubagent: true`; host engines return `null` so the host runs the fresh subagent |
| FR-019 | Default `worktreePolicy` `isolated`; `worktreeKind` is not `sandboxed` |
| FR-020 | `ENGINE_CATALOG_VERSION` and `custom.json` |
| FR-021 | CLI and MCP share the JSON; no Command Center state |
| FR-022 | Custom sparse mode still emits start, stop, and error; sparse mode is not an automatic failover target under a numeric budget |
| FR-023 | Host `dispatch` returns `null`; `HOST_SPAWN_FORBIDDEN` if a host CLI would be parented |
| FR-024 | `dispatch-queue/` for away and idle host engines; detached supervisor only for `opencode`, `crush`, `aider`, `custom` |
| FR-025 | `engines supervise` detached child; `SUPERVISOR_IN_MCP_FORBIDDEN`; hook catch returns deny |
| FR-026 | Env builder allowlist plus `byokEnvAllowlist` only on rung `byok` |
| FR-027 | Non-host spawn returns `SLICE_A_ONLY` until `sliceAValidated` |

---

<!-- Adapted from SK: templates/plan-template.md (MIT). See /NOTICE. -->
