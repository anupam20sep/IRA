# Feature Specification: ira-engine-adapters

**Feature Branch**: `006-ira-engine-adapters`

**Created**: 2026-09-06

**Status**: Draft

**Type**: platform

**Input**: P-006 — Multi-CLI roster binding, per-agent model assignment, cross-engine review, OpenCode + local-model pack (≥64k), failover ladder (subscription → BYOK → local), credential/subscription matrix, and normalized engine lifecycle events. Parent EN-* from `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md`.

## Required Reading

| Path | Reason |
|------|--------|
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

**Independent Test**: Mark cloud engines unavailable, bind a known persona to OpenCode + a local model, run Doctor against a <64k fixture (must fail) and a ≥64k fixture (must pass), then complete one mechanical task with the same persona identity.

**Acceptance Scenarios**:

1. **Given** Claude/Cursor-class engines unavailable and OpenCode plus a local backend installed, **When** Ira staffs a mechanical task, **Then** the same persona files and skills are used with only the engine/model fields changed.
2. **Given** a local model whose advertised context is below 64k, **When** Doctor or local-pack validation runs, **Then** the check fails and names the model plus the 64k minimum and how to raise context or switch models.
3. **Given** a local model whose advertised context is 64k or higher, **When** Doctor runs, **Then** the local-pack context check passes and dispatch is allowed under policy.

---

### User Story 4 - Failover down the subscription → BYOK → local ladder (Priority: P2)

When the preferred engine is unhealthy (rate-limited, quota exhausted, missing, or auth failed), Ira moves the **next** dispatch down a configured ladder: subscription-backed CLI → API/BYOK → local, without Operator micro-management — unless the move would hit a critical HITL class (budget exceed, destructive work).

**Why this priority**: Keeps the floor moving when quotas die; depends on P1 bind + local pack being real.

**Independent Test**: Seed a roster with a subscription engine marked unhealthy and a healthy next-rung engine; dispatch the next ready task and verify the assignee’s effective engine is the next rung, with a hive event recording the failover reason.

**Acceptance Scenarios**:

1. **Given** failover policy enabled and the subscription engine reporting quota-exhausted or rate-limited, **When** the next task is dispatched, **Then** Ira assigns a BYOK or local rung per policy and records the reason on the roster/event log.
2. **Given** every higher rung unhealthy and a healthy local pack, **When** dispatch occurs, **Then** the task runs locally with the same persona and does not invent a new identity.
3. **Given** the next ladder rung would exceed the remaining agent or feature budget, **When** failover is considered, **Then** Ira does not silent-auto; it opens Ask-Me (or equivalent Command Plane escalation) instead.

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

### Edge Cases

- What happens when advertised local context is unknown? Doctor MUST fail closed (treat as below 64k) until context is declared or probed by a documented method.
- What happens when failover would change engine mid-turn? System MUST NOT switch engines mid-turn; failover applies at the next dispatch / fresh-worker boundary.
- What happens when a custom command engine cannot emit tool or token events? Adapter MUST still emit start/stop/error; richer events are optional.
- What happens when two engines share one API key quota? Matrix and routing MUST treat health per engine identity; shared-quota coupling MAY be documented later and MUST NOT silently double-count as two healthy independent rungs without a policy note.
- What happens when the Operator binds a model the engine does not offer? Bind MUST fail with a list of acceptable models or tiers for that engine.
- What happens when all ladder rungs are unhealthy? Dispatch MUST stop, surface Ask-Me / Doctor, and MUST NOT invent an unregistered engine.
- What happens when a hire manifest (P-005) suggests an engine that is not installed? Bind/spawn review MUST flag it (P-005 already requires this); this spec MUST expose the detection signal they consume.
- What happens when an adapter process crashes? Command Plane MUST remain up; the worker is marked offline/error; other engines stay dispatchable.

## Requirements *(mandatory)*

### Functional Requirements

#### Roster binding and detection

- **FR-001**: System MUST bind each roster entry to **persona + engine + model + budget + workspace/worktree** as a single inspectable record.
- **FR-002**: System MUST support this target engine set — Claude Code, Codex, Cursor Agent, OpenCode, Crush, Aider, and a custom command — and MUST detect which of those are installed.
- **FR-003**: System MUST allow **per-agent model assignment** so different roster entries MAY use different engines and models at the same time.

#### Portability and local pack

- **FR-004**: System SHOULD support **cross-engine review** as an Operator-configurable policy (default off) that prefers a reviewer engine different from the implementer engine.
- **FR-005**: When Claude/Cursor-class proprietary engines are unavailable, the **same SuperSpec personas and skills** MUST run on an OpenCode-class engine with a local or BYOK model backend.
- **FR-006**: The local OpenCode + Ollama path MUST enforce a **minimum advertised context of 64k tokens**; if the bound local model is below that floor or context is unknown, Doctor MUST fail with a concrete fix (raise context or choose another model).
- **FR-007**: Local-pack model backends MUST include **Ollama, LM Studio, vLLM, and BYOK** as first-class options behind OpenCode-class engines.

#### Failover, credentials, events

- **FR-008**: System MUST apply a **failover ladder** of subscription-backed CLI → API/BYOK → local according to policy and engine health.
- **FR-009**: System MUST expose a **credential/subscription matrix** of per-engine auth mode and health via Command Plane (CLI/MCP); Command Center MAY render the same payload.
- **FR-010**: The engine adapter layer SHOULD normalize lifecycle events — **start, tool, stop, error, tokens** — into the hive append-only log.
- **FR-011**: Credentials MUST NOT be written to the hive, pattern store, roster dump, or matrix payload; the matrix shows mode and health only.
- **FR-012**: Failover for rate-limit, quota exhaustion, missing CLI, or auth/health failure MUST be **routine automation** within policy; failover MUST escalate (not silent-auto) when it would exceed budget or enter another critical HITL class.
- **FR-013**: Failover and engine changes MUST take effect at **task/dispatch boundaries** (fresh worker), never mid-turn.

#### Doctor, routing, compatibility

- **FR-014**: Doctor MUST report missing target engines, per-engine auth health, and local-pack context below 64k (or unknown).
- **FR-015**: Install/onboarding MUST detect installed CLIs and suggest available engines for roster/hire binding.
- **FR-016**: SuperSpec `route-model` economy / standard / frontier MUST remain the default tiering; Command Plane MAY override per agent assignment.
- **FR-017**: When quota or subscription signals are available, they MUST influence routing (prefer local or economy when quota is low).
- **FR-018**: Fresh subagent dispatch MUST remain the default worker execution model where the host engine supports it.
- **FR-019**: Worktree isolation SHOULD be the default for spawned workers that write code.
- **FR-020**: The engine adapter catalog MUST be **versioned** and MUST accept a custom command engine (identity + spawn command; optional richer events).
- **FR-021**: Engine detection, roster binds, failover state, Doctor findings, and the credential matrix MUST be fully usable via CLI/MCP with Command Center absent.
- **FR-022**: Custom command engines MUST be bindable with identity and spawn command; when they cannot emit tool or token events, adapters MUST still emit start, stop, and error.

### FR Crosswalk (Parent IDs)

| FR | Parent ID(s) | Summary |
|----|--------------|---------|
| FR-001 | EN-001 | Roster bind persona + engine + model + budget + workspace |
| FR-002 | EN-002 | Target engine set + detect installed |
| FR-003 | EN-003 | Per-agent mixed model/engine assignment |
| FR-004 | EN-004 | Cross-engine review policy option |
| FR-005 | EN-005 | Same personas/skills on OpenCode-class + local/BYOK |
| FR-006 | EN-006 | Local OpenCode+Ollama ≥64k or Doctor fail |
| FR-007 | EN-005 | Ollama / LM Studio / vLLM / BYOK backends |
| FR-008 | EN-007 | Failover ladder subscription → BYOK → local |
| FR-009 | EN-008 | Credential/subscription matrix (API; UI in P-002) |
| FR-010 | EN-009 | Normalized lifecycle events → hive log |
| FR-011 | NFR-002 | No secrets in matrix/hive/patterns |
| FR-012 | EN-007, §5.3 | Failover routine vs HITL |
| FR-013 | EN-007, SS-004, OPEN-005 | Failover at dispatch boundary |
| FR-014 | DX-001 (engine slice) | Doctor: engines, auth, Ollama context |
| FR-015 | DX-002 | Onboarding detects CLIs |
| FR-016 | TK-008 | Keep route-model tiers; per-agent override |
| FR-017 | TK-009 | Quota signals influence routing |
| FR-018 | SS-004 | Fresh subagent dispatch |
| FR-019 | SS-005 | Worktree isolation default |
| FR-020 | EN-002, NFR-006 | Versioned adapters + custom command |
| FR-021 | CP-001, §7.2 | Option D — no UI-only engine state |
| FR-022 | EN-002, EN-009 | Custom engine sparse events |

**Explicitly deferred to sibling specs**: CP/GD/HV core hive (P-001); Command Center rendering of matrix/fleet (P-002); pattern retrieve/distill (P-003); budget ledger + circuit breaker enforcement (P-004 owns TK-001–TK-007); hire gallery/manifest review (P-005); Hermes/OpenClaw (P-007).

### Key Entities

- **EngineIdentity**: Stable id for a target engine (`claude`, `codex`, `cursor-agent`, `opencode`, `crush`, `aider`, `custom`) plus display name and install detection result.
- **EnginePreset**: Versioned adapter description — how to spawn, which models/tiers are valid, which lifecycle events the engine can emit. Adapted from Munder multi-engine presets.
- **RosterEngineBinding**: Roster fields this spec owns — engine, model (vendor id or abstract tier), budget reference, workspace/worktree policy — joined to persona (P-005) and hive status (P-001).
- **LocalPackProfile**: OpenCode-class engine plus backend (Ollama / LM Studio / vLLM / BYOK), advertised context length, and Doctor result for the 64k floor.
- **FailoverPolicy**: Ordered ladder (subscription → BYOK → local), enablement flag, and HITL exceptions (budget, destructive).
- **CredentialMatrixRow**: Per-engine auth mode (`subscription` \| `byok` \| `local` \| `unknown`) and health (`ok` \| `degraded` \| `missing` \| `unauthorized`); no secret fields.
- **NormalizedEngineEvent**: Hive log record — `start` \| `tool` \| `stop` \| `error` \| `tokens` — with agent id, engine id, timestamp, optional token counts, non-secret error class.
- **CrossEngineReviewPolicy**: On/off setting that prefers reviewer engine ≠ implementer engine.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An Operator can detect installed engines and bind two mixed roster entries entirely via CLI/MCP in under 5 minutes on a reference machine with at least two target CLIs.
- **SC-002**: Doctor fails the local-pack context check in 100% of fixtures whose advertised context is below 64k or unknown, and each failure names the 64k floor and a remediating action.
- **SC-003**: With failover enabled and the top ladder rung marked unhealthy, the next dispatch uses a healthier lower rung within 30 seconds of the health update in local tests.
- **SC-004**: 100% of P1 acceptance scenarios pass with Command Center not installed or not running.
- **SC-005**: When cross-engine review is on and two engines are healthy, 100% of test review assignments use a different engine than the implementer.
- **SC-006**: Fixture sessions for each implemented adapter produce hive `start` and `stop` events; `error` when a failure is injected; `tokens` only when the engine actually reports usage.
- **SC-007**: Credential-matrix payloads in tests contain a row for every target engine and zero fields that match secret material (API keys, tokens, passwords).
- **SC-008**: After cloud engines are marked unavailable, a previously bound persona completes one mechanical task on the local pack without rewriting persona files.
- **SC-009**: Downstream specs can consume detection, binding, health, matrix, and normalized events without inventing a parallel engine catalog (platform integration unblocked).

## Assumptions

- **Adapt Munder presets**: Per-engine spawn and event collection strategies start from Munder `AgentProviderPreset` (native hooks, shim, proxy, or type-in). Exact hook vs PTY vs ACP mapping is an architect decision per adapter (parent OPEN-005) and is **not** left open in this spec.
- **Omnigent / Aegis are URLs only**: Use them to explain *why* cross-engine review and native-protocol adapters matter. Do not add them as dependencies or copy their code.
- **Local path reference**: OpenCode + Ollama follows [Ollama’s OpenCode integration](https://docs.ollama.com/integrations/opencode), including the 64k+ context rule. LM Studio and vLLM are additional backends with the same floor.
- **Target set is Ira’s EN-002 list**, not Munder’s full twelve. Extra CLIs (Grok, Kimi, Copilot, pi.dev, …) MAY later register as custom or future presets; they are not v1 MUST.
- **Failover is next-task only**: Mid-turn engine swap is out of scope; it would break fresh-subagent semantics.
- **Unknown context fails closed**: If the local runtime does not advertise context length, treat as non-compliant until declared.
- **Cross-engine review default off**: Single-engine shops remain valid.
- **Secrets stay in native stores**: Claude/Codex/Cursor logins, env API keys, and local daemon endpoints are not imported into SuperSpec files.
- **Spend enforcement is P-004**: This spec emits token events and respects budget HITL on failover; it does not own the cost ledger or circuit breaker.
- **Hire review is P-005**: This spec exposes “is this engine installed?” and bind validation; it does not own gallery UX or untrusted-manifest parsing.
- **Matrix UI is P-002**: P-006 ships the queryable matrix; Command Center only renders it.
- **Single Operator v1**: Shared-team credential stores are out of scope.
- **Hermes / OpenClaw not required** (P-007 / INT-003).

<!-- Adapted from SK: templates/spec-template.md (MIT). See /NOTICE. -->
