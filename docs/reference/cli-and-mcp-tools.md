# CLI and MCP tools

`@superspec-dev/core` — same tools via CLI and MCP. Package: [npm](https://www.npmjs.com/package/@superspec-dev/core).

```bash
npx -y @superspec-dev/core@latest <command> [options]
npx -y @superspec-dev/core mcp   # stdio MCP server
```

Add `--verbose` / `-v` on forge commands for human summary + JSON.

---

## Init and scaffold

| MCP | CLI | Purpose |
|-----|-----|---------|
| `init` | `init` | Bootstrap repo (`--mode lite\|full`) |
| `scaffold` | `scaffold` | Copy templates |

---

## Lint and matrix

| MCP | CLI | Purpose |
|-----|-----|---------|
| `lint-spec` | `lint --spec` | Spec quality gate |
| `lint-plan` | `lint --plan` | Plan + TDD rules for code tasks |
| `lint-design` | `lint --design` | Design artifact gate |
| `build-matrix` | `matrix` | FR ↔ task coverage; reports gaps |

Empty JSON `[]` from lint = pass.

---

## Forge loop

| MCP | CLI | Purpose |
|-----|-----|---------|
| `next-task` | `next-task` | Next DAG-ready task |
| `begin-task` | `begin-task` | Mark `in_progress` |
| `record-result` | `record-result` | Pass/fail; optional `spec` refreshes `status.md` |
| `sync-status` | `sync-status` | Write `status.md` |
| `forge-status` | `forge-status` | Aggregate counts; optional spec writes `status.md` |
| `coordinator-brief` | `coordinator-brief` / `coordinator-init` | Refresh `specs/<feature>/.superspec/coordinator.md` (lean forge handoff) |
| `route-model` | — | `mechanical`→economy; `moderate`→standard; `complex`→frontier (+ optional `.superspec/models.yaml` via `projectRoot`) |

All forge commands need `stateDir` / `--dir specs/<feature>`.

---

## Discovery

| MCP | CLI | Purpose |
|-----|-----|---------|
| `list-personas` | `list-personas` | Scan project + home `.claude/.cursor/.codex/agents` (pass `projectRoot` / `--root`) |

---

## Examples

```bash
npx -y @superspec-dev/core matrix --spec specs/foo/spec.md --plan specs/foo/plan.md
npx -y @superspec-dev/core next-task --plan specs/foo/plan.md --dir specs/foo --verbose
```
