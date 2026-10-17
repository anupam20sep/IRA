# Design: ira-integrations

**Feature**: `007-ira-integrations`  
**Date**: 2026-10-17  
**Status**: Ready for plan

## Summary

Optional, disabled-by-default adapters for OpenClaw, Hermes, channel approve, and read-only board share. Core Ira (P-001–P-006) MUST run with zero adapters. Adapter failures never clear `hiveReady`.

## Technical Context

| Item | Choice |
|------|--------|
| Language | TypeScript 5, Node ≥ 20, ESM |
| Location | `packages/core/src/integrations/` (+ thin CLI/MCP registration) |
| Storage | `.superspec/hive/integrations/config.json` (mode 0600 dir with hive) |
| Testing | Vitest under `packages/core/test/integrations/` |
| Platform | CLI + MCP; Command Center share routes optional hook |
| Constraints | No new mandatory npm deps; no `shell: true`; OD-017 loopback mutations preserved |

## Architecture

```
CLI / MCP bootstrap
        │
        ▼
 registerIntegrations(config)   # no-op when all disabled
        │
        ├── OpenClawAdapter (FR-004) ──► Ask-Me create (channel msg)
        ├── HermesAdapter (FR-005) ────► health + MCP front-door notes
        ├── ChannelApproveBridge (FR-006) ► ask-me-answer only
        └── BoardShare (FR-007) ───────► share token verify (read-only)
        │
 Doctor ◄── IntegrationFindings (FR-008)  # never clears hiveReady
```

Host engine spawn remains P-006 / OD-009. Channels never call `hire-spawn-confirm`.

## Decisions

### D1: Registry in core, not separate package (MVP)

**Problem**: Optional adapters vs install friction.  
**Decision**: Implement MVP contracts inside `packages/core/src/integrations/` with enable flags. Future vendor SDKs MAY move to `packages/integrations-*` without changing the registry interface.  
**Alternatives**: Separate npm packages now (rejected — empty packages add CI noise).

### D2: Fail-closed per adapter (OD-015 style)

**Problem**: Adapter throw must not kill MCP.  
**Decision**: All adapter entrypoints wrapped like command-plane `failClosed`; registry catches and records `integration.failed` event optional; doctor warning only.

### D3: Share token ≠ loopback token (OD-017 / OPEN-007)

**Problem**: INT-005 vs loopback-only mutations.  
**Decision**: Share token authorizes read-only snapshot APIs only. Mutating board routes continue to require loopback bearer; share token → `SHARE_READ_ONLY`.

### D4: Channel → Ask-Me only

**Problem**: Untrusted channel spam.  
**Decision**: OpenClaw/channel paths may create Ask-Me items or answer existing ones; they MUST NOT call dispatch-task, hire-spawn-confirm, or budget setters.

## Data Model

### IntegrationConfig

```ts
{
  schemaVersion: 1,
  adapters: {
    openclaw: { enabled: false, gatewayUrl?: string },
    hermes: { enabled: false, mcpEndpoint?: string },
    channelApprove: { enabled: false, sharedSecretEnv: string },
    boardShare: { enabled: false }
  }
}
```

Defaults: all `enabled: false`. Missing file ≡ all disabled.

### ShareTokenRecord

`{ id, hash, createdAt, expiresAt, scope: "board_read" }` stored under `integrations/share-tokens.json` (hashes only).

## Contracts

```ts
interface IntegrationAdapter {
  readonly id: "openclaw" | "hermes" | "channel_approve" | "board_share";
  isEnabled(): boolean;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

function loadIntegrationConfig(hiveRoot: string): Promise<IntegrationConfig>;
function registerIntegrations(hiveRoot: string): Promise<void>;
function integrationDoctorFindings(hiveRoot: string): Promise<DoctorFinding[]>;

/** OpenClaw / channel inbound */
function handleChannelInbound(msg: ChannelMessage): Promise<{ askMeId?: string } | { rejected: string }>;

/** Channel approve → ask-me-answer only */
function handleChannelApprove(input: { itemId: string; action: string; secret: string }): Promise<unknown>;

/** Board share */
function createShareToken(hiveRoot: string): Promise<{ token: string; expiresAt: string }>;
function verifyShareToken(hiveRoot: string, token: string): Promise<{ ok: true; scope: "board_read" } | { ok: false }>;
```

CLI: `superspec integrations status|enable|disable|share-create`  
MCP: `integrations-status`, `integrations-share-create` (optional)

## Traceability

| FR | Module |
|----|--------|
| FR-001, FR-002 | config defaults + bootstrap skip |
| FR-003, FR-009 | fail-closed wrappers + deny list on channel paths |
| FR-004 | openclaw.ts |
| FR-005 | hermes.ts |
| FR-006 | channel-approve.ts |
| FR-007 | board-share.ts |
| FR-008 | doctor findings injection |
