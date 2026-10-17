import { createReadStream } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { HiveLedgerSchema, featureIdSchema } from "../command-plane/schema.js";
import type { TaskKind } from "../types.js";
import { querySpendTotals } from "./rollup.js";
import { tokenRoot } from "./paths.js";
import { SpendEventSchema } from "./schema.js";
import type { CostForecast } from "./types.js";

export type ForecastInput = {
  featureId: string;
  taskKind: TaskKind;
  engine?: string;
  agentId?: string;
};

type TaskSpendMeta = {
  engines: Set<string>;
};

function taskKey(featureId: string, taskId: string): string {
  return `${featureId}\0${taskId}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function insufficientHistory(basis: string): CostForecast {
  return {
    expectedTokens: null,
    expectedUsd: null,
    basis,
    status: "insufficient-history",
  };
}

async function readTaskSpendMeta(hiveRoot: string): Promise<Map<string, TaskSpendMeta>> {
  const path = join(tokenRoot(hiveRoot), "spend.jsonl");
  const index = new Map<string, TaskSpendMeta>();
  try {
    await access(path, constants.R_OK);
  } catch {
    return index;
  }

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
    const { featureId, taskId, engine } = row.data;
    if (featureId === null || taskId === null) continue;
    const key = taskKey(featureId, taskId);
    let meta = index.get(key);
    if (!meta) {
      meta = { engines: new Set<string>() };
      index.set(key, meta);
    }
    if (engine !== null && engine.length > 0) {
      meta.engines.add(engine);
    }
  }

  return index;
}

async function readAllDoneTasks(hiveRoot: string): Promise<Array<{ featureId: string; taskId: string; kind: TaskKind }>> {
  let files: string[];
  try {
    files = (await readdir(join(hiveRoot, "ledger"))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  const done: Array<{ featureId: string; taskId: string; kind: TaskKind }> = [];
  for (const file of files) {
    const featureId = file.replace(/\.json$/, "");
    if (!featureIdSchema.safeParse(featureId).success) continue;
    let raw: string;
    try {
      raw = await readFile(join(hiveRoot, "ledger", file), "utf8");
    } catch {
      continue;
    }
    const ledger = HiveLedgerSchema.safeParse(JSON.parse(raw));
    if (!ledger.success) continue;
    for (const task of ledger.data.tasks) {
      if (task.status !== "done") continue;
      done.push({ featureId: task.featureId, taskId: task.id, kind: task.kind });
    }
  }
  return done;
}

function isSimilarPeer(
  task: { featureId: string; kind: TaskKind },
  input: ForecastInput,
  spendMeta: TaskSpendMeta | undefined,
): boolean {
  if (task.kind !== input.taskKind) return false;
  if (task.featureId === input.featureId) return true;
  if (input.engine !== undefined && spendMeta?.engines.has(input.engine)) return true;
  return false;
}

/** Pre-dispatch cost estimate from similar completed tasks with recorded spend. */
export async function forecastCost(hiveRoot: string, input: ForecastInput): Promise<CostForecast> {
  const spendMetaByTask = await readTaskSpendMeta(hiveRoot);
  const doneTasks = await readAllDoneTasks(hiveRoot);

  const peerTotals: Array<{ tokens: number; usd: number | null }> = [];
  let matchedFeature = false;
  let matchedEngine = false;

  for (const task of doneTasks) {
    const meta = spendMetaByTask.get(taskKey(task.featureId, task.taskId));
    if (!isSimilarPeer(task, input, meta)) continue;

    if (task.featureId === input.featureId) matchedFeature = true;
    if (input.engine !== undefined && meta?.engines.has(input.engine)) matchedEngine = true;

    const totals = await querySpendTotals(hiveRoot, {
      featureId: task.featureId,
      taskId: task.taskId,
      agentId: input.agentId,
    });
    if (totals.events < 1) continue;

    peerTotals.push({
      tokens: totals.inputTokens + totals.outputTokens,
      usd: totals.usdEstimate,
    });
  }

  if (peerTotals.length < 2) {
    return insufficientHistory("fewer_than_2_peers_with_spend");
  }

  const tokenValues = peerTotals.map((p) => p.tokens);
  const usdValues = peerTotals.map((p) => p.usd).filter((v): v is number => v !== null);
  const usdMissing = peerTotals.length - usdValues.length;
  const expectedUsd =
    usdMissing >= Math.ceil(peerTotals.length / 2) ? null : usdValues.length > 0 ? median(usdValues) : null;

  const basisParts = [`median_of_${peerTotals.length}_tasks_same_kind`];
  if (matchedFeature) basisParts.push("feature");
  if (matchedEngine) basisParts.push("engine");

  return {
    expectedTokens: median(tokenValues),
    expectedUsd,
    basis: basisParts.join("_"),
    status: "ok",
  };
}
