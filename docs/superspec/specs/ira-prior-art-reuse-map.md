# Ira — Prior Art & Reuse Map

Prefer **adapting** these MIT-licensed upstream modules over greenfield invention. Cite them in each feature’s `spec.md` under Required Reading / Prior Art. Formal FRs stay WHAT/WHY; paths guide later `architect`/`forge`.

## Munder Difflin

Repo: https://github.com/chaitanyagiri/munder-difflin (MIT)

| Ira concern | Copy/adapt from |
|-------------|-----------------|
| Hive layout, inbox/outbox, PROTOCOL | `HIVE.md`; `src/main/hive.ts` |
| Task ledger | `src/shared/taskLedger.ts` |
| Ask-Me / HITL | `src/renderer/src/components/AskMeTab.tsx`; `askMeOrder.ts` |
| Command Center shell | `src/renderer/src/components/CommandCenterPanel.tsx` |
| Kanban | `src/renderer/src/components/TasksKanban.tsx` |
| Fleet / workers | `src/renderer/src/components/WorkersTab.tsx` |
| Cost ledger | `src/main/costLedger.ts`; `src/main/realtimeCost.ts`; `CostHud.tsx`; `costStore.ts` |
| Memory panels | `src/main/memory.ts`; `MemoryPanel.tsx`; `MemoryGraphPanel.tsx` |
| Hire manifests | `src/main/hire.ts`; `src/shared/hire.ts`; `src/shared/hireQueue.ts` |
| Docs | https://munderdiffl.in/blog/command-center-guide/ ; hire gallery + untrusted-input posts |

## Ruflo

Repo: https://github.com/ruvnet/ruflo (MIT)

| Ira concern | Copy/adapt from |
|-------------|-----------------|
| Learning pipeline | `plugins/ruflo-intelligence/README.md` |
| Pattern/memory skills | `.agents/skills/agentdb-memory-patterns/SKILL.md`; `reasoningbank-intelligence/SKILL.md`; `memory-management/SKILL.md` |
| Orchestrator vs executor | `AGENTS.md` |
| Swarm init (topology ideas only) | `.agents/skills/agent-coordinator-swarm-init/SKILL.md` |
| MetaHarness / doctor | `docs/metaharness-user-guide.md` |

## SuperSpec (extend, don’t fork)

| Concern | Path |
|---------|------|
| Forge state machine | `packages/core/src/forge-loop.ts` |
| Personas | `packages/core/src/persona-discovery.ts` |
| Model tiers | `packages/core/src/model-router.ts` |
| MCP surface | `packages/core/src/mcp-server.ts` |
| Requirements parent | `docs/superspec/specs/2026-09-06-agent-command-plane-requirements.md` |

## License note

When adapting code, preserve MIT attribution (NOTICE / file headers) and do not copy LimeZu pixel assets from Munder.
