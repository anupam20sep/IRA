import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/staging/**", "**/node_modules/**"],
    env: {
      SUPERSPEC_BIN: path.resolve(rootDir, "../../packages/core/dist/cli.js"),
    },
  },
});

