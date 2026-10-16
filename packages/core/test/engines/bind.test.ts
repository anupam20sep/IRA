import { describe, it, expect, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindRosterEngine, validateBindInput } from "../../src/engines/bind.js";
import type { RosterAgent } from "../../src/command-plane/types.js";

const CODEX_ACCEPTABLE = ["economy", "standard", "frontier", "gpt-5.4", "gpt-5.5", "gpt-5.5-high"];

function agent(overrides: Partial<RosterAgent> & Pick<RosterAgent, "id">): RosterAgent {
  return {
    name: overrides.id,
    personaPath: null,
    capabilityTags: [],
    engine: null,
    model: null,
    workspace: null,
    worktreePolicy: "shared",
    status: "idle",
    origin: "manual",
    ...overrides,
  };
}

function execResult(ok: boolean) {
  return vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    if (!ok) {
      cb(Object.assign(new Error("missing"), { code: "ENOENT" }), "", "");
      return;
    }
    cb(null, "1.0.0", "");
  });
}

function expectVersionProbes(execFile: ReturnType<typeof execResult>) {
  expect(execFile).toHaveBeenCalled();
  for (const call of execFile.mock.calls) {
    expect(call[1]).toEqual(["--version"]);
    expect(call[2]).toMatchObject({ shell: false });
  }
}

async function personaFile(name = "implementer.md"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "persona-"));
  const path = join(dir, name);
  await writeFile(path, "---\nname: implementer\n---\nYou implement.\n");
  return path;
}

async function hiveWith(roster: RosterAgent[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hive-bind-"));
  await writeFile(join(root, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
  await mkdir(join(root, "locks"), { mode: 0o700 });
  await writeFile(join(root, "roster.json"), JSON.stringify(roster));
  return root;
}

const implementer = agent({ id: "implementer", name: "Implementer", capabilityTags: ["implement"] });
const reviewer = agent({
  id: "reviewer",
  name: "Reviewer",
  capabilityTags: ["review"],
  engine: "claude",
  model: "frontier",
  workspace: "/work/reviewer",
  worktreePolicy: "isolated",
});

describe("validateBindInput", () => {
  it("rejects workspace inside hive root", () => {
    const r = validateBindInput({
      agentId: "implementer",
      personaPath: "/repo/.cursor/agents/implementer.md",
      engine: "codex",
      model: "economy",
      workspace: "/repo/.superspec/hive",
      worktreePolicy: "isolated",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("INVALID_INPUT");
  });

  it("rejects a workspace nested inside .superspec/hive", () => {
    const r = validateBindInput({
      agentId: "implementer",
      personaPath: "/repo/.cursor/agents/implementer.md",
      engine: "codex",
      model: "economy",
      workspace: "/repo/.superspec/hive/engines",
      worktreePolicy: "isolated",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("INVALID_INPUT");
  });

  it("rejects a relative workspace", () => {
    const r = validateBindInput({
      agentId: "implementer",
      personaPath: "/repo/.cursor/agents/implementer.md",
      engine: "codex",
      model: "economy",
      workspace: "worktrees/implementer",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("INVALID_INPUT");
  });

  it("accepts an absolute workspace outside the hive", () => {
    const r = validateBindInput({
      agentId: "implementer",
      personaPath: "/repo/.cursor/agents/implementer.md",
      engine: "codex",
      model: "economy",
      workspace: "/repo/.worktrees/implementer",
    });
    expect(r.ok).toBe(true);
  });
});

describe("bindRosterEngine", () => {
  it("returns ENGINE_NOT_FOUND and does not probe or rewrite the roster", async () => {
    const hive = await hiveWith([implementer, reviewer]);
    const before = await readFile(join(hive, "roster.json"));
    const persona = await personaFile();
    const execFile = execResult(true);

    const result = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: persona,
        engine: "nope",
        model: "economy",
        workspace: "/work/implementer",
      },
      { execFile: execFile as never, envPath: "/opt/fake" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ENGINE_NOT_FOUND");
    expect(execFile).not.toHaveBeenCalled();
    expect(await readFile(join(hive, "roster.json"))).toEqual(before);
  });

  it("returns ENGINE_NOT_FOUND for an unknown custom instance", async () => {
    const hive = await hiveWith([implementer]);
    const persona = await personaFile();
    const execFile = execResult(true);

    const result = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: persona,
        engine: "custom:missing",
        model: "economy",
        workspace: "/work/implementer",
      },
      { execFile: execFile as never, envPath: "/opt/fake" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ENGINE_NOT_FOUND");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("returns ENGINE_MISSING when the catalog engine is not installed", async () => {
    const hive = await hiveWith([implementer, reviewer]);
    const before = await readFile(join(hive, "roster.json"));
    const persona = await personaFile();
    const execFile = execResult(false);

    const result = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: persona,
        engine: "codex",
        model: "gpt-5.5",
        workspace: "/work/implementer",
      },
      { execFile: execFile as never, envPath: "/opt/fake" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ENGINE_MISSING");
    expectVersionProbes(execFile);
    expect(await readFile(join(hive, "roster.json"))).toEqual(before);
  });

  it("returns MODEL_REJECTED with tier names and the allowlist", async () => {
    const hive = await hiveWith([implementer, reviewer]);
    const before = await readFile(join(hive, "roster.json"));
    const persona = await personaFile();

    const result = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: persona,
        engine: "codex",
        model: "nope",
        workspace: "/work/implementer",
      },
      { execFile: execResult(true) as never, envPath: "/opt/fake" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("MODEL_REJECTED");
      expect(result.message).toBe('codex does not offer model "nope".');
      expect(result.acceptable).toEqual(CODEX_ACCEPTABLE);
    }
    expect(await readFile(join(hive, "roster.json"))).toEqual(before);
  });

  it("returns INVALID_INPUT when workspace is the hive root and leaves the row unchanged", async () => {
    const hive = await hiveWith([implementer]);
    const before = await readFile(join(hive, "roster.json"));
    const persona = await personaFile();

    const root = await bindRosterEngine(hive, {
      agentId: "implementer",
      personaPath: persona,
      engine: "codex",
      model: "economy",
      workspace: hive,
    });
    const nested = await bindRosterEngine(hive, {
      agentId: "implementer",
      personaPath: persona,
      engine: "codex",
      model: "economy",
      workspace: join(hive, "engines"),
    });

    expect(root.ok).toBe(false);
    expect(nested.ok).toBe(false);
    if (!root.ok) expect(root.error).toBe("INVALID_INPUT");
    if (!nested.ok) expect(nested.error).toBe("INVALID_INPUT");
    expect(await readFile(join(hive, "roster.json"))).toEqual(before);
  });

  it("returns INVALID_INPUT when the persona file is missing", async () => {
    const hive = await hiveWith([implementer]);
    const missing = join(hive, "..", "missing-implementer.md");

    const result = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: missing,
        engine: "codex",
        model: "economy",
        workspace: "/work/implementer",
      },
      { execFile: execResult(true) as never, envPath: "/opt/fake" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when the agent is not on the roster", async () => {
    const hive = await hiveWith([reviewer]);
    const persona = await personaFile();
    const before = await readFile(join(hive, "roster.json"));

    const result = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: persona,
        engine: "codex",
        model: "economy",
        workspace: "/work/implementer",
      },
      { execFile: execResult(true) as never, envPath: "/opt/fake" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("INVALID_INPUT");
    expect(await readFile(join(hive, "roster.json"))).toEqual(before);
  });

  it("returns HIVE_NOT_INITIALIZED when hive.json is absent", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-bind-"));
    const persona = await personaFile();

    const result = await bindRosterEngine(hive, {
      agentId: "implementer",
      personaPath: persona,
      engine: "codex",
      model: "economy",
      workspace: "/work/implementer",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("HIVE_NOT_INITIALIZED");
  });

  it("returns ROSTER_BUSY when roster.lock is held", async () => {
    const hive = await hiveWith([implementer]);
    const persona = await personaFile();
    const before = await readFile(join(hive, "roster.json"));
    await writeFile(
      join(hive, "locks", "roster.lock"),
      `${JSON.stringify({ pid: process.pid, nonce: "held-by-test" })}\n`,
    );

    const result = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: persona,
        engine: "codex",
        model: "economy",
        budgetUsd: 10,
        budgetTokens: null,
        workspace: "/work/implementer",
      },
      { execFile: execResult(true) as never, envPath: "/opt/fake" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ROSTER_BUSY");
    expect(await readFile(join(hive, "roster.json"))).toEqual(before);
  }, 10_000);

  it("writes persona, engine, model, budget, and workspace without touching other rows", async () => {
    const hive = await hiveWith([
      agent({ ...implementer, status: "busy" }),
      reviewer,
    ]);
    const persona = await personaFile("implementer.toml");

    const result = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: persona,
        engine: "codex",
        model: "economy",
        budgetUsd: 10,
        budgetTokens: null,
        workspace: "/work/implementer",
      },
      { execFile: execResult(true) as never, envPath: "/opt/fake" },
    );

    expect(result).toEqual({
      ok: true,
      agent: {
        id: "implementer",
        engine: "codex",
        model: "economy",
        workspace: "/work/implementer",
        worktreePolicy: "isolated",
      },
    });

    const roster = JSON.parse(await readFile(join(hive, "roster.json"), "utf8")) as RosterAgent[];
    expect(roster).toHaveLength(2);
    expect(roster[0]).toMatchObject({
      id: "implementer",
      personaPath: persona,
      engine: "codex",
      model: "economy",
      budgetUsd: 10,
      budgetTokens: null,
      workspace: "/work/implementer",
      worktreePolicy: "isolated",
      status: "busy",
      capabilityTags: ["implement"],
    });
    expect(roster[1]).toEqual(reviewer);
    expect((await stat(join(hive, "roster.json"))).mode & 0o777).toBe(0o600);
    const names = await readdir(hive);
    expect(names.filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("keeps a second agent's engine when the first is rebound", async () => {
    const hive = await hiveWith([implementer, reviewer]);
    const persona = await personaFile();
    const opts = { execFile: execResult(true) as never, envPath: "/opt/fake" };

    const first = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: persona,
        engine: "codex",
        model: "gpt-5.5",
        budgetUsd: null,
        budgetTokens: 1000,
        workspace: "/work/implementer",
        worktreePolicy: "shared",
      },
      opts,
    );
    const second = await bindRosterEngine(
      hive,
      {
        agentId: "reviewer",
        personaPath: persona,
        engine: "claude",
        model: "frontier",
        workspace: "/work/reviewer",
        worktreePolicy: "isolated",
      },
      opts,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const roster = JSON.parse(await readFile(join(hive, "roster.json"), "utf8")) as RosterAgent[];
    expect(roster[0]).toMatchObject({
      engine: "codex",
      model: "gpt-5.5",
      budgetUsd: null,
      budgetTokens: 1000,
      worktreePolicy: "shared",
    });
    expect(roster[1]).toMatchObject({
      engine: "claude",
      model: "frontier",
      workspace: "/work/reviewer",
    });
  });

  it("stores the cursor alias as cursor-agent", async () => {
    const hive = await hiveWith([implementer]);
    const persona = await personaFile();

    const result = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: persona,
        engine: "cursor",
        model: "composer-2.5",
        workspace: "/work/implementer",
      },
      { execFile: execResult(true) as never, envPath: "/opt/fake" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agent.engine).toBe("cursor-agent");
  });

  it("accepts a local-pack model and rejects one the pack does not list", async () => {
    const hive = await hiveWith([implementer]);
    const persona = await personaFile();
    await mkdir(join(hive, "engines"), { mode: 0o700 });
    await writeFile(
      join(hive, "engines", "local-pack.json"),
      JSON.stringify({
        engineId: "opencode",
        backend: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen2.5-coder:32b",
        advertisedContext: 65536,
        contextSource: "declared",
      }),
    );
    const opts = { execFile: execResult(true) as never, envPath: "/opt/fake" };
    const input = {
      agentId: "implementer",
      personaPath: persona,
      engine: "opencode",
      workspace: "/work/implementer",
    };

    const accepted = await bindRosterEngine(hive, { ...input, model: "qwen2.5-coder:32b" }, opts);
    expect(accepted.ok).toBe(true);

    const rejected = await bindRosterEngine(hive, { ...input, model: "tiny" }, opts);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error).toBe("MODEL_REJECTED");
      expect(rejected.acceptable).toEqual(["economy", "standard", "frontier", "qwen2.5-coder:32b"]);
    }
  });

  it("binds a custom instance and rejects a model it does not offer", async () => {
    const hive = await hiveWith([implementer]);
    const persona = await personaFile();
    await mkdir(join(hive, "engines"), { mode: 0o700 });
    await writeFile(
      join(hive, "engines", "custom.json"),
      JSON.stringify({
        schemaVersion: 1,
        engines: [
          {
            instanceId: "acme",
            displayName: "Acme",
            command: ["acme"],
            model: "acme-small",
            eventMode: "sparse",
          },
        ],
      }),
    );
    const execFile = execResult(true);
    const opts = { execFile: execFile as never, envPath: "/opt/fake" };

    const accepted = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: persona,
        engine: "custom:acme",
        model: "acme-small",
        workspace: "/work/implementer",
      },
      opts,
    );
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.agent.engine).toBe("custom:acme");

    const rejected = await bindRosterEngine(
      hive,
      {
        agentId: "implementer",
        personaPath: persona,
        engine: "custom:acme",
        model: "nope",
        workspace: "/work/implementer",
      },
      opts,
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error).toBe("MODEL_REJECTED");
      expect(rejected.acceptable).toEqual(["economy", "standard", "frontier", "acme-small"]);
    }
    expectVersionProbes(execFile);
  });
});
