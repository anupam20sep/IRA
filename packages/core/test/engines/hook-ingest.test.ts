import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseHookStdin, runHookIngest } from "../../src/engines/hook-ingest.js";
import { installProjectHookBridge } from "../../src/engines/hooks-install.js";

async function hiveRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hive-hook-"));
  await writeFile(join(root, "hive.json"), JSON.stringify({ schemaVersion: 1 }));
  await mkdir(join(root, "locks"), { mode: 0o700 });
  await mkdir(join(root, "events"), { mode: 0o700 });
  await writeFile(join(root, "events", "events.jsonl"), "");
  await mkdir(join(root, "engines", "sessions"), { recursive: true, mode: 0o700 });
  return root;
}

async function writeSession(
  hive: string,
  sessionId: string,
  ctx: { agentId: string; engineId: string; taskId: string; featureId?: string },
): Promise<void> {
  const dir = join(hive, "engines", "sessions", sessionId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "session.json"), JSON.stringify(ctx));
}

describe("parseHookStdin", () => {
  it("parses single JSON object from stdin buffer", () => {
    const obj = parseHookStdin(Buffer.from('{"type":"start"}'));
    expect(obj.type).toBe("start");
  });
});

describe("runHookIngest", () => {
  const prevHive = process.env.SUPERSPEC_HIVE_ROOT;

  afterEach(async () => {
    if (prevHive === undefined) delete process.env.SUPERSPEC_HIVE_ROOT;
    else process.env.SUPERSPEC_HIVE_ROOT = prevHive;
  });

  it("appends normalized engine.start and removes session dir on stop", async () => {
    const hive = await hiveRoot();
    process.env.SUPERSPEC_HIVE_ROOT = hive;
    const sessionId = "ses_hook_flow";
    await writeSession(hive, sessionId, {
      agentId: "implementer",
      engineId: "claude",
      taskId: "T015",
      featureId: "006-ira-engine-adapters",
    });

    const start = await runHookIngest(
      JSON.stringify({ hook_event_name: "SessionStart", session_id: sessionId }),
      sessionId,
    );
    expect(start).toEqual({ ok: true });

    const log = (await readFile(join(hive, "events", "events.jsonl"), "utf8")).trim().split("\n");
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0]!).type).toBe("engine.start");

    const stop = await runHookIngest(JSON.stringify({ hook_event_name: "Stop" }), sessionId);
    expect(stop).toEqual({ ok: true });

    const log2 = (await readFile(join(hive, "events", "events.jsonl"), "utf8")).trim().split("\n");
    expect(log2).toHaveLength(2);
    expect(JSON.parse(log2[1]!).type).toBe("engine.stop");

    await expect(stat(join(hive, "engines", "sessions", sessionId))).rejects.toThrow();
  });

  it("returns ok when normalization yields null", async () => {
    const hive = await hiveRoot();
    process.env.SUPERSPEC_HIVE_ROOT = hive;
    const sessionId = "ses_skip";
    await writeSession(hive, sessionId, {
      agentId: "implementer",
      engineId: "codex",
      taskId: "T015",
    });

    const result = await runHookIngest(JSON.stringify({ type: "unknown_vendor_event" }), sessionId);
    expect(result).toEqual({ ok: true });
    expect(await readFile(join(hive, "events", "events.jsonl"), "utf8")).toBe("");
  });
});

describe("installProjectHookBridge", () => {
  it("appends hook-ingest beside the SuperSpec reminder for each host", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "proj-hooks-"));
    await mkdir(join(projectRoot, "hooks"), { recursive: true });
    await writeFile(
      join(projectRoot, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: "command", command: "echo superspec reminder" }],
            },
          ],
        },
      }),
    );
    await writeFile(
      join(projectRoot, "hooks", "hooks-codex.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "startup|resume",
              hooks: [{ type: "command", command: "echo superspec reminder" }],
            },
          ],
        },
      }),
    );
    await writeFile(
      join(projectRoot, "hooks", "hooks-cursor.json"),
      JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: "echo superspec reminder" }] } }),
    );

    for (const host of ["claude", "codex", "cursor-agent"] as const) {
      const installed = await installProjectHookBridge(projectRoot, host);
      expect(installed.ok).toBe(true);
      const text = await readFile(installed.path, "utf8");
      expect(text).toContain("hook-ingest");
      expect(text).toContain("superspec reminder");
    }

    await rm(projectRoot, { recursive: true, force: true });
  });
});
