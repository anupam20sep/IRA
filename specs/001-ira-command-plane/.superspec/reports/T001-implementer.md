# T001 Implementer Report: Hive Zod schemas and shared types

**Status:** DONE  
**Implements:** FR-012, FR-015, FR-025, FR-024, FR-030  
**Commit range:** `975e005f940be2b47cf6d8710900e6c9bbcdd3e4`..`e29c0cf`

## What was implemented

- `packages/core/src/command-plane/schema.ts` — Zod parsers aligned with `design.md` Data Model: hive manifest (`HiveManifestSchema`), autonomy settings with `allowAbsentCi` optional and normalized to `false` on parse via `.transform`, ledger task (`HiveTaskSchema` with `hold` default `false` and optional `abortReason`), ledger envelope (`HiveLedgerSchema`), Ask-Me (`AskMeItemSchema`), append-only events (`IraEventSchema`), plus supporting schemas (Brief, RosterAgent, replan, persona) for downstream tasks.
- `packages/core/src/command-plane/types.ts` — `COMMAND_PLANE_ERROR_CODES` const array matching design Contracts (including `DISPATCH_PATH_REQUIRED`, `DISPATCH_HELD`, `HIVE_NOT_READY`, `SLICE_A_ONLY`, `HOOK_FAILED_CLOSED`) and inferred TypeScript types exported from schemas.
- `packages/core/test/command-plane/schema.test.ts` — acceptance-focused tests from plan T001 plus manifest, Ask-Me, event, and error-code coverage.

## TDD evidence

### RED

```bash
pnpm exec vitest run packages/core/test/command-plane/schema.test.ts
```

```
Error: Failed to load url ../../src/command-plane/schema.js
Does the file exist?
```

Expected: module missing before implementation.

### GREEN

```bash
pnpm exec vitest run packages/core/test/command-plane/schema.test.ts
```

```
✓ packages/core/test/command-plane/schema.test.ts (7 tests)
Test Files  1 passed (1)
Tests  7 passed (7)
```

### REFACTOR

No behavioral refactor required after green. Full workspace suite re-run:

```bash
pnpm exec vitest run
```

```
Test Files  31 passed (31)
Tests  173 passed (173)
```

## Files changed

| File | Action |
|------|--------|
| `packages/core/src/command-plane/schema.ts` | Created |
| `packages/core/src/command-plane/types.ts` | Created |
| `packages/core/test/command-plane/schema.test.ts` | Created |

## Self-review

- `allowAbsentCi` uses optional input + transform default `false`, matching OD-013 / amendment.
- `hold` uses Zod `.default(false)` on ledger tasks.
- `featureId` / `agentId` regexes match design path segment rules.
- `types.ts` imports schema types only (no circular import).
- Did not modify T002/T003/T004 files.

## Concerns

- `constitution.md` was not at repo root; followed workspace SuperSpec rules and `design.md` + LOCKED amendment instead.
- `IraEventSchema.data` is a generic record; event-type allowlists may be tightened in a later contract task if needed.

## Commits

- `d1dd3b3` feat(command-plane): hive schemas with hold and allowAbsentCi
- `e29c0cf` test(command-plane): cover HiveLedgerSchema parse

## Review follow-up (T001-reviewer)

**Gap:** `HiveLedgerSchema` had no parse test (FR-012 ledger facet).

**Fix:** Added `describe("HiveLedgerSchema")` in `schema.test.ts` — parses minimal valid ledger envelope with one nested task; asserts `featureId`, `tasks.length`, and nested `hold` default.

**TDD (follow-up):** Schema already existed; test-only addition. Ran `pnpm exec vitest run packages/core/test/command-plane/schema.test.ts` → **8/8 passing**. No schema code changes required.
