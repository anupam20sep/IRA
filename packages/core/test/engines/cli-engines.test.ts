import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildEnginesCliHelpLines,
  runEnginesCli,
} from "../../src/engines/cli-engines.js";
import {
  enginesBindHandler,
  enginesDetectHandler,
  enginesLocalPackSetHandler,
  enginesMatrixHandler,
  enginesPolicyShowHandler,
} from "../../src/engines/mcp-handlers.js";
import { defaultFailoverPolicy } from "../../src/engines/store.js";
import { ENGINE_CATALOG_VERSION } from "../../src/engines/types.js";

describe("buildEnginesCliHelpLines", () => {
  it("lists detect and bind subcommands", () => {
    const lines = buildEnginesCliHelpLines();
    const text = lines.join("\n");
    expect(text).toContain("engines detect");
    expect(text).toContain("engines bind");
    expect(text).toContain("engines hooks install");
  });
});

async function cliJson(
  argv: string[],
  deps?: Parameters<typeof runEnginesCli>[1],
): Promise<{ code: number; body: Record<string, unknown> }> {
  const res = await runEnginesCli(argv, deps);
  return { code: res.code, body: JSON.parse(res.stdout) as Record<string, unknown> };
}

describe("runEnginesCli / MCP parity", () => {
  it("detect matches engines-detect", async () => {
    const deps = {
      detectInstalled: async () => [
        { engineId: "claude", installed: true, binary: "/bin/claude" },
      ],
    };
    const cli = await runEnginesCli(["detect"], deps);
    const mcp = await enginesDetectHandler({}, deps);
    expect(JSON.parse(cli.stdout)).toEqual(mcp);
    expect(cli.code).toBe(0);
  });

  it("matrix matches engines-matrix", async () => {
    const deps = {
      resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
      buildCredentialMatrix: async () => ({
        catalogVersion: ENGINE_CATALOG_VERSION,
        rows: [],
      }),
    };
    const cli = await runEnginesCli(["matrix"], deps);
    const mcp = await enginesMatrixHandler({}, deps);
    expect(JSON.parse(cli.stdout)).toEqual(mcp);
    expect(cli.code).toBe(0);
  });

  it("policy show matches engines-policy-show", async () => {
    const policy = defaultFailoverPolicy();
    const deps = {
      resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
      readPolicy: async () => ({ ok: true as const, policy }),
    };
    const cli = await runEnginesCli(["policy", "show"], deps);
    const mcp = await enginesPolicyShowHandler({}, deps);
    expect(JSON.parse(cli.stdout)).toEqual(mcp);
    expect(cli.code).toBe(0);
  });

  it("bind forwards flags to engines-bind handler", async () => {
    const deps = {
      resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
      bindRosterEngine: async (_hive: string, input: { agentId: string; engine: string }) => ({
        ok: true as const,
        agent: {
          id: input.agentId,
          engine: input.engine,
          model: null,
          workspace: null,
          worktreePolicy: "shared" as const,
        },
      }),
    };
    const cli = await cliJson([
      "bind",
      "--agent",
      "implementer",
      "--persona",
      "/abs/implementer.md",
      "--engine",
      "codex",
    ], deps);
    const mcp = await enginesBindHandler(
      {
        agentId: "implementer",
        personaPath: "/abs/implementer.md",
        engine: "codex",
      },
      deps,
    );
    expect(cli.body).toEqual(mcp);
    expect(cli.code).toBe(0);
  });

  it("policy set accepts kebab flags", async () => {
    const policy = defaultFailoverPolicy();
    const deps = {
      resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
      readPolicy: async () => ({ ok: true as const, policy }),
      writePolicy: async () => ({ ok: true as const }),
    };
    const { code, body } = await cliJson(
      ["policy", "set", "--cross-engine-review", "true"],
      deps,
    );
    expect(code).toBe(0);
    expect(body.ok).toBe(true);
    if (body.ok) {
      expect((body.policy as { crossEngineReview: boolean }).crossEngineReview).toBe(true);
    }
  });

  it("local-pack set accepts nested subcommand", async () => {
    const deps = {
      resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: "/hive" }),
      setLocalPack: async () => ({
        ok: true as const,
        profile: {
          engineId: "opencode" as const,
          backend: "ollama" as const,
          baseUrl: "http://127.0.0.1:11434",
          model: "qwen2.5-coder:32b",
          advertisedContext: 131072,
          contextSource: "probe" as const,
        },
      }),
    };
    const { code, body } = await cliJson(
      [
        "local-pack",
        "set",
        "--engine",
        "opencode",
        "--backend",
        "ollama",
        "--model",
        "qwen2.5-coder:32b",
      ],
      deps,
    );
    expect(code).toBe(0);
    expect(body.ok).toBe(true);
    expect(body).toEqual(
      await enginesLocalPackSetHandler(
        { engineId: "opencode", backend: "ollama", model: "qwen2.5-coder:32b" },
        deps,
      ),
    );
  });

  it("hooks install writes bridge for delegate host", async () => {
    const root = await mkdtemp(join(tmpdir(), "cli-hooks-"));
    await writeFile(join(root, "program.md"), "# program\n");
    const hive = join(root, ".superspec", "hive");
    await mkdir(hive, { recursive: true });
    await mkdir(join(root, "hooks"), { recursive: true });
    await writeFile(join(hive, "hive.json"), JSON.stringify({ schemaVersion: 1 }));

    const policy = { ...defaultFailoverPolicy(), delegateToHost: "claude" as const };
    const deps = {
      resolveHiveRoot: async () => ({ ok: true as const, hiveRoot: hive }),
      readPolicy: async () => ({ ok: true as const, policy }),
    };
    const { code, body } = await cliJson(["hooks", "install", "--cwd", root], deps);
    expect(code).toBe(0);
    expect(body).toMatchObject({ ok: true, path: join(root, "hooks", "hooks.json") });
  });

  it("returns exit 1 on handler failure", async () => {
    const deps = {
      resolveHiveRoot: async () => ({ ok: false as const, error: "HIVE_NOT_INITIALIZED" as const }),
    };
    const res = await runEnginesCli(["matrix"], deps);
    expect(res.code).toBe(1);
    const body = JSON.parse(res.stdout) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("HIVE_NOT_INITIALIZED");
  });
});
