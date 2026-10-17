import { parseArgs } from "node:util";
import {
  tokenBreakerResetHandler,
  tokenBreakerStatusHandler,
  tokenBudgetSetHandler,
  tokenBudgetShowHandler,
  tokenCompactionListHandler,
  tokenForecastHandler,
  tokenGaugeQueryHandler,
  tokenGaugeReportHandler,
  tokenSpendQueryHandler,
  tokenSpendRecordHandler,
  tokenTierOverrideHandler,
  type TokenMcpDeps,
} from "./mcp-handlers.js";

export type TokenCliResult = { code: number; stdout: string };

export type TokenCliCommand = {
  name: string;
  description: string;
};

function envelope(body: Record<string, unknown> | { ok: boolean }): TokenCliResult {
  const ok = (body as { ok?: boolean }).ok !== false;
  return { code: ok ? 0 : 1, stdout: JSON.stringify(body, null, 2) };
}

function parseOptionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseOptionalBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

export const tokenCliCommands: TokenCliCommand[] = [
  { name: "token spend record", description: "Append one spend event to the hive token ledger." },
  { name: "token spend query", description: "Query spend totals and remaining budget for a scope." },
  { name: "token budget set", description: "Set an agent or feature budget cap in tokens or USD." },
  { name: "token budget show", description: "Show budget caps, spent amounts, and enforced remaining." },
  { name: "token forecast", description: "Forecast task cost from hive spend history." },
  { name: "token breaker status", description: "List circuit breaker states for workers." },
  { name: "token breaker reset", description: "Operator reset of a terminal circuit breaker stop." },
  { name: "token gauge report", description: "Report measured or unavailable context-window gauge for a worker." },
  { name: "token gauge query", description: "Query context-window gauges for workers." },
  { name: "token compaction list", description: "List recent compaction records from the hive token store." },
  { name: "token tier override", description: "Persist an operator tier override with route-model audit." },
];

export function buildTokenCliHelpLines(): string[] {
  return tokenCliCommands.map((c) => `superspec ${c.name} [--cwd path] …`);
}

export async function runTokenCli(argv: string[], deps: TokenMcpDeps = {}): Promise<TokenCliResult> {
  const [head, second] = argv;

  if (head === undefined || head === "--help" || head === "-h") {
    return { code: 0, stdout: buildTokenCliHelpLines().join("\n") };
  }

  try {
    if (head === "spend" && second === "record") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          "agent-id": { type: "string" },
          "session-id": { type: "string" },
          "feature-id": { type: "string" },
          "task-id": { type: "string" },
          engine: { type: "string" },
          model: { type: "string" },
          "input-tokens": { type: "string" },
          "output-tokens": { type: "string" },
          "usd-estimate": { type: "string" },
          source: { type: "string" },
          partial: { type: "string" },
        },
      });
      return envelope(
        await tokenSpendRecordHandler(
          {
            cwd: values.cwd,
            agentId: values["agent-id"],
            sessionId: values["session-id"],
            featureId: values["feature-id"] === undefined ? undefined : values["feature-id"] || null,
            taskId: values["task-id"] === undefined ? undefined : values["task-id"] || null,
            engine: values.engine === undefined ? undefined : values.engine || null,
            model: values.model === undefined ? undefined : values.model || null,
            inputTokens: parseOptionalNumber(values["input-tokens"] as string | undefined),
            outputTokens: parseOptionalNumber(values["output-tokens"] as string | undefined),
            usdEstimate:
              values["usd-estimate"] === undefined
                ? undefined
                : values["usd-estimate"] === "null"
                  ? null
                  : parseOptionalNumber(values["usd-estimate"] as string | undefined),
            source: values.source,
            partial: parseOptionalBool(values.partial as string | undefined),
          },
          deps,
        ),
      );
    }

    if (head === "spend" && second === "query") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          "agent-id": { type: "string" },
          "feature-id": { type: "string" },
          "session-id": { type: "string" },
          "task-id": { type: "string" },
        },
      });
      return envelope(
        await tokenSpendQueryHandler(
          {
            cwd: values.cwd,
            agentId: values["agent-id"],
            featureId: values["feature-id"],
            sessionId: values["session-id"],
            taskId: values["task-id"],
          },
          deps,
        ),
      );
    }

    if (head === "budget" && second === "set") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          scope: { type: "string" },
          "scope-id": { type: "string" },
          unit: { type: "string" },
          cap: { type: "string" },
        },
      });
      const capRaw = values.cap as string | undefined;
      return envelope(
        await tokenBudgetSetHandler(
          {
            cwd: values.cwd,
            scope: values.scope,
            scopeId: values["scope-id"],
            unit: values.unit,
            cap: capRaw === undefined ? undefined : capRaw === "null" ? null : parseOptionalNumber(capRaw),
          },
          deps,
        ),
      );
    }

    if (head === "budget" && second === "show") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          "agent-id": { type: "string" },
          "feature-id": { type: "string" },
        },
      });
      return envelope(
        await tokenBudgetShowHandler(
          {
            cwd: values.cwd,
            agentId: values["agent-id"],
            featureId: values["feature-id"],
          },
          deps,
        ),
      );
    }

    if (head === "forecast") {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: {
          cwd: { type: "string" },
          "feature-id": { type: "string" },
          "task-kind": { type: "string" },
          engine: { type: "string" },
          "agent-id": { type: "string" },
        },
      });
      return envelope(
        await tokenForecastHandler(
          {
            cwd: values.cwd,
            featureId: values["feature-id"],
            taskKind: values["task-kind"],
            engine: values.engine,
            agentId: values["agent-id"],
          },
          deps,
        ),
      );
    }

    if (head === "breaker" && second === "status") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          "worker-key": { type: "string" },
          "agent-id": { type: "string" },
        },
      });
      return envelope(
        await tokenBreakerStatusHandler(
          {
            cwd: values.cwd,
            workerKey: values["worker-key"],
            agentId: values["agent-id"],
          },
          deps,
        ),
      );
    }

    if (head === "breaker" && second === "reset") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          "worker-key": { type: "string" },
          "agent-id": { type: "string" },
        },
      });
      return envelope(
        await tokenBreakerResetHandler(
          {
            cwd: values.cwd,
            workerKey: values["worker-key"],
            agentId: values["agent-id"],
          },
          deps,
        ),
      );
    }

    if (head === "gauge" && second === "report") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          "worker-key": { type: "string" },
          "used-tokens": { type: "string" },
          "limit-tokens": { type: "string" },
          unavailable: { type: "string" },
          reason: { type: "string" },
        },
      });
      return envelope(
        await tokenGaugeReportHandler(
          {
            cwd: values.cwd,
            workerKey: values["worker-key"],
            usedTokens: parseOptionalNumber(values["used-tokens"] as string | undefined),
            limitTokens: parseOptionalNumber(values["limit-tokens"] as string | undefined),
            unavailable: parseOptionalBool(values.unavailable as string | undefined),
            reason: values.reason,
          },
          deps,
        ),
      );
    }

    if (head === "gauge" && second === "query") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          "agent-id": { type: "string" },
          "worker-key": { type: "string" },
        },
      });
      return envelope(
        await tokenGaugeQueryHandler(
          {
            cwd: values.cwd,
            agentId: values["agent-id"],
            workerKey: values["worker-key"],
          },
          deps,
        ),
      );
    }

    if (head === "compaction" && second === "list") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          "feature-id": { type: "string" },
          "task-id": { type: "string" },
          limit: { type: "string" },
        },
      });
      const limitRaw = values.limit as string | undefined;
      const limitParsed = limitRaw === undefined ? undefined : parseOptionalNumber(limitRaw);
      return envelope(
        await tokenCompactionListHandler(
          {
            cwd: values.cwd,
            featureId: values["feature-id"],
            taskId: values["task-id"],
            limit: limitParsed === undefined ? undefined : Math.trunc(limitParsed),
          },
          deps,
        ),
      );
    }

    if (head === "tier" && second === "override") {
      const { values } = parseArgs({
        args: argv.slice(2),
        options: {
          cwd: { type: "string" },
          "agent-id": { type: "string" },
          "feature-id": { type: "string" },
          "requested-tier": { type: "string" },
          reason: { type: "string" },
          complexity: { type: "string" },
          attempt: { type: "string" },
          role: { type: "string" },
          kind: { type: "string" },
        },
      });
      const attemptRaw = values.attempt as string | undefined;
      const attemptParsed = attemptRaw === undefined ? undefined : parseOptionalNumber(attemptRaw);
      return envelope(
        await tokenTierOverrideHandler(
          {
            cwd: values.cwd,
            agentId: values["agent-id"],
            featureId:
              values["feature-id"] === undefined ? undefined : values["feature-id"] || null,
            requestedTier: values["requested-tier"],
            reason: values.reason,
            complexity: values.complexity,
            attempt: attemptParsed === undefined ? undefined : Math.trunc(attemptParsed),
            role: values.role,
            kind: values.kind,
          },
          deps,
        ),
      );
    }

    return envelope({
      ok: false,
      error: "INVALID_INPUT",
      message: `Unknown token subcommand: ${argv.join(" ")}`,
    });
  } catch (err) {
    return envelope({
      ok: false,
      error: "INVALID_INPUT",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
