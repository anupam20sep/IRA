import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runSuperspec } from "../src/server/cli.js";

const repositoryRoot = path.resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);

describe("runSuperspec", () => {
  it("parses a single JSON object from a successful doctor invocation", async () => {
    const result = await runSuperspec(["doctor", "--cwd", repositoryRoot], {
      cwd: repositoryRoot,
      timeoutMs: 10_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.json).toBeTypeOf("object");
    expect(result.json).not.toBeNull();
    expect(Array.isArray(result.json)).toBe(false);
    expect(result.json).toMatchObject({
      ok: expect.any(Boolean),
      hiveReady: expect.any(Boolean),
    });
  });

  it("returns ok: false when stdout is not JSON", async () => {
    const result = await runSuperspec(["not-a-real-command"], {
      cwd: repositoryRoot,
      timeoutMs: 10_000,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/json/i),
    });
  });
});
