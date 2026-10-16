# Design: Ira Hire Gallery

**Revision**: 2026-10-15 | **Status**: DRAFT | **Owner**: @composer

**Input**: Feature specification from `specs/005-ira-hire-gallery/spec.md`

## Required Reading / Prior Art

| Path | Reason |
|------|--------|
| `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` | LOCKED OD-018 (hire acknowledge vs confirm, warning copy), OD-020 (Slice A `hire-spawn-confirm` gate), OD-017 (loopback mutation auth for board hire controls) |

`docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` is LOCKED. If this design disagrees with that amendment, the amendment wins.

## Summary

P-005 implements the **hire gallery** path for Ira: versioned hire manifests, a curated catalog index, and a single **sanitize → review → confirm → spawn** pipeline for file import, remote URL, paste, and gallery selection. No worker starts until the Operator explicitly confirms on the review form (FR-003, SC-002). Network and shared content is **untrusted**; curated catalog entries use the **same** validation, sanitization report, Ask-Me `untrusted_import` gate, warning banner, and confirmation step as remote manifests. The only permitted UI difference is an optional **`trustHint`** label (e.g. curated catalog); it MUST NOT replace or shorten the warning banner (FR-013, OD-018). Persona and roster writes happen only in **`hire-spawn-confirm`**; Ask-Me **`acknowledge`** on `untrusted_import` cancels the review (OD-018).

## Production invariants

Fail-closed: violated gates return non-zero / `ok: false`, write no partial persona or roster effect, and do not substitute a nearby success path.

| Invariant | Fail-closed behavior | Source |
|-----------|------------------------|--------|
| Spawn writer | Only `hire-spawn-confirm` writes persona files and upserts `origin: "hire"` roster rows. Any other confirm path returns `HIRE_SPAWN_CONFIRM_REQUIRED`. | OD-018 |
| Acknowledge cancels | `ask-me-answer` with `action: "acknowledge"` and `reasonClass: "untrusted_import"` sets review `cancelled`, resolves Ask-Me, writes no persona/roster, returns payload code `HIRE_ACK_CANCELS`. | OD-018 |
| Warning copy | `uiCopy.trustBanner` MUST equal `Untrusted import — review all fields before spawn.` for every `sourceKind` including `gallery`. `approvalCopyVariant: "curated_catalog"` MUST NOT change that string. `trustHint` MAY be a separate label field. Any other banner text → `HIRE_WARNING_LENGTH_MISMATCH`; `hire-spawn-confirm` MUST NOT run. | OD-018 |
| Sanitization parity | Curated and remote imports produce the same sanitization report shape and detail; curated MUST NOT skip fields or abbreviate the report. | OD-008, FR-013 |
| Slice A | Until doctor `sliceAValidated: true`, `hire-spawn-confirm` returns `{ ok: false, code: "SLICE_A_ONLY" }` with no persona or roster write. Import, review, and cancel remain live. | OD-020 |
| Hook boundary | `onUntrustedImport` and hire hook throws become deny results per OD-015; they MUST NOT exit the MCP/CLI process or roll back unrelated forge state. | OD-015 |
| Board mutations | Command Center hire confirm/cancel/update routed through the loopback bridge require OD-017 `Authorization: Bearer` on mutating HTTP methods. | OD-017 |

Implementation extends `@superspec-dev/core` beside the Command Plane modules defined in `specs/001-ira-command-plane/design.md`. P-005 registers **`HireHooks`** (`matchCapabilities`, `onUntrustedImport`), adds hire CLI/MCP tools (FR-009), writes **`RosterAgent`** rows with `origin: "hire"` into `roster.json`, installs portable persona files discoverable by existing **`list-personas`**, and persists optional **hire scores** for demotion hints. Prior art adapts Munder Difflin hire parse/review patterns in spirit; schemas and paths follow SuperSpec and the hive contract.

## Technical Context

**Language/Version**: TypeScript 5.5, Node.js >= 20, ESM (`"type": "module"`), NodeNext. Same as `@superspec-dev/core` 0.2.x and P-001.

**Primary Dependencies**: Existing core stack only: `zod`, `@modelcontextprotocol/sdk`, `@superspec-dev/render` (frontmatter for persona files), Command Plane modules from P-001 (`store`, `paths`, `ask-me`, `roster`, `hooks`), and `discoverPersonas` from `persona-discovery.ts`. Optional `node:crypto` for manifest content hashes. No new npm runtime dependencies.

**Storage**: JSON under `<repository-root>/.superspec/hive/hire/` for pending reviews and hire scores; curated gallery index at `<repository-root>/.superspec/hire-gallery/index.json` (Operator-overridable via env `SUPERSPEC_HIRE_GALLERY`). Persona artifacts written to project agent dirs (`.cursor/agents`, `.claude/agents`, `.codex/agents`) and optionally mirrored under home when the manifest declares `scope: "home"`. Roster remains authoritative in `.superspec/hive/roster.json`. No SQLite.

**Testing**: Vitest in `packages/core/test/hire/`. Unit tests for manifest schema, sanitization (allowlist, executable rejection, size limits), tag normalization, capability matching tie-breaks, and spawn rollback. Contract tests for new MCP tools mirroring CLI JSON. Integration tests: import → review → confirm → `list-personas` includes new persona within SC-003 window; curated entry still opens Ask-Me; hash change forces re-review.

**Target Platform**: Local Node via `superspec` CLI and stdio MCP server `superspec`. Cross-harness personas (Cursor markdown, Claude markdown, Codex markdown/TOML) per existing discovery rules.

**Project Type**: Library modules plus CLI subcommands and MCP tools inside `@superspec-dev/core`.

**Performance Goals**: Parse and sanitize a standard manifest (< 32 KiB) in under 50 ms local SSD. Gallery search over a v1 catalog (< 500 entries) in under 100 ms. Spawn (persona write + roster upsert + event append) under 500 ms excluding optional skill download. SC-001 three-minute Operator journey is UX-bound, not server-bound.

**Constraints**: Default-deny skills and MCP (FR-010, NFR-002). No secrets in manifests; doctor rejects manifests containing `apiKey`, `token`, `password`, or `secret` keys even if allowlisted. No executable payloads (scripts, shell, `eval`, base64 blobs over threshold). Hive must exist for roster spawn (`HIVE_NOT_INITIALIZED` otherwise). Ira does not spawn engine processes (P-006); spawn writes persona + roster only. Worktree isolation default `isolated` for code-writing hires (SS-005). Single Operator; loopback board mutations (including hire controls) use OD-017 bearer token — not a user directory.

**Scale/Scope**: Tens of roster hires, hundreds of gallery entries in index, one pending review per import session id; duplicate-name conflicts resolved interactively. v1 gallery is curated index, not a marketplace.

## Architecture

### System Structure

Hire flows sit between the Operator and the hive roster. All import paths converge on **`HireReview`** (pending). Sanitization runs before the review form is shown. Opening the review form calls **`HireHooks.onUntrustedImport`** (or equivalent Ask-Me helper) so **`untrusted_import`** items appear until spawn is confirmed or rejected. Confirm performs atomic persona install + roster upsert; cancel leaves disk unchanged.

```text
Operator
  |  superspec hire *  or  MCP hire-*
  v
packages/core  cli.ts + mcp-server.ts
  v
hire/  (parse, sanitize, gallery, review store, spawn, score, skills)
  |  registerCommandPlaneHooks({ hire: HireHooksImpl })
  v
command-plane/  roster.json, ask-me/, events.jsonl
  |
  +--> persona-discovery.discoverPersonas  (list-personas MCP/CLI)
  +--> EngineHooks.dispatch (P-006) — not called by hire spawn in P-005
```

| Module | Responsibility |
|--------|----------------|
| `manifest.ts` | Zod schema, version gate, size limits, content hash |
| `sanitize.ts` | Allowlisted fields, strip/reject unknown keys, executable scan, sanitization report |
| `gallery.ts` | Load/search curated `index.json`; fetch remote manifest body as untrusted bytes |
| `review.ts` | CRUD pending `HireReview` under hive `hire/reviews/` |
| `spawn.ts` | Confirm: write persona file(s), upsert `RosterAgent`, append events; rollback on failure |
| `skills.ts` | Consent records, optional scan hook, allowlist merge |
| `capabilities.ts` | Tag normalization; `matchCapabilities` implementation |
| `score.ts` | Aggregate metrics from ledger/forge outcomes; demotion hints |
| `hooks-impl.ts` | `HireHooks` registered at module init |

Governance (TDD, FR traceability) stays in `constitution.md` and `superspec-validate`; this design does not duplicate those gates.

### Project Structure

#### Documentation (this feature)

```text
specs/005-ira-hire-gallery/
├── spec.md
├── design.md            # this document
└── adr/                 # optional extracts; decisions below are normative
```

#### Source Code (repository root)

```text
packages/core/src/hire/
├── manifest.ts
├── sanitize.ts
├── gallery.ts
├── review.ts
├── spawn.ts
├── skills.ts
├── capabilities.ts
├── score.ts
├── hooks-impl.ts
├── schema.ts            # zod — contract source of truth for hire tools
└── index.ts

packages/core/src/command-plane/   # P-001; hire calls roster + ask-me + store
packages/core/src/cli.ts           # hire subcommands
packages/core/src/mcp-server.ts    # hire-* tools

packages/core/test/hire/
├── manifest.test.ts
├── sanitize.test.ts
├── gallery.test.ts
├── review-spawn.test.ts
├── capabilities.test.ts
├── contracts.test.ts
└── list-personas.integration.test.ts

hire-gallery/                        # shipped curated catalog (repo root)
├── index.json
└── manifests/*.yaml                 # embedded or referenced manifests
```

**Structure Decision**: Single `@superspec-dev/core` package with a `hire/` namespace. Hire does not introduce a second MCP server. Curated catalog ships in-repo for offline gallery (user story 3); Operators may point `SUPERSPEC_HIRE_GALLERY` at another directory. MIT attribution headers on modules adapted from Munder hire flow concepts.

## Decisions

### Decision: One pipeline for file, URL, paste, and gallery (FR-013)

**Rationale**:

Problem statement: HR-003, HR-004, FR-011, and FR-013 require identical security posture for curated and remote manifests; gallery selection must not auto-spawn or skip HITL.

Context: User clarification 2026-10-15 (OD-008) and amendment OD-018 resolve trust tiers: **same** schema validation, allowlisted fields, executable rejection, visible sanitization report (equal scope for curated and remote), and explicit confirmation via `hire-spawn-confirm` only. Curated entries MAY show `trustHint: "curated_catalog"` as a separate label; `uiCopy.trustBanner` remains the single constant `Untrusted import — review all fields before spawn.` for all sources. Content hash change (including gallery entry update) invalidates any prior approval and creates a new `HireReview` with a fresh Ask-Me item.

Pipeline stages (strict order):

1. **Acquire** raw bytes (file read, HTTP GET with size cap, paste body, or gallery manifest load).
2. **Parse** YAML or JSON into unknown object; fail with field errors if not a mapping.
3. **Sanitize** → `SanitizationReport` (dropped keys, rejected blocks, warnings).
4. **Open review** → persist `HireReview` status `pending`; call `onUntrustedImport` → Ask-Me `untrusted_import` linked to `reviewId`.
5. **Operator edits** review form fields (FR-012); optional skills consent step (FR-006).
6. **Confirm spawn** → Operator calls **`hire-spawn-confirm`** only; resolves linked Ask-Me; writes personas + roster; status `spawned`.
7. **Reject/cancel** → **`hire-spawn-cancel`**, Ask-Me `keep_blocked`, or Ask-Me **`acknowledge`** on `untrusted_import` (same writes as cancel: review `cancelled`, no persona/roster, `HIRE_ACK_CANCELS`).

Gallery step 1 sets `sourceKind: "gallery"` and copies manifest from catalog; steps 2–7 are unchanged.

**Alternatives considered**:

- **Fast path for curated entries skipping Ask-Me**: Rejected. Violates FR-013 and SC-002.
- **Separate roster write on gallery select**: Rejected. Would spawn-by-selection.
- **Trust tier enum affecting sanitization rules**: Rejected. Only optional `trustHint` label may differ; banner and report length stay equal.
- **Confirm spawn via Ask-Me acknowledge**: Rejected. OD-018; acknowledge cancels, it does not spawn.

### Decision: Versioned hire manifest schema (allowlist-only document)

**Rationale**:

Problem statement: FR-002 and HR-002 require a versioned manifest with identity, goal, capability tags, engine, model tier, budget, and default-deny allowlists.

Context: Schema version **`hireManifest/v1`**. Transport: YAML or JSON. Required top-level keys only; anything else is stripped and listed in `SanitizationReport.droppedKeys`. Nested objects outside the allowlist are rejected (not partially kept).

Allowlisted shape (normative):

```yaml
schemaVersion: hireManifest/v1
id: ios-developer          # slug, becomes roster id unless overridden on review
displayName: iOS Developer
goal: Ship native iOS features with SwiftUI.
capabilityTags: [ios, swift, mobile]
suggestedEngine: cursor
suggestedModelTier: standard   # abstract tier; maps via route-model at dispatch
budget:
  tokens: 200000
  usd: 50
allowlists:
  skills: []                   # omitted => default deny-all
  mcp: []
persona:
  harness: cursor              # cursor | claude | codex
  scope: project               # project | home | both
  body: |                      # markdown persona body; no frontmatter secrets
    ---
    name: ios-developer
    description: ...
    ---
    ...
skills: []                     # optional install requests; consent required
metadata:
  galleryTitle: optional
  sourceUri: optional
```

Rejected patterns: keys matching `/script|executable|command|shell|eval|base64/i`, values over `MAX_FIELD_CHARS` (default 16384), manifest file over `MAX_MANIFEST_BYTES` (default 65536), `schemaVersion` other than supported set, missing required fields.

**Alternatives considered**:

- **JSON Schema only without zod in core**: Rejected. Command Plane uses zod as contract source of truth.
- **Executable hooks in manifest**: Rejected. HR-004 / FR-004.
- **Inline skill bodies**: Rejected. Skills install by reference id/path only after consent.

### Decision: Implement `HireHooks` in P-005 and wire Ira routing

**Rationale**:

Problem statement: P-001 defines `HireHooks.matchCapabilities` and `onUntrustedImport` as extension points with no-op defaults. FR-007 requires capability-based routing; FR-011 requires HITL for untrusted import.

Context:

**`matchCapabilities(task, roster)`** (registered at init):

1. Consider only agents with `status === "idle"` and `origin !== "placeholder"` (placeholder `agent-host` excluded unless task has no tags and no other match — same as P-001 fallback when hook absent).
2. Normalize task and agent tags: lowercase, trim, dedupe, `[a-z0-9][a-z0-9._-]{0,31}`.
3. If task tags empty: return first idle hire, else placeholder behavior from P-001.
4. If task tags non-empty: agents must intersect at least one required tag; rank by (1) count of intersecting tags descending, (2) `hireScore.score` descending when present, (3) stable `id` ascending.
5. Return single best agent or `null`.

**`onUntrustedImport({ featureId, agentId, detail })`**: create Ask-Me item `reasonClass: "untrusted_import"`, `question` includes review id and source summary; return `{ askMeId }`. Duplicate open item for same `reviewId` returns existing id.

Idle wake and away tick in P-001 call the registered hook before assignment.

**Alternatives considered**:

- **Display-name routing**: Rejected. FR-007.
- **Automatic demotion on low score**: Rejected. FR-008 hints only.

### Decision: `list-personas` integration via standard agent directories

**Rationale**:

Problem statement: FR-005 and HR-005 require spawned hires to appear in existing persona listing across harnesses.

Context: On confirm, `spawn.ts` writes one persona file per selected harness (from review form, defaulting to manifest `persona.harness`):

| Harness | Project path | Home path (when scope allows) |
|---------|--------------|--------------------------------|
| cursor | `<repo>/.cursor/agents/<id>.md` | `~/.cursor/agents/<id>.md` |
| claude | `<repo>/.claude/agents/<id>.md` | `~/.claude/agents/<id>.md` |
| codex | `<repo>/.codex/agents/<id>.toml` or `.md` | `~/.codex/agents/...` |

Frontmatter includes `name`, `description`, optional `capabilityTags` for human readability; routing uses roster tags. **`list-personas`** is unchanged: it calls `discoverPersonas({ projectRoot: resolveRepositoryRoot(cwd) })`. Doctor adds a hire check: after spawn, optional probe calling discover with same root expects the new `name` within 5 s (SC-003). No new MCP fields on `list-personas` in v1; parity is behavioral.

Roster row stores `personaPath` absolute path to the primary project persona file.

**Alternatives considered**:

- **Separate hire registry file for discovery**: Rejected. FR-005 explicitly requires standard locations.
- **New list-personas filter flag**: Deferred; gallery uses `hire roster-list` and search for fleet views.

### Decision: Pending review and spawn atomicity

**Rationale**:

Problem statement: FR-003, edge cases on cancel, disk failure, and duplicate names.

Context: `HireReview` persisted at `hire/reviews/<reviewId>.json` with exclusive lock. Fields include `sanitizationReport`, `parsedManifest`, `operatorEdits`, `skillConsents[]`, `contentSha256`, `sourceKind`, `approvalCopyVariant` (`standard` | `curated_catalog`), `askMeId`, `state`.

Confirm spawn under roster lock:

1. If roster id exists and `origin === "hire"`: return `HIRE_NAME_CONFLICT` with actions `merge`, `replace`, `cancel` unless request includes `nameConflictAction`.
2. Validate engine presence via `EngineHooks.detectInstalled` when registered; else flag `engine_unverified` on review warnings (FR edge case).
3. Write persona file(s) to temp paths then rename.
4. Upsert `RosterAgent` with confirmed fields, `origin: "hire"`, `worktreePolicy: "isolated"` when manifest tags imply code (`ios`, `backend`, …) or review checkbox set.
5. Append `hire.spawned` event; mark review `spawned`.
6. On any failure after step 3 begins: delete temp personas, do not append roster row (edge case rollback).

Cancel: review → `cancelled`; no roster/persona writes.

**Alternatives considered**:

- **Spawn without hive**: Rejected. Roster is hive-owned per P-001.
- **Silent overwrite on duplicate id**: Rejected. Spec edge case.

### Decision: Skills consent and default-deny MCP

**Rationale**:

Problem statement: FR-006, FR-010, HR-006.

Context: Skills step lists each requested skill with `source` (path, npm spec, or registry id). Operator accepts/declines per skill or batch. Optional `scanSkill(path)` hook (v1 stub returns `{ status: "skipped" }`; structure ready for scanner integration). Declined skills omitted from `allowedSkills`. Confirm with all declined still spawns persona with empty allowlists (default deny). MCP allowlist copied from manifest/review only; no auto-install of MCP servers in P-005.

**Alternatives considered**:

- **Auto-install all manifest skills on confirm**: Rejected. FR-006.

### Decision: Hire scoring from existing ledger signals

**Rationale**:

Problem statement: FR-008 SHOULD record outcomes and surface demotion hints without automatic roster changes.

Context: `hire/scores/<agentId>.json` stores rolling metrics: tasks completed, pass rate, spend vs `budgetUsd`/`budgetTokens`, review failure count from hive ledger sync. Score formula v1: `100 * passRate - 10 * reviewFailureRate - penaltyOverBudget` clamped 0–100. When score < threshold (default 40) set `demotionHint: true` with reasons array exposed on `hire show` and `roster-list` (additive fields). Updated on `record-result` hive path via hook `onRecordResult` registration from hire module listening to task completion events (tail `task.completed` / `task.failed` for assignee).

**Alternatives considered**:

- **Auto-offline low scores**: Rejected. FR-008.

## Data Model

Schema version for hire JSON files: `1`. Timestamps ISO-8601 UTC.

### HireManifest (logical)

Parsed output after sanitize; stored inside `HireReview.parsedManifest`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `schemaVersion` | `"hireManifest/v1"` | yes | |
| `id` | slug string | yes | Roster id candidate |
| `displayName` | string | yes | max 128 |
| `goal` | string | yes | max 4000 |
| `capabilityTags` | string[] | yes | normalized lowercase |
| `suggestedEngine` | string | yes | e.g. cursor, claude, codex |
| `suggestedModelTier` | string | yes | economy/standard/frontier abstract |
| `budget.tokens` | number or null | yes | |
| `budget.usd` | number or null | yes | |
| `allowlists.skills` | string[] | yes | may be empty |
| `allowlists.mcp` | string[] | yes | may be empty |
| `persona.harness` | enum | yes | |
| `persona.scope` | enum | yes | |
| `persona.body` | string | yes | markdown/toml content, size capped |

Invariants: no secret-like keys survive sanitization; executable patterns rejected.

### SanitizationReport

| Field | Type | Notes |
|-------|------|-------|
| `droppedKeys` | string[] | Dot paths removed |
| `rejected` | `{ path, reason }[]` | Fatal issues |
| `warnings` | string[] | e.g. empty capability tags |
| `contentSha256` | string | Full raw bytes |
| `sanitizedAt` | timestamp | |

Invariants: if `rejected.length > 0`, review opens but confirm returns `HIRE_SANITIZE_FAILED` until Operator fixes source or edits remove violations.

### HireReview

Path: `hire/reviews/<reviewId>.json`. PK: `reviewId` (`hrv_` + UUID).

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `reviewId` | string | yes | |
| `state` | `pending` \| `spawned` \| `cancelled` \| `rejected` | yes | |
| `sourceKind` | `file` \| `url` \| `paste` \| `gallery` | yes | |
| `sourceRef` | string | yes | Path, URL, gallery entry id |
| `approvalCopyVariant` | `standard` \| `curated_catalog` | yes | UI copy only |
| `contentSha256` | string | yes | Hash change ⇒ new review |
| `sanitizationReport` | object | yes | Always shown on form |
| `parsedManifest` | object | yes | |
| `operatorEdits` | object | no | Confirmed overrides |
| `skillConsents` | SkillConsent[] | yes | |
| `askMeId` | string | yes | Open until confirm/reject |
| `createdAt` / `updatedAt` | timestamp | yes | |

State machine:

```text
pending --confirm--> spawned
pending --cancel/reject--> cancelled | rejected
```

Invariants: no `spawned` without resolved Ask-Me and successful `hire-spawn-confirm`; no worker spawn at any pre-spawn state; `acknowledge` on `untrusted_import` MUST NOT transition to `spawned`.

### GalleryEntry (catalog)

Stored in `hire-gallery/index.json` as `entries[]`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Stable catalog id |
| `title` | string | yes | |
| `description` | string | yes | |
| `capabilityTags` | string[] | yes | Search index |
| `manifestPath` | string | yes | Relative to gallery root |
| `manifestSha256` | string | yes | Change detection |
| `trustHint` | `"curated_catalog"` | yes | Copy variant only |

Relationships: selecting an entry loads manifest bytes and enters the same pipeline with `approvalCopyVariant: curated_catalog`.

### RosterAgent (hire fields)

Uses P-001 `RosterAgent` shape. P-005 sets `origin: "hire"`, fills `capabilityTags`, `engine`, `model`, budgets, allowlists, `personaPath`, `workspace` (optional worktree path from `superspec-worktree` integration), `worktreePolicy`.

Invariants: P-001 will not delete `origin: "hire"` rows; hire module may update allowlists on merge.

### SkillConsent

| Field | Type | Notes |
|-------|------|-------|
| `skillId` | string | |
| `source` | string | |
| `scanResult` | object or null | |
| `decision` | `pending` \| `accepted` \| `declined` | |

### HireScore

Path: `hire/scores/<agentId>.json`.

| Field | Type | Notes |
|-------|------|-------|
| `agentId` | string | PK |
| `passRate` | number | 0–1 |
| `reviewFailures` | number | |
| `spendUsd` / `spendTokens` | number | |
| `score` | number | 0–100 |
| `demotionHint` | boolean | |
| `demotionReasons` | string[] | |
| `updatedAt` | timestamp | |

## Contracts

Hire CLI commands print the same JSON objects as MCP tools. Failures use the Command Plane envelope (`ok: false`, `error`, `message`, `hint`).

Additional error codes: `HIRE_SANITIZE_FAILED`, `HIRE_REVIEW_NOT_FOUND`, `HIRE_ALREADY_SPAWNED`, `HIRE_NAME_CONFLICT`, `HIRE_GALLERY_UNAVAILABLE`, `HIRE_MANIFEST_TOO_LARGE`, `HIRE_ENGINE_UNAVAILABLE`, `HIVE_NOT_INITIALIZED`, `HIRE_ACK_CANCELS`, `HIRE_SPAWN_CONFIRM_REQUIRED`, `HIRE_WARNING_LENGTH_MISMATCH`, `SLICE_A_ONLY` (hire-spawn-confirm only until Slice A validates).

### MCP / CLI tools

Registered beside existing tools. Names kebab-case.

#### `hire-import`

Request:

```json
{
  "source": "file",
  "path": "/abs/manifest.yaml",
  "cwd": "optional"
}
```

`source`: `file` | `url` | `paste` | `gallery`. For `url`: `url` string. For `paste`: `body` string. For `gallery`: `entryId` string.

Response:

```json
{
  "ok": true,
  "review": {
    "reviewId": "hrv_...",
    "state": "pending",
    "sourceKind": "file",
    "approvalCopyVariant": "standard",
    "sanitizationReport": { "droppedKeys": [], "rejected": [], "warnings": [] },
    "askMeId": "ask_...",
    "form": {
      "displayName": "iOS Developer",
      "capabilityTags": ["ios"],
      "suggestedEngine": "cursor",
      "suggestedModelTier": "standard",
      "budget": { "tokens": 200000, "usd": 50 },
      "allowlists": { "skills": [], "mcp": [] }
    },
    "uiCopy": {
      "trustBanner": "Untrusted import — review all fields before spawn.",
      "showFullSanitizationReport": true
    }
  }
}
```

Curated gallery response is identical except `approvalCopyVariant: "curated_catalog"` and optional top-level or nested `trustHint: "curated_catalog"`. `uiCopy.trustBanner` MUST remain `Untrusted import — review all fields before spawn.` Implementations that emit a different banner MUST reject confirm with `HIRE_WARNING_LENGTH_MISMATCH`.

#### `hire-review-show`

Request: `{ "reviewId": "hrv_..." }`

Response: full `HireReview` including editable fields and skill consents.

#### `hire-review-update`

Request:

```json
{
  "reviewId": "hrv_...",
  "edits": {
    "displayName": "iOS Dev",
    "capabilityTags": ["ios", "swift"],
    "engine": "cursor",
    "modelTier": "standard",
    "budgetUsd": 40,
    "allowedSkills": ["swift-ui"],
    "allowedMcp": []
  },
  "skillConsents": [{ "skillId": "swift-ui", "decision": "accepted" }]
}
```

Response: `{ "ok": true, "review": { } }`

#### `hire-spawn-confirm`

Request:

```json
{
  "reviewId": "hrv_...",
  "nameConflictAction": "merge",
  "createWorktree": true
}
```

Response:

```json
{
  "ok": true,
  "agent": {
    "id": "ios-developer",
    "origin": "hire",
    "personaPath": "/abs/repo/.cursor/agents/ios-developer.md",
    "capabilityTags": ["ios", "swift"],
    "status": "idle"
  },
  "askMeResolved": true
}
```

Side effects: persona file written; roster upsert; `hire.spawned` event; Ask-Me resolved. Does **not** call engine spawn. Until `sliceAValidated`, returns `SLICE_A_ONLY` with no writes.

#### `hire-spawn-cancel`

Request: `{ "reviewId": "hrv_..." }`. Response: `{ "ok": true, "state": "cancelled" }`. Same disk effect as Ask-Me `acknowledge` on linked `untrusted_import` (OD-018).

#### Ask-Me `ask-me-answer` (hire-linked)

For items with `reasonClass: "untrusted_import"` linked to a `reviewId`:

| `action` | Effect |
|----------|--------|
| `acknowledge` | Review → `cancelled`; no persona/roster; `{ ok: true, code: "HIRE_ACK_CANCELS" }` |
| `keep_blocked` | Review stays `pending`; Ask-Me stays open |

Spawn writes are forbidden on this path. Operators confirm via `hire-spawn-confirm` after review edits.

#### `hire-gallery-search`

Request: `{ "query": "ios", "tags": ["mobile"], "limit": 20 }`

Response: `{ "ok": true, "entries": [ { "id", "title", "description", "capabilityTags", "trustHint" } ] }`

#### `hire-show`

Request: `{ "agentId": "ios-developer" }`

Response: roster row plus `hireScore` breakdown and `demotionHint` when set.

CLI mirror:

| Command | Flags |
|---------|--------|
| `superspec hire import` | `--source`, `--path` / `--url` / `--body` / `--entry` |
| `superspec hire review show` | `--review` |
| `superspec hire review update` | `--review`, `--json-edits` |
| `superspec hire confirm` | `--review`, `--on-conflict merge\|replace\|cancel` |
| `superspec hire cancel` | `--review` |
| `superspec hire gallery search` | `--query`, `--tag` repeatable |
| `superspec hire show` | `--agent` |

### Extension hooks (implemented)

P-005 registers:

```ts
export const hireHooksImpl: HireHooks = {
  matchCapabilities(task, roster) { /* see decision */ },
  async onUntrustedImport(input) { /* opens ask_me untrusted_import */ },
};
```

Call sites remain in P-001 dispatch and assignment paths. Hire module calls `registerCommandPlaneHooks({ hire: hireHooksImpl })` from `hire/index.ts` when imported by CLI/MCP bootstrap.

### Event schema (hire)

Append to `events/events.jsonl` via hive store:

| `type` | `data` fields |
|--------|----------------|
| `hire.import_started` | `reviewId`, `sourceKind`, `contentSha256` |
| `hire.review_updated` | `reviewId` |
| `hire.spawned` | `reviewId`, `agentId`, `personaPath`, `capabilityTags` |
| `hire.cancelled` | `reviewId` |
| `hire.score_updated` | `agentId`, `score`, `demotionHint` |

### Integration points

| Integration | Protocol | Notes |
|-------------|----------|-------|
| Command Plane roster | In-process | Locked upsert to `roster.json` |
| Ask-Me | In-process | `untrusted_import` on review open |
| `discoverPersonas` / `list-personas` | In-process | Verification after spawn |
| `EngineHooks.detectInstalled` | Optional hook P-006 | Engine availability warnings |
| `route-model` | In-process | Maps `suggestedModelTier` at dispatch, not at hire |
| Forge / ledger | Read-only for scores | Task outcomes by `assigneeAgentId` |
| Munder hire prior art | Conceptual | Parse/review/spawn gate semantics only |

No network except optional `hire-import` URL fetch with TLS, redirect limit, and byte cap.

### Consumed From Other Specs

| Source spec | Contract | Version / stability | Notes |
|-------------|----------|---------------------|-------|
| `specs/001-ira-command-plane` | `RosterAgent`, hive paths, `HireHooks`, Ask-Me `untrusted_import`, `resolveRepositoryRoot` | v1 | Hive required for spawn |
| `specs/001-ira-command-plane` | `registerCommandPlaneHooks`, event append API | v1 | |
| `@superspec-dev/core` | `discoverPersonas`, `list-personas` tool | core 0.2.x | FR-005 |
| `specs/006-ira-engine-adapters` | `EngineHooks.detectInstalled` | v1 optional | Review warnings only in P-005 |

### Produced For Other Specs

| Target spec / consumer | Contract | Version / stability | Notes |
|------------------------|----------|---------------------|-------|
| `specs/002-ira-command-center` | Hire MCP/CLI JSON, review form shape, `uiCopy` | v1 additive | Fleet/hire panels |
| `specs/006-ira-engine-adapters` | Spawned roster rows with `engine`, `workspace` | v1 | Dispatch consumes roster |
| `specs/004-ira-token-context` | Budget fields on roster | v1 | Spend vs budget in scoring |

## Appendix: FR Coverage

| FR | Where this design satisfies it |
|----|--------------------------------|
| FR-001 | `hire-import`, `hire-gallery-search` |
| FR-002 | Manifest schema decision |
| FR-003 | Pipeline decision; no spawn tools before confirm |
| FR-004 | Sanitize decision; executable rejection |
| FR-005 | Persona paths + `list-personas` integration |
| FR-006 | Skills consent module |
| FR-007 | `HireHooks.matchCapabilities` |
| FR-008 | `HireScore` store and demotion hints |
| FR-009 | MCP + CLI table |
| FR-010 | Default-deny allowlists on manifest and review |
| FR-011 | Ask-Me on review open via `onUntrustedImport` |
| FR-012 | `hire-review-update` editable fields |
| FR-013 | Same pipeline; equal banner and sanitization report; optional `trustHint` only |
| FR-014 | `hire-spawn-confirm` sole writer; acknowledge cancels; Slice A gate |
