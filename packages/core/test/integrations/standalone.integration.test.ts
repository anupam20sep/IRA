import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor, type DoctorReport } from "../../src/command-plane/doctor.js";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import * as hireSpawn from "../../src/hire/spawn.js";
import { handleChannelApprove } from "../../src/integrations/channel-approve.js";
import { saveIntegrationConfig } from "../../src/integrations/config.js";
import { handleOpenClawInbound } from "../../src/integrations/openclaw.js";
import { parseIntegrationConfig } from "../../src/integrations/schema.js";
import * as budgets from "../../src/token-governor/budgets.js";

const TOOLS = ["hive-init", "dispatch-task", "doctor"] as const;
const SECRET = "s3cret";
const sourceDir = join(dirname(fileURLToPath(import.meta.url)), "../../src/integrations");

/** Channel paths may touch Ask-Me only (FR-003, SC-003). */
const CHANNEL_DENY_LIST: RegExp[] = [
  /hireSpawnConfirm/,
  /hire-spawn-confirm/,
  /hire\/spawn/,
  /\bsetBudget\b/,
  /token-budget-set/,
  /dispatch-task/,
  /dispatchTask/,
  /child_process/,
  /execFile/,
  /\bspawn\(/,
];

const CHANNEL_SOURCES = ["openclaw.ts", "channel-approve.ts"] as const;

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;

afterEach(async () => {
  vi.restoreAllMocks();
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function readyRepo(): Promise<{ root: string; hive: string }> {
  const root = await mkdtemp(join(tmpdir(), "int-standalone-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# program\n");
  await mkdir(join(root, ".git"));
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  if (!init.ok) throw new Error(init.error);
  return { root, hive: init.hiveRoot };
}

function errorCodes(report: DoctorReport): string[] {
  return report.findings.filter((item) => item.severity === "error").map((item) => item.code).sort();
}

describe("integrations standalone", () => {
  it("leaves hiveReady unchanged when adapters are absent or disabled", async () => {
    const { root, hive } = await readyRepo();

    const absent = await runDoctor({ cwd: root });
    expect(absent.hiveReady).toBe(true);
    expect(absent.ready).toBe(absent.hiveReady);
    expect(absent.mcpTools).toEqual(expect.arrayContaining([...TOOLS]));
    expect(absent.findings.filter((item) => item.code.startsWith("INTEGRATION_"))).toEqual([]);

    await saveIntegrationConfig(
      hive,
      parseIntegrationConfig({
        schemaVersion: 1,
        adapters: {
          openclaw: { enabled: false },
          hermes: { enabled: false },
          channelApprove: { enabled: false },
          boardShare: { enabled: false },
        },
      }),
    );

    const disabled = await runDoctor({ cwd: root });
    expect(disabled.hiveReady).toBe(absent.hiveReady);
    expect(disabled.ready).toBe(disabled.hiveReady);
    expect(disabled.mcpTools).toEqual(absent.mcpTools);
    expect(errorCodes(disabled)).toEqual(errorCodes(absent));
    expect(disabled.findings.filter((item) => item.code.startsWith("INTEGRATION_"))).toEqual([]);
  });

  it("channel inbound does not call hireSpawnConfirm or raise a budget", async () => {
    const { hive } = await readyRepo();
    const hireSpawnConfirm = vi.spyOn(hireSpawn, "hireSpawnConfirm");
    const setBudget = vi.spyOn(budgets, "setBudget");
    const budgetsBefore = await readFile(join(hive, "token", "budgets.json"));
    const rosterBefore = await readFile(join(hive, "roster.json"));

    const disabled = await handleOpenClawInbound({
      hiveRoot: hive,
      message: { text: "hire-spawn-confirm", channelId: "c" },
    });
    expect(disabled).toEqual({ rejected: "ADAPTER_DISABLED" });

    await saveIntegrationConfig(
      hive,
      parseIntegrationConfig({ adapters: { openclaw: { enabled: true } } }),
    );

    const openAskMe = vi.fn(async () => ({ askMeId: "ask_x" }));
    const injected = await handleOpenClawInbound({
      hiveRoot: hive,
      enabled: true,
      message: { text: "hi", channelId: "c" },
      openAskMe,
    });
    expect(injected).toEqual({ askMeId: "ask_x" });
    expect(openAskMe).toHaveBeenCalledWith(
      expect.objectContaining({ reasonClass: "untrusted_import", channelId: "c" }),
    );

    const opened = await handleOpenClawInbound({
      hiveRoot: hive,
      message: { text: "please hire-spawn-confirm", channelId: "c" },
    });
    expect(opened).toMatchObject({ askMeId: expect.stringMatching(/^ask_/) });
    if (!("askMeId" in opened)) throw new Error("OpenClaw inbound did not open Ask-Me");

    const listed = await handleOpenClawInbound({
      hiveRoot: hive,
      message: { text: "", channelId: "c", flow: "list" },
    });
    expect(listed).toEqual({ askMeIds: [opened.askMeId] });

    const spawnReply = await handleChannelApprove({
      hiveRoot: hive,
      enabled: true,
      itemId: opened.askMeId,
      action: "hire-spawn-confirm",
      secret: SECRET,
      expectedSecret: SECRET,
    });
    expect(spawnReply).toMatchObject({ ok: false, error: "INVALID_INPUT" });

    const approved = await handleChannelApprove({
      hiveRoot: hive,
      enabled: true,
      itemId: opened.askMeId,
      action: "approve",
      secret: SECRET,
      expectedSecret: SECRET,
      now: "2026-10-17T03:00:00.000Z",
    });
    expect(approved).toMatchObject({ ok: true, item: { action: "acknowledge", state: "resolved" } });

    expect(hireSpawnConfirm).not.toHaveBeenCalled();
    expect(setBudget).not.toHaveBeenCalled();
    expect(await readFile(join(hive, "token", "budgets.json"))).toEqual(budgetsBefore);
    expect(await readFile(join(hive, "roster.json"))).toEqual(rosterBefore);
    expect(await readdir(hive)).not.toContain("hire");
  });

  it("channel sources omit the hire, budget, and dispatch deny list", () => {
    for (const file of CHANNEL_SOURCES) {
      const src = readFileSync(join(sourceDir, file), "utf8");
      for (const pattern of CHANNEL_DENY_LIST) {
        expect(src, `${file} ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
