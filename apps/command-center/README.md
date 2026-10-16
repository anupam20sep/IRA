# Ira Command Center

Local loopback web board for the Operator. It reads Command Plane (P-001) snapshot and event data and forwards mutations through the `superspec` CLI only.

## Bind address

The bridge listens on **`127.0.0.1`** only. Non-loopback bind is refused at startup.

- Default port: **`4731`**
- Override: `COMMAND_CENTER_PORT`
- Optional CLI path: `SUPERSPEC_BIN` (defaults to `packages/core/bin/superspec.js` under the repo root)

Open the board at `http://127.0.0.1:4731` (or your chosen port).

## Bearer token

Mutating HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) require:

```http
Authorization: Bearer <token>
```

The bridge verifies the token against `<hiveRoot>/auth/loopback.token` (file mode `0600`, auth directory `0700`). GET and SSE never return the token.

There is no login screen. After the hive token exists, paste it once into the browser session:

- Session storage key: `ira.commandCenter.bearerToken`

Example (browser devtools console):

```js
sessionStorage.setItem("ira.commandCenter.bearerToken", "<paste loopback token>");
```

## Steer (Plane commands only)

Task steer from the board maps to these CLI commands only:

| Board action | Plane command |
|--------------|-----------------|
| Dispatch | `dispatch-task` |
| Pause (hold) | `task-hold` |
| Abort | `task-abort` |
| Reassign | `task-reassign` |

The bridge does not invoke raw forge `begin-task`, does not write ledger or lock files, and does not copy Plane lock helpers.

## Development

From the repository root (requires Node 20+ and a checkout containing `program.md`):

```bash
pnpm install
node apps/command-center/src/server/main.ts
```

With no built `dist/`, the process runs in dev mode: Vite serves the client through the same loopback server (HMR enabled).

Run tests:

```bash
pnpm exec vitest run apps/command-center/test
```

## Production-style start

Build static assets, then start the bridge (serves `dist/` when present):

```bash
pnpm --filter @superspec-dev/command-center run build
node apps/command-center/src/server/main.ts
```

## Prior art

Panel information architecture adapts [Munder Difflin](https://github.com/chaitanyagiri/munder-difflin) (MIT). See `specs/002-ira-command-center/spec.md` for the reuse map. LimeZu pixel assets are not copied; visual language is Ira Glass (CSS tokens in `src/client/tokens.css`).
