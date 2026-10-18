# IRA — Intelligent Resource Automation

**IRA** is your GOD-mode chief of staff for a one-person company: project-first command, multi-engine teams (Cursor / Claude / Codex / OpenCode), Ask-Me gates, and delivery stages — in a Glass-Tech desktop cockpit.

This app is the **IRA product surface**. The monorepo engine underneath powers hive, doctor, dispatch, and personas; you run and think in **IRA**, not in a separate lifecycle brand.

| | |
|--|--|
| **App** | Tauri 2 + React 19 + Vite |
| **API** | `/api/ira/*` (live backend) |
| **UI** | http://127.0.0.1:1420 + native `Ira.app` |

Related: [DEV_PLAN.md](./DEV_PLAN.md) · [INSTALL.md](./INSTALL.md)

---

## What IRA does

- **Projects** — local repo roots you onboard; each may contain many features/specs
- **Team** — agents and skills on disk (Cursor `.md`, Claude, Codex, OpenCode)
- **Engines** — detect host CLIs; queue work to Cursor/Claude/Codex (never Ira-parent host engines)
- **Ask-Me** — critical decisions paused for you
- **Stages** — delivery progress for features inside a project
- **Docs** — search specs, design, plans, patterns on disk
- **Voice** — optional STT/TTS on the omni prompt

---

## Requirements

| Tool | Notes |
|------|--------|
| Node.js 20+ | UI + API |
| pnpm | Workspace installs |
| Rust (rustup) | Desktop (Tauri) |
| IRA engine CLI | Built from `packages/core` in this repo |
| `cursor-agent` (optional) | [Install Cursor CLI](https://cursor.com/docs/cli/installation) |

Primary desktop target: **macOS** (`.app` / `.dmg`).

---

## Install

From the **repo root**:

```bash
./apps/ira-cockpit/scripts/install.sh
./apps/ira-cockpit/scripts/dev.sh
```

Or:

```bash
pnpm --filter ira-cockpit install:local
pnpm --filter ira-cockpit start        # desktop + http://127.0.0.1:1420
pnpm --filter ira-cockpit start:web    # browser only
```

### Cursor Agent (recommended)

```bash
curl https://cursor.com/install -fsS | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
agent --version
agent login
```

---

## Production

```bash
./apps/ira-cockpit/scripts/build-production.sh
# or: pnpm --filter ira-cockpit prod:build
```

Artifacts:

```text
apps/ira-cockpit/src-tauri/target/release/bundle/macos/Ira.app
apps/ira-cockpit/src-tauri/target/release/bundle/dmg/   # when produced
```

```bash
open apps/ira-cockpit/src-tauri/target/release/bundle/macos/Ira.app
```

Secrets via env only (never commit):

```bash
export VITE_IRA_ELEVENLABS_API_KEY=…
export VITE_IRA_OPENAI_API_KEY=…
export SUPERSPEC_BIN=/absolute/path/to/packages/core/dist/cli.js   # IRA engine binary
```

---

## Scripts

| Action | Script / pnpm |
|--------|----------------|
| Install | `./scripts/install.sh` · `pnpm install:local` |
| Dev (desktop) | `./scripts/dev.sh` · `pnpm start` |
| Dev (web) | `./scripts/dev.sh web` · `pnpm start:web` |
| Production | `./scripts/build-production.sh` · `pnpm prod:build` |
| Sync config | `./scripts/sync-config.sh` · `pnpm sync:config` |
| Verify | `./scripts/verify.sh` · `pnpm verify` |

```bash
pnpm --filter ira-cockpit test
pnpm --filter ira-cockpit test:staging
```

---

## Configure projects

Edit `ira.config.json`, then `pnpm sync:config`:

```json
{
  "projects": [
    {
      "id": "my-app",
      "name": "My App",
      "path": "/absolute/path/to/repo"
    }
  ],
  "engines": {
    "prefer": ["cursor-agent", "claude", "codex", "opencode"]
  },
  "voice": {
    "enabled": true,
    "stt": { "provider": "webspeech" },
    "tts": { "provider": "webspeech" }
  }
}
```

A **project** = one local repository. Features under `specs/<id>/` nest **inside** that project.

---

## Usage tutorial

### 1. Launch IRA

```bash
./apps/ira-cockpit/scripts/dev.sh
```

Open the native window or **http://127.0.0.1:1420/**.  
Status should read **LIVE · N projects**. Use **Refresh** if it still says Connecting….

### 2. Onboard a repo

1. **Setup → Onboard**
2. Paste an absolute path that exists on disk
3. Optional name → **Onboard project**

Included examples:

| Project | Path |
|---------|------|
| URL Shortener | `fixtures/url-shortener` |
| Demo Shop | `fixtures/demo-shop` |

### 3. Work a project

Open it from the nav:

| Lens | Purpose |
|------|---------|
| Pulse | Progress, blockers, spend |
| Team | Agents on this project |
| Stages | Feature delivery stages |
| Docs | Search specs / docs / patterns |
| Ask-Me | Decisions waiting on you |

### 4. Hire the team (agents & skills)

**Setup → Add agent** — pick harness (`cursor` / `claude` / `codex` / `opencode`), write persona file under the active project.

**Setup → Add skill** — writes `skills/<id>/SKILL.md`.

### 5. Engines

**Setup → Engines → Re-detect**

- `cursor-agent` / `claude` / `codex` → **host-spawn** (IRA queues; host runs the CLI)
- `opencode` → detachable when the engine rung is ready

### 6. Send work toward Cursor

IRA queues a host intent (does not spawn Cursor itself):

- API: `POST /api/ira/cursor/dispatch`
- File: `.superspec/hive/dispatch-queue/<feature>/<task>.json` under the project

On the host:

```bash
cd /path/to/your/project
agent
```

### 7. Voice (optional)

Mic on the omni prompt. Default: browser webspeech. Set ElevenLabs / OpenAI keys in the environment for other providers.

---

## How it fits together

```text
You  ←→  IRA Cockpit (this app)
              │
              ├─ projects, team, Ask-Me, stages, docs
              ├─ /api/ira/* live backend
              └─ IRA engine (packages/core) — hive, doctor, personas, dispatch queue
                        │
                        └─ host engines: Cursor · Claude · Codex (queue only)
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Not LIVE | `./scripts/dev.sh`; confirm http://127.0.0.1:1420 |
| No `cursor-agent` | Install CLI; add `~/.local/bin` to `PATH` |
| Hive down | `SUPERSPEC_ROOT=/path/to/project node packages/core/dist/cli.js hive init` |
| Port 1420 busy | `./scripts/dev.sh` clears it, or kill the listener |
| Prod build fails | `rustup update stable`; macOS Xcode CLT |

---

## Examples & tests

```bash
cd apps/ira-cockpit/fixtures/url-shortener && node --test tests/*.test.js
pnpm --filter ira-cockpit test:staging
```

Fixture READMEs under `fixtures/` list sample Cursor agents.
