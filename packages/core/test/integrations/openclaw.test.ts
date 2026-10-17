import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAskMe } from "../../src/command-plane/ask-me.js";
import * as hireSpawn from "../../src/hire/spawn.js";
import { saveIntegrationConfig } from "../../src/integrations/config.js";
import { handleOpenClawInbound } from "../../src/integrations/openclaw.js";
import { parseIntegrationConfig } from "../../src/integrations/schema.js";

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "../../src/integrations/openclaw.ts");

async function hive(): Promise<string> {
  const hiveRoot = await mkdtemp(join(tmpdir(), "openclaw-ask-"));
  await writeFile(
    join(hiveRoot, "hive.json"),
    `${JSON.stringify({ schemaVersion: 1, createdAt: "2026-10-17T00:00:00.000Z" })}\n`,
  );
  return hiveRoot;
}

describe("handleOpenClawInbound", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects when adapter disabled", async () => {
    const openAskMe = vi.fn(async () => ({ askMeId: "ask_x" }));
    const r = await handleOpenClawInbound({
      hiveRoot: "/tmp/hive",
      enabled: false,
      message: { text: "approve please", channelId: "c1" },
      openAskMe,
    });
    expect(r).toEqual({ rejected: "ADAPTER_DISABLED" });
    expect(openAskMe).not.toHaveBeenCalled();
  });

  it("opens Ask-Me with untrusted_import and does not hire-spawn", async () => {
    const hireSpawnConfirm = vi.spyOn(hireSpawn, "hireSpawnConfirm");
    const openAskMe = vi.fn(async () => ({ askMeId: "ask_x" }));
    const r = await handleOpenClawInbound({
      hiveRoot: "/tmp/x",
      enabled: true,
      message: { text: "approve please", channelId: "c1" },
      openAskMe,
    });
    expect(r).toEqual({ askMeId: "ask_x" });
    expect(openAskMe).toHaveBeenCalledWith(
      expect.objectContaining({
        hiveRoot: "/tmp/x",
        channelId: "c1",
        reasonClass: "untrusted_import",
        question: expect.stringContaining("approve please"),
      }),
    );
    expect(hireSpawnConfirm).not.toHaveBeenCalled();
  });

  it("returns adapter failure when openAskMe throws", async () => {
    const r = await handleOpenClawInbound({
      hiveRoot: "/tmp/x",
      enabled: true,
      message: { text: "hi", channelId: "c" },
      openAskMe: async () => {
        throw new Error("boom");
      },
    });
    expect(r).toEqual({ rejected: "ADAPTER_FAILED" });
  });

  it("treats a missing integration config as disabled", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "openclaw-missing-"));
    const openAskMe = vi.fn(async () => ({ askMeId: "ask_x" }));
    const r = await handleOpenClawInbound({
      hiveRoot,
      message: { text: "hi", channelId: "c" },
      openAskMe,
    });
    expect(r).toEqual({ rejected: "ADAPTER_DISABLED" });
    expect(openAskMe).not.toHaveBeenCalled();
  });

  it("creates an Ask-Me item when OpenClaw is enabled in config", async () => {
    const hiveRoot = await hive();
    await saveIntegrationConfig(
      hiveRoot,
      parseIntegrationConfig({ adapters: { openclaw: { enabled: true } } }),
    );
    const hireSpawnConfirm = vi.spyOn(hireSpawn, "hireSpawnConfirm");
    const opened = await handleOpenClawInbound({
      hiveRoot,
      message: { text: "approve please", channelId: "c1" },
    });
    expect(opened).toMatchObject({ askMeId: expect.stringMatching(/^ask_/) });
    if (!("askMeId" in opened)) return;

    const again = await handleOpenClawInbound({
      hiveRoot,
      message: { text: "approve please", channelId: "c1" },
    });
    const other = await handleOpenClawInbound({
      hiveRoot,
      message: { text: "different request", channelId: "c1" },
    });
    expect(again).toEqual({ askMeId: opened.askMeId });
    expect(other).toMatchObject({ askMeId: expect.stringMatching(/^ask_/) });
    if (!("askMeId" in other)) return;
    expect(other.askMeId).not.toBe(opened.askMeId);

    const listed = await listAskMe({ hiveRoot, state: "open" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const item = listed.items.find((row) => row.id === opened.askMeId);
    expect(item?.reasonClass).toBe("untrusted_import");
    expect(item?.question).toContain("c1");
    expect(item?.question).toContain("approve please");
    expect(item?.taskId?.startsWith("hrv_")).toBe(false);
    expect(hireSpawnConfirm).not.toHaveBeenCalled();
  });

  it("lists Ask-Me items for the channel without opening another", async () => {
    const hiveRoot = await hive();
    const created = await handleOpenClawInbound({
      hiveRoot,
      enabled: true,
      message: { text: "need a look", channelId: "c1" },
    });
    const elsewhere = await handleOpenClawInbound({
      hiveRoot,
      enabled: true,
      message: { text: "other room", channelId: "c2" },
    });
    const prefixed = await handleOpenClawInbound({
      hiveRoot,
      enabled: true,
      message: { text: "longer id", channelId: "c10" },
    });
    expect("askMeId" in created).toBe(true);
    expect("askMeId" in elsewhere).toBe(true);
    expect("askMeId" in prefixed).toBe(true);
    if (!("askMeId" in created) || !("askMeId" in elsewhere) || !("askMeId" in prefixed)) return;

    const openAskMe = vi.fn(async () => ({ askMeId: "ask_should_not" }));
    const listed = await handleOpenClawInbound({
      hiveRoot,
      enabled: true,
      message: { text: "", channelId: "c1", flow: "list" },
      openAskMe,
    });
    expect(listed).toEqual({ askMeIds: [created.askMeId] });
    expect(openAskMe).not.toHaveBeenCalled();

    const after = await listAskMe({ hiveRoot, state: "open" });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.items.map((row) => row.id).sort()).toEqual(
      [created.askMeId, elsewhere.askMeId, prefixed.askMeId].sort(),
    );
  });

  it("rejects empty create messages and hire-review tokens", async () => {
    const openAskMe = vi.fn(async () => ({ askMeId: "ask_x" }));
    const empty = await handleOpenClawInbound({
      hiveRoot: "/tmp/x",
      enabled: true,
      message: { text: "  ", channelId: "c1" },
      openAskMe,
    });
    const blankChannel = await handleOpenClawInbound({
      hiveRoot: "/tmp/x",
      enabled: true,
      message: { text: "approve please", channelId: "  " },
      openAskMe,
    });
    const review = await handleOpenClawInbound({
      hiveRoot: "/tmp/x",
      enabled: true,
      message: {
        text: "see hrv_01234567-89ab-cdef-0123-456789abcdef",
        channelId: "c1",
      },
      openAskMe,
    });
    expect(empty).toEqual({ rejected: "INVALID_MESSAGE" });
    expect(blankChannel).toEqual({ rejected: "INVALID_MESSAGE" });
    expect(review).toEqual({ rejected: "INVALID_MESSAGE" });
    expect(openAskMe).not.toHaveBeenCalled();
  });

  it("does not reference hire spawn, dispatch, or host process APIs", () => {
    const src = readFileSync(sourcePath, "utf8");
    expect(src).not.toMatch(/hireSpawnConfirm|hire-spawn-confirm|hire\/spawn/);
    expect(src).not.toMatch(/dispatch-task|dispatchTask/);
    expect(src).not.toMatch(/child_process|execFile|\bspawn\(/);
    expect(src).not.toMatch(/claude|codex|cursor-agent/);
  });
});
