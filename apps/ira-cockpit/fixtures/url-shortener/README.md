# URL Shortener — Ira + Cursor example

Standalone SuperSpec project onboarded into **Ira Cockpit**.

## Team (Cursor agents)

| Agent | Role |
|-------|------|
| `us-architect` | Specs, design, Ask-Me gates |
| `us-backend` | Shorten / redirect API |
| `us-frontend` | Minimal HTML UI |
| `us-qa` | Acceptance tests |

## Feature

`specs/001-url-shortener` — full SuperSpec lifecycle (explore → ship).

## Ira

Onboarded via Setup or pre-registered in `ira.config.json` as **URL Shortener**.

```bash
# From Ira cockpit package
pnpm --filter ira-cockpit test:url-shortener
```
