# Dispatch and context

> Why SuperSpec runs implement and review in fresh subagents, and how the orchestrator stays lean.

---

## The problem: context rot

Long agent sessions accumulate tokens — diffs, test output, review findings, MCP JSON. As the window fills, quality degrades quietly: earlier constraints get less attention, style drifts, plans ignore buried requirements.

SuperSpec addresses this at two layers:

1. **Workers** — implementers and reviewers start with **fresh context** per task.
2. **Coordinator** — the forge session routes, records state, and reads **files on disk** instead of relying on conversation memory.

---

## Thin orchestrator, heavy subagents

The forge coordinator should:

- Call `next-task`, `begin-task`, `record-result`, `sync-status`, `forge-status`
- Dispatch `agents/implementer.md` and `agents/task-reviewer.md` with filled task briefs
- **Not** implement or review in the coordinator thread when subagents are available

Heavy work (TDD, commits, independent review) happens in subagents that terminate when done. The coordinator only needs summaries and artifact paths — not full diffs in chat history.

---

## Filesystem as shared memory

Conversation memory does not survive compaction. These artifacts do:

| Artifact | Purpose |
|----------|---------|
| `specs/<feature>/spec.md` | Requirements contract (`FR-###`) |
| `specs/<feature>/plan.md` | TDD-executable tasks |
| `specs/<feature>/status.md` | FR + task progress (committed) |
| `specs/<feature>/.superspec/state.json` | Machine forge state (gitignored) |
| `specs/<feature>/.superspec/coordinator.md` | **Lean loop handoff** — coordinator re-reads after compaction (gitignored) |
| `specs/<feature>/.superspec/reports/` | Per-task implementer/reviewer reports (gitignored) |
| `constitution.md` | Non-negotiable Test-First + traceability rules |

After restart or compaction: trust `coordinator.md`, `status.md`, `state.json`, and `git log` — not memory.

### Lean coordinator loop

Long forges should use `coordinator-init` / `coordinator-brief` (CLI or MCP with **file paths only**) so the coordinator thread stays a one-line-per-task loop. See `superspec-forge` → **Lean Coordinator Loop**.

---

## Per-task dispatch pattern

For every task `T00X`:

```
route-model → next-task → begin-task
  → dispatch implementer (red-green-refactor, commit)
  → dispatch task-reviewer (read-only, spec + quality verdicts)
  → on fail: resume implementer with findings → re-review
  → on pass: record-result --passed true --spec …
  → sync-status
```

See [Run the forge loop](../how-to/run-the-forge-loop.md) for CLI/MCP commands and platform-specific dispatch ([Claude Code](../how-to/dispatch-on-claude-code.md), [Cursor](../how-to/dispatch-on-cursor.md)).

---

## Related

- [superspec-forge skill](../../skills/superspec-forge/SKILL.md) — full forge loop skill
- [Traceability spine](traceability-spine.md)
