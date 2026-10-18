/**
 * Staging Ira API — real HTTP server (same handler as Vite middleware).
 * Usage: node --import tsx src/staging/serve-ira.ts
 * Or via: pnpm staging:ira
 */
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleIraApi } from "../backend/http-api.js";

const here = dirname(fileURLToPath(import.meta.url));
const cockpitCwd = resolve(here, "../..");
const port = Number(process.env.IRA_STAGING_PORT ?? 1420);

const server = createServer((req, res) => {
  void (async () => {
    const handled = await handleIraApi(req, res, { cwd: cockpitCwd });
    if (!handled) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "NOT_FOUND" }));
    }
  })().catch((err: unknown) => {
    res.statusCode = 500;
    res.end(err instanceof Error ? err.message : String(err));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Ira staging API http://127.0.0.1:${port}`);
  console.log(`cwd=${cockpitCwd}`);
});
