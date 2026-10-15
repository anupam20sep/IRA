# Program Backlog

**Mode**: full  
**Program**: Ira (Intelligent Resource Automation)  
**Last updated**: 2026-09-06T00:55:00+05:30  
**Requirements source**: `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md`

Multi-spec workstream tracker for Ira. Each row is owned by the agent/human working that spec — edit only your row; re-read this file before updating.

## Backlog

| ID | Feature | Priority | Owner | Stage | Spec Path | Notes |
|----|---------|----------|-------|-------|-----------|-------|
| P-001 | ira-command-plane | P1 | @composer | refine | specs/001-ira-command-plane | Scope done (28 FR, lint pass). 3 clarifications → OD-005–007 |
| P-002 | ira-command-center | P1 | @grok | refine | specs/002-ira-command-center | Scope done; lint pass. Visual → OD-001; voice → OD-003 |
| P-003 | ira-learning-memory | P1 | @composer | refine | specs/003-ira-learning-memory | Scope done (14 FR, lint pass). OD-002 open |
| P-004 | ira-token-context | P1 | @grok | refine | specs/004-ira-token-context | Scope done; lint pass |
| P-005 | ira-hire-gallery | P2 | @composer | refine | specs/005-ira-hire-gallery | Scope done (12 FR, lint pass). Gallery trust → OD-008 |
| P-006 | ira-engine-adapters | P2 | @grok | refine | specs/006-ira-engine-adapters | Scope done; lint pass |
| P-007 | ira-integrations | P3 | @composer | deferred | specs/007-ira-integrations | INT-* Hermes/OpenClaw nice-to-have |

## Open Decisions

| ID | Decision | Affects | Owner | Status | Resolution |
|----|----------|---------|-------|--------|------------|
| OD-001 | Command Center visual language (KITT/Arc/holographic hybrid, original) | P-002 | Operator | open | — |
| OD-002 | Pattern store tech (markdown vs SQLite FTS vs local embeddings vs hybrid) | P-003 | Operator | open | From FR-010 |
| OD-003 | Voice timing for Ira | P-002 | Operator | open | Deferred beyond initial specs |
| OD-004 | Prefer adapt/copy from Munder+Ruflo vs greenfield | All | Operator | resolved | Prefer reference/adapt MIT-licensed patterns; cite paths in each spec Required Reading / Prior Art |
| OD-005 | Night mode v1 trigger catalog (CI webhook vs forge-status poll vs cron) | P-001 | Operator | open | From FR-026 |
| OD-006 | Default replan attempt budget before Ask-Me/block | P-001 | Operator | open | From FR-027; candidate: reuse forge maxReviewFailures |
| OD-007 | Hive store path (project `.superspec/hive/` vs user-global) | P-001 | Operator | open | From FR-028; candidate: project-local |
| OD-008 | Gallery trust tiers (curated vs always-full untrusted review) | P-005 | Operator | open | Default: same review path, lighter copy for curated |

## Prior Art Index (reuse first)

### Munder Difflin (MIT) — https://github.com/chaitanyagiri/munder-difflin

| Concern | Upstream reference |
|---------|-------------------|
| Hive design | `HIVE.md`, `MEMORY_GRAPH_SPEC.md` |
| Command Center | blog + `CommandCenterPanel`, `TasksKanban`, `AskMeTab` (see repo `src/renderer`) |
| Hire gallery | https://munderdiffl.in/blog/how-to-hire-from-the-agent-gallery/ ; hire manifest untrusted-input posts |
| Budgets / cost | Command Center guide: per-agent budgets, circuit breaker, transcript cost ledger |
| Multi-engine | README supported agents / engine presets |

### Ruflo (MIT) — https://github.com/ruvnet/ruflo

| Concern | Upstream reference |
|---------|-------------------|
| Learning loop | `plugins/ruflo-intelligence/README.md` — RETRIEVE→JUDGE→DISTILL→CONSOLIDATE |
| Pattern/memory skills | `.agents/skills/agentdb-*`, `reasoningbank-*`, `memory-management` |
| Orchestrator≠executor | `AGENTS.md` division of labor |
| Policy / doctor | metaharness docs; policy verify commands |

### SuperSpec (this repo)

| Concern | Path |
|---------|------|
| Forge loop | `packages/core/src/forge-loop.ts`, MCP forge tools |
| Personas | `packages/core/src/persona-discovery.ts` |
| Model tiers | `packages/core/src/model-router.ts` |
| Dispatch | `docs/explanation/dispatch-and-context.md` |

## Learnings

- Ira = Intelligent Resource Automation (GOD persona callsign **Ira**).
- Delivery: Option D (core/MCP + web Command Center).
- Hermes/OpenClaw = nice-to-have only (P-007 deferred).
