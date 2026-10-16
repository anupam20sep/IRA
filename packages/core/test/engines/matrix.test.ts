import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listBuiltinPresets } from "../../src/engines/catalog.js";
import { ensureEnginesLayout } from "../../src/engines/paths.js";
import { buildCredentialMatrix } from "../../src/engines/matrix.js";
import { redactMessage } from "../../src/engines/redact.js";
import { ENGINE_CATALOG_VERSION } from "../../src/engines/types.js";

const FORBIDDEN_KEY_RE = /apiKey|token|password|secret|authorization/i;
const FORBIDDEN_VALUE_RE = /sk-|ghp_/;

async function hiveRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hive-matrix-"));
  await writeFile(join(root, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
  await ensureEnginesLayout(root);
  return root;
}

describe("redactMessage", () => {
  it("redacts sk- prefixed tokens", () => {
    expect(redactMessage("failed sk-abc123secret")).not.toContain("sk-abc");
  });

  it("redacts ghp_ tokens and key=value secret patterns", () => {
    const out = redactMessage("api_key=supersecret ghp_abc123xyz token: bearer");
    expect(out).not.toContain("supersecret");
    expect(out).not.toContain("ghp_abc");
    expect(out).toContain("[redacted]");
  });
});

describe("buildCredentialMatrix", () => {
  it("returns a row per builtin preset with catalog version", async () => {
    const hive = await hiveRoot();
    await writeFile(
      join(hive, "engines", "health.json"),
      JSON.stringify({
        claude: {
          engineId: "claude",
          authMode: "subscription",
          health: "ok",
          reasonClass: null,
          binaryVersion: "1.0",
          checkedAt: "2020-01-01T00:00:00.000Z",
        },
      }),
    );

    const matrix = await buildCredentialMatrix(hive, {
      detectRows: [
        { engineId: "claude", installed: true, binary: "claude" },
        ...listBuiltinPresets()
          .filter((p) => p.engineId !== "claude")
          .map((p) => ({ engineId: p.engineId, installed: false, binary: null })),
      ],
    });

    expect(matrix.catalogVersion).toBe(ENGINE_CATALOG_VERSION);
    expect(matrix.rows).toHaveLength(listBuiltinPresets().length);
    const claude = matrix.rows.find((r) => r.engineId === "claude");
    expect(claude).toMatchObject({
      displayName: "Claude Code",
      installed: true,
      authMode: "subscription",
      health: "ok",
      rung: "subscription",
      binary: "claude",
    });
  });

  it("includes custom engines and serializes without secret-like fields", async () => {
    const hive = await hiveRoot();
    await writeFile(
      join(hive, "engines", "custom.json"),
      JSON.stringify({
        schemaVersion: 1,
        engines: [
          {
            instanceId: "my-cli",
            displayName: "My CLI",
            command: ["my-cli", "--run"],
            rung: "byok",
            eventMode: "sparse",
          },
        ],
      }),
    );

    const matrix = await buildCredentialMatrix(hive, {
      detectRows: listBuiltinPresets().map((p) => ({
        engineId: p.engineId,
        installed: false,
        binary: null,
      })),
      isCustomInstalled: async () => true,
    });

    const custom = matrix.rows.find((r) => r.engineId === "custom:my-cli");
    expect(custom).toMatchObject({
      displayName: "My CLI",
      installed: true,
      rung: "byok",
      binary: "my-cli",
    });

    const payload = JSON.stringify(matrix);
    for (const key of Object.keys(JSON.parse(payload) as Record<string, unknown>)) {
      expect(key).not.toMatch(FORBIDDEN_KEY_RE);
    }
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        expect(k).not.toMatch(FORBIDDEN_KEY_RE);
        if (typeof v === "string") {
          expect(v).not.toMatch(FORBIDDEN_VALUE_RE);
        }
        walk(v);
      }
    };
    walk(matrix);
  });
});
