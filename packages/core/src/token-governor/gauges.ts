import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "../command-plane/store.js";
import { ContextGaugeSchema, GaugesFileSchema } from "./schema.js";
import type { ContextGauge, GaugesFile } from "./types.js";
import { tokenRoot } from "./paths.js";

export type ReportGaugeInput =
  | { workerKey: string; unavailable: true; reason: string }
  | { workerKey: string; usedTokens: number; limitTokens: number };

export type QueryGaugesFilter = {
  workerKey?: string;
};

const cacheByHive = new Map<string, GaugesFile>();

function gaugesPath(hiveRoot: string): string {
  return join(tokenRoot(hiveRoot), "gauges.json");
}

function clampRatio(usedTokens: number, limitTokens: number): number {
  if (limitTokens <= 0) return 1;
  const raw = usedTokens / limitTokens;
  return Math.min(1, Math.max(0, raw));
}

function gaugeFromInput(input: ReportGaugeInput): ContextGauge {
  const updatedAt = new Date().toISOString();
  if ("unavailable" in input && input.unavailable) {
    return ContextGaugeSchema.parse({
      state: "unavailable",
      reason: input.reason,
      updatedAt,
    });
  }
  const { usedTokens, limitTokens } = input as Extract<ReportGaugeInput, { usedTokens: number }>;
  const ratio = clampRatio(usedTokens, limitTokens);
  return ContextGaugeSchema.parse({
    state: "measured",
    usedTokens,
    limitTokens,
    ratio,
    updatedAt,
  });
}

async function readGaugesFile(hiveRoot: string): Promise<GaugesFile> {
  const cached = cacheByHive.get(hiveRoot);
  if (cached) return cached;

  const path = gaugesPath(hiveRoot);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = GaugesFileSchema.parse(JSON.parse(raw));
    cacheByHive.set(hiveRoot, parsed);
    return parsed;
  } catch {
    const empty: GaugesFile = { schemaVersion: 1, items: {} };
    cacheByHive.set(hiveRoot, empty);
    return empty;
  }
}

async function persistGauges(hiveRoot: string, file: GaugesFile): Promise<void> {
  cacheByHive.set(hiveRoot, file);
  await writeJsonAtomic(gaugesPath(hiveRoot), file);
}

/** Record a context-window gauge snapshot for a worker (measured or unavailable). */
export async function reportGauge(hiveRoot: string, input: ReportGaugeInput): Promise<ContextGauge> {
  const file = await readGaugesFile(hiveRoot);
  const gauge = gaugeFromInput(input);
  const next: GaugesFile = {
    schemaVersion: 1,
    items: { ...file.items, [input.workerKey]: gauge },
  };
  await persistGauges(hiveRoot, next);
  return gauge;
}

/** Query gauge snapshots; optional filter by workerKey. */
export async function queryGauges(
  hiveRoot: string,
  filter: QueryGaugesFilter = {},
): Promise<ContextGauge[]> {
  const file = await readGaugesFile(hiveRoot);
  const entries = Object.entries(file.items);
  const filtered =
    filter.workerKey === undefined
      ? entries
      : entries.filter(([key]) => key === filter.workerKey);
  return filtered.map(([, gauge]) => gauge);
}

/** Drop in-memory gauge cache for a hive (tests / cross-process consistency). */
export function flushGaugeCache(hiveRoot?: string): void {
  if (hiveRoot === undefined) {
    cacheByHive.clear();
    return;
  }
  cacheByHive.delete(hiveRoot);
}
