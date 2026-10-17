# Status: 007-ira-integrations

**Last updated**: 2026-10-17T17:35:55.820Z
**Tasks**: 11/11 done · 0 in progress · 0 blocked · 0 pending

## Functional requirements

| FR | Status | Tasks | Requirement |
| --- | --- | --- | --- |
| FR-001 | ✅ done | T008, T010, T011 | System MUST provide full Ira Command Plane capability without Hermes, OpenClaw,  |
| FR-002 | ✅ done | T001, T002, T009, T011 | System MUST expose a disable-able integration registry; every adapter defaults t |
| FR-003 | ✅ done | T003, T004, T006, T010, T011 | Optional adapters MUST NOT expand autonomy past Ira HITL critical class without  |
| FR-004 | ✅ done | T004, T011 | System MUST provide an optional OpenClaw adapter that can map channel messages t |
| FR-005 | ✅ done | T005, T011 | System MUST provide an optional Hermes adapter configuration that fronts SuperSp |
| FR-006 | ✅ done | T006, T011 | System MUST provide an optional channel-approve bridge (Slack/Telegram/phone) th |
| FR-007 | ✅ done | T007, T009, T011 | System MUST provide optional shareable board read access via a share token disti |
| FR-008 | ✅ done | T005, T008, T011 | Doctor MUST report adapter health separately from `hiveReady` / `engineRungReady |
| FR-009 | ✅ done | T003, T011 | Adapter crashes or throws MUST be fail-closed for that adapter only; Command Pla |

## Task progress

| Task | Status | FRs | Title |
| --- | --- | --- | --- |
| T001 | done | FR-002 | Integration config schema and defaults |
| T002 | done | FR-002 | Load and persist integration config |
| T003 | done | FR-003, FR-009 | Fail-closed adapter runner |
| T004 | done | FR-004, FR-003 | OpenClaw channel → Ask-Me mapping |
| T005 | done | FR-005, FR-008 | Hermes adapter health and degrade |
| T006 | done | FR-006, FR-003 | Channel approve → ask-me-answer |
| T007 | done | FR-007 | Board share token create/verify |
| T008 | done | FR-008, FR-001 | Integration doctor findings |
| T009 | done | FR-002, FR-007 | CLI + MCP integrations surface |
| T010 | done | FR-001, FR-003 | Standalone + no-hire-spawn integration proofs |
| T011 | done | FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009 | Public exports and verify gate |

## Notes

This file is updated by `@superspec-dev/core sync-status` (or MCP `sync-status`) during forge. Commit it to share FR progress with your team.
