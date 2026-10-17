import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { constants } from "node:fs";
import { writeJsonAtomic } from "../command-plane/store.js";
import { TokenSettingsSchema } from "./schema.js";

export function defaultTokenSettings() {
  return TokenSettingsSchema.parse({ schemaVersion: 1 });
}

async function writeJsonIfMissing(filePath: string, value: unknown): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    await writeJsonAtomic(filePath, value);
  }
}

async function ensureEmptyFile(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    await writeFile(filePath, "", { encoding: "utf8", mode: 0o600 });
  }
}

/** Create token governor files under `tokenDir` when missing (idempotent). */
export async function bootstrapTokenLayout(tokenDir: string): Promise<void> {
  await mkdir(join(tokenDir, "locks"), { recursive: true, mode: 0o700 });

  await writeJsonIfMissing(join(tokenDir, "settings.json"), defaultTokenSettings());
  await writeJsonIfMissing(join(tokenDir, "budgets.json"), { schemaVersion: 1, items: [] });
  await writeJsonIfMissing(join(tokenDir, "breakers.json"), { schemaVersion: 1, items: {} });
  await writeJsonIfMissing(join(tokenDir, "gauges.json"), { schemaVersion: 1, items: {} });

  await ensureEmptyFile(join(tokenDir, "spend.jsonl"));
  await ensureEmptyFile(join(tokenDir, "compaction.jsonl"));
  await ensureEmptyFile(join(tokenDir, "tier-overrides.jsonl"));
}
