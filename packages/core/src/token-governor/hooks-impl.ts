import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  registerCommandPlaneHooks,
  type DispatchContext,
  type DispatchGate,
  type DistillContext,
  type SpendEventInput,
  type TokenHooks,
} from "../command-plane/hooks.js";
import { HiveLedgerSchema } from "../command-plane/schema.js";
import type { TaskKind } from "../types.js";
import { getEnforcedRemaining, wouldExceedRemaining } from "./budgets.js";
import { evaluateBreaker } from "./breaker.js";
import { runCompaction } from "./compaction.js";
import { forecastCost } from "./forecast.js";
import { appendSpendEvent } from "./spend-ledger.js";
import {
  guardSideEffectWrite,
  isSliceAActive,
  sliceABeforeDispatchGate,
  type SliceAGuardOptions,
} from "./slice-a.js";

const TASK_KINDS: readonly TaskKind[] = ["code", "verify", "provision", "signoff", "doc-sync"];

type GateView = {
  featureId: string;
  taskId: string;
  agentId: string;
  hiveRoot?: string;
  estimatedUsd?: number;
  estimatedTokens?: number;
  engineRung: "host" | "byok" | "local";
  sliceAActive?: boolean;
  taskKind?: TaskKind;
  engine?: string;
};

let boundHiveRoot: string | null = null;

/**
 * Install token hooks for a hive directory.
 * `beforeDispatch` is only invoked by `dispatch-task` (FR-024), not by begin-task.
 * A missing directory is a no-op and leaves any previous binding in place.
 */
export function registerTokenGovernor(hiveRoot: string): void {
  if (!hiveDirectory(hiveRoot)) return;
  boundHiveRoot = hiveRoot;
  registerCommandPlaneHooks({ token: tokenHooksImpl });
}

/** Test and bootstrap helper: true after `registerTokenGovernor` bound a hive directory. */
export function isTokenGovernorRegistered(): boolean {
  return boundHiveRoot !== null;
}

export const tokenHooksImpl: TokenHooks = {
  async beforeDispatch(ctx) {
    return (await decide(ctx)) as DispatchGate;
  },

  async recordSpend(event) {
    const hive = boundHiveRoot;
    if (!hive) return;
    const extra = event as SpendEventInput & {
      sliceAActive?: unknown;
      sessionId?: unknown;
      taskId?: unknown;
      partial?: unknown;
    };
    await guardSideEffectWrite(
      hive,
      async () => {
        const sessionId = nonEmpty(extra.sessionId) ?? "session";
        const taskId = typeof extra.taskId === "string" ? extra.taskId : null;
        const appended = await appendSpendEvent(hive, {
          agentId: event.agentId,
          sessionId,
          featureId: event.featureId,
          taskId,
          engine: event.engine,
          model: event.model,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          usdEstimate: event.usdEstimate,
          source: event.source,
          partial: typeof extra.partial === "boolean" ? extra.partial : event.source === "estimate",
        });
        if (!("id" in appended)) return;
        await refreshBudgetBreaker(hive, event, sessionId, taskId);
      },
      sliceOptions(flag(extra.sliceAActive)),
    );
  },

  async onRecordResult(ctx) {
    const hive = boundHiveRoot;
    if (!hive) return;
    const extra = ctx as DistillContext & {
      agentId?: unknown;
      sessionId?: unknown;
      sliceAActive?: unknown;
      residualTokens?: unknown;
    };
    const sliceAActive = flag(extra.sliceAActive);
    await guardSideEffectWrite(
      hive,
      () =>
        runCompaction(hive, {
          featureId: ctx.featureId,
          taskId: ctx.taskId,
          passed: ctx.passed,
          agentId: nonEmpty(extra.agentId) ?? "worker",
          sessionId: nonEmpty(extra.sessionId) ?? "session",
          residualTokens: finiteNumber(extra.residualTokens),
          sliceAActive,
        }),
      sliceOptions(sliceAActive),
    );
  },
};

async function decide(ctx: DispatchContext): Promise<DispatchGate | ReturnType<typeof sliceABeforeDispatchGate>> {
  const view = readView(ctx);
  if (await sliceActive(view)) {
    return sliceABeforeDispatchGate({ engineRung: view.engineRung, sliceAActive: true });
  }

  const hive = view.hiveRoot ?? boundHiveRoot;
  if (!hive) return { allow: true };

  const remaining = await getEnforcedRemaining(hive, {
    agentId: scopeId(view.agentId),
    featureId: scopeId(view.featureId),
  });

  const taskKind = view.taskKind ?? (await lookupTaskKind(hive, view.featureId, view.taskId));
  if (taskKind && view.featureId) {
    const forecast = await forecastCost(hive, {
      featureId: view.featureId,
      taskKind,
      engine: view.engine,
      agentId: scopeId(view.agentId),
    });
    if (
      forecast.status === "ok" &&
      wouldExceedRemaining(remaining, { tokens: forecast.expectedTokens, usd: forecast.expectedUsd })
    ) {
      return budgetDeny(`forecast exceeds remaining budget (${forecast.basis})`);
    }
  }

  if (wouldExceedRemaining(remaining, { tokens: view.estimatedTokens, usd: view.estimatedUsd })) {
    return budgetDeny("dispatch exceeds remaining budget");
  }
  return { allow: true };
}

async function refreshBudgetBreaker(
  hive: string,
  event: SpendEventInput,
  sessionId: string,
  taskId: string | null,
): Promise<void> {
  const remaining = await getEnforcedRemaining(hive, {
    agentId: event.agentId,
    featureId: event.featureId ?? undefined,
  });
  if (remaining.tokens !== 0 && remaining.usd !== 0) return;
  await evaluateBreaker(hive, `${event.agentId}:${sessionId}`, {
    trigger: "budget",
    featureId: event.featureId,
    taskId,
    sliceAActive: false,
  });
}

async function sliceActive(view: GateView): Promise<boolean> {
  if (view.sliceAActive !== undefined) return view.sliceAActive;
  const hive = view.hiveRoot ?? boundHiveRoot;
  if (!hive) return false;
  return isSliceAActive(hive);
}

async function lookupTaskKind(hiveRoot: string, featureId: string, taskId: string): Promise<TaskKind | undefined> {
  if (!featureId || !taskId) return undefined;
  try {
    const raw = await readFile(join(hiveRoot, "ledger", `${featureId}.json`), "utf8");
    const ledger = HiveLedgerSchema.safeParse(JSON.parse(raw));
    if (!ledger.success) return undefined;
    return ledger.data.tasks.find((task) => task.id === taskId)?.kind;
  } catch {
    return undefined;
  }
}

function readView(ctx: DispatchContext): GateView {
  const root = ctx as DispatchContext & Record<string, unknown>;
  const intent = isRecord(root.intent) ? root.intent : undefined;
  return {
    featureId: text(intent?.featureId, root.featureId),
    taskId: text(intent?.taskId, root.taskId),
    agentId: text(intent?.agentId, root.agentId),
    hiveRoot: nonEmpty(intent?.hiveRoot) ?? nonEmpty(root.hiveRoot),
    estimatedUsd: finiteNumber(root.estimatedUsd ?? intent?.estimatedUsd),
    estimatedTokens: finiteNumber(root.estimatedTokens ?? intent?.estimatedTokens),
    engineRung: engineRung(root.engineRung ?? intent?.engineRung),
    sliceAActive: flag(root.sliceAActive ?? intent?.sliceAActive),
    taskKind: taskKind(root.taskKind ?? intent?.taskKind),
    engine: nonEmpty(root.engine) ?? nonEmpty(intent?.engine),
  };
}

function budgetDeny(detail: string): DispatchGate {
  return { allow: false, reasonClass: "budget_exceed", detail };
}

function sliceOptions(sliceAActive: boolean | undefined): SliceAGuardOptions | undefined {
  return sliceAActive === undefined ? undefined : { sliceAActive };
}

function hiveDirectory(hiveRoot: string): boolean {
  if (!hiveRoot) return false;
  try {
    return statSync(hiveRoot).isDirectory();
  } catch {
    return false;
  }
}

function engineRung(value: unknown): GateView["engineRung"] {
  if (value === "host" || value === "byok" || value === "local") return value;
  return "host";
}

function taskKind(value: unknown): TaskKind | undefined {
  return TASK_KINDS.find((kind) => kind === value);
}

function flag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function scopeId(value: string): string | undefined {
  return value.length > 0 ? value : undefined;
}

function text(...values: unknown[]): string {
  for (const value of values) {
    const found = nonEmpty(value);
    if (found) return found;
  }
  return "";
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
