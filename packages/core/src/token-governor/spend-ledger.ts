import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { IraEventSchema, featureIdSchema } from "../command-plane/schema.js";
import {
  EVENT_LOCK_WAIT_MS,
  LEDGER_LOCK_WAIT_MS,
  appendJsonlLine,
  withLock,
} from "../command-plane/store.js";
import { tokenRoot } from "./paths.js";
import { SpendEventInputSchema, SpendEventSchema } from "./schema.js";
import { guardSideEffectWrite } from "./slice-a.js";
import type { SpendEvent, SpendEventInput } from "./types.js";

export type AppendSpendEventResult =
  | { id: string }
  | { ok: false; code: "SLICE_A_ONLY" }
  | { ok: false; code: "DUPLICATE_SPEND_ID" }
  | { ok: false; code: "LEDGER_BUSY" };

export type AppendSpendEventOptions = {
  /** Idempotency key; duplicate values are rejected under lock. */
  id?: string;
};

function spendJsonlPath(hiveRoot: string): string {
  return join(tokenRoot(hiveRoot), "spend.jsonl");
}

function spendLockPath(hiveRoot: string): string {
  return join(tokenRoot(hiveRoot), "locks", "spend.lock");
}

async function readExistingSpendIds(filePath: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return ids;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as { id?: unknown };
      if (typeof row.id === "string" && row.id.length > 0) ids.add(row.id);
    } catch {
      // Skip malformed lines; doctor warns on corruption elsewhere.
    }
  }
  return ids;
}

async function emitSpendRecorded(hiveRoot: string, spend: SpendEvent): Promise<void> {
  try {
    await access(join(hiveRoot, "events"), constants.W_OK);
  } catch {
    return;
  }
  const featureId =
    spend.featureId !== null && featureIdSchema.safeParse(spend.featureId).success
      ? spend.featureId
      : null;
  const event = IraEventSchema.safeParse({
    id: `evt_${randomUUID()}`,
    type: "token.spend_recorded",
    version: 1,
    ts: new Date().toISOString(),
    featureId,
    actor: { kind: "ira", id: "ira" },
    data: {
      spendId: spend.id,
      agentId: spend.agentId,
      featureId: spend.featureId,
      taskId: spend.taskId,
      usdEstimate: spend.usdEstimate,
    },
  });
  if (!event.success) return;
  await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
    appendJsonlLine(join(hiveRoot, "events", "events.jsonl"), event.data),
  );
}

/**
 * Append one validated {@link SpendEvent} line to `token/spend.jsonl`.
 * No-op with `SLICE_A_ONLY` while Slice A side effects are disabled (OD-020).
 */
export async function appendSpendEvent(
  hiveRoot: string,
  input: SpendEventInput,
  options?: AppendSpendEventOptions,
): Promise<AppendSpendEventResult> {
  const guarded = await guardSideEffectWrite(hiveRoot, async () => {
    const fields = SpendEventInputSchema.parse({ engine: null, model: null, ...input });
    const id = options?.id ?? `spend_${randomUUID()}`;
    const spend = SpendEventSchema.parse({
      ...fields,
      id,
      ts: new Date().toISOString(),
    });

    const spendPath = spendJsonlPath(hiveRoot);
    const locked = await withLock(spendLockPath(hiveRoot), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
      const existing = await readExistingSpendIds(spendPath);
      if (existing.has(id)) return { ok: false as const, code: "DUPLICATE_SPEND_ID" as const };
      await appendJsonlLine(spendPath, spend);
      return { ok: true as const, spend };
    });

    if (!locked.ok) return { ok: false as const, code: "LEDGER_BUSY" as const };
    if (!locked.value.ok) return locked.value;
    await emitSpendRecorded(hiveRoot, locked.value.spend);
    return { id: locked.value.spend.id };
  });

  if (typeof guarded === "object" && guarded !== null && "ok" in guarded && guarded.ok === false) {
    return guarded;
  }
  return guarded;
}
