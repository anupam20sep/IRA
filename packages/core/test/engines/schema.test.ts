import { describe, it, expect } from "vitest";
import {
  FailoverPolicySchema,
  LOCAL_CONTEXT_FLOOR,
  ENGINE_CATALOG_VERSION,
  EnginePresetSchema,
  CustomEngineSchema,
  CustomEnginesFileSchema,
  LocalPackProfileSchema,
  CredentialMatrixRowSchema,
  EngineHealthRecordSchema,
} from "../../src/engines/schema.js";

describe("FailoverPolicySchema", () => {
  it("requires fixed three-rung ladder order", () => {
    const p = FailoverPolicySchema.parse({
      schemaVersion: 1,
      failoverEnabled: true,
      ladder: ["subscription", "byok", "local"],
      crossEngineReview: false,
      delegateToHost: null,
      hitl: ["budget_exceed", "destructive_git"],
      quotaGroups: [],
    });
    expect(p.ladder[2]).toBe("local");
  });

  it("rejects reordered ladder", () => {
    expect(() =>
      FailoverPolicySchema.parse({
        schemaVersion: 1,
        failoverEnabled: true,
        ladder: ["byok", "subscription", "local"],
        crossEngineReview: false,
        delegateToHost: null,
        hitl: [],
        quotaGroups: [],
      }),
    ).toThrow();
  });
});

describe("LOCAL_CONTEXT_FLOOR", () => {
  it("is 65536", () => {
    expect(LOCAL_CONTEXT_FLOOR).toBe(65536);
  });
});

describe("ENGINE_CATALOG_VERSION", () => {
  it("is 1", () => {
    expect(ENGINE_CATALOG_VERSION).toBe(1);
  });
});

describe("EnginePresetSchema", () => {
  it("parses a minimal hooks preset", () => {
    const preset = EnginePresetSchema.parse({
      catalogVersion: 1,
      engineId: "claude",
      displayName: "Claude Code",
      binaries: ["claude"],
      strategy: "hooks",
      rung: "subscription",
      spawnArgs: [],
      statusArgs: ["auth", "status"],
      authEnv: "ANTHROPIC_API_KEY",
      byokEnvAllowlist: [],
      models: ["economy", "standard", "frontier"],
      emits: ["start", "tool", "stop", "error", "tokens"],
    });
    expect(preset.strategy).toBe("hooks");
  });
});

describe("CustomEngineSchema", () => {
  it("parses custom engine with sparse event mode", () => {
    const row = CustomEngineSchema.parse({
      instanceId: "my-cli",
      displayName: "My CLI",
      command: ["my-cli", "--batch"],
      eventMode: "sparse",
    });
    expect(row.eventMode).toBe("sparse");
  });
});

describe("CustomEnginesFileSchema", () => {
  it("requires schemaVersion 1", () => {
    const file = CustomEnginesFileSchema.parse({
      schemaVersion: 1,
      engines: [],
    });
    expect(file.schemaVersion).toBe(1);
  });
});

describe("LocalPackProfileSchema", () => {
  it("parses ollama backend profile", () => {
    const profile = LocalPackProfileSchema.parse({
      engineId: "opencode",
      backend: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5-coder:32b",
      advertisedContext: null,
      contextSource: "probe",
    });
    expect(profile.backend).toBe("ollama");
  });
});

describe("CredentialMatrixRowSchema", () => {
  it("parses matrix row without secret fields", () => {
    const row = CredentialMatrixRowSchema.parse({
      engineId: "claude",
      displayName: "Claude Code",
      installed: true,
      authMode: "subscription",
      health: "ok",
      rung: "subscription",
      binary: "claude",
    });
    expect(row.health).toBe("ok");
  });
});

describe("EngineHealthRecordSchema", () => {
  it("parses health cache row", () => {
    const row = EngineHealthRecordSchema.parse({
      engineId: "codex",
      authMode: "byok",
      health: "degraded",
      reasonClass: null,
      binaryVersion: "1.0.0",
      checkedAt: "2026-10-16T12:00:00.000Z",
    });
    expect(row.engineId).toBe("codex");
  });
});
