# Status: 005-ira-hire-gallery

**Last updated**: 2026-10-17T15:11:27.003Z
**Tasks**: 22/22 done · 0 in progress · 0 blocked · 0 pending

## Functional requirements

| FR | Status | Tasks | Requirement |
| --- | --- | --- | --- |
| FR-001 | ✅ done | T007, T008, T018, T022 | System MUST allow the Operator to initiate a hire from a manifest file or from a |
| FR-002 | ✅ done | T001, T002, T022 | System MUST represent every hire as a versioned manifest containing at minimum:  |
| FR-003 | ✅ done | T005, T010, T011, T012, T022 | System MUST NOT spawn or start any worker agent on manifest import, gallery sele |
| FR-004 | ✅ done | T003, T022 | System MUST treat manifests from network or shared sources as untrusted input: v |
| FR-005 | ✅ done | T010, T019, T022 | On confirmed spawn, system MUST install or update portable persona definitions i |
| FR-006 | ✅ done | T009, T022 | System MUST require explicit Operator consent before installing any skill refere |
| FR-007 | ✅ done | T004, T013, T014, T022 | Ira MUST route dispatchable work to hires by matching task capability requiremen |
| FR-008 | ✅ done | T015, T022 | System SHOULD compute and persist a hire performance score from task outcomes (p |
| FR-009 | ✅ done | T008, T016, T017, T021, T022 | System MUST expose hire flows through Command Plane API (CLI and MCP) so the sam |
| FR-010 | ✅ done | T001, T003, T022 | System MUST default to deny-all for skills and MCP unless explicitly allowlisted |
| FR-011 | ✅ done | T005, T006, T012, T014, T020, T022 | System MUST classify untrusted hire import as HITL-critical: pending imports app |
| FR-012 | ✅ done | T009, T010, T022 | Operator MUST be able to edit engine, model tier, budget, goal, capability tags, |
| FR-013 | ✅ done | T003, T006, T008, T020, T022 | Curated gallery entries and remote or shared manifests MUST use the same review  |
| FR-014 | ✅ done | T008, T010, T012, T014, T020, T022 | `hire-spawn-confirm` MUST be the only command that writes portable persona files |

## Task progress

| Task | Status | FRs | Title |
| --- | --- | --- | --- |
| T001 | done | FR-002, FR-010 | Hire Zod schemas and shared types |
| T002 | done | FR-002 | Manifest parse (YAML/JSON) and size gates |
| T003 | done | FR-004, FR-010, FR-013 | Sanitization, allowlist, and executable rejection |
| T004 | done | FR-007 | Capability tag normalization helpers |
| T005 | done | FR-003, FR-011 | HireReview persistence under hive |
| T006 | done | FR-011, FR-013 | Ask-Me `untrusted_import` on review open |
| T007 | done | FR-001 | Curated gallery index load and search |
| T008 | done | FR-001, FR-009, FR-013, FR-014 | Unified `hire-import` pipeline (file, url, paste, gallery) |
| T009 | done | FR-012, FR-006 | Review form updates and skill consent records |
| T010 | done | FR-003, FR-005, FR-012, FR-014 | `hire-spawn-confirm` — persona files and roster upsert |
| T011 | done | FR-003 | Spawn rollback and duplicate-name conflict |
| T012 | done | FR-003, FR-011, FR-014 | Cancel, acknowledge, and reject spawn paths |
| T013 | done | FR-007 | `HireHooks.matchCapabilities` implementation |
| T014 | done | FR-007, FR-011, FR-014 | Register hire hooks at CLI/MCP bootstrap |
| T015 | done | FR-008 | Hire performance score and demotion hints |
| T016 | done | FR-009 | CLI `superspec hire` subcommands |
| T017 | done | FR-009 | MCP hire tools and contract tests |
| T018 | done | FR-001 | Shipped curated catalog provision |
| T019 | done | FR-005 | `list-personas` integration after spawn |
| T020 | done | FR-011, FR-013, FR-014 | End-to-end curated vs untrusted import integration |
| T021 | done | FR-009 | Public exports for hire module |
| T022 | done | FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014 | Verify hire suite, matrix, and lint-plan |

## Notes

This file is updated by `@superspec-dev/core sync-status` (or MCP `sync-status`) during forge. Commit it to share FR progress with your team.
