import type { IraEvent } from "../command-plane/types.js";
import type { DispatchIntent } from "../command-plane/hooks.js";
import { detectInstalled } from "./detect.js";
import { dispatchEngine, type EngineDispatchResult } from "./dispatch.js";
import { normalizeEngineEvent } from "./normalize.js";

export type SliceAEngineHooks = {
  detectInstalled(): Promise<Array<{ engineId: string; installed: boolean }>>;
  dispatch(intent: DispatchIntent): Promise<EngineDispatchResult>;
  normalizeEvent(raw: {
    type: string;
    agentId?: string;
    engineId?: string;
    data?: Record<string, unknown>;
  }): Promise<IraEvent | null>;
};

export function createEngineHooks(hiveRoot: string): SliceAEngineHooks {
  return {
    async detectInstalled() {
      const rows = await detectInstalled();
      return rows.map((row) => ({ engineId: row.engineId, installed: row.installed }));
    },
    async dispatch(intent) {
      const root = intent.hiveRoot || hiveRoot;
      return dispatchEngine({ ...intent, hiveRoot: root });
    },
    async normalizeEvent(raw) {
      const data = raw.data ?? {};
      const taskId = typeof data.taskId === "string" && data.taskId.length > 0 ? data.taskId : "T000";
      const sessionId =
        typeof data.sessionId === "string" && data.sessionId.length > 0
          ? data.sessionId
          : `ses-${raw.agentId ?? "worker"}`;
      const featureId = typeof data.featureId === "string" ? data.featureId : null;
      return normalizeEngineEvent(raw, {
        agentId: raw.agentId && raw.agentId.length > 0 ? raw.agentId : "worker",
        engineId: raw.engineId && raw.engineId.length > 0 ? raw.engineId : "claude",
        taskId,
        sessionId,
        featureId,
      });
    },
  };
}
