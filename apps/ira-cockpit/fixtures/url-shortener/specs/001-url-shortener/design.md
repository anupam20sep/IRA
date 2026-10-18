# Design: URL Shortener

## Overview

In-process Node HTTP server with an in-memory Map store. No external DB for the demo.

## Architecture

```
Client → POST /api/shorten → store.set(code, url)
Client → GET /r/:code → 302 Location: url
Client → GET /api/links → JSON array
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Node ESM | Matches Ira fixture tooling |
| Code generation | base36 from random bytes | Short, URL-safe |
| Persistence | In-memory Map | Demo scope; swap later |
| Host engines | Cursor agents via Ira dispatch queue | OD-009 host-spawn only |

## API Contracts

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/api/shorten` | `{ url }` | `{ code, url }` |
| GET | `/r/:code` | — | 302 or 404 |
| GET | `/api/links` | — | `Link[]` |
| GET | `/health` | — | `{ ok: true }` |

## Risks

- Process restart clears links (accepted for demo)
- No auth (local demo only)
