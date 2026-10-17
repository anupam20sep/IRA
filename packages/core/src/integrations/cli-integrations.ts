import { parseArgs } from "node:util";
import { z } from "zod";
import { resolveRepositoryRoot } from "../command-plane/paths.js";
import type { McpToolDef } from "../command-plane/mcp-command-plane-tools.js";
import { loadIntegrationConfig, saveIntegrationConfig } from "./config.js";
import { integrationDoctorFindings } from "./doctor-findings.js";
import { createShareToken } from "./board-share.js";
import type { IntegrationConfig } from "./types.js";

export type IntegrationsCliResult = { code: number; stdout: string };

const AdapterKeySchema = z.enum(["openclaw", "hermes", "channelApprove", "boardShare"]);
type AdapterKey = z.infer<typeof AdapterKeySchema>;

type HiveResolved =
  | { ok: true; hiveRoot: string }
  | { ok: false; error: "HIVE_ROOT_UNRESOLVED" };

export type IntegrationsMcpDeps = {
  resolveHiveRoot?: (cwd: string) => HiveResolved;
  cwd?: () => string;
};

function envelope(body: Record<string, unknown> | { ok: boolean }): IntegrationsCliResult {
  const ok = (body as { ok?: boolean }).ok !== false;
  return { code: ok ? 0 : 1, stdout: JSON.stringify(body, null, 2) };
}

function hiveFailure(error: "HIVE_ROOT_UNRESOLVED"): {
  ok: false;
  error: typeof error;
  message: string;
  hint: string;
} {
  return {
    ok: false,
    error,
    message: "Could not resolve repository root.",
    hint: "Add program.md at the SuperSpec repository root, then run superspec hive init.",
  };
}

function resolveHiveFromCwd(cwd: string): HiveResolved {
  const resolved = resolveRepositoryRoot(cwd);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  return { ok: true, hiveRoot: resolved.hiveRoot };
}

async function requireHive(
  cwdOpt: string | undefined,
  hiveRootOpt: string | undefined,
  deps: IntegrationsMcpDeps,
): Promise<
  | { ok: true; hiveRoot: string }
  | { ok: false; error: string; message: string; hint?: string }
> {
  if (hiveRootOpt?.trim()) {
    return { ok: true, hiveRoot: hiveRootOpt.trim() };
  }
  const cwd = cwdOpt ?? deps.cwd?.() ?? process.cwd();
  const resolve = deps.resolveHiveRoot ?? resolveHiveFromCwd;
  const resolved = resolve(cwd);
  if (!resolved.ok) return hiveFailure(resolved.error);
  return resolved;
}

function integrationsJson(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export async function integrationsStatusHandler(
  args: { cwd?: string; hiveRoot?: string },
  deps: IntegrationsMcpDeps = {},
) {
  const ctx = await requireHive(args.cwd, args.hiveRoot, deps);
  if (!ctx.ok) return ctx;
  const config = await loadIntegrationConfig(ctx.hiveRoot);
  const findings = await integrationDoctorFindings(ctx.hiveRoot);
  return { ok: true as const, config, findings };
}

export async function integrationsShareCreateHandler(
  args: { cwd?: string; hiveRoot?: string },
  deps: IntegrationsMcpDeps = {},
) {
  const ctx = await requireHive(args.cwd, args.hiveRoot, deps);
  if (!ctx.ok) return ctx;
  const config = await loadIntegrationConfig(ctx.hiveRoot);
  if (!config.adapters.boardShare.enabled) {
    return {
      ok: false as const,
      error: "INTEGRATION_DISABLED",
      message: "Board share adapter is disabled.",
      hint: "Run superspec integrations enable boardShare",
    };
  }
  const created = await createShareToken(ctx.hiveRoot);
  return { ok: true as const, ...created };
}

function setAdapterEnabled(config: IntegrationConfig, adapter: AdapterKey, enabled: boolean): IntegrationConfig {
  return {
    ...config,
    adapters: {
      ...config.adapters,
      [adapter]: { ...config.adapters[adapter], enabled },
    },
  };
}

export async function integrationsEnableHandler(
  args: { cwd?: string; hiveRoot?: string; adapter: string },
  deps: IntegrationsMcpDeps = {},
) {
  const parsed = AdapterKeySchema.safeParse(args.adapter);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "INVALID_ADAPTER",
      message: `Unknown adapter: ${args.adapter}`,
      hint: "Use openclaw, hermes, channelApprove, or boardShare.",
    };
  }
  const ctx = await requireHive(args.cwd, args.hiveRoot, deps);
  if (!ctx.ok) return ctx;
  const current = await loadIntegrationConfig(ctx.hiveRoot);
  const config = setAdapterEnabled(current, parsed.data, true);
  await saveIntegrationConfig(ctx.hiveRoot, config);
  return { ok: true as const, config };
}

export async function integrationsDisableHandler(
  args: { cwd?: string; hiveRoot?: string; adapter: string },
  deps: IntegrationsMcpDeps = {},
) {
  const parsed = AdapterKeySchema.safeParse(args.adapter);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: "INVALID_ADAPTER",
      message: `Unknown adapter: ${args.adapter}`,
      hint: "Use openclaw, hermes, channelApprove, or boardShare.",
    };
  }
  const ctx = await requireHive(args.cwd, args.hiveRoot, deps);
  if (!ctx.ok) return ctx;
  const current = await loadIntegrationConfig(ctx.hiveRoot);
  const config = setAdapterEnabled(current, parsed.data, false);
  await saveIntegrationConfig(ctx.hiveRoot, config);
  return { ok: true as const, config };
}

export const INTEGRATIONS_MCP_TOOL_NAMES = ["integrations-status", "integrations-share-create"] as const;

export function buildIntegrationsMcpTools(deps: IntegrationsMcpDeps = {}): McpToolDef[] {
  return [
    {
      name: "integrations-status",
      description: "Show integration adapter enable flags and doctor findings for the hive.",
      schema: {
        cwd: z.string().optional(),
        hiveRoot: z.string().optional(),
      },
      handler: async (args) => integrationsJson(await integrationsStatusHandler(args, deps)),
    },
    {
      name: "integrations-share-create",
      description: "Create a read-only board share token when boardShare adapter is enabled.",
      schema: {
        cwd: z.string().optional(),
        hiveRoot: z.string().optional(),
      },
      handler: async (args) => integrationsJson(await integrationsShareCreateHandler(args, deps)),
    },
  ];
}

export function buildIntegrationsCliHelpLines(): string[] {
  return [
    "superspec integrations status [--cwd path] [--hive-root path]",
    "superspec integrations enable <adapter> [--cwd path] [--hive-root path]",
    "superspec integrations disable <adapter> [--cwd path] [--hive-root path]",
    "superspec integrations share-create [--cwd path] [--hive-root path]",
  ];
}

export async function runIntegrationsCli(
  argv: string[],
  deps: IntegrationsMcpDeps = {},
): Promise<IntegrationsCliResult> {
  const [head, ...rest] = argv;

  if (head === undefined || head === "--help" || head === "-h") {
    return { code: 0, stdout: buildIntegrationsCliHelpLines().join("\n") };
  }

  const commonOptions = {
    cwd: { type: "string" as const },
    "hive-root": { type: "string" as const },
  };

  try {
    if (head === "status") {
      const { values } = parseArgs({ args: rest, options: commonOptions });
      return envelope(
        await integrationsStatusHandler(
          { cwd: values.cwd as string | undefined, hiveRoot: values["hive-root"] as string | undefined },
          deps,
        ),
      );
    }

    if (head === "share-create") {
      const { values } = parseArgs({ args: rest, options: commonOptions });
      return envelope(
        await integrationsShareCreateHandler(
          { cwd: values.cwd as string | undefined, hiveRoot: values["hive-root"] as string | undefined },
          deps,
        ),
      );
    }

    if (head === "enable" || head === "disable") {
      const { values, positionals } = parseArgs({
        args: rest,
        options: commonOptions,
        allowPositionals: true,
      });
      const adapter = positionals[0];
      if (!adapter || adapter.startsWith("-")) {
        return envelope({
          ok: false,
          error: "INVALID_INPUT",
          message: `Adapter name is required for integrations ${head}.`,
        });
      }
      const handler = head === "enable" ? integrationsEnableHandler : integrationsDisableHandler;
      return envelope(
        await handler(
          {
            adapter,
            cwd: values.cwd as string | undefined,
            hiveRoot: values["hive-root"] as string | undefined,
          },
          deps,
        ),
      );
    }

    return envelope({ ok: false, error: "INVALID_INPUT", message: `Unknown integrations subcommand: ${head}` });
  } catch (err) {
    return envelope({
      ok: false,
      error: "INVALID_INPUT",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
