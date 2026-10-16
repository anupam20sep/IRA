import { canAbort, canDispatch, canPause, canReassign, type SteerGuardResult } from "../client/steer-guards.js";
import type { RosterAgentStatus, SnapshotTask } from "../shared/snapshot-types.js";
import { verifyBearerToken, type BearerAuthRequest } from "./auth.js";
import { runSuperspec, type RunSuperspecResult } from "./cli.js";

/** Steer and brief-submit share the longer Plane timeout from design.md. */
export const STEER_TIMEOUT_MS = 30_000;

const STEER_IN_FLIGHT_MESSAGE = "A steer action is already running.";

const inFlightFeatures = new Set<string>();

export type SteerArgvTarget = {
  featureId: string;
  taskId: string;
  cwd?: string;
};

export type SteerHandlerResult = {
  status: number;
  body: Record<string, unknown>;
};

export type SteerBaseInput = {
  request: BearerAuthRequest;
  hiveRoot: string;
  cwd: string;
  featureId: string;
  taskId: string;
  task: SnapshotTask;
  tasksById: ReadonlyMap<string, SnapshotTask>;
};

export type SteerDispatchInput = SteerBaseInput & {
  hiveReady: boolean;
  assigneeStatus: RosterAgentStatus | null;
};

export type SteerAbortInput = SteerBaseInput & {
  confirm: boolean;
  /** Plane `task-abort` rejects an empty reason. Omitted keeps the argv without `--reason`. */
  reason?: string;
};

export type SteerReassignInput = SteerBaseInput & {
  agentId: string | null;
  targetStatus: RosterAgentStatus | null;
};

export function steerArgvDispatch(input: SteerArgvTarget): string[] {
  return withCwd(["dispatch-task", "--feature", input.featureId, "--task", input.taskId], input.cwd);
}

export function steerArgvPause(input: SteerArgvTarget): string[] {
  return withCwd(
    ["task-hold", "--feature", input.featureId, "--task", input.taskId, "--hold", "true"],
    input.cwd,
  );
}

export function steerArgvAbort(input: SteerArgvTarget & { reason?: string }): string[] {
  const argv = ["task-abort", "--feature", input.featureId, "--task", input.taskId, "--confirm", "true"];
  const reason = input.reason?.trim() ?? "";
  if (reason.length > 0) argv.push("--reason", reason);
  return withCwd(argv, input.cwd);
}

export function steerArgvReassign(input: SteerArgvTarget & { agentId: string }): string[] {
  return withCwd(
    ["task-reassign", "--feature", input.featureId, "--task", input.taskId, "--agent", input.agentId],
    input.cwd,
  );
}

export function steerDispatch(input: SteerDispatchInput): Promise<SteerHandlerResult> {
  return execute(
    input,
    () =>
      canDispatch({
        task: input.task,
        tasksById: input.tasksById,
        hiveReady: input.hiveReady,
        assigneeStatus: input.assigneeStatus,
      }),
    () => steerArgvDispatch({ featureId: input.featureId, taskId: input.taskId, cwd: input.cwd }),
  );
}

export function steerPause(input: SteerBaseInput): Promise<SteerHandlerResult> {
  return execute(
    input,
    () => canPause({ status: input.task.status }),
    () => steerArgvPause({ featureId: input.featureId, taskId: input.taskId, cwd: input.cwd }),
  );
}

export function steerAbort(input: SteerAbortInput): Promise<SteerHandlerResult> {
  return execute(
    input,
    () => canAbort({ status: input.task.status, confirm: input.confirm }),
    () =>
      steerArgvAbort({
        featureId: input.featureId,
        taskId: input.taskId,
        cwd: input.cwd,
        reason: input.reason,
      }),
  );
}

export function steerReassign(input: SteerReassignInput): Promise<SteerHandlerResult> {
  return execute(
    input,
    () =>
      canReassign({
        status: input.task.status,
        targetAgentId: input.agentId,
        targetStatus: input.targetStatus,
      }),
    () =>
      steerArgvReassign({
        featureId: input.featureId,
        taskId: input.taskId,
        agentId: input.agentId?.trim() ?? "",
        cwd: input.cwd,
      }),
  );
}

async function execute(
  input: SteerBaseInput,
  guard: () => SteerGuardResult,
  argv: () => string[],
): Promise<SteerHandlerResult> {
  const auth = await verifyBearerToken(input.request, input.hiveRoot);
  if (!auth.ok) {
    return {
      status: auth.status,
      body: { ok: false, error: auth.error, message: auth.message },
    };
  }

  if (input.featureId.trim() === "" || input.taskId.trim() === "") {
    return notSent("Feature and task are required.");
  }
  if (input.task.featureId !== input.featureId || input.task.id !== input.taskId) {
    return notSent("Task does not match the steer request.");
  }
  if (!beginFeatureSteer(input.featureId)) {
    return envelope(400, "INVALID_INPUT", STEER_IN_FLIGHT_MESSAGE);
  }

  try {
    const decision = guard();
    if (!decision.ok) return notSent(decision.message);
    const result = await runSuperspec(argv(), { cwd: input.cwd, timeoutMs: STEER_TIMEOUT_MS });
    return fromCli(result);
  } finally {
    inFlightFeatures.delete(input.featureId);
  }
}

function beginFeatureSteer(featureId: string): boolean {
  if (inFlightFeatures.has(featureId)) return false;
  inFlightFeatures.add(featureId);
  return true;
}

function withCwd(argv: string[], cwd: string | undefined): string[] {
  if (!cwd) return argv;
  return [...argv, "--cwd", cwd];
}

function envelope(status: number, error: string, message: string): SteerHandlerResult {
  return { status, body: { ok: false, error, message } };
}

function notSent(reason: string): SteerHandlerResult {
  const message = reason.endsWith(".")
    ? `${reason} The action was not sent.`
    : `${reason}. The action was not sent.`;
  return envelope(400, "INVALID_INPUT", message);
}

function fromCli(result: RunSuperspecResult): SteerHandlerResult {
  if (!result.ok) return envelope(400, "INVALID_INPUT", result.error);
  if (!isRecord(result.json)) return envelope(400, "INVALID_INPUT", "CLI stdout is not a single JSON object.");
  return { status: result.json.ok === false ? 400 : 200, body: result.json };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
