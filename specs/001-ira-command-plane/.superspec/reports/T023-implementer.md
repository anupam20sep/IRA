# T023 Implementer Report: Public package exports

**Status:** DONE  
**Implements:** FR-018

## What was implemented

- Re-exported the full command-plane barrel from `packages/core/src/index.ts` via `export * from "./command-plane/index.js"`, surfacing `registerCommandPlaneHooks`, `IRA_PERSONA`, hook types, store helpers, schemas, paths, and hive init symbols on the public `@superspec-dev/core` entry.
- Extended `packages/core/test/smoke.test.ts` with a `core exports` test matching the plan (imports from `@superspec-dev/core`).
- Added a Vitest resolve alias in `vitest.config.ts` so monorepo tests can import `@superspec-dev/core` against source `index.ts` without a pre-build or self-referential devDependency.

## TDD evidence

### RED

Command: `pnpm exec vitest run packages/core/test/smoke.test.ts -t "exports"` (before `index.ts` change, with plan import once alias added)

```
TypeError: Cannot read properties of undefined (reading 'callsign')
```

Expected: `IRA_PERSONA` was not exported from the package entry.

### GREEN

Command: `pnpm exec vitest run packages/core/test/smoke.test.ts`

```
✓ packages/core/test/smoke.test.ts (2 tests)
Test Files  1 passed (1)
Tests  2 passed (2)
```

### REFACTOR

No behavioral refactor; alias kept minimal (single package entry mapping).

Full suite: `pnpm exec vitest run packages/core/test` — **389/389 passing**.

## Files changed

- `packages/core/src/index.ts`
- `packages/core/test/smoke.test.ts`
- `vitest.config.ts` (resolve alias for `@superspec-dev/core` in tests)

## Self-review

- `export *` from `command-plane/index.ts` matches design.md (“re-export command-plane public types and hooks”) without duplicating symbol lists.
- Did not modify `contracts.test.ts` or `integration-forge-hive.test.ts` per task constraints.
- Vitest alias is outside the plan’s two-file list but required for the prescribed `@superspec-dev/core` import to resolve in this workspace.

## Concerns

- Published consumers still need `pnpm build` in `packages/core` for `dist/index.js` to include new exports until the next release build; tests use the alias to source.
