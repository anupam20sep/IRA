import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { McpToolDef } from "../command-plane/mcp-command-plane-tools.js";
import { resolveHiveRoot } from "../engines/store.js";
import type { Complexity, TaskKind } from "../types.js";
import { getEnforcedRemaining, setBudget, type SetBudgetInput } from "./budgets.js";
import { resetBreaker } from "./breaker.js";
import { ensureTokenLayout, tokenRoot } from "./paths.js";
import { forecastCost } from "./forecast.js";
import { reportGauge, queryGauges, type ReportGaugeInput } from "./gauges.js";
import { querySpendTotals } from "./rollup.js";
import { recordTierOverride } from "./routing-hints.js";
import {
  BreakersFileSchema,
  BudgetsFileSchema,
  CompactionRecordSchema,
  GaugesFileSchema,
  ModelTierSchema,
  SpendEventInputSchema,
  SpendSourceSchema,
} from "./schema.js";
import { appendSpendEvent } from "./spend-ledger.js";
import type { CircuitBreakerState, ContextGauge } from "./types.js";

export const TOKEN_MCP_TOOL_NAMES = [
  "token-spend-record",
  "token-spend-query",
  "token-budget-set",
  "token-budget-show",
  "token-forecast",
  "token-breaker-status",
  "token-breaker-reset",
  "token-gauge-report",
  "token-gauge-query",
  "token-compaction-list",
  "token-tier-override",
] as const;

export type TokenMcpToolName = (typeof TOKEN_MCP_TOOL_NAMES)[number];

type HiveResolved =
  | { ok: true; hiveRoot: string }
  | { ok: false; error: "HIVE_ROOT_UNRESOLVED" | "HIVE_NOT_INITIALIZED" };

export type TokenMcpDeps = {
  resolveHiveRoot?: (cwd: string) => Promise<HiveResolved>;
  cwd?: () => string;
};

function hiveFailure(error: "HIVE_ROOT_UNRESOLVED" | "HIVE_NOT_INITIALIZED") {
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

async function requireHive(cwdOpt: string | undefined, deps: TokenMcpDeps): Promise<
  | { ok: true; hiveRoot: string }
  | { ok: false; error: string; message: string; hint?: string }
> {
  const cwd = cwdOpt ?? deps.cwd?.() ?? process.cwd();
  const resolve = deps.resolveHiveRoot ?? resolveHiveRoot;
  const resolved = await resolve(cwd);
  if (!resolved.ok) return hiveFailure(resolved.error);
  return resolved;
}

function tokenJson(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function workerKeyFromAgent(agentId: string, sessionId = "session"): string {
  return `${agentId}:${sessionId}`;
}

async function readBreakersFile(hiveRoot: string): Promise<CircuitBreakerState[]> {
  try {
    const raw = await readFile(join(tokenRoot(hiveRoot), "breakers.json"), "utf8");
    const parsed = BreakersFileSchema.parse(JSON.parse(raw));
    return Object.values(parsed.items);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function listCompactionRecords(
  hiveRoot: string,
  filter: { featureId?: string; taskId?: string; limit: number },
): Promise<unknown[]> {
  const path = join(tokenRoot(hiveRoot), "compaction.jsonl");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const rows: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const row = CompactionRecordSchema.safeParse(parsed);
    if (!row.success) continue;
    if (filter.featureId !== undefined && row.data.featureId !== filter.featureId) continue;
    if (filter.taskId !== undefined && row.data.taskId !== filter.taskId) continue;
    rows.push(row.data);
  }
  return rows.slice(-filter.limit);
}

async function budgetShow(hiveRoot: string, query: { agentId?: string; featureId?: string }) {
  const [budgetsRaw, remaining] = await Promise.all([
    readFile(join(tokenRoot(hiveRoot), "budgets.json"), "utf8").catch(() =>
      JSON.stringify({ schemaVersion: 1, items: [] }),
    ),
    getEnforcedRemaining(hiveRoot, query),
  ]);
  const budgets = BudgetsFileSchema.parse(JSON.parse(budgetsRaw));
  const scopes: Array<{ scope: "agent" | "feature"; scopeId: string }> = [];
  if (query.agentId) scopes.push({ scope: "agent", scopeId: query.agentId });
  if (query.featureId) scopes.push({ scope: "feature", scopeId: query.featureId });

  const caps: Record<string, unknown> = {};
  const spent: Record<string, unknown> = {};
  const scopeRemaining: Record<string, unknown> = {};

  for (const { scope, scopeId } of scopes) {
    const filter = scope === "agent" ? { agentId: scopeId } : { featureId: scopeId };
    const totals = await querySpendTotals(hiveRoot, filter);
    const tokenCap = budgets.items.find(
      (item) => item.scope === scope && item.scopeId === scopeId && item.unit === "tokens",
    )?.cap;
    const usdCap = budgets.items.find(
      (item) => item.scope === scope && item.scopeId === scopeId && item.unit === "usd",
    )?.cap;
    const tokenSpent = totals.inputTokens + totals.outputTokens;
    caps[`${scope}:${scopeId}`] = { tokens: tokenCap ?? null, usd: usdCap ?? null };
    spent[`${scope}:${scopeId}`] = {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      usdEstimate: totals.usdEstimate,
    };
    scopeRemaining[`${scope}:${scopeId}`] = {
      tokens:
        tokenCap == null ? null : Math.max(0, tokenCap - tokenSpent),
      usd:
        usdCap == null || totals.usdEstimate === null
          ? usdCap == null
            ? null
            : Math.max(0, usdCap - (totals.usdEstimate ?? 0))
          : Math.max(0, usdCap - totals.usdEstimate),
    };
  }

  return {
    ok: true as const,
    caps,
    spent,
    remaining: scopeRemaining,
    enforcedRemaining: remaining,
  };
}

export async function tokenSpendRecordHandler(
  args: Record<string, unknown>,
  deps: TokenMcpDeps = {},
) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;
  await ensureTokenLayout(ctx.hiveRoot);

  const parsed = SpendEventInputSchema.safeParse({
    engine: null,
    model: null,
    partial: false,
    ...args,
  });
  if (!parsed.success) {
    return { ok: false as const, error: "INVALID_INPUT" as const, message: "Spend event is invalid." };
  }

  const appended = await appendSpendEvent(ctx.hiveRoot, parsed.data);
  if (!("id" in appended)) {
    if (appended.ok === false && appended.code === "SLICE_A_ONLY") {
      return { ok: false as const, error: "SLICE_A_ONLY" as const, message: "Token side effects disabled (Slice A)." };
    }
    if (appended.ok === false && appended.code === "DUPLICATE_SPEND_ID") {
      return { ok: false as const, error: "DUPLICATE_SPEND_ID" as const, message: "Spend id already exists." };
    }
    return { ok: false as const, error: "LEDGER_BUSY" as const, message: "Spend ledger is busy." };
  }

  const { agentId, sessionId, featureId } = parsed.data;
  const [agentRollup, featureRollup, sessionRollup] = await Promise.all([
    querySpendTotals(ctx.hiveRoot, { agentId }),
    featureId ? querySpendTotals(ctx.hiveRoot, { featureId }) : Promise.resolve(null),
    querySpendTotals(ctx.hiveRoot, { sessionId }),
  ]);

  return {
    ok: true as const,
    id: appended.id,
    rollup: {
      agent: agentRollup,
      feature: featureRollup,
      session: sessionRollup,
    },
  };
}

export async function tokenSpendQueryHandler(args: Record<string, unknown>, deps: TokenMcpDeps = {}) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;

  const filter = {
    agentId: args.agentId as string | undefined,
    featureId: args.featureId as string | undefined,
    sessionId: args.sessionId as string | undefined,
    taskId: args.taskId as string | undefined,
  };
  if (!filter.agentId && !filter.featureId && !filter.sessionId && !filter.taskId) {
    return {
      ok: false as const,
      error: "INVALID_INPUT" as const,
      message: "At least one of agentId, featureId, sessionId, or taskId is required.",
    };
  }

  const totals = await querySpendTotals(ctx.hiveRoot, filter);
  const remaining = await getEnforcedRemaining(ctx.hiveRoot, {
    agentId: filter.agentId,
    featureId: filter.featureId,
  });

  return {
    ok: true as const,
    totals: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      usdEstimate: totals.usdEstimate,
    },
    remaining: { tokens: remaining.tokens, usd: remaining.usd },
    events: totals.events,
  };
}

export async function tokenBudgetSetHandler(args: Record<string, unknown>, deps: TokenMcpDeps = {}) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;
  await ensureTokenLayout(ctx.hiveRoot);

  const input = {
    scope: args.scope,
    scopeId: args.scopeId,
    unit: args.unit,
    cap: args.cap,
  };
  const parsed = z
    .object({
      scope: z.enum(["agent", "feature"]),
      scopeId: z.string().min(1),
      unit: z.enum(["tokens", "usd"]),
      cap: z.number().nullable(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "INVALID_INPUT" as const, message: "Budget update is invalid." };
  }

  const budget = await setBudget(ctx.hiveRoot, parsed.data as SetBudgetInput);
  return { ok: true as const, budget };
}

export async function tokenBudgetShowHandler(args: Record<string, unknown>, deps: TokenMcpDeps = {}) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;
  return budgetShow(ctx.hiveRoot, {
    agentId: args.agentId as string | undefined,
    featureId: args.featureId as string | undefined,
  });
}

export async function tokenForecastHandler(args: Record<string, unknown>, deps: TokenMcpDeps = {}) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;

  const parsed = z
    .object({
      featureId: z.string().min(1),
      taskKind: z.enum(["code", "verify", "provision", "signoff", "doc-sync"]),
      engine: z.string().optional(),
      agentId: z.string().optional(),
    })
    .safeParse(args);
  if (!parsed.success) {
    return { ok: false as const, error: "INVALID_INPUT" as const, message: "Forecast request is invalid." };
  }

  const forecast = await forecastCost(ctx.hiveRoot, parsed.data);
  return { ok: true as const, forecast };
}

export async function tokenBreakerStatusHandler(args: Record<string, unknown>, deps: TokenMcpDeps = {}) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;

  const workerKey = args.workerKey as string | undefined;
  const agentId = args.agentId as string | undefined;
  let breakers = await readBreakersFile(ctx.hiveRoot);
  if (workerKey !== undefined) {
    breakers = breakers.filter((row) => row.workerKey === workerKey);
  } else if (agentId !== undefined) {
    breakers = breakers.filter((row) => row.workerKey === agentId || row.workerKey.startsWith(`${agentId}:`));
  }
  return { ok: true as const, breakers };
}

export async function tokenBreakerResetHandler(args: Record<string, unknown>, deps: TokenMcpDeps = {}) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;

  const workerKey = typeof args.workerKey === "string" ? args.workerKey : undefined;
  const agentId = typeof args.agentId === "string" ? args.agentId : undefined;
  const key = workerKey ?? (agentId ? workerKeyFromAgent(agentId) : undefined);
  if (!key) {
    return { ok: false as const, error: "INVALID_INPUT" as const, message: "workerKey or agentId is required." };
  }
  await resetBreaker(ctx.hiveRoot, key);
  return { ok: true as const };
}

export async function tokenGaugeReportHandler(args: Record<string, unknown>, deps: TokenMcpDeps = {}) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;
  await ensureTokenLayout(ctx.hiveRoot);

  let input: ReportGaugeInput;
  if (args.unavailable === true) {
    const workerKey = typeof args.workerKey === "string" ? args.workerKey : "";
    const reason = typeof args.reason === "string" ? args.reason : "";
    if (!workerKey || !reason) {
      return { ok: false as const, error: "INVALID_INPUT" as const, message: "workerKey and reason are required." };
    }
    input = { workerKey, unavailable: true, reason };
  } else {
    const workerKey = typeof args.workerKey === "string" ? args.workerKey : "";
    const usedTokens = typeof args.usedTokens === "number" ? args.usedTokens : NaN;
    const limitTokens = typeof args.limitTokens === "number" ? args.limitTokens : NaN;
    if (!workerKey || !Number.isFinite(usedTokens) || !Number.isFinite(limitTokens)) {
      return {
        ok: false as const,
        error: "INVALID_INPUT" as const,
        message: "workerKey, usedTokens, and limitTokens are required.",
      };
    }
    input = { workerKey, usedTokens, limitTokens };
  }

  const gauge = await reportGauge(ctx.hiveRoot, input);
  return { ok: true as const, gauge };
}

async function readGaugeEntries(hiveRoot: string): Promise<Array<[string, ContextGauge]>> {
  try {
    const raw = await readFile(join(tokenRoot(hiveRoot), "gauges.json"), "utf8");
    const file = GaugesFileSchema.parse(JSON.parse(raw));
    return Object.entries(file.items);
  } catch {
    return [];
  }
}

export async function tokenGaugeQueryHandler(args: Record<string, unknown>, deps: TokenMcpDeps = {}) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;

  const workerKey = args.workerKey as string | undefined;
  const agentId = args.agentId as string | undefined;
  if (workerKey !== undefined) {
    const gauges = await queryGauges(ctx.hiveRoot, { workerKey });
    return { ok: true as const, gauges: gauges.map((gauge) => ({ workerKey, ...gauge })) };
  }

  let entries = await readGaugeEntries(ctx.hiveRoot);
  if (agentId !== undefined) {
    entries = entries.filter(([key]) => key === agentId || key.startsWith(`${agentId}:`));
  }
  return {
    ok: true as const,
    gauges: entries.map(([key, gauge]) => ({ workerKey: key, ...gauge })),
  };
}

export async function tokenCompactionListHandler(args: Record<string, unknown>, deps: TokenMcpDeps = {}) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;

  const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 500) : 50;
  const records = await listCompactionRecords(ctx.hiveRoot, {
    featureId: args.featureId as string | undefined,
    taskId: args.taskId as string | undefined,
    limit,
  });
  return { ok: true as const, records };
}

export async function tokenTierOverrideHandler(args: Record<string, unknown>, deps: TokenMcpDeps = {}) {
  const ctx = await requireHive(args.cwd as string | undefined, deps);
  if (!ctx.ok) return ctx;
  await ensureTokenLayout(ctx.hiveRoot);

  const parsed = z
    .object({
      agentId: z.string().min(1),
      featureId: z.string().nullable().optional(),
      requestedTier: ModelTierSchema,
      reason: z.string().min(1),
      complexity: z.enum(["mechanical", "moderate", "complex"]).optional(),
      attempt: z.number().int().min(1).optional(),
      role: z.enum(["implementer", "reviewer"]).optional(),
      kind: z.enum(["code", "verify", "provision", "signoff", "doc-sync"]).optional(),
    })
    .safeParse(args);
  if (!parsed.success) {
    return { ok: false as const, error: "INVALID_INPUT" as const, message: "Tier override is invalid." };
  }

  const override = await recordTierOverride(ctx.hiveRoot, {
    agentId: parsed.data.agentId,
    featureId: parsed.data.featureId ?? null,
    requestedTier: parsed.data.requestedTier,
    reason: parsed.data.reason,
    complexity: (parsed.data.complexity ?? "moderate") as Complexity,
    attempt: parsed.data.attempt ?? 1,
    role: parsed.data.role ?? "implementer",
    kind: (parsed.data.kind ?? "code") as TaskKind,
  });
  return { ok: true as const, override, tier: override.requestedTier, routeModelTier: override.routeModelTier };
}

export function buildTokenMcpTools(): McpToolDef[] {
  return [
    {
      name: "token-spend-record",
      description: "Append one spend event to the hive token ledger.",
      schema: {
        cwd: z.string().optional(),
        agentId: z.string().min(1),
        sessionId: z.string().min(1),
        featureId: z.string().nullable().optional(),
        taskId: z.string().nullable().optional(),
        engine: z.string().nullable().optional(),
        model: z.string().nullable().optional(),
        inputTokens: z.number().min(0),
        outputTokens: z.number().min(0),
        usdEstimate: z.number().nullable().optional(),
        source: SpendSourceSchema,
        partial: z.boolean().optional(),
      },
      handler: async (args) => tokenJson(await tokenSpendRecordHandler(args)),
    },
    {
      name: "token-spend-query",
      description: "Query spend totals and remaining budget for a scope.",
      schema: {
        cwd: z.string().optional(),
        agentId: z.string().optional(),
        featureId: z.string().optional(),
        sessionId: z.string().optional(),
        taskId: z.string().optional(),
      },
      handler: async (args) => tokenJson(await tokenSpendQueryHandler(args)),
    },
    {
      name: "token-budget-set",
      description: "Set an agent or feature budget cap in tokens or USD.",
      schema: {
        cwd: z.string().optional(),
        scope: z.enum(["agent", "feature"]),
        scopeId: z.string().min(1),
        unit: z.enum(["tokens", "usd"]),
        cap: z.number().nullable(),
      },
      handler: async (args) => tokenJson(await tokenBudgetSetHandler(args)),
    },
    {
      name: "token-budget-show",
      description: "Show budget caps, spent amounts, and enforced remaining.",
      schema: {
        cwd: z.string().optional(),
        agentId: z.string().optional(),
        featureId: z.string().optional(),
      },
      handler: async (args) => tokenJson(await tokenBudgetShowHandler(args)),
    },
    {
      name: "token-forecast",
      description: "Forecast task cost from hive spend history.",
      schema: {
        cwd: z.string().optional(),
        featureId: z.string().min(1),
        taskKind: z.enum(["code", "verify", "provision", "signoff", "doc-sync"]),
        engine: z.string().optional(),
        agentId: z.string().optional(),
      },
      handler: async (args) => tokenJson(await tokenForecastHandler(args)),
    },
    {
      name: "token-breaker-status",
      description: "List circuit breaker states for workers.",
      schema: {
        cwd: z.string().optional(),
        workerKey: z.string().optional(),
        agentId: z.string().optional(),
      },
      handler: async (args) => tokenJson(await tokenBreakerStatusHandler(args)),
    },
    {
      name: "token-breaker-reset",
      description: "Operator reset of a terminal circuit breaker stop.",
      schema: {
        cwd: z.string().optional(),
        workerKey: z.string().optional(),
        agentId: z.string().optional(),
      },
      handler: async (args) => tokenJson(await tokenBreakerResetHandler(args)),
    },
    {
      name: "token-gauge-report",
      description: "Report measured or unavailable context-window gauge for a worker.",
      schema: {
        cwd: z.string().optional(),
        workerKey: z.string(),
        usedTokens: z.number().min(0).optional(),
        limitTokens: z.number().positive().optional(),
        unavailable: z.boolean().optional(),
        reason: z.string().optional(),
      },
      handler: async (args) => tokenJson(await tokenGaugeReportHandler(args)),
    },
    {
      name: "token-gauge-query",
      description: "Query context-window gauges for workers.",
      schema: {
        cwd: z.string().optional(),
        agentId: z.string().optional(),
        workerKey: z.string().optional(),
      },
      handler: async (args) => tokenJson(await tokenGaugeQueryHandler(args)),
    },
    {
      name: "token-compaction-list",
      description: "List recent compaction records from the hive token store.",
      schema: {
        cwd: z.string().optional(),
        featureId: z.string().optional(),
        taskId: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      handler: async (args) => tokenJson(await tokenCompactionListHandler(args)),
    },
    {
      name: "token-tier-override",
      description: "Persist an operator tier override with route-model audit.",
      schema: {
        cwd: z.string().optional(),
        agentId: z.string().min(1),
        featureId: z.string().nullable().optional(),
        requestedTier: ModelTierSchema,
        reason: z.string().min(1),
        complexity: z.enum(["mechanical", "moderate", "complex"]).optional(),
        attempt: z.number().int().min(1).optional(),
        role: z.enum(["implementer", "reviewer"]).optional(),
        kind: z.enum(["code", "verify", "provision", "signoff", "doc-sync"]).optional(),
      },
      handler: async (args) => tokenJson(await tokenTierOverrideHandler(args)),
    },
  ];
}
