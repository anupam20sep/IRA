# IRA Cockpit — Engineering Dev Plan

**Product: IRA** (Intelligent Resource Automation). Engine packages in-repo power hive/dispatch; the cockpit is the product surface.

## Status (2026-10-18)

| Phase | Status |
|-------|--------|
| Config + agent/skill create forms | **Done** — writes via `/api/ira/agents` + `/api/ira/skills` |
| Voice STT/TTS provider switch | **Done** (webspeech + ElevenLabs/OpenAI hooks; whisper-local later) |
| Engines health panel | **Done** — live `detectEngines` via `/api/ira/engines` |
| CLI bridge → store | **Done** — `buildCockpitSnapshot` → Zustand `refreshLive` |
| Live docs FS search | **Done** — `/api/ira/docs` |
| Backend unit tests | **Done** — `pnpm --filter ira-cockpit test` |
| Bundle / INSTALL | **Done** — `scripts/install.sh`, `build-production.sh`, README tutorial |
| Whisper-local STT | Not started |
| Signed desktop releases | Phase 2 |

### Live backend (no stubbed UI as source of truth)

- Node modules under `src/backend/` (CLI, hive, agents, skills, docs, features, engines, snapshot)
- Vite middleware `iraApiPlugin` → `/api/ira/*` on `127.0.0.1:1420`
- Zustand hydrates from `GET /api/ira/snapshot` every 15s; mock seed only until first successful refresh
- Setup forms write real persona/skill files under the repo root

### Project model

- A **project** = one local repository root (`ira.config.json` → `projects[]`)
- A **spec** = `specs/<feature>/` inside that repo — nested under the project, never its own project
- Multiple local paths → multiple projects in the nav
- **UI onboard:** Setup → paste absolute path → `POST /api/ira/projects` writes config + refresh
- **Example:** `fixtures/demo-shop` — `pnpm --filter ira-cockpit test:example`
- **URL Shortener:** `fixtures/url-shortener` — `test:url-shortener` (module) + `test:staging` (live HTTP)

## UI → Substrate map

| Cockpit surface | Keep / cut | Existing code | Build |
|-----------------|------------|---------------|-------|
| Home brief / Ask-Me | Keep | `command-plane` ask-me, doctor, brief | Wire CLI JSON → Zustand |
| Project filter + pulse | Keep | hive ledger / snapshot | Live hive read |
| Team (agent↔task, tokens, time) | Keep | roster, token governor, engines events | Wire roster + spend ledger |
| Stages (lifecycle ribbon) | Keep as **delivery stages** (not forge UI) | forge-status / sync-status | Map stage from feature artifacts |
| Docs search | Keep | specs/, patterns/ on disk | FS search via backend |
| Decisions | Keep | Ask-Me answers + events | Event log append |
| Memory | Keep | P-003 patterns | patterns from snapshot |
| Spend / breaker | Keep | P-004 token | token CLI (partial) |
| Triggers / away | Keep | away mode, OD-005/013 | wire away settings |
| Brainstorm → plan mode | Keep | host engines | Deep-link host session (partial) |
| Setup agents/skills | Keep + **forms** | hire spawn writes `.md` | Forms → write agents/*.md + skills/SKILL.md |
| Omni + voice | **Add voice** | — | Configurable STT/TTS |
| Old CC seven-tab app | **Cut as product** | `apps/command-center` | Optional CLI bridge only |
| Hermes/OpenClaw in UI | **Cut from v1 UI** | P-007 optional | Config stub only |

## Engine integration (critical)

| Engine | Spawn ownership | Cockpit behavior |
|--------|-----------------|------------------|
| `claude` | Host-spawn only (OD-009) | Show health; queue intent; never Ira-parent |
| `cursor-agent` | Host-spawn | Same |
| `codex` | Host-spawn | Same |
| `opencode` | Detached supervisor OK | Allow away/run when engine rung ready |

Persona files:

- Claude → `.claude/agents/<id>.md`
- Cursor → `.cursor/agents/<id>.md`
- Codex → `.codex/agents/<id>.toml`
- OpenCode → `.opencode/agents/<id>.md`

Skills → `skills/<id>/SKILL.md`

## API surface

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/ira/snapshot` | Doctor + ask-me + roster + personas + features + engines |
| GET | `/api/ira/engines` | which(1) detect + host-spawn flags |
| GET | `/api/ira/docs?q=` | Search specs/docs/patterns |
| POST | `/api/ira/agents` | Write harness persona file |
| POST | `/api/ira/skills` | Write `skills/<id>/SKILL.md` |
| POST | `/api/ira/ask-me/answer` | Answer pending Ask-Me via CLI |

## Tests

```bash
pnpm --filter ira-cockpit test
```

Coverage: agent/skill file writers, docs search classification, feature stage inference, engines catalog, snapshot→UI map.

## Distribution / delivery

1. **Dev:** `pnpm --filter ira-cockpit tauri:dev` → http://127.0.0.1:1420  
2. **Desktop:** `pnpm --filter ira-cockpit tauri:build`  
3. **CLI substrate:** `SUPERSPEC_BIN` or `packages/core` dist  
4. **Config:** `ira.config.json` + env secrets only  

## Explicit non-goals this pass

- Replaying SuperSpec explore→ship for this work  
- Rebuilding hive/dispatch in the frontend  
- Pixel office, Marvel branding  
- Multi-user cloud SaaS  
