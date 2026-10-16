# Design: Ira Learning Memory

**Revision**: 2026-10-16 | **Status**: DRAFT | **Owner**: @composer

**Input**: Feature specification from `specs/003-ira-learning-memory/spec.md`

## Required Reading / Prior Art

| Path | Reason |
|------|--------|
| `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` | LOCKED production invariants (OD-016 learning, OD-015 hooks, OD-020 Slice A) |

`docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` is LOCKED. If this design disagrees with that amendment, the amendment wins.

## Summary

P-003 adds a **project-local pattern store** and a **RETRIEVE → JUDGE → DISTILL → CONSOLIDATE** pipeline that runs around existing forge MCP/CLI tools. Distilled lessons survive worker chat compaction because canonical records live under `<repository-root>/.superspec/patterns/` as human-readable markdown; a **derived SQLite FTS5 index** at `.superspec/patterns/index.sqlite` powers fast retrieval and the read-only query surface. Markdown is source of truth; the index is rebuildable and gitignored. v1 uses signal matching plus FTS only — **no embeddings or vector index**.

Implementation registers **`LearningHooks`** from P-001 (`retrieve`, `distill`) inside `@superspec-dev/core`, extends `begin-task`, `record-result`, `route-model`, and `coordinator-brief` with optional injection hooks, and exposes CLI/MCP read APIs for P-001 Command Plane and P-002 Command Center. Standalone SuperSpec works unchanged when hooks are disabled or Command Plane is absent.

After forge **`saveState`** on `record-result`, the handler returns success **without awaiting** DISTILL, a distill hard timeout, or CONSOLIDATE. DISTILL is scheduled off the returned call. SQLite FTS is optional; markdown under `.superspec/patterns/` is canonical with capped markdown scan fallback when the index is unavailable.

## Production invariants

Normative source: `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` (OD-016, OD-015, OD-020).

| Invariant | Fail-closed / required behavior | Amendment |
|-----------|----------------------------------|-----------|
| Non-blocking distill | `record-result` order: forge `saveState` / `recordResult` → hive sync (if hive) → return forge success JSON → schedule DISTILL off-stack. Handler MUST NOT `await` distill, distill timeout, or CONSOLIDATE. 30 s on-stack distill wait forbidden. | OD-016 |
| Distill failure | MUST NOT fail `record-result`, roll back forge state, or change exit code after successful save. Log only; no partial pattern write. | OD-016 |
| Markdown canonical | `*.md` under `.superspec/patterns/` is source of truth. SQLite FTS is derived. Index rebuildable via `patterns reindex`. | OD-016 |
| Index optional | Missing `better-sqlite3`, native load failure, or unreadable index: RETRIEVE and distill use markdown; RETRIEVE uses **capped markdown scan**; log `PATTERNS_INDEX_UNAVAILABLE`; forge/MCP calls MUST NOT fail. Doctor warns. | OD-016 |
| CONSOLIDATE off stack | CONSOLIDATE MUST NOT run on the `record-result` stack. Runs after async DISTILL or lazy schedule only. | OD-016 |
| Hook isolation | `LearningHooks` run inside P-001 `registerCommandPlaneHooks` try/catch. Throw → `hook.failed` / closed deny on steer paths; MUST NOT exit MCP or undo prior successful `saveState`. | OD-015 |
| Slice A writes | Until `sliceAValidated: true`, P-003 distill/consolidate pattern writes are no-op `SLICE_A_ONLY` (no pattern file). Forge `record-result` after `saveState` remains live; deferred distill skipped per OD-020. | OD-020 |

## Technical Context

**Language/Version**: TypeScript 5.5, Node.js >= 20, ESM (`"type": "module"`), NodeNext — same as `@superspec-dev/core` 0.2.x.

**Primary Dependencies**: Existing core stack (`zod`, `@modelcontextprotocol/sdk`, Node built-ins). **One new runtime dependency**: `better-sqlite3` (FTS5, synchronous single-writer semantics, no separate server process). No Ruflo plugin, no LoRA/EWC, no embedding runtimes.

**Storage**: Hybrid per FR-010 — canonical pattern markdown files under `<repository-root>/.superspec/patterns/*.md`; derived SQLite database `.superspec/patterns/index.sqlite` (FTS5 + metadata tables). Optional config at `<repository-root>/.superspec/learning.json`. Pattern files may be committed; the index is not.

**Testing**: Vitest under `packages/core/test/learning-memory/`. Unit tests for JUDGE scoring, CONSOLIDATE merge rules, redaction, and FTS query ranking. Integration tests in a temp repo: distill after `record-result`, retrieve on `begin-task`, index rebuild from markdown-only, concurrent write serialization, and “distill failure does not fail record-result”.

**Target Platform**: Local Node in the existing `superspec` CLI and stdio MCP server (`superspec`). Same cross-harness story as P-001.

**Project Type**: Library modules inside `@superspec-dev/core` (not a separate npm package).

**Performance Goals**: RETRIEVE + JUDGE for a store of 500 patterns completes in < 200 ms p95 on local SSD (FTS path); capped markdown scan fallback MAY be slower but MUST respect the same injection caps. CONSOLIDATE for one signal bucket with ≤ 20 candidates completes in < 500 ms when run off-stack. Forge `record-result` returns immediately after `saveState` and hive sync without waiting on DISTILL (OD-016). Background DISTILL uses a configurable hard timeout; timeout logs and abandons distill only.

**Constraints**: Injection cap default 2 KB combined (SC-005). Pattern summary cap default 1 KB per record (FR-007). No secrets or full transcripts in persisted patterns. Single-writer per repository pattern partition. Worker context compaction must not touch `.superspec/patterns/`. Learning disable switches must not delete stored patterns (FR-014).

**Scale/Scope**: Project-scoped store (one repo root), hundreds to low thousands of patterns, tens of FR tags and task kinds per feature. Cross-project user-global memory is out of scope for v1.

## Architecture

### System Structure

Learning memory sits beside the forge loop in-process. Forge handlers remain the writer of `specs/<feature>/.superspec/state.json`. After a successful forge persistence, optional learning phases run. P-001 Command Plane, when present, calls the same hook implementations via `registerCommandPlaneHooks`; dispatch attaches `patternSummary` on `DispatchIntent` per P-001 contracts.

```text
Operator / Coordinator
  |  superspec CLI  or  MCP (server "superspec")
  v
packages/core  cli.ts + mcp-server.ts
  |  begin-task / record-result / route-model / coordinator-brief
  |  (forge semantics unchanged on failure paths)
  v
learning-memory/          RETRIEVE → JUDGE → (inject)
  |                         DISTILL → CONSOLIDATE (persist)
  +------------------+---------------------------+
  |                  |                           |
  v                  v                           v
.superspec/patterns/*.md   index.sqlite (FTS5)   command-plane/hooks.ts
(canonical, committable)   (gitignored, derived)   LearningHooks (P-001)
```

Pipeline phases (FR-004):

| Phase | When | Responsibility |
|-------|------|----------------|
| **RETRIEVE** | `route-model`, `begin-task`, `coordinator-brief` (next task known), P-001 `LearningHooks.retrieve` | Build `RetrieveContext` from plan task + optional reports; FTS + signal filter; return ranked candidates |
| **JUDGE** | Same call stack, before injection | Score candidates; drop below threshold; enforce combined injection byte cap |
| **DISTILL** | Scheduled after `record-result` returns success (post-`saveState`); P-001 `LearningHooks.distill` when not Slice A | Extract bounded lesson; redact secrets; write markdown; upsert index when SQLite loads; hard timeout in background worker |
| **CONSOLIDATE** | After async DISTILL completes or lazy timer — never on `record-result` stack | Merge ≥80% summary overlap within same signal bucket; demote superseded rows |

Component responsibilities:

| Module | Responsibility |
|--------|----------------|
| `paths.ts` | Resolve repository root, `.superspec/patterns/`, index path; reject traversal |
| `config.ts` | Load `learning.json`; global/feature disable flags |
| `schema.ts` | Zod schemas for pattern frontmatter, query DTOs, MCP JSON |
| `pattern-io.ts` | Atomic markdown write/read; frontmatter parse |
| `index.ts` | SQLite open when binding loads; FTS5 schema, upsert/delete, rebuild-from-markdown; graceful degrade when unavailable |
| `retrieve.ts` | Signal + FTS candidate generation; capped markdown scan fallback when index unavailable |
| `judge.ts` | Relevance scoring, cap enforcement, `InjectionSummary` build |
| `distill.ts` | Outcome → pattern draft (heuristic v1 + optional model call via existing router) |
| `consolidate.ts` | Duplicate merge, archive demotion |
| `redact.ts` | Secret/credential detectors; skip write on hard fail |
| `pipeline.ts` | Orchestration, error logging, feature flags |
| `hooks.ts` | `LearningHooks` adapter for P-001 |
| `query.ts` | Read-only list/filter/pagination for CLI/MCP |
| `install.ts` | `installLearningMemory(projectRoot)` registers hooks + doctor probes |

Governance gates (TDD, traceability) remain in `constitution.md` and `superspec-validate`; this design does not restate them.

### Project Structure

#### Documentation (this feature)

```text
specs/003-ira-learning-memory/
├── spec.md
├── design.md            # this document
└── adr/                 # optional extracts; decisions below are normative
```

#### Source Code (repository root)

```text
packages/core/src/learning-memory/
├── paths.ts
├── config.ts
├── schema.ts
├── types.ts
├── pattern-io.ts
├── index-sqlite.ts
├── retrieve.ts
├── judge.ts
├── distill.ts
├── consolidate.ts
├── redact.ts
├── pipeline.ts
├── hooks.ts
├── query.ts
├── install.ts
└── index.ts

packages/core/src/mcp-server.ts     # hook calls + patterns-list tool
packages/core/src/cli.ts            # superspec patterns * subcommands
packages/core/src/coordinator-ledger.ts  # optional "## Prior patterns" section
packages/core/src/index.ts          # re-export learning-memory public API

packages/core/test/learning-memory/
├── retrieve-judge.test.ts
├── distill-redact.test.ts
├── consolidate.test.ts
├── index-rebuild.test.ts
├── hooks-forge.test.ts
└── query-contract.test.ts
```

**Structure Decision**: Add a `learning-memory/` directory inside `@superspec-dev/core`, mirroring P-001’s `command-plane/` module. Forge and MCP handlers import learning functions directly so RETRIEVE can run without the hive. P-001 consumes the same behavior through `LearningHooks` registration, not a second process.

## Decisions

### Decision: Extend `@superspec-dev/core` instead of `@superspec-dev/learning-memory`

**Rationale**:

Problem statement: Where should the pattern store and forge hook wiring live?

Context: FR-011 requires extending existing `begin-task`, `record-result`, and `route-model` without a second MCP server. P-001 already defines `LearningHooks` in `command-plane/hooks.ts` and documents call order around dispatch and `record-result`. Hook implementations must run in the same process immediately after `saveState`, matching the hive sync rationale in P-001’s package-boundary decision.

A sibling npm package would either duplicate forge handler patches or depend on core exporting unstable internal hooks. Colocating `learning-memory/` in core keeps one bin, one MCP server, and shared types (`RetrieveContext`, `DistillContext`) with additive fields.

**Alternatives considered**:

- **Separate `@superspec-dev/learning-memory` package**: Rejected — inverted layering, double registration, and forked forge handlers.
- **Runtime plugin loaded from disk**: Rejected — extra install/doctor surface with no isolation benefit; pattern writes must not race forge state saves.
- **Markdown-only without SQLite**: Rejected — FR-010 and SC-007 require a query surface without reading every file; FTS satisfies OPEN-004 without embeddings.

### Decision: Hybrid markdown canonical + derived SQLite FTS5 index

**Rationale**:

Problem statement: FR-010 / OPEN-004 pattern store backend.

Context: Operators and git need readable artifacts; RETRIEVE and P-001/P-002 consumers need fast filtered search. Markdown files under `.superspec/patterns/` are authoritative. Each write updates one `.md` file then upserts FTS rows in `index.sqlite`. `superspec patterns reindex` rebuilds the entire index from markdown. Index path is gitignored at repo root (see doctor/gitignore decision).

**Alternatives considered**:

- **SQLite only**: Rejected — poor human inspectability and harder operator trust.
- **Embeddings / vector index**: Rejected — NG4, spec clarification 2026-10-15, SC-006.
- **Node built-in `node:sqlite` only**: Rejected for Node 20 baseline — FTS5 and stability are better served by `better-sqlite3` until engines.json raises minimum to 22+ with verified FTS parity.

### Decision: `better-sqlite3` as the only new runtime dependency

**Rationale**:

Problem statement: Which SQLite binding supports FTS5 with predictable single-writer semantics on Node 20?

Context: CONSOLIDATE and DISTILL need transactional upserts; concurrent forge tasks require serialized writes (spec edge case). Synchronous `better-sqlite3` with an exclusive lock file `.superspec/patterns/.index.lock` matches P-001’s JSON store locking style.

**Alternatives considered**:

- **sql.js (WASM)**: Rejected — slower, heavier bundle, awkward FTS maintenance.
- **External sqlite3 CLI**: Rejected — subprocess overhead and poor MCP latency.

### Decision: CONSOLIDATE off the `record-result` stack (OD-016)

**Rationale**:

Problem statement: CONSOLIDATE scheduling without blocking forge return.

Context: OD-016 forbids CONSOLIDATE on the `record-result` stack. v1 runs CONSOLIDATE after background DISTILL completes (same detached worker chain) or on a lazy timer/CLI trigger. SC-004 acceptance tests invoke CONSOLIDATE explicitly or wait on the async chain in test harness — not by blocking MCP `record-result`.

**Alternatives considered**:

- **Synchronous CONSOLIDATE before forge return**: Rejected — violates OD-016 and production speed invariant.
- **Manual CONSOLIDATE only**: Rejected — violates FR-009 automation expectation; async chain satisfies automation.

### Decision: Non-blocking DISTILL after `saveState`; errors never fail `record-result` (OD-016)

**Rationale**:

Problem statement: Forge persistence must not wait on learning phases.

Context: When the hive exists, order is: forge `saveState` / `recordResult` → hive sync → return forge success JSON → schedule DISTILL off the returned call. The handler MUST NOT `await` DISTILL, a distill hard timeout, or CONSOLIDATE. A microtask the handler still awaits is forbidden. Background DISTILL runs in try/catch with a hard timeout (configurable, default e.g. 30 s); timeout or error logs only — no rollback, no exit code change. Atomic markdown write (temp + rename); skip on validation/redaction failure. Slice A: distill write no-op `SLICE_A_ONLY` until doctor `sliceAValidated` (OD-020).

**Alternatives considered**:

- **Await distill with 30 s cap on request stack**: Rejected — superseded by OD-016; forbidden.
- **Fail record-result on distill error**: Rejected — breaks forge loop independence.
- **Write partial patterns**: Rejected — corrupts store; skip write on validation/redaction failure.

### Decision: SQLite optional — markdown scan fallback (OD-016)

**Rationale**:

Problem statement: Native module or index open failure must not break forge.

Context: `better-sqlite3` remains the preferred FTS binding when it loads. On missing package, `dlopen` failure, or corrupt/unopenable index, `index.ts` sets `indexAvailable: false`. RETRIEVE uses signal filter + **capped markdown scan** (read frontmatter/summary up to a file budget). DISTILL writes markdown only; index upsert skipped with log. Doctor emits warning finding `PATTERNS_INDEX_UNAVAILABLE` (severity `warn`). `superspec patterns reindex` rebuilds when SQLite works.

**Alternatives considered**:

- **Reject RETRIEVE when SQLite absent**: Rejected — superseded by OD-016.
- **Fail forge tools when index missing**: Rejected — non-conformant.

### Decision: v1 DISTILL uses heuristics first, optional model via existing `routeModel`

**Rationale**:

Problem statement: How to extract lessons without mandating neural training (NG4)?

Context: Spec assumes DISTILL may use coordinator engine via existing router; dedicated distill model selection is out of scope. v1 implementation extracts structured bullets from implementer/reviewer report paths passed into `record-result`, classifies kind (`success` | `failure`), and fills signals from plan task metadata. Model-assisted summarization is gated behind `learning.json` `distill.mode: "model"` using the same economy tier as mechanical tasks.

**Alternatives considered**:

- **Mandatory LLM distill**: Rejected — offline/CI and SC-006.
- **Transcript ingestion**: Rejected — FR-007 forbids full transcripts in store.

### Decision: Gitignore derived index only

**Rationale**:

Problem statement: What is committed vs local?

Context: Add to repository `.gitignore`: `.superspec/patterns/index.sqlite`, `.superspec/patterns/index.sqlite-wal`, `.superspec/patterns/index.sqlite-shm`, `.superspec/patterns/.index.lock`. Pattern `*.md` remain committable when operators want shared lessons. P-001 `doctor` (when hive present) gains optional probe `patterns_index_stale` comparing index mtime to markdown max mtime, and `PATTERNS_INDEX_UNAVAILABLE` when SQLite cannot load or open (OD-016).

**Alternatives considered**:

- **Gitignore entire `.superspec/patterns/`**: Rejected — loses shareable team patterns.
- **Commit index**: Rejected — merge conflicts and non-canonical drift vs FR-010.

## Data Model

### Entities

**Pattern** (canonical markdown + index projection)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `pat_` + ulid or uuid; filename `<id>.md` |
| `createdAt` | ISO8601 | Set on create |
| `updatedAt` | ISO8601 | Touch on consolidate merge |
| `kind` | `success` \| `failure` \| `routing` | From outcome |
| `signals.frTags` | string[] | e.g. `FR-012` |
| `signals.taskKind` | TaskKind | From plan |
| `signals.stack` | string[] | Optional tags from plan or config |
| `signals.engine` | string? | Harness/engine id when known |
| `signals.errorClass` | string? | Derived from reviewer report on failure |
| `signals.featureId` | string? | Feature slug from spec dir |
| `summary` | markdown string | Bounded; body below frontmatter |
| `evidenceRefs` | string[] | Task id, report paths under spec `.superspec/reports/` |
| `score` | number? | JUDGE retrieval score last used |
| `useCount` | integer | Increment when injected |
| `status` | `active` \| `archived` | CONSOLIDATE demotes duplicates |

**PatternStore**

- Partition: one store per repository root (`<repository-root>/.superspec/patterns/`).
- Invariant: markdown file exists iff `status=active` index row exists (archived may remain in index with lower rank or excluded from RETRIEVE by default).
- Rebuild: `reindex()` scans `*.md`, parses frontmatter, recreates FTS.

**RetrieveContext** (extends P-001 contract)

| Field | Source |
|-------|--------|
| `featureId` | Derived from `specs/<feature>/` path |
| `taskId` | Argument |
| `implementsFr` | Plan task |
| `kind`, `complexity` | Plan task |
| `capabilityTags` | Plan task (future P-005; optional v1) |
| `stack` | Config defaults + plan hints |
| `engine` | Last `route-model` harness or null |
| `errorClass` | Prior failure report optional |

**InjectionSummary** (P-001)

- `text`: markdown section, ≤ configured cap (default 2048 bytes UTF-8).
- `patternIds`: ids included for traceability.

**DistillContext** (extends P-001 contract)

| Field | Source |
|-------|--------|
| `featureId`, `taskId`, `passed`, `reviewFailures` | P-001 base |
| `kind`, `implementsFr` | Plan task at record time |
| `implementerReport`, `reviewerReport` | Optional paths from `record-result` args |
| `engine` | Optional harness string |

### Markdown file shape (canonical)

```markdown
---
id: pat_01JABC...
kind: failure
createdAt: 2026-10-15T12:00:00.000Z
updatedAt: 2026-10-15T12:00:00.000Z
signals:
  frTags: [FR-012]
  taskKind: code
  stack: [typescript]
  featureId: 003-ira-learning-memory
evidenceRefs:
  - task:T004
  - report:specs/003-ira-learning-memory/.superspec/reports/T004-reviewer.md
useCount: 0
status: active
---

Bounded lesson markdown (no secrets).
```

### SQLite index (derived)

Tables (conceptual):

- `patterns_meta` — id, kind, status, feature_id, task_kind, use_count, updated_at
- `patterns_fts` — FTS5 on summary + signal text blob for keyword retrieval
- `patterns_signals` — normalized fr_tag rows for equality prefilter

Invariant: rebuild from markdown must produce identical RETRIEVE results for the same query fixtures.

### State transitions

- **Create**: DISTILL validates → write temp md → rename → upsert index → CONSOLIDATE bucket.
- **Inject**: RETRIEVE → JUDGE → increment `useCount` on selected ids (async best-effort).
- **Archive**: CONSOLIDATE marks loser `status=archived`; file moved to `archive/<id>.md` or frontmatter flag only (implementation choice: frontmatter `status` without delete).

## Contracts

### P-001 `LearningHooks` implementation

Declared in `packages/core/src/command-plane/hooks.ts` (P-001). P-003 implements:

```ts
export interface LearningHooks {
  retrieve?(ctx: RetrieveContext): Promise<InjectionSummary | null>;
  distill?(ctx: DistillContext): Promise<void>;
}
```

**Registration**: `installLearningMemory({ projectRoot })` calls `registerCommandPlaneHooks({ learning: createLearningHooks(projectRoot) })` when command-plane module is loaded; also exports `createLearningHooks` for tests.

**Call order** (P-001 normative):

- Before dispatch / on brief paths: `LearningHooks.retrieve` first among extension hooks.
- On `record-result` after forge save returns to caller (hive or not): schedule `LearningHooks.distill` before `TokenHooks.onRecordResult` when both registered — neither hook may block the forge success response (OD-016). Hook throws caught at P-001 boundary (OD-015).

P-003 additionally invokes RETRIEVE inside core forge tools so standalone forge benefits without hive. RETRIEVE uses FTS when available; otherwise capped markdown scan.

### Forge tool extensions (additive, FR-011)

Behavior when `learning.json` has `enabled: false` or feature-scoped disable: no injection, no distill; tools behave as today.

#### `begin-task`

After `saveState`, if retrieve enabled:

1. Build `RetrieveContext` from plan + `taskId`.
2. Run RETRIEVE → JUDGE.
3. Append section to formatted report:

```markdown
## Prior patterns (learning memory)

<text from InjectionSummary or omitted if null>
```

Verbose=false still includes a one-line count when injections present.

#### `record-result`

After `saveState` and optional status/coordinator writes:

1. Sync hive when present.
2. **Return** forge success JSON to CLI/MCP caller (exit 0).
3. **Schedule** (do not await on the handler stack) background pipeline: DISTILL (hard timeout) → optional CONSOLIDATE on success. Slice A: skip distill write (`SLICE_A_ONLY`).
4. Learning errors in background: log only; never change exit code or forge state for the returned call.
5. Verbose on the synchronous path MAY note `patterns: distill scheduled`; background completion MAY log `patterns: distilled 1` or `patterns: skipped (reason)`.

Existing args `implementerReport`, `reviewerReport`, `specDir`, `planPath` feed `DistillContext`.

Forbidden: awaiting DISTILL, distill timeout, or CONSOLIDATE before step 2 returns (OD-016).

#### `route-model`

Response JSON gains optional additive fields (stable for consumers):

```json
{
  "tier": "economy",
  "patternHint": "Optional single-line JUDGE-approved hint when task context passed",
  "patternIds": ["pat_..."]
}
```

New optional request fields: `taskId`, `planText` or `implementsFr[]`, `featureId` — when absent, route-model behavior unchanged (no pattern fields).

#### `coordinator-brief`

When `nextTask` is non-null and retrieve enabled, inject under `## Current position`:

```markdown
### Prior patterns for next task

<InjectionSummary.text>
```

### Read-only query surface (FR-012, SC-007)

#### MCP tool: `patterns-list`

```json
{
  "projectRoot": "/abs/repo",
  "featureId": "003-ira-learning-memory",
  "frTag": "FR-012",
  "kind": "failure",
  "limit": 20,
  "cursor": null
}
```

Response:

```json
{
  "patterns": [
    {
      "id": "pat_...",
      "kind": "failure",
      "signals": { "frTags": ["FR-012"], "taskKind": "code" },
      "summaryPreview": "First 240 chars...",
      "evidenceRefs": ["task:T004"],
      "useCount": 2,
      "updatedAt": "2026-10-15T12:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

Errors: `PATTERNS_STORE_UNREADABLE` (corrupt index) — partial results with `warnings[]` when possible; never throw for empty store.

#### CLI

| Command | Purpose |
|---------|---------|
| `superspec patterns list` | Same filters as MCP; JSON to stdout |
| `superspec patterns show --id` | Full summary for one pattern |
| `superspec patterns reindex` | Rebuild SQLite from markdown |

### Configuration (`<repo>/.superspec/learning.json`)

```json
{
  "enabled": true,
  "retrieve": true,
  "distillEnabled": true,
  "maxInjectionBytes": 2048,
  "maxSummaryBytes": 1024,
  "judgeMinScore": 0.35,
  "distill": { "mode": "heuristic" },
  "features": {
    "003-ira-learning-memory": { "distillEnabled": false }
  }
}
```

Missing file → all defaults on except no feature overrides.

### Integration points

| Integration | Protocol | Notes |
|-------------|----------|-------|
| Forge loop | In-process | After `saveState` in begin-task / record-result |
| Command Plane P-001 | `LearningHooks` + `registerCommandPlaneHooks` | Same implementation; `patternSummary` on dispatch intent |
| Model router | In-process | Optional model distill; route-model hint path |
| Coordinator ledger | File append | Prior patterns section in coordinator.md |
| Command Center P-002 | MCP/CLI JSON | Read-only; no UI in P-003 |

No network calls in core learning paths.

### Consumed From Other Specs

| Source spec | Contract | Version / stability | Notes |
|-------------|----------|---------------------|-------|
| `specs/001-ira-command-plane` | `LearningHooks.retrieve` and `LearningHooks.distill` | v1 | Call order around dispatch and record-result; retrieve text maps to dispatch `patternSummary` when hive present |

### Produced For Other Specs

| Target spec / consumer | Contract | Version / stability | Notes |
|------------------------|----------|---------------------|-------|
| `specs/001-ira-command-plane` | `LearningHooks` implementation | v1 | Registered at install |
| `specs/002-ira-command-center` | `patterns-list` MCP + CLI JSON | v1 additive | Memory panel read path |
| `specs/004-ira-token-context` | Distill before `TokenHooks.onRecordResult` | v1 | Preserves P-001 ordering |

### Event schema

v1 does not append hive `events.jsonl` entries for patterns (optional P-002 timeline later). Forge verbose output and stderr structured logs carry `learning.phase=distill|retrieve|consolidate` for tests.

---

## Appendix: FR Coverage

| FR | Where this design satisfies it |
|----|--------------------------------|
| FR-001, FR-001a | Non-blocking DISTILL after `saveState` return; hooks + background pipeline |
| FR-011a | CONSOLIDATE off `record-result` stack |
| FR-002 | `.superspec/patterns/` durable paths |
| FR-003 | RETRIEVE on begin-task, route-model, coordinator-brief, `LearningHooks.retrieve` |
| FR-004 | Four-phase pipeline table; no neural training |
| FR-005 | Signal fields in pattern frontmatter + index |
| FR-006 | Store outside spec `.superspec/state.json` and chat |
| FR-007 | Summary caps + `redact.ts` |
| FR-008 | JUDGE module + injection cap |
| FR-009 | CONSOLIDATE after DISTILL |
| FR-010 | Hybrid md + optional FTS sqlite; markdown scan fallback; reindex; gitignore index |
| FR-011 | Additive forge/MCP fields; works without hive; hook throws isolated (OD-015) |
| FR-012 | `patterns-list` MCP + CLI |
| FR-013 | `evidenceRefs` in frontmatter |
| FR-014 | `learning.json` disable flags |

<!-- Adapted from SK: templates/design-template.md (MIT). See /NOTICE. -->
