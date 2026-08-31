# SuperSpec

**Spec-driven + TDD-driven development for AI coding agents.**

SuperSpec fuses [GitHub Spec Kit](https://github.com/github/spec-kit)'s traceable specs (`FR-###`, user stories, `SC-###`) with [Superpowers](https://github.com/obra/superpowers)' mandatory TDD execution (red-green-refactor tasks, subagent dispatch, verification gates). One plugin, one shared engine — identical skills and tools in Claude Code, Cursor, and Codex.

[![npm version](https://img.shields.io/npm/v/%40superspec-dev%2Fcore?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/@superspec-dev/core)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

---

## Table of contents

- [What is SuperSpec](#what-is-superspec)
- [How it works](#how-it-works)
- [Quickstart](#quickstart)
- [Documentation](#documentation)
- [Why SuperSpec](#why-superspec)
- [Usage guide](#usage-guide)
- [Lifecycle](#lifecycle)
- [Verification tools](#verification-tools)
- [Install](#install)
- [What's in the repo](#whats-in-the-repo)
- [Developing SuperSpec](#developing-superspec)
- [Philosophy](#philosophy)
- [Provenance & license](#provenance--license)

---

## What is SuperSpec

SuperSpec is a spec-driven + TDD-driven framework for AI coding agents (Claude Code, Cursor, and Codex). It solves two problems that break agentic development at scale:

1. **No traceability** — requirements drift from implementation; you cannot prove every `FR-###` shipped with a test.
2. **Context rot** — long sessions degrade quality as the window fills with diffs, review text, and tool output.

SuperSpec addresses traceability with a **coverage matrix** and mandatory TDD for code tasks. It addresses context rot by running **implement and review in fresh subagents** while persisting progress to **`status.md`** and **forge state on disk** — not conversation memory.

---

## How it works

Each feature repeats the same lifecycle. The **forge** phase is where dispatch logic matters most:

### Lifecycle (spec → ship)

```
explore/ingest → scope → refine → architect → plan → route → forge → validate → ship
```

### Forge dispatch loop (per task)

The coordinator stays lean; heavy work runs in isolated subagents:

1. **Select** — `next-task` loads persisted state; `begin-task` marks `in_progress`
2. **Route** — `route-model` picks economy/standard/frontier tier (+ harness slug) for implementer **and** reviewer
3. **Implement** — dispatch `agents/implementer.md` (red → green → refactor → commit)
4. **Review** — dispatch `agents/task-reviewer.md` (fresh context, read-only; spec + quality verdicts)
5. **Record** — `record-result` + `sync-status`; repeat until `forge-status` reports `complete: true`

On review failure: resume the **same** implementer with findings → re-review. After 3 failures, task becomes `blocked` — escalate.

| Platform | Dispatch mechanism | Guide |
|----------|-------------------|-------|
| **Claude Code** | `Agent` tool | [Dispatch on Claude Code](docs/how-to/dispatch-on-claude-code.md) |
| **Cursor** | `Task` tool | [Dispatch on Cursor](docs/how-to/dispatch-on-cursor.md) |
| **Codex** | Multi-agent spawn | [Dispatch on Codex](docs/how-to/dispatch-on-codex.md) |

Full loop: [Run the forge loop](docs/how-to/run-the-forge-loop.md). Context model: [Dispatch and context](docs/explanation/dispatch-and-context.md).

---

## Quickstart

### 1. Install the plugin

**Cursor** — in Agent chat:

```
/add-plugin superspec
```

Or by URL: `/add-plugin https://github.com/anupam20sep/superspec`

**Claude Code** — from GitHub (no clone required):

```bash
claude plugin marketplace add anupam20sep/superspec
claude plugin install superspec@superspec-dev
```

In Claude Code chat:

```
/plugin marketplace add anupam20sep/superspec
/plugin install superspec@superspec-dev
```

**Codex** — CLI or ChatGPT Work mode:

```bash
codex plugin marketplace add anupam20sep/superspec
# or local clone:
codex plugin marketplace add /path/to/SuperSpec

codex plugin add superspec@superspec-dev
```

Or open ChatGPT **Work mode** / desktop Codex → Plugins Directory → **SuperSpec**. After install, approve SessionStart hooks in `/hooks` (Codex skips untrusted plugin hooks). MCP is bundled via `.codex-plugin` → `.mcp.json`.

Requires Codex CLI **≥ 0.142** (repo-root plugin path `./`). If you added the marketplace earlier and saw no plugins, remove and re-add it after pulling this fix:

```bash
codex plugin marketplace remove superspec-dev
codex plugin marketplace add anupam20sep/superspec   # or local path
codex plugin list --available -m superspec-dev
codex plugin add superspec@superspec-dev
```

Restart the session (or `/reload-plugins` on Claude) after install. [Install details →](docs/how-to/install-on-your-runtime.md)

### 2. Bootstrap your repo (once)

```bash
npx -y @superspec-dev/core@latest init --root . --mode lite --verbose
```

Or tell the agent:

> Initialize SuperSpec in this repo.

This runs **`superspec-init`** — scaffolds templates, writes `constitution.md`, and optionally `program.md` (full mode).

### 3. Start building

| You have… | Say to the agent… | Tutorial |
| --------- | ----------------- | -------- |
| A new idea | "Let's explore and build …" | [Your first feature](docs/tutorials/your-first-feature.md) |
| Existing docs or code | "Ingest requirements from …" | [Onboarding an existing codebase](docs/tutorials/onboarding-existing-codebase.md) |
| A small bug | "Fix this bug: …" | `superspec-fix` skill |

The **`using-superspec`** skill routes to the right lane. You don't memorize the lifecycle — the agent does.

### MCP tools — how they work per platform

**Skills and MCP are two layers:** skills (markdown lifecycle guidance) ship with the plugin; the engine (`@superspec-dev/core`) ships from **npm** via `npx`.

| Platform | Skills | MCP setup |
|----------|--------|-----------|
| **Claude Code** | Bundled with plugin (`skills/`, `agents/`, `hooks/`) | **Bundled** — plugin `.mcp.json` runs `npx @superspec-dev/core mcp` automatically |
| **Cursor** | Bundled with plugin (`skills/`, hooks) | **Manual** — add `.cursor/mcp.json` in your project (see below) |
| **Codex** | Bundled with plugin (`skills/`, hooks) | **Bundled** — `.codex-plugin` points at the same `.mcp.json` |

On first MCP use, `npx` downloads `@superspec-dev/core` from npm. Requires Node.js on your PATH. No `npm install` in your project.

**Without MCP (Cursor / CLI fallback):** skills still work — the agent can run `npx @superspec-dev/core lint …` in the terminal during `validate`. On Codex without the plugin, you can also `codex mcp add superspec -- npx -y @superspec-dev/core mcp`.

**Cursor — add MCP to your project** (recommended when not using another platform's bundled config):

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

Save as `.cursor/mcp.json` in your project root and restart Cursor. Details: [Install on your runtime](docs/how-to/install-on-your-runtime.md).

## Documentation

**Tutorials** — learning by doing:

- [Your first feature](docs/tutorials/your-first-feature.md)
- [Onboarding an existing codebase](docs/tutorials/onboarding-existing-codebase.md)

**How-to guides** — task-focused recipes:

- [Install on your runtime](docs/how-to/install-on-your-runtime.md)
- [Run the forge loop](docs/how-to/run-the-forge-loop.md)
- [Dispatch on Claude Code](docs/how-to/dispatch-on-claude-code.md)
- [Dispatch on Cursor](docs/how-to/dispatch-on-cursor.md)
- [Dispatch on Codex](docs/how-to/dispatch-on-codex.md)
- [Track forge progress](docs/how-to/track-forge-progress.md)
- [Route parallel execution](docs/how-to/route-parallel-execution.md)
- [Validate before ship](docs/how-to/validate-before-ship.md)

**Reference** — authoritative facts:

- [CLI and MCP tools](docs/reference/cli-and-mcp-tools.md)
- [Forge state and status](docs/reference/forge-state.md)
- [Agent prompt bodies](docs/reference/agents.md)
- [Skills index](docs/reference/skills.md)

**Explanation** — concepts and design:

- [Dispatch and context](docs/explanation/dispatch-and-context.md)
- [Traceability spine](docs/explanation/traceability-spine.md)
- [Lifecycle overview](docs/explanation/lifecycle.md)

Full index: [docs/README.md](docs/README.md).

---

## Why SuperSpec

### The problem

AI agents are good at writing code quickly. They are bad at knowing **what** to build, **when** they are done, and **whether** every requirement actually shipped with a test behind it.

Two open-source projects each solve half of that:


|              | [Spec Kit](https://github.com/github/spec-kit) | [Superpowers](https://github.com/obra/superpowers) |
| ------------ | ---------------------------------------------- | -------------------------------------------------- |
| **Strength** | Spec-driven development (SDD)                  | Test-driven development (TDD) + agent execution    |
| **Weakness** | Tests are optional in its task template        | No stable requirement IDs or coverage proof        |


SuperSpec exists to fuse both halves into one plugin with a **traceability spine**: `FR-### ↔ Task ↔ Test ↔ Verification gate`.

### What spec-driven development (SDD) gives you

SDD means the spec is the contract — not a document you write once and forget.

- **Stable IDs** (`FR-###`, `SC-###`) — every requirement and success criterion is addressable in plans, PRs, and reviews
- **Prioritized user stories** — Given/When/Then acceptance scenarios define MVP scope before code
- **Standalone design artifacts** — architecture, decisions, data model, and contracts reviewed before implementation
- **Stakeholder traceability** — you can point to exactly which FR a task implements and prove it shipped

*Spec Kit brings this layer. SuperSpec keeps it.*

### What test-driven development (TDD) gives you

TDD means tests are written first and drive implementation — not added as an afterthought.

- **Red-green-refactor per task** — failing test first, minimal implementation, then refactor
- **No placeholders** — plans carry actual test code, implementation code, run commands, and commit messages
- **Agent-executable tasks** — a fresh subagent can run a task with zero ambiguity about what "done" means
- **Regression safety** — every behavior change starts with a test that captures intent

*Superpowers brings this layer. SuperSpec makes it mandatory for code tasks.*

### Why combine them

Neither SDD nor TDD alone is enough for agentic development:

```
SDD alone  →  you know WHAT to build, but execution drifts (tests optional, tasks vague)
TDD alone  →  you know HOW to build each step, but lose traceability (no FR IDs, no matrix)
Both       →  every requirement maps to a task, every task has proof, gaps are machine-checkable
```

SuperSpec's **coverage matrix** is the binding link. An `FR` with no covering task, or a task with no passing test, shows up as a gap — not a hope.

### How SuperSpec covers the full dev cycle


| Phase                      | What happens                    | Skill                | Artifact                     | Verified by             |
| -------------------------- | ------------------------------- | -------------------- | ---------------------------- | ----------------------- |
| **Bootstrap**              | Adopt SuperSpec in a repo       | `init`               | `constitution.md`, templates | —                       |
| **Discover**               | Shape a greenfield idea         | `explore`            | Intent notes                 | —                       |
| **Intake**                 | Extract brownfield requirements | `ingest`             | draft FRs, `sources.lock`    | —                       |
| **Specify**                | Formalize requirements          | `scope`              | `spec.md`                    | `lint-spec`             |
| **Clarify**                | Resolve open questions          | `refine`             | updated `spec.md`            | `lint-spec`             |
| **Design**                 | Technical solution              | `architect`          | `design.md`                  | `lint-design`           |
| **Plan**                   | TDD-executable tasks            | `plan`               | `plan.md`                    | `lint-plan`             |
| **Schedule**               | Parallel windows + routing      | `route`              | `execution-map.md`           | —                       |
| **Implement**              | Autonomous task loop            | `forge`              | working code + tests         | tests + reviewer        |
| **Prove**                  | Evidence before "done"          | `validate`           | lint + matrix report         | all lint gates + matrix |
| **Deliver**                | Merge, PR, or discard           | `ship`               | merged branch / PR           | clean validation        |
| **Fix** (shortcut)         | Small bug, no full spec         | `fix`                | regression test + patch      | test suite              |
| **Coordinate** (full mode) | Multi-spec backlog              | `program` / `status` | `program.md`                 | `forge-status`          |


One plugin. One lifecycle. Skills guide the agent through each phase; `@superspec-dev/core` tools verify the artifacts. See [Lifecycle overview](docs/explanation/lifecycle.md) and [Skills index](docs/reference/skills.md).

**Worked example:** [`examples/url-shortener/`](examples/url-shortener/) — validate with `npm run dogfood:url-shortener`.

---

## Usage guide

### First-time setup (per repository)

1. **`superspec-init`** — choose **lite** (single spec) or **full** (multi-spec + `program.md`).
2. **MCP** — automatic on Claude Code and Codex (plugin `.mcp.json`); on Cursor, add `.cursor/mcp.json` (see [Quickstart](#mcp-tools--how-they-work-per-platform)).
3. **Custom agents** (optional) — if you already have `.cursor/agents/` or `.claude/agents/`, `route` and `forge` discover them automatically.

### Pick your lane

```
┌─────────────────────────────────────────────────────────────┐
│  NEW FEATURE (greenfield)    explore → scope → refine → …   │
│  NEW FEATURE (brownfield)    ingest → scope → refine → …    │
│  BUG FIX                     fix → validate → ship            │
│  MULTI-SPEC COORDINATION     program / status (full mode)   │
└─────────────────────────────────────────────────────────────┘
```

**Full feature path** (after explore or ingest):

```
scope → refine → architect → plan → [worktree] → route → forge → validate → ship
```

Forge dispatch: [Run the forge loop](docs/how-to/run-the-forge-loop.md) · [Claude Code](docs/how-to/dispatch-on-claude-code.md) · [Cursor](docs/how-to/dispatch-on-cursor.md) · [Codex](docs/how-to/dispatch-on-codex.md)

### What gets created in your project

| Artifact | Created by | Purpose |
| -------- | ---------- | ------- |
| `constitution.md` | `init` | Governance — Test-First + traceability rules |
| `spec.md` | `scope` | Requirements (`FR-###`), Type, success criteria |
| `design.md` | `architect` | Architecture, decisions, contracts |
| `plan.md` | `plan` | Executable tasks with **Kind** tags |
| `execution-map.md` | `route` | DAG, parallel windows, model routing |
| `status.md` | `forge` / `sync-status` | FR + task progress table (commit this) |
| `sources.lock` | `ingest` | Provenance for brownfield requirements |
| `program.md` | `init` (full mode) | Multi-spec backlog |
| `.superspec/state.json` | `forge` | Machine forge state (gitignored) |

### Key concepts

**Spec Type** (`product` | `platform` | `infra` | `migration` | `spike`) — set in `spec.md`; drives done-definition.

**Task Kind** (`code` | `verify` | `provision` | `signoff` | `doc-sync`) — set per task in `plan.md`:

- **`code`** → mandatory red-green-refactor (test code + impl code + command + commit message)
- **Other kinds** → type-appropriate proof, not TDD cycles

**Coverage matrix** — every `FR-###` must map to at least one task; gaps are reported, not guessed.

### Worked example

[`examples/url-shortener/`](examples/url-shortener/) — a complete 4-requirement feature with real TDD implementation.

```bash
npm run build
npm run dogfood:url-shortener
```

---

## Lifecycle

### Flow diagram

```
init (once per repo)
  │
  ├─ fix ──────────────────────────────► validate → ship
  │
  ├─ ingest (brownfield) ─┐
  └─ explore (greenfield) ┴─► scope → refine → architect → plan
                                                    │
                                            [worktree] (optional)
                                                    │
                                                  route → forge → validate → ship

program + status  ← ongoing coordination (full mode)
```

### Skills reference

| Skill | When to use |
| ----- | ----------- |
| `using-superspec` | Every session — routes to the right skill |
| `superspec-init` | Once per repo bootstrap |
| `superspec-ingest` | Brownfield — extract FRs from docs or code |
| `superspec-explore` | Greenfield — shape an idea through dialogue |
| `superspec-scope` | Write formal `spec.md` |
| `superspec-refine` | Resolve `[NEEDS CLARIFICATION]` markers |
| `superspec-architect` | Write `design.md` |
| `superspec-plan` | Write TDD-executable `plan.md` |
| `superspec-route` | Build `execution-map.md` |
| `superspec-worktree` | Isolate plan/forge on a feature branch |
| `superspec-forge` | Autonomous implementation loop |
| `superspec-validate` | Run verification before claiming done |
| `superspec-ship` | Merge, PR, keep, or discard |
| `superspec-fix` | Small bugs — skip full lifecycle |
| `superspec-program` | Maintain multi-spec backlog (full mode) |
| `superspec-status` | Consolidated status across specs |

Full index: [Skills reference](docs/reference/skills.md)

### Non-negotiable principles

From [`content/templates/constitution.md`](content/templates/constitution.md):

1. **Test-First for code tasks** — every **Kind: code** task is red-green-refactor. No optional tests.
2. **Traceability spine** — every `FR-###` maps to a task and a passing test. The matrix must be complete.

Everything else (simplicity, observability, versioning) is customizable per project.

> SuperSpec **advises** — it lints, validates, and reports. It never hard-blocks a commit or CI run.

---

## Verification tools

`@superspec-dev/core` exposes the same tools via MCP and CLI. Full reference: [CLI and MCP tools](docs/reference/cli-and-mcp-tools.md).

### Lint gates

```bash
npx -y @superspec-dev/core@latest lint --spec path/to/spec.md
npx -y @superspec-dev/core@latest lint --design path/to/design.md --specs-root .
npx -y @superspec-dev/core@latest lint --plan path/to/plan.md
```

Empty JSON array `[]` = pass.

### Coverage matrix

```bash
npx -y @superspec-dev/core@latest matrix --spec spec.md --plan plan.md
```

### Forge state

Persists to `specs/<feature>/.superspec/state.json`. FR progress in `specs/<feature>/status.md`. See [Forge state and status](docs/reference/forge-state.md).

```bash
npx -y @superspec-dev/core@latest next-task     --plan plan.md --dir specs/<feature> --verbose
npx -y @superspec-dev/core@latest begin-task     --plan plan.md --dir specs/<feature> --task T001 --verbose
npx -y @superspec-dev/core@latest record-result  --plan plan.md --dir specs/<feature> --task T001 --passed true --spec specs/<feature>/spec.md --verbose
npx -y @superspec-dev/core@latest sync-status     --spec specs/<feature>/spec.md --plan plan.md --dir specs/<feature> --verbose
npx -y @superspec-dev/core@latest forge-status   --plan plan.md --dir specs/<feature> --spec specs/<feature>/spec.md --verbose
```

Always pass `--dir` / `stateDir`. Add `--verbose` for human-readable summary + JSON.

### All tools

| MCP tool | CLI | Purpose |
| -------- | --- | ------- |
| `init` | `init` | Bootstrap repo (`lite` / `full`) |
| `build-matrix` | `matrix` | FR-to-task coverage; reports gaps |
| `lint-spec` | `lint --spec` | Type, FR/SC completeness, placeholders |
| `lint-plan` | `lint --plan` | Placeholders; TDD rules for code tasks |
| `lint-design` | `lint --design` | Decisions, contracts, clarification markers |
| `route-model` | — | Recommend economy/standard/frontier tier (+ harness slug) |
| `scaffold` | `scaffold` | Render tier templates |
| `next-task` | `next-task` | Next DAG-ready forge task |
| `begin-task` | `begin-task` | Mark task `in_progress` |
| `record-result` | `record-result` | Pass/fail; `--spec` refreshes `status.md` |
| `sync-status` | `sync-status` | Write `status.md` from spec + plan + state |
| `forge-status` | `forge-status` | `{total, done, blocked, pending, complete}` |
| `list-personas` | `list-personas` | Discover `.claude/` / `.cursor/` agents |

Start MCP server: `npx -y @superspec-dev/core mcp`

---

## Install

### What the plugin installs vs what npm provides

Both Cursor, Claude Code, and Codex install from the **GitHub repo** — skills, hooks, and (for Claude) agents. The verification engine is always **`@superspec-dev/core` from npm**, fetched by `npx` on first use.

| Component | Cursor (`/add-plugin`) | Claude Code (`superspec@superspec-dev`) | Codex (plugins / Work mode) | Source |
|-----------|------------------------|----------------------------------------|------------------------------|--------|
| Skills (`skills/`) | Yes | Yes | Yes | GitHub |
| Hooks | `hooks-cursor.json` | `hooks/hooks.json` | `hooks/hooks-codex.json` | GitHub |
| Agents | — | `agents/` | paste `agents/*.md` into spawn | GitHub |
| MCP config | You add `.cursor/mcp.json` | Bundled (repo `.mcp.json`) | Bundled (`.codex-plugin` → `.mcp.json`) | npm via `npx` |
| `@superspec-dev/render` | No | No | No | Maintainers only |

```
GitHub plugin install
        │
        ├─► skills/ + hooks (+ agents on Claude)
        │
        └─► MCP engine: npx @superspec-dev/core mcp  (from npm, on first use)
              │
              ├─ Claude: automatic (plugin .mcp.json)
              ├─ Codex: automatic (plugin mcpServers → .mcp.json)
              └─ Cursor: manual (.cursor/mcp.json in your project)
```

### Claude Code

**From GitHub (recommended):**

```bash
claude plugin marketplace add anupam20sep/superspec
claude plugin install superspec@superspec-dev
```

In Claude Code chat:

```
/plugin marketplace add anupam20sep/superspec
/plugin install superspec@superspec-dev
```

Includes skills, agents, hooks, and MCP (`.mcp.json` → `npx @superspec-dev/core mcp`). Restart or `/reload-plugins` after install.

**Local clone (contributors):**

```bash
git clone https://github.com/anupam20sep/superspec.git
cd superspec && ./scripts/install.sh
```

Validate plugin changes:

```bash
claude plugin validate /path/to/superspec
```

**Community marketplace:** submit for public listing at [platform.claude.com/plugins/submit](https://platform.claude.com/plugins/submit) after `claude plugin validate` passes.

### Cursor

```
/add-plugin superspec
```

Or: `/add-plugin https://github.com/anupam20sep/superspec`

Skills ship from `./skills/` (same layout as [obra/superpowers](https://github.com/obra/superpowers)). Add `.cursor/mcp.json` for MCP tools — see [Install on your runtime](docs/how-to/install-on-your-runtime.md).

### Codex

```bash
codex plugin marketplace add anupam20sep/superspec
# or local: codex plugin marketplace add /path/to/SuperSpec
codex plugin add superspec@superspec-dev
```

ChatGPT **Work mode** / desktop Codex: Plugins Directory → install **SuperSpec**.

Includes:

- Skills from `./skills/` (`.codex-plugin/plugin.json` at repo root)
- MCP via the same `.mcp.json` (`npx @superspec-dev/core mcp`)
- SessionStart hooks (`hooks/hooks-codex.json`) — **approve in `/hooks`** after install

Marketplace entry uses `"path": "./"` (repo root). That requires Codex CLI **≥ 0.142**. Older snapshots used `"../.."`, which Codex silently skips — if the marketplace appears but no plugin lists, remove and re-add after upgrading/pulling:

```bash
codex plugin marketplace remove superspec-dev
codex plugin marketplace add anupam20sep/superspec
codex plugin list --available -m superspec-dev
codex plugin add superspec@superspec-dev
```

If Claude-compat (`.claude-plugin/marketplace.json`) and Codex (`.agents/plugins`) both list SuperSpec, install **once** from the Codex source.

See [Install on your runtime](docs/how-to/install-on-your-runtime.md), [Dispatch on Codex](docs/how-to/dispatch-on-codex.md), and [Acceptance: Codex](docs/acceptance/codex.md).

### MCP only (no full plugin)

Add to `.cursor/mcp.json`, `.mcp.json`, or Codex `~/.codex/config.toml` / `codex mcp add` in any project:

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

See [Install on your runtime](docs/how-to/install-on-your-runtime.md). Codex is supported via `.codex-plugin/`; GitHub Copilot support is planned.
---

## What's in the repo

```
.claude-plugin/     ← Claude marketplace manifest
.cursor-plugin/     ← Cursor plugin manifest
.codex-plugin/      ← Codex plugin manifest
.agents/plugins/    ← Codex-native marketplace
.mcp.json           ← Claude/Codex plugin MCP (npx @superspec-dev/core)
docs/               ← tutorials, how-to guides, reference, explanation
content/skills/     ← canonical skill source (edit here)
content/templates/  ← spec, plan, design, constitution templates
content/agents/     ← subagent prompt bodies (implementer, reviewers)
skills/             ← rendered output (Claude + Cursor + Codex plugins consume this)
agents/             ← Claude Code agent files (with frontmatter); Codex pastes into spawn
hooks/              ← hooks.json (Claude) + hooks-cursor.json + hooks-codex.json
packages/core/      ← @superspec-dev/core (MCP + CLI, published to npm)
packages/render/    ← @superspec-dev/render (skill renderer, published to npm)
examples/           ← worked examples (url-shortener)
```

**Skill workflow:** edit `content/skills/` → `npm run render` → commit `skills/` → push.

**Publishing:**

| What | How |
|------|-----|
| Skills (Cursor + Claude + Codex GitHub install) | `git push` — updates `skills/` in repo |
| Claude marketplace (community) | Submit at [platform.claude.com/plugins/submit](https://platform.claude.com/plugins/submit) |
| Codex marketplace / Work mode | Ship `.codex-plugin/` + `.agents/plugins/marketplace.json`; install from repo or Plugins Directory |
| MCP/CLI engine | `npm publish` → `@superspec-dev/core` |
| Render CLI | `npm publish` → `@superspec-dev/render` (maintainers only) |

---

## Developing SuperSpec

```bash
npm install
npm run build              # compile packages/core + packages/render
npm run render             # content/skills → skills/
npm test                   # full test suite
npm run dogfood:url-shortener   # validation ladder on worked example
```

---

## Philosophy

- **TDD for code tasks** — enforced by `lint-plan`, not convention.
- **Proportionality** — full lifecycle for features; `fix` for bugs; `ingest` for brownfield.
- **Traceability by ID** — coverage matrix, not hope.
- **Evidence before assertions** — `validate` runs real commands before "done."
- **Advise-only** — report gaps; you decide what to do.
- **Fresh context per task** — one implementer + one reviewer per forge task.
- **One source, every tool** — skills authored once, rendered to `skills/` for Claude, Cursor, and Codex.

---

## Provenance & license

SuperSpec reuses MIT-licensed work from Spec Kit and Superpowers. See [NOTICE](NOTICE) for provenance and license.

MIT License — [LICENSE](LICENSE).