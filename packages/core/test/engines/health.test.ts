import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LOCAL_CONTEXT_FLOOR } from "../../src/engines/types.js";
import {
  applyEngineSessionError,
  authModeFromSignals,
  getCachedHealth,
  refreshEngineHealth,
} from "../../src/engines/health.js";
import { ensureEnginesLayout, enginesRoot } from "../../src/engines/paths.js";

async function hiveRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hive-health-"));
  await writeFile(join(root, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
  await ensureEnginesLayout(root);
  return root;
}

describe("authModeFromSignals", () => {
  it("returns missing when binary not installed", () => {
    expect(authModeFromSignals({ installed: false }).health).toBe("missing");
    expect(authModeFromSignals({ installed: false }).authMode).toBe("unknown");
  });

  it("maps BYOK env presence to byok and ok", () => {
    const r = authModeFromSignals({ installed: true, byokEnvPresent: true });
    expect(r.authMode).toBe("byok");
    expect(r.health).toBe("ok");
  });

  it("maps successful status probe to subscription and ok", () => {
    const r = authModeFromSignals({ installed: true, statusProbe: "ok" });
    expect(r.authMode).toBe("subscription");
    expect(r.health).toBe("ok");
  });

  it("degrades on rate_limited session error without changing authMode", () => {
    const r = authModeFromSignals({
      installed: true,
      statusProbe: "ok",
      sessionReasonClass: "rate_limited",
    });
    expect(r.authMode).toBe("subscription");
    expect(r.health).toBe("degraded");
    expect(r.reasonClass).toBe("rate_limited");
  });

  it("marks local pack below context floor as degraded", () => {
    const r = authModeFromSignals({
      installed: true,
      localPack: { active: true, contextGateOk: false },
    });
    expect(r.authMode).toBe("local");
    expect(r.health).toBe("degraded");
  });
});

describe("refreshEngineHealth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists cache rows and getCachedHealth reads them", async () => {
    const hive = await hiveRoot();
    const execFile = vi.fn((cmd: string, args: string[], _opts: unknown, cb: Function) => {
      if (args.join(" ") === "--version") {
        cb(null, "claude 1.2.3", "");
        return;
      }
      if (args.join(" ") === "auth status") {
        cb(null, "", "");
        return;
      }
      cb(new Error("missing"), "", "");
    });

    const rows = await refreshEngineHealth(hive, {
      envPath: "/bin",
      env: { PATH: "/bin" },
      execFile: execFile as never,
      detectRows: [
        { engineId: "claude", installed: true, binary: "/bin/claude" },
        { engineId: "codex", installed: false, binary: null },
      ],
    });

    const claude = rows.find((r) => r.engineId === "claude");
    expect(claude?.authMode).toBe("subscription");
    expect(claude?.health).toBe("ok");

    const cached = await getCachedHealth(hive, "claude");
    expect(cached?.engineId).toBe("claude");
    expect(cached?.authMode).toBe("subscription");

    const raw = await readFile(join(enginesRoot(hive), "health.json"), "utf8");
    expect(raw).not.toContain("sk-");
  });

  it("never logs secret env values during refresh", async () => {
    const hive = await hiveRoot();
    const secret = "sk-test-never-log-me";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await refreshEngineHealth(hive, {
      envPath: "/bin",
      env: { PATH: "/bin", ANTHROPIC_API_KEY: secret },
      execFile: vi.fn((_cmd, args: string[], _opts, cb) => {
        if (args[0] === "--version") cb(null, "1.0", "");
        else cb(new Error("skip"), "", "");
      }) as never,
      detectRows: [{ engineId: "claude", installed: true, binary: "/bin/claude" }],
    });

    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
    expect(logged).not.toContain(secret);
  });
});

describe("applyEngineSessionError", () => {
  it("updates cached health to degraded for quota_exhausted", async () => {
    const hive = await hiveRoot();
    await refreshEngineHealth(hive, {
      envPath: "/bin",
      env: { PATH: "/bin" },
      execFile: vi.fn((_cmd, args: string[], _opts, cb) => {
        if (args[0] === "--version") cb(null, "1.0", "");
        else cb(new Error("skip"), "", "");
      }) as never,
      detectRows: [{ engineId: "codex", installed: true, binary: "/bin/codex" }],
    });

    await applyEngineSessionError(hive, "codex", "quota_exhausted");
    const cached = await getCachedHealth(hive, "codex");
    expect(cached?.health).toBe("degraded");
    expect(cached?.reasonClass).toBe("quota_exhausted");
  });
});

describe("local context from profile", () => {
  it("treats stored context below floor as degraded local auth", async () => {
    const hive = await hiveRoot();
    await writeFile(
      join(enginesRoot(hive), "local-pack.json"),
      JSON.stringify({
        engineId: "opencode",
        backend: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "tiny",
        advertisedContext: LOCAL_CONTEXT_FLOOR - 1,
        contextSource: "probe",
      }),
    );

    const rows = await refreshEngineHealth(hive, {
      envPath: "/bin",
      env: { PATH: "/bin" },
      execFile: vi.fn((_cmd, args: string[], _opts, cb) => {
        if (args[0] === "--version") cb(null, "1.0", "");
        else cb(new Error("skip"), "", "");
      }) as never,
      detectRows: [{ engineId: "opencode", installed: true, binary: "/bin/opencode" }],
    });

    const opencode = rows.find((r) => r.engineId === "opencode");
    expect(opencode?.authMode).toBe("local");
    expect(opencode?.health).toBe("degraded");
  });
});
