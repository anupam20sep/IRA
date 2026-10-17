import { parseArgs } from "node:util";
import { resolveRepositoryRoot } from "../command-plane/paths.js";
import type { HostHookEngine } from "./hooks-install.js";
import { installProjectHookBridge } from "./hooks-install.js";
import {
  enginesBindHandler,
  enginesDetectHandler,
  enginesLocalPackSetHandler,
  enginesMatrixHandler,
  enginesPolicySetHandler,
  enginesPolicyShowHandler,
  type EnginesMcpDeps,
} from "./mcp-handlers.js";
import { readPolicy } from "./store.js";

type EnginesCliDeps = EnginesMcpDeps & {
  installProjectHookBridge?: typeof installProjectHookBridge;
};

export type EnginesCliResult = { code: number; stdout: string };

export function buildEnginesCliHelpLines(): string[] {
  return [
    "superspec engines detect [--cwd path]",
    "superspec engines bind --agent <id> --persona <path> --engine <id> [--model] [--budget-usd] [--budget-tokens] [--workspace] [--worktree isolated|shared] [--cwd path]",
    "superspec engines matrix [--cwd path]",
    "superspec engines policy show [--cwd path]",
    "superspec engines policy set [--failover true|false] [--cross-engine-review true|false] [--delegate-to-host claude|codex|cursor-agent|null] [--cwd path]",
    "superspec engines local-pack set --engine opencode|crush --backend ollama|lmstudio|vllm|byok --model <id> [--base-url] [--context N] [--cwd path]",
    "superspec engines hooks install [--host claude|codex|cursor-agent] [--cwd path]",
    "superspec engines supervise <intent-path>",
  ];
}

function envelope(body: Record<string, unknown> | { ok: boolean }): EnginesCliResult {
  const ok = (body as { ok?: boolean }).ok !== false;
  return { code: ok ? 0 : 1, stdout: JSON.stringify(body, null, 2) };
}

function parseOptionalBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

function parseDelegateToHost(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "null") return null;
  return raw;
}

async function enginesHooksInstallHandler(
  args: { cwd?: string; host?: HostHookEngine },
  deps: EnginesCliDeps = {},
): Promise<{ ok: true; path: string } | { ok: false; error: string; message: string; hint?: string }> {
  const cwd = args.cwd ?? deps.cwd?.() ?? process.cwd();
  const resolve = deps.resolveHiveRoot;
  if (resolve) {
    const hive = await resolve(cwd);
    if (!hive.ok) {
      if (hive.error === "HIVE_ROOT_UNRESOLVED") {
        return {
          ok: false,
          error: hive.error,
          message: "Could not resolve repository root.",
          hint: "Add program.md at the SuperSpec repository root, then run superspec hive init.",
        };
      }
      return {
        ok: false,
        error: "HIVE_NOT_INITIALIZED",
        message: "Hive is not initialized.",
        hint: "Run superspec hive init, then superspec doctor",
      };
    }
  }

  const repo = resolveRepositoryRoot(cwd);
  if (!repo.ok) {
    return {
      ok: false,
      error: "HIVE_ROOT_UNRESOLVED",
      message: "Could not resolve repository root.",
      hint: "Add program.md at the SuperSpec repository root, then run superspec hive init.",
    };
  }

  let host: HostHookEngine | null | undefined = args.host;
  if (!host) {
    const readFn = deps.readPolicy ?? readPolicy;
    const policyRead = await readFn(repo.hiveRoot);
    if (!policyRead.ok) {
      return {
        ok: false,
        error: "HIVE_NOT_INITIALIZED",
        message: "Hive is not initialized.",
        hint: "Run superspec hive init, then superspec doctor",
      };
    }
    host = policyRead.policy.delegateToHost ?? undefined;
  }

  if (!host) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: "Pass --host or set delegateToHost in engines policy.",
    };
  }

  const installFn = deps.installProjectHookBridge ?? installProjectHookBridge;
  return installFn(repo.repositoryRoot, host);
}

export async function runEnginesCli(
  argv: string[],
  deps: EnginesCliDeps = {},
): Promise<EnginesCliResult> {
  const [head, second, ...tail] = argv;

  if (head === undefined || head === "--help" || head === "-h") {
    return { code: 0, stdout: buildEnginesCliHelpLines().join("\n") };
  }

  try {
    if (head === "detect") {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: { cwd: { type: "string" } },
      });
      return envelope(await enginesDetectHandler({ cwd: values.cwd as string | undefined }, deps));
    }

    if (head === "bind") {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: {
          cwd: { type: "string" },
          agent: { type: "string" },
          persona: { type: "string" },
          engine: { type: "string" },
          model: { type: "string" },
          "budget-usd": { type: "string" },
          "budget-tokens": { type: "string" },
          workspace: { type: "string" },
          worktree: { type: "string" },
        },
      });
      const budgetUsdRaw = values["budget-usd"] as string | undefined;
      const budgetTokensRaw = values["budget-tokens"] as string | undefined;
      return envelope(
        await enginesBindHandler(
          {
            cwd: values.cwd,
            agentId: values.agent,
            personaPath: values.persona,
            engine: values.engine,
            model: values.model ?? null,
            budgetUsd: budgetUsdRaw === undefined ? undefined : Number(budgetUsdRaw),
            budgetTokens: budgetTokensRaw === undefined ? undefined : Number(budgetTokensRaw),
            workspace: values.workspace ?? null,
            worktreePolicy: values.worktree as "isolated" | "shared" | undefined,
          },
          deps,
        ),
      );
    }

    if (head === "matrix") {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: { cwd: { type: "string" } },
      });
      return envelope(await enginesMatrixHandler({ cwd: values.cwd as string | undefined }, deps));
    }

    if (head === "policy" && second === "show") {
      const { values } = parseArgs({
        args: tail,
        options: { cwd: { type: "string" } },
      });
      return envelope(await enginesPolicyShowHandler({ cwd: values.cwd as string | undefined }, deps));
    }

    if (head === "policy" && second === "set") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          failover: { type: "string" },
          "cross-engine-review": { type: "string" },
          "delegate-to-host": { type: "string" },
        },
      });
      const patch: Record<string, unknown> = { cwd: values.cwd };
      const failover = parseOptionalBool(values.failover as string | undefined);
      if (failover !== undefined) patch.failoverEnabled = failover;
      const cross = parseOptionalBool(values["cross-engine-review"] as string | undefined);
      if (cross !== undefined) patch.crossEngineReview = cross;
      const delegate = parseDelegateToHost(values["delegate-to-host"] as string | undefined);
      if (delegate !== undefined) patch.delegateToHost = delegate;
      return envelope(await enginesPolicySetHandler(patch, deps));
    }

    if (head === "local-pack" && second === "set") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          engine: { type: "string" },
          backend: { type: "string" },
          model: { type: "string" },
          "base-url": { type: "string" },
          context: { type: "string" },
        },
      });
      const contextRaw = values.context as string | undefined;
      return envelope(
        await enginesLocalPackSetHandler(
          {
            cwd: values.cwd,
            engineId: values.engine,
            backend: values.backend,
            model: values.model,
            baseUrl: values["base-url"],
            advertisedContext: contextRaw === undefined ? undefined : Number(contextRaw),
          },
          deps,
        ),
      );
    }

    if (head === "hooks" && second === "install") {
      const { values } = parseArgs({
        args: tail,
        options: {
          cwd: { type: "string" },
          host: { type: "string" },
        },
      });
      return envelope(
        await enginesHooksInstallHandler(
          {
            cwd: values.cwd as string | undefined,
            host: values.host as HostHookEngine | undefined,
          },
          deps,
        ),
      );
    }

    return envelope({
      ok: false,
      error: "INVALID_INPUT",
      message: `Unknown engines subcommand: ${argv.join(" ")}`,
    });
  } catch (err) {
    return envelope({
      ok: false,
      error: "INVALID_INPUT",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
