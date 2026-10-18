# Demo Shop — Ira example project

Sample local repo for **Ira Cockpit** onboarding and Cursor integration.

## What this is

- A **project** = this repository root
- **Specs** live under `specs/<feature>/` (catalog + checkout)
- **Cursor agents** under `.cursor/agents/`
- **Skill** under `skills/inventory-sync/SKILL.md`

## Onboard in Ira

1. Start cockpit: `pnpm --filter ira-cockpit tauri:dev`
2. **Setup → Onboard** → paste this folder’s absolute path
3. Open **Demo Shop** — Stages shows the two specs; Team shows Cursor personas when CLI discovers them

## Cursor

Open this folder in Cursor. Agents in `.cursor/agents/` are available to Cursor Agent and to Ira via `list-personas`.
