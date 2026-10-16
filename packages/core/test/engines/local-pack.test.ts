import { describe, it, expect, vi } from "vitest";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_CONTEXT_FLOOR } from "../../src/engines/types.js";
import {
  evaluateContextFromProbe,
  evaluateContextGate,
  setLocalPack,
} from "../../src/engines/local-pack.js";

const smallOllama = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ollama-show-small.json"), "utf8"),
);

async function hive(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hive-local-pack-"));
  await writeFile(join(root, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
  return root;
}

function execOk(stdout: string) {
  return vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
    cb(null, stdout, "");
  });
}

describe("LOCAL_CONTEXT_FLOOR", () => {
  it("is 65536", () => {
    expect(LOCAL_CONTEXT_FLOOR).toBe(65536);
  });
});

describe("evaluateContextFromProbe", () => {
  it("fails closed when probe returns no context fields", () => {
    const r = evaluateContextFromProbe({ backend: "ollama", probeValue: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LOCAL_CONTEXT_UNKNOWN");
  });

  it("ignores a declared context when the ollama probe has no context field", () => {
    const r = evaluateContextFromProbe({
      backend: "ollama",
      probeValue: { parameters: "temperature 0.2", model_info: {}, details: {} },
      advertisedContext: 131072,
      model: "qwen",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("LOCAL_CONTEXT_UNKNOWN");
      expect(r.message).toContain("unknown");
      expect(r.message).toContain("65536");
      expect(r.message).toContain("qwen");
    }
  });

  it("uses num_ctx from the small ollama fixture ahead of a larger model_info", () => {
    const r = evaluateContextFromProbe({
      backend: "ollama",
      probeValue: smallOllama,
      model: "qwen2.5-coder:7b",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("LOCAL_CONTEXT_BELOW_FLOOR");
      expect(r.message).toContain("8192");
      expect(r.message).toContain("65536");
      expect(r.message).toContain("num_ctx");
    }
  });

  it("accepts ollama context_length at the floor when num_ctx is absent", () => {
    const r = evaluateContextFromProbe({
      backend: "ollama",
      probeValue: { parameters: "temperature 0.2", model_info: { "qwen2.context_length": 65536 } },
      model: "qwen",
    });
    expect(r).toMatchObject({ ok: true, advertisedContext: 65536, contextSource: "probe" });
  });

  it("reads details.context_length when model_info has none", () => {
    const r = evaluateContextFromProbe({
      backend: "ollama",
      probeValue: { details: { context_length: 32768 } },
      model: "tiny",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LOCAL_CONTEXT_BELOW_FLOOR");
  });

  it("reads lmstudio context_length before max_context_length on the named model", () => {
    const below = evaluateContextFromProbe({
      backend: "lmstudio",
      model: "qwen",
      probeValue: {
        data: [{ id: "other", context_length: 131072 }, { id: "qwen", context_length: 8192, max_context_length: 131072 }],
      },
    });
    expect(below.ok).toBe(false);
    if (!below.ok) expect(below.code).toBe("LOCAL_CONTEXT_BELOW_FLOOR");

    const atFloor = evaluateContextFromProbe({
      backend: "lmstudio",
      model: "qwen",
      probeValue: { data: [{ id: "qwen", max_context_length: 65536 }] },
    });
    expect(atFloor).toMatchObject({ ok: true, advertisedContext: 65536, contextSource: "probe" });
  });

  it("reads vllm max_model_len and ignores a sibling context_length", () => {
    const missing = evaluateContextFromProbe({
      backend: "vllm",
      model: "llama",
      probeValue: { data: [{ id: "llama", context_length: 131072 }] },
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("LOCAL_CONTEXT_UNKNOWN");

    const ok = evaluateContextFromProbe({
      backend: "vllm",
      model: "llama",
      probeValue: { data: [{ id: "llama", max_model_len: 65536 }] },
    });
    expect(ok).toMatchObject({ ok: true, advertisedContext: 65536, contextSource: "probe" });
  });

  it("requires declared context for byok", () => {
    const missing = evaluateContextFromProbe({ backend: "byok", probeValue: null, model: "gpt" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("LOCAL_CONTEXT_UNKNOWN");

    const low = evaluateContextFromProbe({
      backend: "byok",
      probeValue: { context_length: 131072 },
      advertisedContext: 8192,
      model: "gpt",
    });
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.code).toBe("LOCAL_CONTEXT_BELOW_FLOOR");

    const ok = evaluateContextFromProbe({
      backend: "byok",
      probeValue: null,
      advertisedContext: 65536,
      model: "gpt",
    });
    expect(ok).toMatchObject({ ok: true, advertisedContext: 65536, contextSource: "declared" });
  });
});

describe("evaluateContextGate", () => {
  it("probes ollama with execFile and fails closed on the small fixture", async () => {
    const execFile = execOk(JSON.stringify(smallOllama));
    const r = await evaluateContextGate(
      { backend: "ollama", model: "qwen2.5-coder:7b", advertisedContext: 131072 },
      { execFile: execFile as never },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LOCAL_CONTEXT_BELOW_FLOOR");
    expect(execFile).toHaveBeenCalledWith(
      "ollama",
      ["show", "qwen2.5-coder:7b", "--json"],
      expect.objectContaining({ shell: false }),
      expect.any(Function),
    );
  });

  it("uses declared context only when the ollama probe cannot run", async () => {
    const execFile = vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
      cb(Object.assign(new Error("spawn ollama ENOENT"), { code: "ENOENT" }));
    });
    const r = await evaluateContextGate(
      { backend: "ollama", model: "qwen", advertisedContext: 65536 },
      { execFile: execFile as never },
    );
    expect(r).toMatchObject({ ok: true, advertisedContext: 65536, contextSource: "declared" });
  });

  it("does not fetch a non-loopback local backend", async () => {
    const fetchImpl = vi.fn();
    const r = await evaluateContextGate(
      { backend: "lmstudio", model: "qwen", baseUrl: "http://example.com:1234", advertisedContext: 131072 },
      { fetch: fetchImpl as never },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LOCAL_CONTEXT_UNKNOWN");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads lmstudio /v1/models and treats a live miss as unknown", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "qwen" }] }), { status: 200 }));
    const r = await evaluateContextGate(
      { backend: "lmstudio", model: "qwen", advertisedContext: 131072 },
      { fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LOCAL_CONTEXT_UNKNOWN");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://127.0.0.1:1234/v1/models");
  });

  it("uses declared context when the vllm port cannot be measured", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const r = await evaluateContextGate(
      { backend: "vllm", model: "llama", baseUrl: "http://localhost:8000", advertisedContext: 70000 },
      { fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(r).toMatchObject({ ok: true, advertisedContext: 70000, contextSource: "declared" });
  });
});

describe("setLocalPack", () => {
  it("refuses an uninitialized hive", async () => {
    const root = await mkdtemp(join(tmpdir(), "hive-local-pack-"));
    const r = await setLocalPack(root, {
      engineId: "opencode",
      backend: "byok",
      baseUrl: "https://api.example.com/v1",
      model: "gpt",
      advertisedContext: 65536,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("HIVE_NOT_INITIALIZED");
  });

  it("rejects a non-loopback local URL and a byok userinfo secret without writing", async () => {
    const root = await hive();
    const execFile = execOk(JSON.stringify({ model_info: { context_length: 131072 } }));
    const local = await setLocalPack(
      root,
      { engineId: "opencode", backend: "ollama", baseUrl: "http://10.0.0.8:11434", model: "qwen" },
      { execFile: execFile as never },
    );
    expect(local.ok).toBe(false);
    if (!local.ok) expect(local.code).toBe("INVALID_INPUT");
    expect(execFile).not.toHaveBeenCalled();

    const byok = await setLocalPack(root, {
      engineId: "crush",
      backend: "byok",
      baseUrl: "https://user:sk-secret@api.example.com/v1",
      model: "gpt",
      advertisedContext: 65536,
    });
    expect(byok.ok).toBe(false);
    if (!byok.ok) expect(byok.code).toBe("INVALID_INPUT");
    await expect(access(join(root, "engines", "local-pack.json"))).rejects.toThrow();
  });

  it("does not write the profile when the context gate fails", async () => {
    const root = await hive();
    const execFile = execOk(JSON.stringify(smallOllama));
    const r = await setLocalPack(
      root,
      {
        engineId: "opencode",
        backend: "ollama",
        model: "qwen2.5-coder:7b",
        advertisedContext: 131072,
      },
      { execFile: execFile as never },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LOCAL_CONTEXT_BELOW_FLOOR");
    await expect(access(join(root, "engines", "local-pack.json"))).rejects.toThrow();
  });

  it("writes probed context when the gate passes", async () => {
    const root = await hive();
    const execFile = execOk(JSON.stringify({ parameters: "num_ctx 65536" }));
    const r = await setLocalPack(
      root,
      {
        engineId: "crush",
        backend: "ollama",
        model: "qwen",
        tiers: { economy: "qwen", standard: "qwen", frontier: "qwen" },
      },
      { execFile: execFile as never },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.advertisedContext).toBe(65536);
    expect(r.profile.contextSource).toBe("probe");
    expect(r.profile.baseUrl).toBe("http://127.0.0.1:11434");
    const saved = JSON.parse(await readFile(join(root, "engines", "local-pack.json"), "utf8"));
    expect(saved).toMatchObject({
      engineId: "crush",
      backend: "ollama",
      model: "qwen",
      advertisedContext: 65536,
      contextSource: "probe",
      tiers: { economy: "qwen", standard: "qwen", frontier: "qwen" },
    });
  });
});
