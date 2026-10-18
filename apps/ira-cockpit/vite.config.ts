import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { handleIraApi } from "./src/backend/http-api";

const host = process.env.TAURI_DEV_HOST;
const rootDir = path.dirname(fileURLToPath(import.meta.url));

function iraApiPlugin(): Plugin {
  return {
    name: "ira-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          const handled = await handleIraApi(req, res, { cwd: rootDir });
          if (!handled) next();
        })().catch((err: unknown) => {
          res.statusCode = 500;
          res.end(err instanceof Error ? err.message : String(err));
        });
      });
    },
  };
}

export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), iraApiPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : {
          protocol: "ws",
          host: "127.0.0.1",
          port: 1420,
        },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
