# Feature Specification: ira-engine-adapters

**Feature Branch**: `006-ira-engine-adapters`

**Created**: 2026-09-06

**Status**: Draft

**Type**: platform

**Input**: P-006 — Multi-CLI roster binding, per-agent model assignment, cross-engine review, OpenCode + local-model pack (≥64k), failover ladder (subscription → BYOK → local), credential/subscription matrix, and normalized engine lifecycle events. Parent EN-* from `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md`.

## Required Reading

| Path | Reason |
|------|--------|
| `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` | LOCKED production remediation. OD-009 host spawn, OD-014 doctor split, OD-015 process isolation, OD-019 env scrub and sandbox, OD-020 Slice A. If this spec disagrees with that amendment, the amendment wins |
| `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md` | Parent EN-* (§6.6), G3, actors §5.1, HITL §5.3, roster model §8.1, local/BYOK journey §9.3, OPEN-005 |
| `docs/superspec/specs/ira-prior-art-reuse-map.md` | Reuse-first map — adapt Munder/Ruflo/SuperSpec; do not invent a second engine layer |
| `program.md` (P-006 row) | Program boundary: EN-* owned here; UI render in P-002; hire manifests in P-005 |
| `specs/001-ira-command-plane/spec.md` | Hive event log, roster placeholders, Doctor, Option D CLI/MCP invariant |
| `docs/explanation/dispatch-and-context.md` | Fresh subagent dispatch; failover only at task boundaries |
| https://docs.ollama.com/integrations/opencode | Local OpenCode + Ollama path; **≥64k context** requirement |
| https://github.com/chaitanyagiri/munder-difflin/blob/main/src/shared/agentProvider.ts | Munder multi-engine presets to **adapt** |
| https://munderdiffl.in/blog/run-a-mixed-engine-office/ | Mixed-engine office: per-hire CLI + local/BYOK settings |
| https://www.databricks.com/blog/introducing-omnigent-meta-harness-combine-control-and-share-your-agents | Omnigent — **architecture inspiration only** (cross-vendor review at a meta layer) |
| https://apiad.github.io/aegis/ | Aegis — **architecture inspiration only** (drive multiple CLIs over native protocols) |

## Prior Art / Reuse

Prefer **adapt** over invent. Formal FRs stay WHAT/WHY; paths guide later `architect` / `forge`. Preserve MIT attribution when adapting code.

| Concern | Treatment | Source |
|---------|-----------|--------|
| Multi-CLI presets, spawn flags, hook/bridge strategy per engine | **Adapt** | Munder `src/shared/agentProvider.ts` (`AgentProviderPreset`, `inferAgentProvider`); README supported-agents list |
| Mixed-engine floor (different CLI per hire, local base URLs, BYOK) | **Adapt** | [Run a Mixed-Engine Office](https://munderdiffl.in/blog/run-a-mixed-engine-office/); Settings → AI Engines pattern |
| Abstract model tiers + existing harness map | **Extend** | SuperSpec `packages/core/src/model-router.ts`, `packages/core/src/harness-model-map.ts` |
| Portable personas across harnesses | **Extend** | SuperSpec `packages/core/src/persona-discovery.ts` |
| Fresh worker per task | **Keep** | SuperSpec `docs/explanation/dispatch-and-context.md` |
| Local OpenCode + Ollama context floor | **Reference** | [Ollama × OpenCode](https://docs.ollama.com/integrations/opencode) — 64k+ context |
| Cross-vendor review / meta-harness policy | **Inspiration URLs only** | Omnigent; Aegis — do **not** vendor, depend on, or copy their implementations |
| Hive event log consumer | **Consume** | P-001 append-only event log; this spec supplies normalized engine events |

**Out of scope for reuse in P-006**: Munder pixel/office UI; Munder’s full 12-engine catalog beyond Ira’s target set; Ruflo 300+ MCP tools; Hermes/OpenClaw adapters (P-007); Command Center visual chrome (P-002).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Detect installed engines and bind a roster entry (Priority: P1)

The Operator (or Ira staffing from a brief/hire) binds a worker as **persona + engine + model + budget + workspace/worktree**. Ira detects which target engines are installed and refuses silent binding to a missing CLI.

**Why this priority**: Without a bound, detectable engine, Ira cannot dispatch any worker. This is the platform contract P-001 roster placeholders and P-005 hire confirmations consume.

**Independent Test**: On a machine with only a subset of target CLIs installed, list detected engines, bind one roster entry to an installed engine, and attempt a bind to a missing engine — the latter must fail with a Doctor-actionable reason.

**Acceptance Scenarios**:

1. **Given** two target engines installed and one absent, **When** the Operator queries engine detection, **Then** the response lists each target engine as installed or missing with a human-readable identifier.
2. **Given** a persona and an installed engine, **When** the Operator binds a roster entry with model, budget, and workspace, **Then** the roster record persists those five bindings and is queryable via CLI/MCP without a UI.
3. **Given** a bind request naming a missing engine, **When** the bind is submitted, **Then** the system rejects the bind, does not start a worker, and points to Doctor remediation (install or pick another engine).

---

### User Story 2 - Mix models and engines per agent (Priority: P1)

The Operator assigns different engines and models to different roster entries — for example implementer on Codex and reviewer on Claude — without a global “one engine for the whole floor” constraint.

**Why this priority**: Mixed assignment is the core of G3 and EN-003; a single global engine setting would lock Ira into harness lock-in.

**Independent Test**: Create two roster entries with different engine+model pairs; dispatch a paired implement/review cycle (or a dry-run assignment query) and verify each worker retains its own engine and model.

**Acceptance Scenarios**:

1. **Given** two idle roster entries, **When** the Operator sets implementer to engine A / model M1 and reviewer to engine B / model M2, **Then** subsequent assignment queries show the mixed pair and do not overwrite one entry when the other is edited.
2. **Given** SuperSpec default model tiers (economy / standard / frontier), **When** a roster entry has no explicit vendor model, **Then** dispatch uses the default tier mapping for that engine.
3. **Given** a roster entry with an explicit per-agent model, **When** dispatch occurs, **Then** that assignment overrides the default tier mapping for that agent only.

---

### User Story 3 - Run the same personas on a local OpenCode pack (Priority: P1)

When subscription-backed Claude/Cursor-class engines are unavailable, the same SuperSpec personas and skills run on an OpenCode-class engine backed by Ollama, LM Studio, vLLM, or BYOK. The local path must advertise **at least 64k context** or Doctor fails with a concrete fix.

**Why this priority**: Local/BYOK parity is the anti-lock-in promise; a local pack that silently uses a 8k/32k model would corrupt forge quality.

**Independent Test**: Mark cloud engines unavailable, bind a known persona to OpenCode + a local model, run Doctor against a <64k fixture (that local rung fails; hive readiness stays true when the hive itself is healthy) and a ≥64k fixture (that rung passes), then complete one mechanical task with the same persona identity.

**Acceptance Scenarios**:

1. **Given** Claude/Cursor-class engines unavailable and OpenCode plus a local backend installed, **When** Ira staffs a mechanical task, **Then** the same persona files and skills are used with only the engine/model fields changed.
2. **Given** a local model whose advertised context is below 64k or unknown, **When** Doctor or local-pack validation runs, **Then** that local rung fails (`engineRungReady` is false when no other healthy rung remains), the finding names the model plus the 64k minimum and how to raise context or switch models, and `hiveReady` stays unchanged.
3. **Given** a local model whose advertised context is 64k or higher, **When** Doctor runs, **Then** the local-pack context check passes for that rung and dispatch of that rung is allowed under policy and Slice A.

---

### User Story 4 - Failover down the subscription → BYOK → local ladder (Priority: P2)

When the preferred engine is unhealthy (rate-limited, quota exhausted, missing, or auth failed), Ira moves the **next** dispatch down a configured ladder: subscription-backed CLI → API/BYOK → local, without Operator micro-management — unless the move would hit a critical HITL class (budget exceed, destructive work).

**Why this priority**: Keeps the floor moving when quotas die; depends on P1 bind + local pack being real.

**Independent Test**: Seed a roster with a subscription engine marked unhealthy and a healthy next-rung engine that can emit token usage; dispatch the next ready task and verify the assignee’s effective engine is the next rung, with a hive event recording the failover reason. Repeat with a numeric budget and a next rung that cannot emit token usage; that dispatch must not start.

**Acceptance Scenarios**:

1. **Given** failover policy enabled, no numeric budget cap (or a cap plus a next rung that emits token usage), and the subscription engine reporting quota-exhausted or rate-limited, **When** the next task is dispatched, **Then** Ira assigns a BYOK or local rung per policy and records the reason on the roster/event log.
2. **Given** every higher rung unhealthy and a healthy local pack that can emit token usage, **When** dispatch occurs, **Then** the task runs locally with the same persona and does not invent a new identity.
3. **Given** the next ladder rung would exceed the remaining agent or feature budget, **When** failover is considered, **Then** Ira does not silent-auto; it opens Ask-Me (or equivalent Command Plane escalation) instead.
4. **Given** a numeric agent or feature budget cap and a candidate rung that cannot emit token usage signals, **When** failover is considered, **Then** Ira does not auto-select that rung; `TokenHooks.beforeDispatch` denies or `EngineHooks.dispatch` returns `{ accepted: false }`, and no unmetered worker starts.

---

### User Story 5 - Cross-engine review as a policy option (Priority: P2)

The Operator can require that review run on a different engine than implementation (for example implement on Codex, review on Claude) so one vendor is not marking its own homework. The option is off by default.

**Why this priority**: High leverage for quality on mixed fleets; optional so single-engine shops still work.

**Independent Test**: Enable the policy with two healthy engines; complete an implement→review cycle and assert reviewer engine ≠ implementer engine. Disable the policy; a single-engine shop still reviews successfully.

**Acceptance Scenarios**:

1. **Given** cross-engine review policy **on** and two healthy engines, **When** a task reaches review, **Then** the reviewer is bound to a different engine than the implementer.
2. **Given** the policy **on** but only one healthy engine, **When** review is due, **Then** Ira either assigns that engine and records a policy-degraded event, or escalates — it does not hang silently.
3. **Given** the policy **off**, **When** implement and review run, **Then** both MAY share one engine and no extra engine is required.

---

### User Story 6 - Normalized lifecycle events in the hive log (Priority: P2)

Each engine adapter emits a common event vocabulary — start, tool, stop, error, tokens — so the hive activity stream and spend ledger do not speak twelve vendor dialects.

**Why this priority**: P-001’s append-only log and P-002’s activity view are useless without a normalized feed; adapters exist to hide CLI differences.

**Independent Test**: Run a short fixture session per installed engine (or a recorded adapter fixture); assert hive log entries use the shared event types and include agent, engine, and timestamp.

**Acceptance Scenarios**:

1. **Given** a worker session on any supported engine, **When** the session starts and later stops, **Then** the hive log contains normalized `start` and `stop` (or equivalent) events for that agent.
2. **Given** the engine reports a failure, **When** the adapter observes it, **Then** a normalized `error` event is appended with a non-secret reason class.
3. **Given** the engine reports token usage, **When** the session emits usage, **Then** a normalized `tokens` event is appended; **Given** the engine cannot report tokens, **When** the session ends, **Then** the adapter still emits start/stop and does not fabricate token counts.

---

### User Story 7 - Credential and subscription matrix (Priority: P3)

The Operator inspects a per-engine matrix of auth mode (subscription, BYOK, local, unknown) and health (ok, degraded, missing, unauthorized). Secrets never appear in the matrix, hive, or pattern store. Command Center may render the same payload later.

**Why this priority**: Visibility prevents surprise lock-in; not required to dispatch the first mixed-engine task.

**Independent Test**: Query the matrix via CLI/MCP with one subscription engine logged in, one missing CLI, and one local backend; verify modes/health and that the payload contains no key/token/password fields.

**Acceptance Scenarios**:

1. **Given** a mix of installed, missing, and unauthorized engines, **When** the Operator queries the credential matrix, **Then** every target engine appears with auth mode and health.
2. **Given** any engine’s native credential exists, **When** the matrix is serialized, **Then** the payload has no secret material (keys, tokens, cookies, refresh tokens).
3. **Given** Command Center is not running, **When** the Operator queries via CLI/MCP, **Then** the same matrix is available.

---

### User Story 8 - Keep host CLIs on the host and isolate every other child (Priority: P1)

When the Command Plane MCP server is attached to Claude Code, Codex, or Cursor Agent, that host engine stays a host fresh subagent. Ira returns `null` from dispatch and does not parent the CLI. Away and idle wake enqueue a durable intent. OpenCode, Crush, Aider, and custom run only as a detached supervisor process, and only after Slice A validates. The supervisor does not inherit operator credentials unless the rung is BYOK and the name is allowlisted.

**Why this priority**: Parenting a host CLI from IDE-attached MCP, or folding the supervisor into the MCP stdio process, takes down the editor session or leaks credentials. Production remediation is fail-closed on this path.

**Independent Test**: With MCP attached to one host engine, dispatch that engine and assert `null`, zero host children, and `delegateToHost` equal to that host. Dispatch away and assert the queue file and zero host children. After Slice A, dispatch OpenCode and assert a detached supervisor pid that is not the MCP pid, with a scrubbed env. Before Slice A, the same dispatch returns `SLICE_A_ONLY`.

**Acceptance Scenarios**:

1. **Given** the Command Plane MCP server is attached to `claude`, `codex`, or `cursor-agent`, **When** dispatch targets that host engine, **Then** `delegateToHost` is that host, `EngineHooks.dispatch` returns `null`, and no child with argv0 `claude`, `codex`, `cursor-agent`, or `agent` starts.
2. **Given** away or idle wake and a host engine, **When** dispatch runs, **Then** `<hiveRoot>/dispatch-queue/<featureId>/<taskId>.json` is written mode `0600` and no host CLI starts.
3. **Given** `delegateToHost` null, a matching `away.pid`, or a completed `engines hooks install`, **When** a host-engine spawn is attempted from the IDE-attached MCP process, **Then** the outcome is `HOST_SPAWN_FORBIDDEN` and no child starts.
4. **Given** Slice A is validated and the effective engine is `opencode`, `crush`, `aider`, or `custom`, **When** dispatch accepts, **Then** the child is a detached supervisor with its own pid, `shell: false`, and stdio that is not the MCP pipes, and the MCP server is not the parent.
5. **Given** Slice A is not validated, **When** dispatch targets `opencode`, `crush`, `aider`, or `custom`, **Then** the result is `SLICE_A_ONLY` and no child starts.
6. **Given** a supervisor spawn on a non-BYOK rung, **When** the child env is inspected, **Then** it is a new object limited to the base allowlist, and names matching `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, or `CREDENTIAL` are absent.

---

### Edge Cases

- What happens when advertised local context is unknown? Doctor MUST fail closed (treat as below 64k) until context is declared or probed by a documented method.
- What happens when failover would change engine mid-turn? System MUST NOT switch engines mid-turn; failover applies at the next dispatch / fresh-worker boundary.
- What happens when a custom command engine cannot emit tool or token events? Adapter MUST still emit start/stop/error; richer events are optional.
- What happens when two engines share one API key quota? Matrix and routing MUST treat health per engine identity; shared-quota coupling MAY be documented later and MUST NOT silently double-count as two healthy independent rungs without a policy note.
- What happens when the Operator binds a model the engine does not offer? Bind MUST fail with a list of acceptable models or tiers for that engine.
- What happens when all ladder rungs are unhealthy? Dispatch MUST stop, surface Ask-Me / Doctor, and MUST NOT invent an unregistered engine.
- What happens when a hire manifest (P-005) suggests an engine that is not installed? Bind/spawn review MUST flag it (P-005 already requires this); this spec MUST expose the detection signal they consume.
- What happens when an adapter process crashes? Command Plane MUST remain up; the worker is marked offline/error; other engines stay dispatchable. The crash MUST NOT be a child of the IDE-attached MCP server.
- What happens when the Command Plane MCP server is attached to Claude Code, Codex, or Cursor Agent? `delegateToHost` defaults to that host. `EngineHooks.dispatch` for that host engine returns `null`. Ira MUST NOT parent `claude`, `codex`, or `cursor-agent` from that process (FR-023).
- What happens when away or idle wake targets a host engine? Ira persists a durable `DispatchIntent` and starts no host CLI (FR-024).
- What happens when `delegateToHost` is null, `away.pid` matches this process, or `engines hooks install` has run? None of those authorize Ira to spawn a host CLI. The result is `HOST_SPAWN_FORBIDDEN` if a spawn is attempted, and no child starts (FR-023).
- What happens when the effective engine is OpenCode, Crush, Aider, or custom after Slice A validates? The child is a detached supervisor process with its own pid. It is not an in-process function of the stdio MCP server (FR-024, FR-025).
- What happens when a hook throws? The forge tool’s already-successful result stays success. The hook returns a deny and MUST NOT exit the MCP or CLI process (FR-025).
- What happens when supervisor environment construction would copy `process.env`? Credential-like variables are dropped unless the effective rung is `byok` and the name is on that engine’s `byokEnvAllowlist` (FR-026).
- What happens when Doctor is asked whether a linked worktree is a sandbox? `worktreeKind` and `sandboxed` stay independent. A linked worktree MUST NOT set `sandboxed` true (FR-019).
- What happens when local context is below 64k or unknown and the hive store is healthy? That local rung fails. `hiveReady` stays true. `engineRungReady` reflects whether any host-delegate target or other healthy rung remains (FR-006, FR-014).
- What happens before doctor reports `sliceAValidated: true`? Host engines still return `null` and may queue an intent. Detached spawn of OpenCode, Crush, Aider, or custom returns `SLICE_A_ONLY` and starts no child (FR-027).

## Clarifications

### Session 2026-10-16

Normative: `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md`. That file is LOCKED. If this spec disagrees with it, the amendment wins.

- Q: When the Command Plane MCP server is attached to Claude Code, Codex, or Cursor Agent, who spawns that host CLI, and what does `EngineHooks.dispatch` return? (OD-009 / FR-023) → A: Those engines (`claude`, `codex`, `cursor-agent`; input alias `cursor` maps to `cursor-agent`) are host engines. `delegateToHost` defaults to the attached host. `EngineHooks.dispatch` returns `null` and starts no process whose argv0 is `claude`, `codex`, `cursor-agent`, or `agent`. Ira MUST NOT parent those three from an IDE-attached MCP process. `delegateToHost: null`, an `away.pid` match, and `engines hooks install` MUST NOT authorize Ira-parent spawn. A spawn attempt returns `HOST_SPAWN_FORBIDDEN` and starts no child.
- Q: What may away, idle wake, and the detached supervisor start? (OD-009 / FR-024) → A: Away and idle wake for a host engine persist a durable `DispatchIntent` at `<hiveRoot>/dispatch-queue/<featureId>/<taskId>.json` (mode `0600`) and MUST NOT start `claude`, `codex`, or `cursor-agent`. A detached supervisor child is permitted only for `opencode`, `crush`, `aider`, and `custom`, and only after Slice A allows it. Any other id returns `{ accepted: false }` and starts no child.
- Q: Where does the non-host supervisor run, and what happens when a hook throws? (OD-015 / FR-025) → A: Non-host children run only in a detached supervisor process (own pid, `detached: true`, `shell: false`, stdio not the MCP stdio pipes, parent unref). The IDE-attached MCP server MUST NOT parent those children and MUST NOT run the supervisor in-process (`SUPERVISOR_IN_MCP_FORBIDDEN`). `registerCommandPlaneHooks` catches every hook exception. A throw becomes `{ allow: false }` or `{ accepted: false }` plus event `hook.failed` with reason `HOOK_FAILED_CLOSED`. It MUST NOT exit the process or fail an already-successful forge `saveState`.
- Q: What environment does the supervisor receive, and is a linked worktree a sandbox? (OD-019 / FR-019, FR-026) → A: Supervisor `env` is a new object, not `process.env`. Base allowlist is only `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `TMPDIR`, `TMP`, `TEMP`, `SystemRoot`, `ComSpec`, `PATHEXT`, `SHELL`, `SUPERSPEC_ROOT`, `SUPERSPEC_ENGINE_SESSION`, `SUPERSPEC_HIVE_ROOT`. A catalog `byokEnvAllowlist` name is copied only when the effective rung is `byok`. Every other variable whose name matches `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, or `CREDENTIAL` is dropped. Doctor `worktreeKind` (`main` or `linked`) and `sandboxed` are independent. `sandboxed: true` is legal only with an OS sandbox wrapper on that child. A linked worktree MUST NOT set `sandboxed` true (`WORKTREE_IS_NOT_SANDBOX`). Slice A has no sandbox wrapper, so `sandboxed` is `false`.
- Q: What is live before doctor reports `sliceAValidated`, and does a local 64k failure take down the hive? (OD-020, OD-014 / FR-006, FR-014, FR-027) → A: Until `sliceAValidated` is true, host-delegate (`null`, queued intent, no host-CLI spawn) is live. Detached spawn of `opencode`, `crush`, `aider`, and `custom` is a no-op `SLICE_A_ONLY` with no child. `sliceAValidated` is computed by doctor, not a hand-edited flag. Doctor returns `hiveReady` and `engineRungReady` separately. Local context below 64k or unknown fails that local rung only. An engine finding MUST NOT set `hiveReady` false. A legacy `ready` field, if emitted, equals `hiveReady`.

## Requirements *(mandatory)*

### Functional Requirements

#### Roster binding and detection

- **FR-001**: System MUST bind each roster entry to **persona + engine + model + budget + workspace/worktree** as a single inspectable record.
- **FR-002**: System MUST support this target engine set — Claude Code, Codex, Cursor Agent, OpenCode, Crush, Aider, and a custom command — and MUST detect which of those are installed. The input id `cursor` is an alias of `cursor-agent` and is a host engine.
- **FR-003**: System MUST allow **per-agent model assignment** so different roster entries MAY use different engines and models at the same time.

#### Portability and local pack

- **FR-004**: System SHOULD support **cross-engine review** as an Operator-configurable policy (default off) that prefers a reviewer engine different from the implementer engine.
- **FR-005**: When Claude/Cursor-class proprietary engines are unavailable, the **same SuperSpec personas and skills** MUST run on an OpenCode-class engine with a local or BYOK model backend.
- **FR-006**: The local OpenCode + Ollama path MUST enforce a **minimum advertised context of 64k tokens**. If the bound local model is below that floor or context is unknown, Doctor MUST fail **that local rung only**, with a concrete fix (raise context or choose another model). The finding sets `engineRungReady` false when no host-delegate target and no other healthy post-Slice-A rung remain. It MUST NOT set `hiveReady` false and MUST NOT mark a healthy host or other rung corrupt.
- **FR-007**: Local-pack model backends MUST include **Ollama, LM Studio, vLLM, and BYOK** as first-class options behind OpenCode-class engines.

#### Failover, credentials, events

- **FR-008**: System MUST apply a **failover ladder** of subscription-backed CLI → API/BYOK → local according to policy and engine health.
- **FR-009**: System MUST expose a **credential/subscription matrix** of per-engine auth mode and health via Command Plane (CLI/MCP); Command Center MAY render the same payload.
- **FR-010**: The engine adapter layer SHOULD normalize lifecycle events — **start, tool, stop, error, tokens** — into the hive append-only log.
- **FR-011**: Credentials MUST NOT be written to the hive, pattern store, roster dump, or matrix payload; the matrix shows mode and health only.
- **FR-012**: Failover for rate-limit, quota exhaustion, missing CLI, or auth/health failure MUST be **routine automation** within policy. A failover rung change MUST call `TokenHooks.beforeDispatch` again on the effective engine and model before spawn and before `{ accepted: true }`. When a **numeric** agent or feature budget cap is set, automatic failover MUST NOT select a rung that **cannot emit token usage signals**. If no signal-capable rung remains, dispatch MUST deny or return `{ accepted: false }` and MUST NOT substitute a silent unmetered dispatch (token governor, P-004). Failover MUST escalate (not silent-auto) when it would exceed budget or enter another critical HITL class. `{ allow: false }` MUST NOT spawn.
- **FR-013**: Failover and engine changes MUST take effect at **task/dispatch boundaries** (fresh worker), never mid-turn.

#### Doctor, routing, compatibility

- **FR-014**: Doctor MUST report missing target engines, per-engine auth health, and local-pack context below 64k (or unknown). Doctor MUST return `hiveReady` and `engineRungReady` as separate booleans. `hiveReady` is coordination-store health. `engineRungReady` is rung health: a host-delegate target, or, after Slice A validates, a healthy `opencode`, `crush`, `aider`, or `custom` rung. An engine finding, including `ENGINE_SPAWN_UNSUPPORTED`, `ENGINE_NONE_HEALTHY`, `LOCAL_CONTEXT_BELOW_FLOOR`, and `LOCAL_CONTEXT_UNKNOWN`, MUST NOT set `hiveReady` false. A legacy `ready` field, if emitted, MUST equal `hiveReady` and MUST NOT be the conjunction of the two booleans. Doctor MUST also emit `worktreeKind` (`main` or `linked`) and `sandboxed`.
- **FR-015**: Install/onboarding MUST detect installed CLIs and suggest available engines for roster/hire binding.
- **FR-016**: SuperSpec `route-model` economy / standard / frontier MUST remain the default tiering; Command Plane MAY override per agent assignment.
- **FR-017**: When quota or subscription signals are available, they MUST influence routing (prefer local or economy when quota is low).
- **FR-018**: Fresh subagent dispatch MUST remain the default worker execution model where the host engine supports it. For host engines, the host performs that fresh subagent because `EngineHooks.dispatch` returns `null` (FR-023). Ira does not parent the host CLI to obtain a fresh subagent.
- **FR-019**: Worktree isolation SHOULD be the default for spawned workers that write code. Doctor `worktreeKind` (`main` or `linked`) and `sandboxed` MUST be independent. `sandboxed: true` is legal only when that child was started under an OS sandbox wrapper. A linked worktree MUST NOT set `sandboxed` true. A check that sets `sandboxed` from `worktreeKind`, `workspace`, or `worktreePolicy` is finding `WORKTREE_IS_NOT_SANDBOX`, and the reported `sandboxed` value MUST be corrected to `false`. Slice A has no sandbox wrapper, so `sandboxed` is `false`.
- **FR-020**: The engine adapter catalog MUST be **versioned** and MUST accept a custom command engine (identity + spawn command; optional richer events).
- **FR-021**: Engine detection, roster binds, failover state, Doctor findings, and the credential matrix MUST be fully usable via CLI/MCP with Command Center absent.
- **FR-022**: Custom command engines MUST be bindable with identity and spawn command; when they cannot emit tool or token events, adapters MUST still emit start, stop, and error. A custom engine that cannot emit token usage signals MUST NOT be an automatic failover target while a numeric budget cap is set (FR-012).
- **FR-023**: Host engines are exactly `claude`, `codex`, and `cursor-agent`. When the Command Plane MCP server is attached to one of those hosts, `delegateToHost` MUST default to that host. `EngineHooks.dispatch` for a host engine MUST return `null` and MUST NOT spawn a process whose argv0 is `claude`, `codex`, `cursor-agent`, or `agent`. Ira MUST NOT parent a host engine from an IDE-attached MCP process. `delegateToHost: null`, an away pid match, or `engines hooks install` MUST NOT flip a host engine into Ira-parent spawn. A violation returns `HOST_SPAWN_FORBIDDEN` and starts no child. *(OD-009)*
- **FR-024**: Away and idle wake for a host engine MUST persist a durable `DispatchIntent` at `<hiveRoot>/dispatch-queue/<featureId>/<taskId>.json` (mode `0600`) and MUST NOT start `claude`, `codex`, or `cursor-agent`. A detached supervisor child is permitted only when the effective engine id is `opencode`, `crush`, `aider`, or `custom`, and only after Slice A allows it (FR-027). Any other id returns `{ accepted: false }` and starts no child. *(OD-009)*
- **FR-025**: Non-host engine children MUST run only inside a detached supervisor process with its own pid (`detached: true`, `shell: false`, stdio not the MCP stdio pipes, parent unref). The IDE-attached MCP server MUST NOT be the parent of those children and MUST NOT run the supervisor in-process. An in-process supervisor call from the MCP request handler is `SUPERVISOR_IN_MCP_FORBIDDEN`. `registerCommandPlaneHooks` MUST catch every hook exception. A throw becomes `{ allow: false }` or `{ accepted: false }` plus event `hook.failed` with reason `HOOK_FAILED_CLOSED`. A hook MUST NOT exit the process. An already-successful forge `saveState` result, stdout, and exit code stay success. *(OD-015)*
- **FR-026**: Supervisor `env` MUST be a new object, not a spread of `process.env`. The base allowlist is only `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `TMPDIR`, `TMP`, `TEMP`, `SystemRoot`, `ComSpec`, `PATHEXT`, `SHELL`, `SUPERSPEC_ROOT`, `SUPERSPEC_ENGINE_SESSION`, and `SUPERSPEC_HIVE_ROOT`. A catalog `byokEnvAllowlist` name is copied only when the effective rung is `byok`. Every other variable whose name matches `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, or `CREDENTIAL` MUST be dropped. *(OD-019)*
- **FR-027**: Until doctor reports `sliceAValidated: true`, the live P-006 surface is host-delegate only: `EngineHooks.dispatch` returns `null`, a host `DispatchIntent` may be queued, and no host CLI is spawned. Detached spawn of `opencode`, `crush`, `aider`, and `custom` MUST be a no-op that returns `{ ok: false, code: "SLICE_A_ONLY" }` and starts no child. `sliceAValidated` MUST be recomputed by doctor from the amendment’s four checks. A hand-edited flag MUST be ignored. *(OD-020)*

### FR Crosswalk (Parent IDs)

| FR | Parent ID(s) | Summary |
|----|--------------|---------|
| FR-001 | EN-001 | Roster bind persona + engine + model + budget + workspace |
| FR-002 | EN-002 | Target engine set + detect installed |
| FR-003 | EN-003 | Per-agent mixed model/engine assignment |
| FR-004 | EN-004 | Cross-engine review policy option |
| FR-005 | EN-005 | Same personas/skills on OpenCode-class + local/BYOK |
| FR-006 | EN-006, OD-014 | Local ≥64k; below/unknown fails that rung only |
| FR-007 | EN-005 | Ollama / LM Studio / vLLM / BYOK backends |
| FR-008 | EN-007 | Failover ladder subscription → BYOK → local |
| FR-009 | EN-008 | Credential/subscription matrix (API; UI in P-002) |
| FR-010 | EN-009 | Normalized lifecycle events → hive log |
| FR-011 | NFR-002 | No secrets in matrix/hive/patterns |
| FR-012 | EN-007, §5.3, OD-010 | Failover routine vs HITL; no unmetered rung when a numeric budget is set |
| FR-013 | EN-007, SS-004, OPEN-005 | Failover at dispatch boundary |
| FR-014 | DX-001, OD-014 | Doctor: `hiveReady` separate from `engineRungReady` |
| FR-015 | DX-002 | Onboarding detects CLIs |
| FR-016 | TK-008 | Keep route-model tiers; per-agent override |
| FR-017 | TK-009 | Quota signals influence routing |
| FR-018 | SS-004, OD-009 | Fresh subagent; host performs it via `null` dispatch |
| FR-019 | SS-005, OD-019 | Worktree isolation default; worktree is not a sandbox |
| FR-020 | EN-002, NFR-006 | Versioned adapters + custom command |
| FR-021 | CP-001, §7.2 | Option D — no UI-only engine state |
| FR-022 | EN-002, EN-009 | Custom engine sparse events; no unmetered failover |
| FR-023 | OD-009 | Host engines default to host; never parent from IDE MCP |
| FR-024 | OD-009 | Away queues host intent; supervisor only for four ids |
| FR-025 | OD-015 | Detached supervisor; hooks fail closed |
| FR-026 | OD-019 | Supervisor env scrub unless BYOK allowlist |
| FR-027 | OD-020 | Slice A: host-delegate live; non-host spawn is `SLICE_A_ONLY` |

**Explicitly deferred to sibling specs**: CP/GD/HV core hive (P-001); Command Center rendering of matrix/fleet (P-002); pattern retrieve/distill (P-003); budget ledger + circuit breaker enforcement (P-004 owns TK-001–TK-007); hire gallery/manifest review (P-005); Hermes/OpenClaw (P-007).

### Key Entities

- **EngineIdentity**: Stable id for a target engine (`claude`, `codex`, `cursor-agent`, `opencode`, `crush`, `aider`, `custom`) plus display name and install detection result. `cursor` is an input alias of `cursor-agent`. `claude`, `codex`, and `cursor-agent` are host engines. The other four ids are the only detached-supervisor engines.
- **EnginePreset**: Versioned adapter description — how to spawn, which models/tiers are valid, which lifecycle events the engine can emit. Adapted from Munder multi-engine presets.
- **RosterEngineBinding**: Roster fields this spec owns — engine, model (vendor id or abstract tier), budget reference, workspace/worktree policy — joined to persona (P-005) and hive status (P-001).
- **LocalPackProfile**: OpenCode-class engine plus backend (Ollama / LM Studio / vLLM / BYOK), advertised context length, and Doctor result for the 64k floor.
- **FailoverPolicy**: Ordered ladder (subscription → BYOK → local), enablement flag, and HITL exceptions (budget, destructive). A numeric budget excludes rungs that cannot emit token usage signals from automatic selection.
- **DispatchIntent**: Durable queue file for away and idle wake of a host engine. Path `<hiveRoot>/dispatch-queue/<featureId>/<taskId>.json`, mode `0600`. Not a spawn authorization for `claude`, `codex`, or `cursor-agent`.
- **CredentialMatrixRow**: Per-engine auth mode (`subscription` \| `byok` \| `local` \| `unknown`) and health (`ok` \| `degraded` \| `missing` \| `unauthorized`); no secret fields.
- **NormalizedEngineEvent**: Hive log record — `start` \| `tool` \| `stop` \| `error` \| `tokens` — with agent id, engine id, timestamp, optional token counts, non-secret error class.
- **CrossEngineReviewPolicy**: On/off setting that prefers reviewer engine ≠ implementer engine.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An Operator can detect installed engines and bind two mixed roster entries entirely via CLI/MCP in under 5 minutes on a reference machine with at least two target CLIs.
- **SC-002**: Doctor fails the local-pack context check in 100% of fixtures whose advertised context is below 64k or unknown, each failure names the 64k floor and a remediating action, and a healthy hive stays `hiveReady: true` (the failure is that rung only).
- **SC-003**: With failover enabled and the top ladder rung marked unhealthy, the next dispatch uses a healthier lower rung that can emit token usage when a numeric budget is set, within 30 seconds of the health update in local tests. A lower rung that cannot emit token usage is not auto-selected while that cap is set.
- **SC-004**: 100% of P1 acceptance scenarios pass with Command Center not installed or not running.
- **SC-005**: When cross-engine review is on and two engines are healthy, 100% of test review assignments use a different engine than the implementer.
- **SC-006**: Fixture sessions for each implemented adapter produce hive `start` and `stop` events; `error` when a failure is injected; `tokens` only when the engine actually reports usage.
- **SC-007**: Credential-matrix payloads in tests contain a row for every target engine and zero fields that match secret material (API keys, tokens, passwords).
- **SC-008**: After cloud engines are marked unavailable, a previously bound persona completes one mechanical task on the local pack without rewriting persona files.
- **SC-009**: Downstream specs can consume detection, binding, health, matrix, and normalized events without inventing a parallel engine catalog (platform integration unblocked).
- **SC-010**: In 100% of IDE-attached MCP fixtures for `claude`, `codex`, and `cursor-agent`, `EngineHooks.dispatch` returns `null`, `delegateToHost` is that host, and zero child processes with argv0 `claude`, `codex`, `cursor-agent`, or `agent` are started — including when `delegateToHost` is null, `away.pid` matches, or hooks were installed.
- **SC-011**: Away and idle-wake fixtures for a host engine write `dispatch-queue/<featureId>/<taskId>.json` at mode `0600` and start zero host CLIs. Non-host spawn fixtures, when Slice A allows them, show a detached supervisor pid that is not the MCP server pid and whose stdio is not the MCP pipes.
- **SC-012**: Supervisor env fixtures contain only the base allowlist plus, on a `byok` rung, `byokEnvAllowlist` names. Variables matching `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, or `CREDENTIAL` are absent unless that BYOK allowlist names them. Doctor fixtures report `worktreeKind: "linked"` with `sandboxed: false`.
- **SC-013**: Before `sliceAValidated` is true, 100% of `opencode`, `crush`, `aider`, and `custom` dispatch attempts return `SLICE_A_ONLY` and start zero children. Host-engine dispatch still returns `null` with no host CLI.

## Assumptions

- **Adapt Munder presets**: Per-engine spawn and event collection strategies start from Munder `AgentProviderPreset` (native hooks, shim, proxy, or type-in). Exact hook vs PTY vs ACP mapping is an architect decision per adapter (parent OPEN-005) and is **not** left open in this spec.
- **Omnigent / Aegis are URLs only**: Use them to explain *why* cross-engine review and native-protocol adapters matter. Do not add them as dependencies or copy their code.
- **Local path reference**: OpenCode + Ollama follows [Ollama’s OpenCode integration](https://docs.ollama.com/integrations/opencode), including the 64k+ context rule. LM Studio and vLLM are additional backends with the same floor.
- **Target set is Ira’s EN-002 list**, not Munder’s full twelve. Extra CLIs (Grok, Kimi, Copilot, pi.dev, …) MAY later register as custom or future presets; they are not v1 MUST.
- **Failover is next-task only**: Mid-turn engine swap is out of scope; it would break fresh-subagent semantics.
- **Unknown context fails that rung**: If the local runtime does not advertise context length, that local rung is non-compliant until declared. The hive coordination store is a separate doctor bit.
- **Host engines are not Ira’s children**: Claude Code, Codex, and Cursor Agent run in the attached host. Away queues an intent. OpenCode, Crush, Aider, and custom are the only detached-supervisor engines, and only after Slice A.
- **Numeric budget needs a token signal**: Automatic failover will not land on an engine that cannot emit token usage while an agent or feature budget cap is numeric. That rule matches the token governor (P-004).
- **Worktree is not a sandbox**: A linked worktree isolates git state. It is not evidence of an OS sandbox. Slice A reports `sandboxed: false`.
- **Cross-engine review default off**: Single-engine shops remain valid.
- **Secrets stay in native stores**: Claude/Codex/Cursor logins, env API keys, and local daemon endpoints are not imported into SuperSpec files.
- **Spend enforcement is P-004**: This spec emits token events and respects budget HITL on failover; it does not own the cost ledger or circuit breaker. It does refuse automatic failover onto a rung that cannot emit token usage when a numeric budget is set, and it re-invokes `TokenHooks.beforeDispatch` on the effective engine before spawn.
- **Hire review is P-005**: This spec exposes “is this engine installed?” and bind validation; it does not own gallery UX or untrusted-manifest parsing.
- **Matrix UI is P-002**: P-006 ships the queryable matrix; Command Center only renders it.
- **Single Operator v1**: Shared-team credential stores are out of scope.
- **Hermes / OpenClaw not required** (P-007 / INT-003).

<!-- Adapted from SK: templates/spec-template.md (MIT). See /NOTICE. -->
