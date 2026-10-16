/**
 * Versioned builtin engine presets (catalog v1).
 * Preset field shape adapted from Munder `src/shared/agentProvider.ts` (MIT).
 */

import { ENGINE_CATALOG_VERSION, type EngineId, type EnginePreset } from "./types.js";

const TIER_SLUGS = ["economy", "standard", "frontier"] as const;

const BUILTIN_PRESETS: readonly EnginePreset[] = [
  {
    catalogVersion: ENGINE_CATALOG_VERSION,
    engineId: "claude",
    displayName: "Claude Code",
    binaries: ["claude"],
    strategy: "hooks",
    rung: "subscription",
    spawnArgs: [],
    statusArgs: ["auth", "status"],
    authEnv: "ANTHROPIC_API_KEY",
    byokEnvAllowlist: [],
    models: [...TIER_SLUGS],
    emits: ["start", "tool", "stop", "error", "tokens"],
  },
  {
    catalogVersion: ENGINE_CATALOG_VERSION,
    engineId: "codex",
    displayName: "Codex",
    binaries: ["codex"],
    strategy: "hooks",
    rung: "subscription",
    spawnArgs: [],
    statusArgs: ["login", "status"],
    authEnv: "OPENAI_API_KEY",
    byokEnvAllowlist: [],
    models: [...TIER_SLUGS, "gpt-5.4", "gpt-5.5", "gpt-5.5-high"],
    emits: ["start", "tool", "stop", "error", "tokens"],
  },
  {
    catalogVersion: ENGINE_CATALOG_VERSION,
    engineId: "cursor-agent",
    displayName: "Cursor Agent",
    binaries: ["cursor-agent", "agent"],
    strategy: "hooks",
    rung: "subscription",
    spawnArgs: [],
    statusArgs: [],
    authEnv: "CURSOR_API_KEY",
    byokEnvAllowlist: [],
    models: [...TIER_SLUGS, "composer-economy", "composer-2.5", "frontier-high"],
    emits: ["start", "tool", "stop", "error", "tokens"],
  },
  {
    catalogVersion: ENGINE_CATALOG_VERSION,
    engineId: "opencode",
    displayName: "OpenCode",
    binaries: ["opencode"],
    strategy: "acp",
    rung: "byok",
    spawnArgs: ["acp"],
    statusArgs: [],
    authEnv: "OPENAI_API_KEY",
    byokEnvAllowlist: ["OPENAI_API_KEY"],
    models: [...TIER_SLUGS],
    emits: ["start", "tool", "stop", "error", "tokens"],
  },
  {
    catalogVersion: ENGINE_CATALOG_VERSION,
    engineId: "crush",
    displayName: "Crush",
    binaries: ["crush"],
    strategy: "acp",
    rung: "byok",
    spawnArgs: ["acp"],
    statusArgs: [],
    authEnv: "OPENAI_API_KEY",
    byokEnvAllowlist: ["OPENAI_API_KEY"],
    models: [...TIER_SLUGS],
    emits: ["start", "tool", "stop", "error", "tokens"],
  },
  {
    catalogVersion: ENGINE_CATALOG_VERSION,
    engineId: "aider",
    displayName: "Aider",
    binaries: ["aider"],
    strategy: "pty",
    rung: "byok",
    spawnArgs: ["--message-file", "<file>", "--yes-always", "--no-pretty"],
    statusArgs: [],
    authEnv: "OPENAI_API_KEY",
    byokEnvAllowlist: ["OPENAI_API_KEY"],
    models: [...TIER_SLUGS],
    emits: ["start", "stop", "error", "tokens"],
  },
  {
    catalogVersion: ENGINE_CATALOG_VERSION,
    engineId: "custom",
    displayName: "Custom command",
    binaries: ["custom"],
    strategy: "pty",
    rung: "byok",
    spawnArgs: [],
    statusArgs: [],
    authEnv: null,
    byokEnvAllowlist: [],
    models: [],
    emits: ["start", "stop", "error"],
  },
] as const;

const PRESET_BY_ID = new Map<EngineId, EnginePreset>(
  BUILTIN_PRESETS.map((preset) => [preset.engineId, preset]),
);

const BUILTIN_ID_SET = new Set<EngineId>(BUILTIN_PRESETS.map((p) => p.engineId));

const CUSTOM_INSTANCE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type ParsedEngineRef =
  | { kind: "builtin"; id: EngineId }
  | { kind: "custom"; instanceId: string };

export function listBuiltinPresets(): EnginePreset[] {
  return BUILTIN_PRESETS.map((preset) => ({ ...preset }));
}

export function getBuiltinPreset(engineId: EngineId): EnginePreset | null {
  const preset = PRESET_BY_ID.get(engineId);
  return preset ? { ...preset } : null;
}

export function parseCustomEngineId(engine: string): ParsedEngineRef | null {
  if (engine === "cursor") {
    return { kind: "builtin", id: "cursor-agent" };
  }

  if (BUILTIN_ID_SET.has(engine as EngineId)) {
    return { kind: "builtin", id: engine as EngineId };
  }

  if (engine.startsWith("custom:")) {
    const instanceId = engine.slice("custom:".length);
    if (!instanceId || !CUSTOM_INSTANCE_SLUG.test(instanceId)) {
      return null;
    }
    return { kind: "custom", instanceId };
  }

  return null;
}
