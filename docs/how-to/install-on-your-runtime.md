# Install on your runtime

---

## Claude Code (recommended)

```bash
claude plugin marketplace add anupam20sep/superspec
claude plugin install superspec@superspec-dev
```

Includes skills, agents (`implementer`, `task-reviewer`), hooks, and MCP via repo `.mcp.json` → `npx @superspec-dev/core mcp`.

Restart or `/reload-plugins` after install.

---

## Cursor

```
/add-plugin superspec
```

Skills ship from plugin `skills/`. Add MCP manually — create `.cursor/mcp.json`:

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

Restart Cursor.

---

## Codex

```bash
codex plugin marketplace add anupam20sep/superspec
# or local clone:
codex plugin marketplace add /path/to/SuperSpec

codex plugin add superspec@superspec-dev
codex plugin list --available -m superspec-dev   # should show superspec
```

Then open `/plugins` (TUI) or ChatGPT **Work mode** → Plugins Directory → **SuperSpec**.

Includes:

- Skills from `./skills/`
- MCP via `.codex-plugin/plugin.json` → `./.mcp.json` (`npx @superspec-dev/core mcp`)
- SessionStart hook (`hooks/hooks-codex.json`) — **approve in `/hooks`** after install (Codex skips untrusted plugin hooks)

**Marketplace path:** `.agents/plugins/marketplace.json` uses `"path": "./"` (plugin = repo root). Requires Codex CLI **≥ 0.142**. The earlier `"../.."` path is rejected by Codex (parent traversal), so the marketplace loads with **zero plugins**.

If you already added the marketplace and see no plugin:

```bash
codex plugin marketplace remove superspec-dev
codex plugin marketplace add anupam20sep/superspec   # or local path
codex plugin add superspec@superspec-dev
```

**Dual marketplace:** the repo also ships `.claude-plugin/marketplace.json`. If both sources list SuperSpec, install **once** from the Codex marketplace (`.agents/plugins`) and disable the duplicate.

Forge dispatch: [Dispatch on Codex](dispatch-on-codex.md). Acceptance: [Codex](../acceptance/codex.md).

---

## MCP only (any editor)

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

Skills still work from the plugin; without MCP, run CLI via `npx @superspec-dev/core …` in the terminal.

---

## Bootstrap a project

```bash
npx -y @superspec-dev/core@latest init --root . --mode lite --verbose
# Optional model overrides:
# npx -y @superspec-dev/core@latest init --root . --mode lite --with-models --verbose
```

| Mode | Creates |
|------|---------|
| `lite` | `constitution.md`, `specs/`, templates (+ `models.example.yaml` reference) |
| `full` | Above + `program.md` for multi-spec coordination |

`--with-models` is optional and off by default. Without `.superspec/models.yaml`, forge uses built-in tier defaults.

---

## Requirements

- Node.js on PATH (for `npx @superspec-dev/core`)
- Git repository (for forge commits and worktrees)

---

## Related

- [Your first feature](../tutorials/your-first-feature.md)
- [CLI and MCP tools](../reference/cli-and-mcp-tools.md)
