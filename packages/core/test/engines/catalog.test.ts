import { describe, it, expect } from "vitest";
import {
  listBuiltinPresets,
  getBuiltinPreset,
  parseCustomEngineId,
} from "../../src/engines/catalog.js";
import { EnginePresetSchema } from "../../src/engines/schema.js";
import type { EngineId } from "../../src/engines/types.js";

const EXPECTED_IDS: EngineId[] = [
  "aider",
  "claude",
  "codex",
  "crush",
  "cursor-agent",
  "custom",
  "opencode",
];

describe("catalog", () => {
  it("lists exactly seven builtin engine ids at version 1", () => {
    const ids = listBuiltinPresets().map((p) => p.engineId).sort();
    expect(ids).toEqual([...EXPECTED_IDS].sort());
    expect(ids).toContain("claude");
    expect(getBuiltinPreset("claude")?.strategy).toBe("hooks");
    expect(getBuiltinPreset("codex")?.strategy).toBe("hooks");
    expect(getBuiltinPreset("cursor-agent")?.strategy).toBe("hooks");
    expect(getBuiltinPreset("opencode")?.strategy).toBe("acp");
    expect(getBuiltinPreset("crush")?.strategy).toBe("acp");
    expect(getBuiltinPreset("aider")?.strategy).toBe("pty");
    expect(getBuiltinPreset("custom")?.strategy).toBe("pty");
  });

  it("returns null for unknown builtin ids", () => {
    expect(getBuiltinPreset("nope" as EngineId)).toBeNull();
  });

  it("parses every builtin preset through EnginePresetSchema", () => {
    for (const preset of listBuiltinPresets()) {
      expect(() => EnginePresetSchema.parse(preset)).not.toThrow();
      expect(preset.catalogVersion).toBe(1);
    }
  });

  describe("parseCustomEngineId", () => {
    it("recognizes builtin engine ids", () => {
      expect(parseCustomEngineId("claude")).toEqual({ kind: "builtin", id: "claude" });
      expect(parseCustomEngineId("custom")).toEqual({ kind: "builtin", id: "custom" });
    });

    it("maps cursor alias to cursor-agent", () => {
      expect(parseCustomEngineId("cursor")).toEqual({
        kind: "builtin",
        id: "cursor-agent",
      });
    });

    it("parses custom instance roster ids", () => {
      expect(parseCustomEngineId("custom:my-cli")).toEqual({
        kind: "custom",
        instanceId: "my-cli",
      });
    });

    it("rejects invalid custom instance slugs and unknown strings", () => {
      expect(parseCustomEngineId("custom:")).toBeNull();
      expect(parseCustomEngineId("custom:Bad_Slug")).toBeNull();
      expect(parseCustomEngineId("unknown-engine")).toBeNull();
    });
  });
});
