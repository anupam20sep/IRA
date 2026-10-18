# IRA

**Intelligent Resource Automation** — GOD-mode chief of staff for building and running your company with AI agents.

IRA is the product. You onboard local projects, run multi-engine teams (Cursor, Claude, Codex, OpenCode), clear Ask-Me gates, and track delivery — from the **IRA Cockpit** desktop app.

The packages in this repository are the **IRA engine** (hive, doctor, dispatch, personas, forge tooling). Day-to-day you use IRA; you do not operate a separate “lifecycle brand.”

---

## Start here

| | |
|--|--|
| **Cockpit (UI)** | [`apps/ira-cockpit/`](apps/ira-cockpit/) — install, production, usage tutorial |
| **Quick start** | `./apps/ira-cockpit/scripts/install.sh` then `./apps/ira-cockpit/scripts/dev.sh` |
| **App URL** | http://127.0.0.1:1420 · native `Ira.app` |

Full guide: **[apps/ira-cockpit/README.md](apps/ira-cockpit/README.md)**

```bash
./apps/ira-cockpit/scripts/install.sh
./apps/ira-cockpit/scripts/dev.sh
# production:
./apps/ira-cockpit/scripts/build-production.sh
```

---

## What you get

- **Project-first** — each onboarded path is a repo; features/specs nest inside it  
- **Team on disk** — Cursor / Claude / Codex / OpenCode agent files + skills  
- **Host engines** — IRA queues work; Cursor/Claude/Codex stay host-spawn (never Ira-parented)  
- **Ask-Me** — critical calls wait for you  
- **Live cockpit** — Glass-Tech Tauri app over `/api/ira/*`

---

## Repo layout

```text
apps/ira-cockpit/     ← IRA product UI (start here)
packages/core/        ← IRA engine (CLI + MCP + hive/dispatch)
packages/render/      ← shared render helpers
hire-gallery/         ← optional hire catalog assets
docs/                 ← engine / operator deep-dives
```

---

## Cursor Agent CLI

```bash
curl https://cursor.com/install -fsS | bash
export PATH="$HOME/.local/bin:$PATH"
agent login
```

---

## License

MIT — see [LICENSE](LICENSE).
