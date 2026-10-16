import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { McpToolDef } from "../command-plane/mcp-command-plane-tools.js";
import { bindRosterEngine, type BindInput } from "./bind.js";
import { getBuiltinPreset } from "./catalog.js";
import { detectInstalled } from "./detect.js";
import { buildCredentialMatrix } from "./matrix.js";
import { setLocalPack, type LocalPackRequest } from "./local-pack.js";
import { CustomEnginesFileSchema, FailoverPolicySchema } from "./schema.js";
import { readPolicy, resolveHiveRoot, writePolicy, type EnginesStoreError } from "./store.js";
import { ENGINE_CATALOG_VERSION, type EngineId } from "./types.js";

export const ENGINES_MCP_TOOL_NAMES = [
  "engines-detect",
  "engines-bind",
  "engines-matrix",
  "engines-policy-show",
  "engines-policy-set",
  "engines-local-pack-set",
] as const;

export type EnginesMcpToolName = (typeof ENGINES_MCP_TOOL_NAMES)[number];

type HiveResolved =
  | { ok: true; hiveRoot: string }
  | { ok: false; error: "HIVE_ROOT_UNRESOLVED" | "HIVE_NOT_INITIALIZED" };

export type EnginesMcpDeps = {
  detectInstalled?: typeof detectInstalled;
  bindRosterEngine?: typeof bindRosterEngine;
  buildCredentialMatrix?: typeof buildCredentialMatrix;
  readPolicy?: typeof readPolicy;
  writePolicy?: typeof writePolicy;
  setLocalPack?: typeof setLocalPack;
  resolveHiveRoot?: (cwd: string) => Promise<HiveResolved>;
  cwd?: () => string;
};

function hiveFailure(error: "HIVE_ROOT_UNRESOLVED" | "HIVE_NOT_INITIALIZED" | EnginesStoreError) {
  if (error === "HIVE_ROOT_UNRESOLVED") {
    return {
      ok: false as const,
      error,
      message: "Could not resolve repository root.",
      hint: "Add program.md at the SuperSpec repository root, then run superspec hive init.",
    };
  }
  return {
    ok: false as const,
    error: "HIVE_NOT_INITIALIZED" as const,
    message: "Hive is not initialized.",
    hint: "Run superspec hive init, then superspec doctor",
  };
}

function storeFailure(error: EnginesStoreError) {
  if (error === "LEDGER_BUSY") {
    return { ok: false as const, error: "ROSTER_BUSY" as const, message: "Engines lock is busy." };
  }
  return hiveFailure(error);
}

async function requireHive(cwdOpt: string | undefined, deps: EnginesMcpDeps): Promise<
  | { ok: true; hiveRoot: string }
  | { ok: false; error: string; message: string; hint?: string }
> {
  const cwd = cwdOpt ?? deps.cwd?.() ?? process.cwd();
  const resolve = deps.resolveHiveRoot ?? resolveHiveRoot;
  const resolved = await resolve(cwd);
  if (!resolved.ok) return hiveFailure(resolved.error);
  return resolved;
}

async function loadCustomDetectRows(hiveRoot: string): Promise<
  Array<{ engineId: string; displayName: string; installed: boolean; binary: string | null }>
> {
  try {
    const text = await readFile(join(hiveRoot, "engines", "custom.json"), "utf8");
    const parsed = CustomEnginesFileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return [];
    return parsed.data.engines.map((engine) => ({
      engineId: `custom:${engine.instanceId}`,
      displayName: engine.displayName,
      installed: false,
      binary: null,
    }));
  } catch {
    return [];
  }
}

export async function enginesDetectHandler(
  args: { cwd?: string },
  deps: EnginesMcpDeps = {},
): Promise<
  | {
      ok: true;
      catalogVersion: number;
      engines: Array<{
        engineId: string;
        displayName: string;
        installed: boolean;
        binary: string | null;
      }>;
    }
  | { ok: false; error: string; message: string; hint?: string }
> {
  const detectFn = deps.detectInstalled ?? detectInstalled;
  const rows = await detectFn();
  const engines = rows.map((row) => {
    const preset = getBuiltinPreset(row.engineId as EngineId);
    return {
      engineId: row.engineId,
      displayName: preset?.displayName ?? row.engineId,
      installed: row.installed,
      binary: row.binary,
    };
  });

  const cwd = args.cwd ?? deps.cwd?.() ?? process.cwd();
  const resolve = deps.resolveHiveRoot ?? resolveHiveRoot;
  const hive = await resolve(cwd);
  if (hive.ok) {
    engines.push(...(await loadCustomDetectRows(hive.hiveRoot)));
  }

  return { ok: true, catalogVersion: ENGINE_CATALOG_VERSION, engines };
}

export async function enginesBindHandler(
  args: Record<string, unknown>,
  deps: EnginesMcpDeps = {},
) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;

  const input: BindInput = {
    agentId: String(args.agentId ?? ""),
    personaPath: String(args.personaPath ?? ""),
    engine: String(args.engine ?? ""),
    model: (args.model as string | null | undefined) ?? null,
    budgetUsd: (args.budgetUsd as number | null | undefined) ?? null,
    budgetTokens: (args.budgetTokens as number | null | undefined) ?? null,
    workspace: (args.workspace as string | null | undefined) ?? null,
    worktreePolicy: (args.worktreePolicy as "isolated" | "shared" | undefined) ?? undefined,
  };

  const bindFn = deps.bindRosterEngine ?? bindRosterEngine;
  return bindFn(ctx.hiveRoot, input);
}

export async function enginesMatrixHandler(args: { cwd?: string }, deps: EnginesMcpDeps = {}) {
  const ctx = await requireHive(args.cwd, deps);
  if (!ctx.ok) return ctx;

  const matrixFn = deps.buildCredentialMatrix ?? buildCredentialMatrix;
  try {
    const { catalogVersion, rows } = await matrixFn(ctx.hiveRoot);
    return { ok: true as const, catalogVersion, rows };
  } catch (err) {
    if (err instanceof Error && err.message === "HIVE_NOT_INITIALIZED") {
      return hiveFailure("HIVE_NOT_INITIALIZED");
    }
    throw err;
  }
}

export async function enginesPolicyShowHandler(args: { cwd?: string }, deps: EnginesMcpDeps = {}) {
  const ctx = await requireHive(args.cwd, deps);
  if (!ctx.ok) return ctx;

  const readFn = deps.readPolicy ?? readPolicy;
  const read = await readFn(ctx.hiveRoot);
  if (!read.ok) return storeFailure(read.error);
  return { ok: true as const, policy: read.policy };
}

export async function enginesPolicySetHandler(
  args: Record<string, unknown>,
  deps: EnginesMcpDeps = {},
) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;

  const readFn = deps.readPolicy ?? readPolicy;
  const current = await readFn(ctx.hiveRoot);
  if (!current.ok) return storeFailure(current.error);

  const { cwd: _cwd, ...patch } = args;
  const merged = { ...current.policy, ...patch };
  const parsed = FailoverPolicySchema.safeParse(merged);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "INVALID_INPUT" as const,
      message: "Policy update is invalid.",
    };
  }

  const writeFn = deps.writePolicy ?? writePolicy;
  const written = await writeFn(ctx.hiveRoot, parsed.data);
  if (!written.ok) return storeFailure(written.error);
  return { ok: true as const, policy: parsed.data };
}

export async function enginesLocalPackSetHandler(
  args: Record<string, unknown>,
  deps: EnginesMcpDeps = {},
) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;

  const request = args as LocalPackRequest & { cwd?: string };
  const setFn = deps.setLocalPack ?? setLocalPack;
  const result = await setFn(ctx.hiveRoot, request);
  if (!result.ok) {
    return {
      ok: false as const,
      error: result.code,
      message: result.message,
    };
  }
  const { profile } = result;
  return {
    ok: true as const,
    engineId: profile.engineId,
    backend: profile.backend,
    baseUrl: profile.baseUrl,
    model: profile.model,
    advertisedContext: profile.advertisedContext,
    contextSource: profile.contextSource,
    ...(profile.tiers ? { tiers: profile.tiers } : {}),
  };
}

function enginesJson(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function buildEnginesMcpTools(): McpToolDef[] {
  return [
    {
      name: "engines-detect",
      description: "Detect installed engine CLIs from the catalog (optional cwd for custom rows).",
      schema: { cwd: z.string().optional() },
      handler: async (args) => enginesJson(await enginesDetectHandler({ cwd: args.cwd as string | undefined })),
    },
    {
      name: "engines-bind",
      description: "Bind persona, engine, model, budget, and workspace onto a roster agent.",
      schema: {
        cwd: z.string().optional(),
        agentId: z.string(),
        personaPath: z.string(),
        engine: z.string(),
        model: z.string().nullable().optional(),
        budgetUsd: z.number().nullable().optional(),
        budgetTokens: z.number().nullable().optional(),
        workspace: z.string().nullable().optional(),
        worktreePolicy: z.enum(["isolated", "shared"]).optional(),
      },
      handler: async (args) => enginesJson(await enginesBindHandler(args)),
    },
    {
      name: "engines-matrix",
      description: "Build the credential matrix for installed engines and auth health.",
      schema: { cwd: z.string().optional() },
      handler: async (args) => enginesJson(await enginesMatrixHandler({ cwd: args.cwd as string | undefined })),
    },
    {
      name: "engines-policy-show",
      description: "Show failover and review policy from the hive engines store.",
      schema: { cwd: z.string().optional() },
      handler: async (args) => enginesJson(await enginesPolicyShowHandler({ cwd: args.cwd as string | undefined })),
    },
    {
      name: "engines-policy-set",
      description: "Update failover policy (same fields as show response policy object).",
      schema: {
        cwd: z.string().optional(),
        schemaVersion: z.literal(1).optional(),
        failoverEnabled: z.boolean().optional(),
        ladder: z
          .tuple([z.literal("subscription"), z.literal("byok"), z.literal("local")])
          .optional(),
        crossEngineReview: z.boolean().optional(),
        delegateToHost: z.enum(["claude", "codex", "cursor-agent"]).nullable().optional(),
        hitl: z.array(z.enum(["budget_exceed", "destructive_git"])).optional(),
        quotaGroups: z.array(z.array(z.string().min(1))).optional(),
      },
      handler: async (args) => enginesJson(await enginesPolicySetHandler(args)),
    },
    {
      name: "engines-local-pack-set",
      description: "Configure a local-pack profile after context floor probe.",
      schema: {
        cwd: z.string().optional(),
        engineId: z.enum(["opencode", "crush"]),
        backend: z.enum(["ollama", "lmstudio", "vllm", "byok"]),
        baseUrl: z.string().optional(),
        model: z.string(),
        advertisedContext: z.number().int().nonnegative().nullable().optional(),
        tiers: z
          .object({
            economy: z.string().min(1),
            standard: z.string().min(1),
            frontier: z.string().min(1),
          })
          .optional(),
      },
      handler: async (args) => enginesJson(await enginesLocalPackSetHandler(args)),
    },
  ];
}
