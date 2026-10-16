import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ENGINES_MCP_TOOL_NAMES,
  buildEnginesMcpTools,
  enginesBindHandler,
  enginesDetectHandler,
  enginesLocalPackSetHandler,
  enginesMatrixHandler,
  enginesPolicySetHandler,
  enginesPolicyShowHandler,
} from "../../src/engines/mcp-handlers.js";
import { ENGINE_CATALOG_VERSION } from "../../src/engines/types.js";
import { defaultFailoverPolicy } from "../../src/engines/store.js";
import { buildToolDefinitions } from "../../src/mcp-server.js";

describe("ENGINES_MCP_TOOL_NAMES", () => {
  it("lists the six engines MCP tools", () => {
    expect([...ENGINES_MCP_TOOL_NAMES].sort()).toEqual(
      [
        "engines-bind",
        "engines-detect",
        "engines-local-pack-set",
        "engines-matrix",
        "engines-policy-set",
        "engines-policy-show",
      ].sort(),
    );
  });
});

describe("enginesDetectHandler", () => {
  it("returns ok true and catalogVersion 1", async () => {
    const out = await enginesDetectHandler({}, { detectInstalled: async () => [] });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.catalogVersion).toBe(1);
  });

  it("adds displayName from the catalog for builtin rows", async () => {
    const out = await enginesDetectHandler(
      {},
      {
        detectInstalled: async () => [
          { engineId: "claude", installed: true, binary: "/usr/local/bin/claude" },
        ],
      },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      const claude = out.engines.find((e) => e.engineId === "claude");
      expect(claude?.displayName).toBe("Claude Code");
      expect(claude?.installed).toBe(true);
    }
  });
});

describe("enginesMatrixHandler", () => {
  it("returns matrix JSON envelope", async () => {
    const out = await enginesMatrixHandler(
      {},
      {
        resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
        buildCredentialMatrix: async () => ({
          catalogVersion: ENGINE_CATALOG_VERSION,
          rows: [
            {
              engineId: "claude",
              displayName: "Claude Code",
              installed: true,
              authMode: "subscription",
              health: "ok",
              rung: "subscription",
              binary: "claude",
            },
          ],
        }),
      },
    );
    expect(out).toEqual({
      ok: true,
      catalogVersion: 1,
      rows: [
        {
          engineId: "claude",
          displayName: "Claude Code",
          installed: true,
          authMode: "subscription",
          health: "ok",
          rung: "subscription",
          binary: "claude",
        },
      ],
    });
  });

  it("returns HIVE_NOT_INITIALIZED when hive is missing", async () => {
    const out = await enginesMatrixHandler(
      {},
      {
        resolveHiveRoot: async () => ({ ok: false as const, error: "HIVE_NOT_INITIALIZED" }),
      },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("HIVE_NOT_INITIALIZED");
      expect(out.hint).toContain("doctor");
    }
  });
});

describe("enginesPolicyShowHandler", () => {
  it("returns policy envelope", async () => {
    const policy = defaultFailoverPolicy();
    const out = await enginesPolicyShowHandler(
      {},
      {
        resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
        readPolicy: async () => ({ ok: true, policy }),
      },
    );
    expect(out).toEqual({ ok: true, policy });
  });
});

describe("enginesPolicySetHandler", () => {
  it("writes validated policy and returns ok", async () => {
    const policy = defaultFailoverPolicy();
    const out = await enginesPolicySetHandler(
      { crossEngineReview: true },
      {
        resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
        readPolicy: async () => ({ ok: true, policy }),
        writePolicy: async () => ({ ok: true }),
      },
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.policy.crossEngineReview).toBe(true);
  });
});

describe("enginesBindHandler", () => {
  it("returns bind success envelope", async () => {
    const out = await enginesBindHandler(
      {
        agentId: "implementer",
        personaPath: "/abs/implementer.md",
        engine: "codex",
      },
      {
        resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
        bindRosterEngine: async () => ({
          ok: true,
          agent: {
            id: "implementer",
            engine: "codex",
            model: null,
            workspace: null,
            worktreePolicy: "shared",
          },
        }),
      },
    );
    expect(out.ok).toBe(true);
  });

  it("returns MODEL_REJECTED envelope from bind", async () => {
    const out = await enginesBindHandler(
      {
        agentId: "implementer",
        personaPath: "/abs/implementer.md",
        engine: "codex",
        model: "nope",
      },
      {
        resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
        bindRosterEngine: async () => ({
          ok: false,
          error: "MODEL_REJECTED",
          message: 'codex does not offer model "nope".',
          acceptable: ["economy"],
        }),
      },
    );
    expect(out).toMatchObject({
      ok: false,
      error: "MODEL_REJECTED",
      acceptable: ["economy"],
    });
  });
});

describe("enginesLocalPackSetHandler", () => {
  it("returns context fields on success", async () => {
    const out = await enginesLocalPackSetHandler(
      {
        engineId: "opencode",
        backend: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen2.5-coder:32b",
      },
      {
        resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
        setLocalPack: async () => ({
          ok: true,
          profile: {
            engineId: "opencode",
            backend: "ollama",
            baseUrl: "http://127.0.0.1:11434",
            model: "qwen2.5-coder:32b",
            advertisedContext: 131072,
            contextSource: "probe",
          },
        }),
      },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.advertisedContext).toBe(131072);
      expect(out.contextSource).toBe("probe");
    }
  });

  it("returns LOCAL_CONTEXT_BELOW_FLOOR on gate failure", async () => {
    const out = await enginesLocalPackSetHandler(
      {
        engineId: "opencode",
        backend: "ollama",
        model: "small",
      },
      {
        resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
        setLocalPack: async () => ({
          ok: false,
          code: "LOCAL_CONTEXT_BELOW_FLOOR",
          message: "too small",
        }),
      },
    );
    expect(out).toEqual({ ok: false, error: "LOCAL_CONTEXT_BELOW_FLOOR", message: "too small" });
  });
});

describe("buildEnginesMcpTools", () => {
  it("registers handlers that emit JSON text envelopes", async () => {
    const tools = buildEnginesMcpTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ENGINES_MCP_TOOL_NAMES].sort());
    const detect = tools.find((t) => t.name === "engines-detect")!;
    const res = await detect.handler({});
    const payload = JSON.parse(res.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.catalogVersion).toBe(1);
  });
});

describe("mcp-server registration", () => {
  it("includes engines tools in buildToolDefinitions", () => {
    const names = buildToolDefinitions().map((t) => t.name);
    for (const name of ENGINES_MCP_TOOL_NAMES) {
      expect(names).toContain(name);
    }
  });
});

describe("enginesPolicyShowHandler integration", () => {
  it("reads default policy when hive is initialized", async () => {
    const root = await mkdtemp(join(tmpdir(), "repo-mcp-policy-"));
    await writeFile(join(root, "program.md"), "# program\n");
    const hive = join(root, ".superspec", "hive");
    await mkdir(hive, { recursive: true });
    await writeFile(join(hive, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
    const out = await enginesPolicyShowHandler({ cwd: root });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.policy.ladder).toEqual(["subscription", "byok", "local"]);
  });
});
