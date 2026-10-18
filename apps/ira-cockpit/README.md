# Ira Command Cockpit

Glass-Tech **GOD-mode** desktop app for Ira — project-first command surface over SuperSpec hive, Cursor/Claude/Codex engines, Ask-Me, and agents/skills.

Stack: **Tauri 2 + React 19 + Vite**, live backend at `/api/ira/*`.

| Doc | Purpose |
|-----|---------|
| **This README** | Install, production, usage tutorial |
| [DEV_PLAN.md](./DEV_PLAN.md) | Feature / substrate map |
| [INSTALL.md](./INSTALL.md) | Short pointer (kept for links) |

---

## Requirements

| Tool | Notes |
|------|--------|
| **Node.js 20+** | Frontend + Vite API |
| **pnpm** | Monorepo package manager |
| **Rust (rustup)** | Tauri desktop builds |
| **SuperSpec CLI** | `packages/core` in this monorepo |
| **cursor-agent** (optional) | Host engine — [install](https://cursor.com/docs/cli/installation) |

macOS is the primary desktop target (`.app` / `.dmg`).

---

## Quick install

From the **monorepo root** (`superspec/`):

```bash
# One-shot install (deps + core CLI + config sync)
./apps/ira-cockpit/scripts/install.sh

# Start desktop + web (http://127.0.0.1:1420)
./apps/ira-cockpit/scripts/dev.sh
# browser-only:
./apps/ira-cockpit/scripts/dev.sh web
```

Or via pnpm:

```bash
pnpm --filter ira-cockpit install:local
pnpm --filter ira-cockpit start          # tauri:dev
pnpm --filter ira-cockpit start:web      # vite only
```

### Cursor Agent CLI (recommended)

```bash
curl https://cursor.com/install -fsS | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
agent --version    # or: cursor-agent --version
agent login
```

---

## Production build

```bash
./apps/ira-cockpit/scripts/build-production.sh
# or
pnpm --filter ira-cockpit prod:build
```

Outputs under:

```text
apps/ira-cockpit/src-tauri/target/release/bundle/
  macos/Ira.app
  dmg/…               # when DMG target built
```

Open the app:

```bash
open apps/ira-cockpit/src-tauri/target/release/bundle/macos/Ira.app
```

Set secrets **only** in the environment (never commit):

```bash
export VITE_IRA_ELEVENLABS_API_KEY=…
export VITE_IRA_OPENAI_API_KEY=…
export SUPERSPEC_BIN=/absolute/path/to/packages/core/dist/cli.js
```

---

## Scripts reference

| Script | Command | What it does |
|--------|---------|----------------|
| Install | `./scripts/install.sh` / `pnpm install:local` | pnpm install, build core CLI, sync config |
| Dev (desktop) | `./scripts/dev.sh` / `pnpm start` | Tauri + Vite HMR |
| Dev (web) | `./scripts/dev.sh web` / `pnpm start:web` | Vite only on `:1420` |
| Production | `./scripts/build-production.sh` / `pnpm prod:build` | `tsc` + Vite + Tauri release |
| Sync config | `./scripts/sync-config.sh` / `pnpm sync:config` | `ira.config.json` → `public/` |
| Verify | `./scripts/verify.sh` / `pnpm verify` | unit + staging + engine probe |

Tests:

```bash
pnpm --filter ira-cockpit test            # unit / module
pnpm --filter ira-cockpit test:staging    # live HTTP (staging-style)
pnpm --filter ira-cockpit test:url-shortener
```

---

## Configuration

Edit `ira.config.json` (and run `pnpm sync:config`):

```json
{
  "projects": [
    {
      "id": "url-shortener",
      "name": "URL Shortener",
      "path": "/absolute/path/to/repo"
    }
  ],
  "engines": {
    "prefer": ["cursor-agent", "claude", "codex", "opencode"],
    "superspecBin": "packages/core/dist/cli.js"
  },
  "voice": {
    "enabled": true,
    "stt": { "provider": "webspeech" },
    "tts": { "provider": "webspeech" }
  }
}
```

A **project** is a local repository root. Specs live under `specs/<feature>/` inside that repo — they are not separate projects.

---

## Usage tutorial

### 1. Start Ira

```bash
./apps/ira-cockpit/scripts/dev.sh
```

Open **http://127.0.0.1:1420/** or the native window. Status line should show **LIVE · N projects**.

Click **Refresh** if the line says Connecting… — you should see a timestamp and hive status.

### 2. Onboard a project

1. Go to **Setup**
2. Under **Onboard**, paste an absolute path to a repo (must exist on disk)
3. Optional display name → **Onboard project**
4. Ira writes `ira.config.json` and opens the project in the nav

Example fixtures already registered:

- **URL Shortener** — `fixtures/url-shortener`
- **Demo Shop** — `fixtures/demo-shop`
- **SuperSpec** — monorepo root

### 3. Explore a project

From the nav, open a project. Use lenses:

| Lens | Use |
|------|-----|
| **Pulse** | Progress, spend, blockers |
| **Team** | Agents on the project |
| **Stages** | SuperSpec delivery stage per feature |
| **Docs** | Live FS search (`specs/`, `docs/`, patterns) |
| **Ask-Me** | Pending operator gates |
| **Setup** (global) | Agents, skills, engines, voice, onboard |

### 4. Add Cursor / Claude agents

**Setup → Add agent**

1. Choose harness (`cursor`, `claude`, `codex`, `opencode`)
2. Fill id / role / tags / body
3. **Write agent file** → creates e.g. `.cursor/agents/<id>.md` in the **active project** root

Skills: **Setup → Add skill** → `skills/<id>/SKILL.md`.

### 5. Check engines (Cursor Agent)

**Setup → Engines → Re-detect**

You want `cursor-agent` = **installed**, badge **host-spawn**.

Ira **queues** work for Cursor; it does **not** start `cursor-agent` as a child (OD-009). Host Cursor session / CLI picks up the intent.

### 6. Walk SuperSpec stages (example)

Against the URL Shortener fixture, Ira can advance lifecycle status via API (used by staging tests):

```bash
# Smoke the live stack
pnpm --filter ira-cockpit test:staging
```

In the UI, open **URL Shortener → Stages** after Refresh — features under `specs/` appear nested under that project.

### 7. Dispatch to Cursor (intent queue)

From tooling / API (Setup will grow a button over time):

- `POST /api/ira/cursor/dispatch` with `projectId`, `featureId`, `taskId`
- Writes `.superspec/hive/dispatch-queue/<feature>/<task>.json`
- Engine field is `cursor-agent`, `freshSubagent: true`

Then run Cursor Agent on the project folder (host):

```bash
cd /path/to/your/project
agent
```

### 8. Voice (optional)

Omni-prompt mic uses `ira.config.json` → `voice`. Default is browser **webspeech**. For ElevenLabs / OpenAI TTS/STT, set env keys before `pnpm start`.

---

## Architecture (short)

```text
Browser / Tauri webview
        │  fetch /api/ira/*
        ▼
Vite middleware  →  src/backend/*  →  SuperSpec CLI (SUPERSPEC_BIN)
        │                              hive / personas / doctor
        ▼
Zustand store (refreshLive every 15s + Refresh button)
```

Host engines (`claude`, `cursor-agent`, `codex`) = **queue only**.  
`opencode` may detach when engine rung is ready.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Refresh does nothing / Connecting… | Ensure Vite is on `127.0.0.1:1420`; run `./scripts/dev.sh`; check status line for errors |
| `cursor-agent` missing | Install CLI + `PATH="$HOME/.local/bin:$PATH"` |
| Hive down | From project: `SUPERSPEC_ROOT=/path/to/project node packages/core/dist/cli.js hive init` |
| Port 1420 in use | `./scripts/dev.sh` kills stale listeners; or `lsof -tiTCP:1420 \| xargs kill` |
| Production build fails | `rustup update stable`; Xcode CLT on macOS |

---

## Example projects

```bash
# URL Shortener app tests
cd apps/ira-cockpit/fixtures/url-shortener && node --test tests/*.test.js

# Ira + shortener staging
pnpm --filter ira-cockpit test:staging
```

See fixture `README.md` files under `fixtures/` for Cursor agent lists.
