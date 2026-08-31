# Dispatch on Cursor

> Spawn implementer and task-reviewer subagents with the `Task` tool.

---

## Agent bodies

| Role | File |
|------|------|
| Implementer | `agents/implementer.md` |
| Task reviewer | `agents/task-reviewer.md` |

Optional: copy to `.cursor/agents/` for `list-personas` discovery.

---

## Implementer dispatch

```text
Task({
  subagent_type: "generalPurpose",
  model: "<routed implementer model>",
  description: "Implement T001",
  prompt: """
  Follow agents/implementer.md. Zero prior context except the task brief.

  Task: T001 — [title]
  FR: FR-001
  Acceptance criteria: [verbatim]

  TDD: red → green → refactor. Run tests. Commit.
  Return BASE_SHA..HEAD_SHA and summary.
  """
})
```

---

## Reviewer dispatch

Separate dispatch — **no implementer conversation history**. Read-only.

```text
Task({
  subagent_type: "code-reviewer",
  model: "<routed reviewer model>",
  readonly: true,
  description: "Review T001",
  prompt: """
  Follow agents/task-reviewer.md. Read-only.

  [Filled task-reviewer.md: criteria, constitution, diff, commits]

  Both verdicts required: spec compliance + code quality.
  """
})
```

---

## Fix loop

```text
Task({ resume: "<implementer-agent-id>", prompt: "Fix: [reviewer findings]" })
```

Then re-run reviewer as a **new** `Task` dispatch.

---

## MCP setup

Add `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "superspec": {
      "command": "npx",
      "args": ["-y", "@superspec-dev/core@0.2.15", "mcp"]
    }
  }
}
```

Restart Cursor after changes.

---

## Inline fallback

When `Task` is unavailable, implement then run `task-reviewer.md` checklist in an explicit **review boundary** before `record-result`. See [superspec-forge](../../skills/superspec-forge/SKILL.md).

---

## Related

- [Cursor tool reference](../../skills/references/cursor-tools.md)
- [Dispatch on Claude Code](dispatch-on-claude-code.md)
