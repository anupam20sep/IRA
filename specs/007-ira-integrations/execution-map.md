# Execution Map: ira-integrations

**Feature:** `007-ira-integrations`  
**Plan:** `plan.md` (T001–T011)

## Windows

| Window | Tasks | Tier | Notes |
|--------|-------|------|-------|
| W1 Schema | T001 | economy | Config Zod defaults |
| W2 Persist + fail-closed | T002, T003 | economy / standard | Parallel OK |
| W3 Adapters | T004, T005, T006, T007 | frontier / standard | T004+T006 complex; T005+T007 parallel |
| W4 Doctor | T008 | standard | After adapter modules exist |
| W5 Surfaces | T009 | standard | CLI/MCP |
| W6 Proofs | T010 | frontier | SC-001/SC-003 |
| W7 Verify | T011 | economy | Suite + matrix + tsc |

## Verification Gates

| Gate | Criteria | Blocks |
|------|----------|--------|
| Integrations vitest | `pnpm exec vitest run packages/core/test/integrations` exit 0 | forge |
| No hire-spawn from channel | T010 proof | forge |
| Doctor severity | Missing adapters ≠ error clearing hiveReady | forge |
| lint-plan / build-matrix | 0 findings / 0 FR gaps | validate |
| Typecheck | `tsc --noEmit` exit 0 | ship |

## Rollback

Revert `packages/core/src/integrations/**` and CLI/MCP registration commits; hive `integrations/` dir safe to delete.
