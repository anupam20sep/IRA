# Feature Specification: ira-integrations

**Feature Branch**: `007-ira-integrations`

**Created**: 2026-09-06

**Updated**: 2026-10-17

**Status**: Active (activated from deferred)

**Type**: platform

**Input**: Parent requirements INT-* (Hermes / OpenClaw nice-to-have) from `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md` §6.8

## Required Reading

| Path | Reason |
|------|--------|
| `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md` §6.8 | INT-* source |
| `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` | OD-017 loopback auth; HITL; no engine spawn from channels |
| `specs/001-ira-command-plane/spec.md` | Command Plane must work without these |
| `specs/002-ira-command-center/spec.md` | Board share interacts with loopback auth |
| `specs/005-ira-hire-gallery/spec.md` | Untrusted channel MUST NOT auto-spawn hires (OD-018) |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Standalone Ira without integrations (Priority: P1)

Operator runs Ira Command Plane and Command Center with zero Hermes/OpenClaw/Slack adapters installed.

**Why this priority**: Hard requirement INT-003 / FR-001.

**Independent Test**: Fresh machine with SuperSpec + one coding CLI only; doctor and core flows work.

**Acceptance Scenarios**:

1. **Given** Hermes, OpenClaw, and channel adapters are not installed, **When** Operator runs doctor, **Then** hiveReady is not cleared solely because integrations are absent; findings for missing adapters are informational or absent.
2. **Given** integrations packages are present but disabled in config, **When** Operator starts CLI/MCP, **Then** no adapter process is spawned and core tools remain available.

---

### User Story 2 - Optional OpenClaw adapter (Priority: P2)

Operator enables OpenClaw to bridge CLI backends and map channel messages into Ask-Me.

**Why this priority**: INT-001 primary optional gateway.

**Independent Test**: With OpenClaw disabled by default; enable in config; inject a channel message fixture → Ask-Me item appears; no hire spawn.

**Acceptance Scenarios**:

1. **Given** OpenClaw adapter is enabled and healthy, **When** a channel approval request arrives, **Then** an Ask-Me item is created with reasonClass from the channel bridge (never auto-dispatches).
2. **Given** OpenClaw adapter process crashes, **When** Command Plane continues, **Then** MCP/CLI remain up and doctor reports adapter unhealthy without clearing hiveReady.

---

### User Story 3 - Optional Hermes front-door (Priority: P2)

Operator enables Hermes as an always-on messaging front-door that calls SuperSpec MCP.

**Why this priority**: INT-002.

**Independent Test**: Hermes adapter disabled by default; enable; Hermes MCP client config validates; misconfig degrades to standalone.

**Acceptance Scenarios**:

1. **Given** Hermes is not installed, **When** Hermes adapter is enabled in config, **Then** doctor reports adapter unavailable; Ira core stays operable.
2. **Given** Hermes adapter is enabled and reachable, **When** Hermes invokes SuperSpec MCP tools, **Then** tools execute under the same HITL gates as direct MCP (no autonomy expansion).

---

### User Story 4 - Channel approve for Ask-Me (Priority: P3)

Operator answers Ask-Me items from Slack/Telegram/phone via an optional channel bridge.

**Why this priority**: INT-004.

**Independent Test**: Bridge posts an answer mapped to `ask-me-answer`; critical actions still require explicit Operator consent classes.

**Acceptance Scenarios**:

1. **Given** a pending Ask-Me item and channel approve enabled, **When** Operator sends approve/deny via the bridge, **Then** `ask-me-answer` is invoked with the mapped action and no budget/hire spawn side effects beyond Ask-Me resolution rules.
2. **Given** channel message lacks authentication for the configured bridge, **When** the message arrives, **Then** it is rejected and no Ask-Me mutation occurs.

---

### User Story 5 - Shareable board link (Priority: P3)

Operator generates a shareable read-oriented board URL for teammates without disabling local mutation auth.

**Why this priority**: INT-005 / OPEN-007 still open for multi-user write auth.

**Independent Test**: Share token grants read-only snapshot access; mutations still require loopback bearer.

**Acceptance Scenarios**:

1. **Given** Operator enables share mode, **When** a share URL is generated, **Then** GET snapshot endpoints accept the share token and never return the loopback mutation token.
2. **Given** a client holds only a share token, **When** it attempts a mutating board POST, **Then** the request is refused (`401` / `SHARE_READ_ONLY`).

---

### Edge Cases

- Adapter process crash must not take down Command Plane or MCP stdio.
- Untrusted channel messages must not auto-spawn hires, raise budgets, or call `hire-spawn-confirm`.
- Enabling a broken adapter leaves core Ira operable (SC-002).
- Share mode must not bind board to non-loopback for mutations (OD-017 preserved).

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide full Ira Command Plane capability without Hermes, OpenClaw, or channel adapters installed or enabled.
- **FR-002**: System MUST expose a disable-able integration registry; every adapter defaults to **disabled**.
- **FR-003**: Optional adapters MUST NOT expand autonomy past Ira HITL critical class without Operator consent (no auto hire spawn, no auto budget raise).
- **FR-004**: System MUST provide an optional OpenClaw adapter that can map channel messages to Ask-Me create/list flows and MUST NOT Ira-parent host CLIs (`claude`/`codex`/`cursor-agent`).
- **FR-005**: System MUST provide an optional Hermes adapter configuration that fronts SuperSpec MCP; absence or failure MUST degrade to standalone without clearing `hiveReady`.
- **FR-006**: System MUST provide an optional channel-approve bridge (Slack/Telegram/phone) that maps authenticated Operator replies to `ask-me-answer` only.
- **FR-007**: System MUST provide optional shareable board read access via a share token distinct from the loopback mutation bearer; mutating routes MUST reject share tokens.
- **FR-008**: Doctor MUST report adapter health separately from `hiveReady` / `engineRungReady` (informational or warning severity only for missing optional adapters).
- **FR-009**: Adapter crashes or throws MUST be fail-closed for that adapter only; Command Plane hooks and forge MUST continue.

### Key Entities

- **IntegrationAdapter**: id, kind (`openclaw`|`hermes`|`channel_approve`|`board_share`), enabled, health, config path
- **IntegrationRegistry**: list of adapters + enable flags under `.superspec/hive/integrations/`
- **ShareToken**: opaque token for read-only board access (never the loopback mutation token)
- **ChannelApproveMapping**: external message id → Ask-Me item id + allowed actions

### Success Criteria

- **SC-001**: 100% of P1 acceptance scenarios for standalone Ira pass with integrations absent or disabled.
- **SC-002**: Enabling a broken or missing adapter leaves core Ira operable (`hiveReady` unchanged by adapter absence).
- **SC-003**: No test path from channel message → `hire-spawn-confirm` or budget mutation without an explicit Ask-Me resolution that already authorizes that action.
- **SC-004**: Share token cannot successfully call a mutating board route in automated tests.

### Assumptions

- Adapter depth is MVP stubs + contracts (OPEN-006): live OpenClaw/Hermes process supervision is out of scope beyond health probe and message→Ask-Me mapping interfaces.
- Multi-user write auth remains OPEN-007; INT-005 is read-only share only.
- Channel approve supports a generic webhook/fixture first; vendor Slack/Telegram SDKs are optional later packages.
- Config lives under `.superspec/hive/integrations/config.json` (gitignored with hive); no secrets in events.
