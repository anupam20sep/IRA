import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { agentIdSchema, featureIdSchema } from "../command-plane/schema.js";
import { writeJsonAtomic } from "../command-plane/store.js";
import { tokenRoot } from "./paths.js";
import { querySpendTotals, type SpendTotals } from "./rollup.js";
import { BudgetRowSchema, BudgetsFileSchema } from "./schema.js";
import type { BudgetRow, BudgetScope, BudgetUnit, BudgetsFile } from "./types.js";

const mirrorFieldsSchema = z.object({
  budgetTokens: z.number().nonnegative().nullable().optional(),
  budgetUsd: z.number().nonnegative().nullable().optional(),
});

const rosterMirrorSchema = z.object({
  id: z.string().min(1),
  budgetTokens: z.number().nonnegative().nullable().optional(),
  budgetUsd: z.number().nonnegative().nullable().optional(),
});

export type SetBudgetInput = {
  scope: BudgetScope;
  scopeId: string;
  unit: BudgetUnit;
  cap: number | null;
};

export type EnforcedRemaining = {
  tokens: number | null;
  usd: number | null;
};

export type RemainingQuery = {
  agentId?: string;
  featureId?: string;
};

export type SpendRequest = {
  tokens?: number | null;
  usd?: number | null;
};

/** Brief or roster budget fields. Omitted keys are left unchanged by sync. */
export type BudgetMirror = {
  budgetTokens?: number | null;
  budgetUsd?: number | null;
};

function budgetsPath(hiveRoot: string): string {
  return join(tokenRoot(hiveRoot), "budgets.json");
}

function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

async function readBudgets(hiveRoot: string): Promise<BudgetsFile> {
  let raw: string;
  try {
    raw = await readFile(budgetsPath(hiveRoot), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, items: [] };
    }
    throw err;
  }
  return BudgetsFileSchema.parse(JSON.parse(raw));
}

function sameRow(item: BudgetRow, scope: BudgetScope, scopeId: string, unit: BudgetUnit): boolean {
  return item.scope === scope && item.scopeId === scopeId && item.unit === unit;
}

/** Upsert one cap. `cap` null means that unit is unlimited. */
export async function setBudget(hiveRoot: string, input: SetBudgetInput): Promise<BudgetRow> {
  const next = BudgetRowSchema.parse({
    scope: input.scope,
    scopeId: input.scopeId,
    unit: input.unit,
    cap: input.cap,
    updatedAt: new Date().toISOString(),
  });
  const file = await readBudgets(hiveRoot);
  const items = file.items.filter((item) => !sameRow(item, next.scope, next.scopeId, next.unit));
  items.push(next);
  await writeJsonAtomic(budgetsPath(hiveRoot), { schemaVersion: 1, items });
  return next;
}

async function upsertMirror(
  hiveRoot: string,
  scope: BudgetScope,
  scopeId: string,
  mirror: BudgetMirror,
): Promise<BudgetRow[]> {
  const rows: BudgetRow[] = [];
  if (mirror.budgetTokens !== undefined) {
    rows.push(await setBudget(hiveRoot, { scope, scopeId, unit: "tokens", cap: mirror.budgetTokens }));
  }
  if (mirror.budgetUsd !== undefined) {
    rows.push(await setBudget(hiveRoot, { scope, scopeId, unit: "usd", cap: mirror.budgetUsd }));
  }
  return rows;
}

/** Copy a feature brief's budget fields into `budgets.json` (authoritative store). */
export function syncBriefBudgetMirror(
  hiveRoot: string,
  featureId: string,
  mirror: BudgetMirror,
): Promise<BudgetRow[]> {
  return upsertMirror(hiveRoot, "feature", featureId, mirror);
}

/** Copy a roster agent's budget fields into `budgets.json` (authoritative store). */
export function syncRosterBudgetMirror(
  hiveRoot: string,
  agentId: string,
  mirror: BudgetMirror,
): Promise<BudgetRow[]> {
  return upsertMirror(hiveRoot, "agent", agentId, mirror);
}

async function readBriefMirror(hiveRoot: string, featureId: string): Promise<BudgetMirror | null> {
  if (!featureIdSchema.safeParse(featureId).success) return null;
  try {
    const raw = await readFile(join(hiveRoot, "briefs", `${featureId}.json`), "utf8");
    const parsed = mirrorFieldsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readRosterMirror(hiveRoot: string, agentId: string): Promise<BudgetMirror | null> {
  if (!agentIdSchema.safeParse(agentId).success) return null;
  try {
    const raw = await readFile(join(hiveRoot, "roster.json"), "utf8");
    const parsed = z.array(z.unknown()).safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    for (const item of parsed.data) {
      const agent = rosterMirrorSchema.safeParse(item);
      if (agent.success && agent.data.id === agentId) return agent.data;
    }
    return null;
  } catch {
    return null;
  }
}

function capFor(
  file: BudgetsFile,
  scope: BudgetScope,
  scopeId: string,
  unit: BudgetUnit,
  mirror: BudgetMirror | null,
): number | null | undefined {
  const row = file.items.find((item) => sameRow(item, scope, scopeId, unit));
  if (row) return row.cap;
  if (!mirror) return undefined;
  return unit === "tokens" ? mirror.budgetTokens : mirror.budgetUsd;
}

function scopeRemaining(
  file: BudgetsFile,
  scope: BudgetScope,
  scopeId: string | undefined,
  unit: BudgetUnit,
  mirror: BudgetMirror | null,
  totals: SpendTotals | null,
): number | null {
  if (!scopeId) return null;
  return remainingFor(capFor(file, scope, scopeId, unit, mirror), spentOf(totals, unit), unit);
}

function spentOf(totals: SpendTotals | null, unit: BudgetUnit): number {
  if (!totals) return 0;
  if (unit === "tokens") return totals.inputTokens + totals.outputTokens;
  return totals.usdEstimate ?? 0;
}

/** Remaining is null when uncapped. A cap at or below spend is explicit zero. */
function remainingFor(cap: number | null | undefined, spent: number, unit: BudgetUnit): number | null {
  if (cap == null) return null;
  const raw = cap - spent;
  if (raw <= 0) return 0;
  return unit === "usd" ? roundUsd(raw) : raw;
}

function tighter(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

/**
 * Minimum remaining per unit across the agent and feature scopes that are set.
 * A null unit means that unit is unlimited.
 */
export async function getEnforcedRemaining(
  hiveRoot: string,
  query: RemainingQuery,
): Promise<EnforcedRemaining> {
  const [file, agentTotals, featureTotals, agentMirror, featureMirror] = await Promise.all([
    readBudgets(hiveRoot),
    query.agentId ? querySpendTotals(hiveRoot, { agentId: query.agentId }) : Promise.resolve(null),
    query.featureId ? querySpendTotals(hiveRoot, { featureId: query.featureId }) : Promise.resolve(null),
    query.agentId ? readRosterMirror(hiveRoot, query.agentId) : Promise.resolve(null),
    query.featureId ? readBriefMirror(hiveRoot, query.featureId) : Promise.resolve(null),
  ]);

  return {
    tokens: tighter(
      scopeRemaining(file, "agent", query.agentId, "tokens", agentMirror, agentTotals),
      scopeRemaining(file, "feature", query.featureId, "tokens", featureMirror, featureTotals),
    ),
    usd: tighter(
      scopeRemaining(file, "agent", query.agentId, "usd", agentMirror, agentTotals),
      scopeRemaining(file, "feature", query.featureId, "usd", featureMirror, featureTotals),
    ),
  };
}

function unitWouldExceed(remaining: number | null, requested: number | null | undefined): boolean {
  if (remaining === null) return false;
  if (remaining <= 0) return true;
  if (requested == null) return false;
  return requested > remaining;
}

/**
 * True when requested spend is above remaining, or remaining is already zero.
 * Null remaining is unlimited and does not block.
 */
export function wouldExceedRemaining(remaining: EnforcedRemaining, requested: SpendRequest = {}): boolean {
  return unitWouldExceed(remaining.tokens, requested.tokens) || unitWouldExceed(remaining.usd, requested.usd);
}
