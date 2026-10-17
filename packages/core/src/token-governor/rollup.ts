import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { tokenRoot } from "./paths.js";
import { SpendEventSchema } from "./schema.js";
import type { SpendEvent } from "./types.js";

export type SpendTotalsFilter = {
  agentId?: string;
  featureId?: string;
  sessionId?: string;
  taskId?: string;
};

export type SpendTotals = {
  inputTokens: number;
  outputTokens: number;
  usdEstimate: number | null;
  events: number;
};

function spendJsonlPath(hiveRoot: string): string {
  return join(tokenRoot(hiveRoot), "spend.jsonl");
}

function matchesFilter(event: SpendEvent, filter: SpendTotalsFilter): boolean {
  if (filter.agentId !== undefined && event.agentId !== filter.agentId) return false;
  if (filter.featureId !== undefined && event.featureId !== filter.featureId) return false;
  if (filter.sessionId !== undefined && event.sessionId !== filter.sessionId) return false;
  if (filter.taskId !== undefined && event.taskId !== filter.taskId) return false;
  return true;
}

/** Aggregate spend ledger lines matching optional scope filters. */
export async function querySpendTotals(
  hiveRoot: string,
  filter: SpendTotalsFilter = {},
): Promise<SpendTotals> {
  const path = spendJsonlPath(hiveRoot);
  try {
    await access(path, constants.R_OK);
  } catch {
    return { inputTokens: 0, outputTokens: 0, usdEstimate: null, events: 0 };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let usdSum = 0;
  let hasUsd = false;
  let events = 0;

  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const row = SpendEventSchema.safeParse(parsed);
    if (!row.success) continue;
    if (!matchesFilter(row.data, filter)) continue;

    events += 1;
    inputTokens += row.data.inputTokens;
    outputTokens += row.data.outputTokens;
    if (row.data.usdEstimate !== null) {
      hasUsd = true;
      usdSum += row.data.usdEstimate;
    }
  }

  return {
    inputTokens,
    outputTokens,
    usdEstimate: hasUsd ? usdSum : null,
    events,
  };
}
