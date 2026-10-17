import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "../command-plane/store.js";
import { parseIntegrationConfig } from "./schema.js";
import type { IntegrationConfig } from "./types.js";

function integrationConfigPath(hiveRoot: string): string {
  return join(hiveRoot, "integrations", "config.json");
}

/** Load integration adapter flags from the hive; missing file ≡ all disabled. */
export async function loadIntegrationConfig(hiveRoot: string): Promise<IntegrationConfig> {
  const path = integrationConfigPath(hiveRoot);
  try {
    const raw = await readFile(path, "utf8");
    return parseIntegrationConfig(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return parseIntegrationConfig({});
    }
    throw err;
  }
}

/** Persist validated integration config under the hive integrations directory. */
export async function saveIntegrationConfig(
  hiveRoot: string,
  config: IntegrationConfig,
): Promise<void> {
  const validated = parseIntegrationConfig(config);
  const dir = join(hiveRoot, "integrations");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeJsonAtomic(integrationConfigPath(hiveRoot), validated);
}
