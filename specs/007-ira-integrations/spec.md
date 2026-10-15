# Feature Specification: ira-integrations

**Feature Branch**: `007-ira-integrations`

**Created**: 2026-09-06

**Status**: Deferred

**Type**: platform

**Input**: Parent requirements INT-* (Hermes / OpenClaw nice-to-have) from `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md`

## Required Reading

| Path | Reason |
|------|--------|
| `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md` §6.8 | INT-* source |
| `docs/superspec/specs/ira-prior-art-reuse-map.md` | Reuse map |
| https://github.com/NousResearch/hermes-agent | Optional Hermes adapter |
| https://docs.openclaw.ai | Optional OpenClaw gateway |
| `specs/001-ira-command-plane/spec.md` | Command Plane must work without these |

## Deferred scope

This workstream is **intentionally deferred**. Ira MUST operate fully without Hermes or OpenClaw (INT-003).

When activated, formalize:

| Parent ID | Intent |
|-----------|--------|
| INT-001 | Optional OpenClaw adapter for CLI backends + channel→Ask-Me |
| INT-002 | Optional Hermes as always-on Ira front-door via SuperSpec MCP |
| INT-003 | No hard dependency (already satisfied by deferral) |
| INT-004 | Optional Slack/Telegram/phone approve |
| INT-005 | Optional shareable board URL |

## Prior Art / Reuse

- OpenClaw gateway protocol and CLI backends docs
- Hermes Agent MCP client/server + messaging bridge
- Sentient-OS / CrewHub as examples of attaching dashboards to these gateways — do not vendor their UIs

## User Scenarios & Testing

### User Story 1 - Standalone Ira without integrations (Priority: P1)

Operator runs Ira Command Plane and Command Center with zero Hermes/OpenClaw install.

**Why this priority**: Hard requirement INT-003.

**Independent Test**: Fresh machine with SuperSpec + one coding CLI only; all P1 Ira flows work.

**Acceptance Scenarios**:

1. **Given** Hermes and OpenClaw are not installed, **When** Operator starts Ira, **Then** Doctor does not fail; core features remain available.
2. **Given** integrations are later enabled, **When** adapters are misconfigured, **Then** Ira degrades gracefully to standalone mode.

### Edge Cases

- Adapter process crash must not take down Command Plane.
- Untrusted channel messages must not auto-spawn hires or raise budgets.

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide full Ira Command Plane capability without Hermes or OpenClaw installed.
- **FR-002**: System MAY later expose optional adapters for OpenClaw and Hermes; adapters MUST be disable-able.
- **FR-003**: Optional adapters MUST NOT expand autonomy past Ira HITL critical class without Operator consent.

### Key Entities

- **IntegrationAdapter**: optional bridge config + health

### Success Criteria

- **SC-001**: 100% of P1 acceptance scenarios for standalone Ira pass with integrations absent.
- **SC-002**: Enabling a broken adapter leaves core Ira operable.

### Assumptions

- Formal FR expansion for INT-001/002/004/005 happens when this row moves from `deferred` to `scope` in `program.md`.
