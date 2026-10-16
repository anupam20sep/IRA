import { chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DispatchIntent } from "../command-plane/hooks.js";
import { featureIdSchema } from "../command-plane/schema.js";
import { writeJsonAtomic } from "../command-plane/store.js";

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/**
 * Durable host handoff. Mode 0600. Does not start a process.
 * Path: `<hiveRoot>/dispatch-queue/<featureId>/<taskId>.json`.
 */
export async function persistDispatchIntent(intent: DispatchIntent): Promise<string> {
  if (intent.freshSubagent !== true) throw new Error("INVALID_INPUT");
  const featureId = featureIdSchema.parse(intent.featureId);
  if (!TASK_ID.test(intent.taskId)) throw new Error("INVALID_INPUT");
  const path = join(intent.hiveRoot, "dispatch-queue", featureId, `${intent.taskId}.json`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeJsonAtomic(path, intent);
  await chmod(path, 0o600);
  return path;
}
