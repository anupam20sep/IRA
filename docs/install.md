# Installing SuperSpec

SuperSpec is a spec-driven + TDD-driven AI development plugin for Claude Code, Cursor, and OpenAI Codex.

## Claude Code

### Install from GitHub (recommended)

No clone required. The plugin ships skills, agents, hooks, and MCP from the public repo.

```bash
claude plugin marketplace add anupam20sep/superspec
claude plugin install superspec@superspec-dev
```

In Claude Code chat:

```
/plugin marketplace add anupam20sep/superspec
/plugin install superspec@superspec-dev
```

### MCP (bundled with the plugin)

Repo-root `.mcp.json` uses npm — no local build of `packages/core` required:

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

On first MCP use, `npx` downloads `@superspec-dev/core@0.2.15` from the [npm registry](https://www.npmjs.com/package/@superspec-dev/core). Use `@0.2.13` or newer for default project/home persona discovery and economy/standard/frontier model routing.

### Local checkout (contributors)

```bash
git clone https://github.com/anupam20sep/superspec.git
cd superspec
./scripts/install.sh
```

`install.sh` registers the local marketplace, installs the plugin, and runs `claude plugin validate`.

Manual equivalent:

```bash
claude plugin marketplace add /path/to/superspec
claude plugin install superspec@superspec-dev
claude plugin validate /path/to/superspec
```

### MCP in a different project (without the full plugin)

Add the same `npx` entry to that project's own `.mcp.json` if you only want tools, not skills.

## Cursor

```
/add-plugin superspec
```

Or by URL: `/add-plugin https://github.com/anupam20sep/superspec`

Skills ship from `./skills/` per `.cursor-plugin/plugin.json`. Optional MCP: add `npx -y @superspec-dev/core@0.2.15 mcp` to your project's `.cursor/mcp.json` (see main README).

## Codex

```bash
codex plugin marketplace add anupam20sep/superspec
# or: codex plugin marketplace add /path/to/superspec
codex plugin add superspec@superspec-dev
```

Or install from ChatGPT Work mode / desktop Codex → Plugins Directory.

Manifest: `.codex-plugin/plugin.json` → skills, MCP (`.mcp.json`), hooks (`hooks/hooks-codex.json`). Marketplace: `.agents/plugins/marketplace.json` with `"path": "./"` (Codex CLI ≥ 0.142). Approve hooks in `/hooks` after install. Prefer the Codex marketplace (`.agents/plugins`) if Claude-compat also appears.

If the marketplace adds but no plugin appears, you likely have a stale snapshot with the old `"../.."` path — remove and re-add the marketplace after pulling latest.

See [Install on your runtime](how-to/install-on-your-runtime.md) and [Acceptance: Codex](acceptance/codex.md).

## Community marketplace submission

To list in Anthropic's public `claude-community` catalog after review, submit at:

- https://platform.claude.com/plugins/submit

Run `claude plugin validate` on the repo before submitting.

## GitHub Copilot (future)

Planned: `.github/prompts/*.prompt.md` + `.vscode/mcp.json` — no install script.
