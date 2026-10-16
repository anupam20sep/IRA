import { describe, it, expect } from "vitest";
import { resolveDispatchModel } from "../../src/engines/resolve-model.js";

function ok(
  ...args: Parameters<typeof resolveDispatchModel>
): Extract<ReturnType<typeof resolveDispatchModel>, { ok: true }> {
  const r = resolveDispatchModel(...args);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  return r;
}

describe("resolveDispatchModel", () => {
  it("uses roster tier override over intent tier", () => {
    const r = ok(
      { tier: "economy", agentId: "implementer" } as never,
      { model: "frontier", engine: "codex" } as never,
      "codex",
    );
    expect(r.tier).toBe("frontier");
    expect(r.vendorModel).toBe("gpt-5.5-high");
  });

  it("uses intent tier when roster model is null and mapHarnessModel for host engines", () => {
    const r = ok({ tier: "standard" } as never, { model: null, engine: "claude" } as never, "claude");
    expect(r.tier).toBe("standard");
    expect(r.vendorModel).toBe("sonnet");
  });

  it("maps cursor-agent through the cursor harness", () => {
    const r = ok({ tier: "economy" } as never, { model: null, engine: "cursor-agent" } as never, "cursor-agent");
    expect(r.vendorModel).toBe("composer-economy");
  });

  it("uses local-pack model for OpenCode when no tier map", () => {
    const r = ok(
      { tier: "standard" } as never,
      { model: null, engine: "opencode" } as never,
      "opencode",
      {
        localPack: {
          engineId: "opencode",
          backend: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          model: "llama3:70b",
          advertisedContext: 131072,
          contextSource: "probe",
        },
      },
    );
    expect(r.tier).toBe("standard");
    expect(r.vendorModel).toBe("llama3:70b");
  });

  it("uses local-pack tier map when present", () => {
    const r = ok(
      { tier: "frontier" } as never,
      { model: "economy", engine: "crush" } as never,
      "crush",
      {
        localPack: {
          engineId: "crush",
          backend: "vllm",
          baseUrl: "http://127.0.0.1:8000",
          model: "default-model",
          advertisedContext: 65536,
          contextSource: "probe",
          tiers: {
            economy: "small-local",
            standard: "mid-local",
            frontier: "big-local",
          },
        },
      },
    );
    expect(r.tier).toBe("economy");
    expect(r.vendorModel).toBe("small-local");
  });

  it("keeps an explicit roster vendor slug and intent tier", () => {
    const r = ok(
      { tier: "economy" } as never,
      { model: "gpt-5.5", engine: "codex" } as never,
      "codex",
    );
    expect(r.tier).toBe("economy");
    expect(r.vendorModel).toBe("gpt-5.5");
  });

  it("rejects vendor slugs outside the preset allowlist", () => {
    const r = resolveDispatchModel(
      { tier: "standard" } as never,
      { model: "not-a-real-model", engine: "codex" } as never,
      "codex",
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected reject");
    expect(r.error).toBe("MODEL_REJECTED");
    expect(r.acceptable).toContain("economy");
    expect(r.acceptable).toContain("gpt-5.5-high");
  });
});
