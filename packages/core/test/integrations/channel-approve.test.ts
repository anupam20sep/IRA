import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAskMe, openAskMeItem } from "../../src/command-plane/ask-me.js";
import { handleChannelApprove } from "../../src/integrations/channel-approve.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function openItem(): Promise<{ hive: string; id: string }> {
  const hive = await mkdtemp(join(tmpdir(), "channel-approve-"));
  roots.push(hive);
  await writeFile(join(hive, "hive.json"), `${JSON.stringify({ schemaVersion: 1 })}\n`);
  const opened = await openAskMeItem({
    hiveRoot: hive,
    featureId: null,
    taskId: null,
    agentId: null,
    reasonClass: "ambiguous_requirement",
    question: "Ship the change?",
    now: "2026-10-17T00:00:00.000Z",
  });
  if (!opened.ok) throw new Error(opened.message);
  return { hive, id: opened.item.id };
}

describe("handleChannelApprove", () => {
  it("rejects bad secret without mutating Ask-Me", async () => {
    const { hive, id } = await openItem();
    const r = await handleChannelApprove({
      hiveRoot: hive,
      enabled: true,
      itemId: id,
      action: "acknowledge",
      secret: "wrong",
      expectedSecret: "right",
    });
    expect(r).toEqual({ ok: false, code: "CHANNEL_AUTH_FAILED" });

    const listed = await listAskMe({ hiveRoot: hive, state: "open" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.items.map((item) => item.id)).toEqual([id]);
    expect(listed.items[0]?.state).toBe("open");
    expect(listed.items[0]?.answer).toBeNull();
  });

  it("rejects the plan fixture secret without touching a missing hive", async () => {
    const r = await handleChannelApprove({
      hiveRoot: "/tmp/hive",
      enabled: true,
      itemId: "ask_1",
      action: "acknowledge",
      secret: "wrong",
      expectedSecret: "right",
    });
    expect(r).toEqual({ ok: false, code: "CHANNEL_AUTH_FAILED" });
  });

  it("maps an authenticated acknowledge onto ask-me-answer", async () => {
    const { hive, id } = await openItem();
    const r = await handleChannelApprove({
      hiveRoot: hive,
      enabled: true,
      itemId: id,
      action: "acknowledge",
      secret: "right",
      expectedSecret: "right",
      now: "2026-10-17T01:00:00.000Z",
    });
    expect(r).toMatchObject({
      ok: true,
      item: {
        id,
        state: "resolved",
        action: "acknowledge",
        answer: "Approved via channel.",
        resolvedAt: "2026-10-17T01:00:00.000Z",
      },
    });

    const stored = JSON.parse(await readFile(join(hive, "ask-me", `${id}.json`), "utf8")) as {
      state: string;
      action: string;
    };
    expect(stored).toMatchObject({ state: "resolved", action: "acknowledge" });
  });

  it("maps approve and deny replies onto ask-me actions only", async () => {
    const approved = await openItem();
    const denied = await openItem();

    const yes = await handleChannelApprove({
      hiveRoot: approved.hive,
      enabled: true,
      itemId: approved.id,
      action: "approve",
      secret: "s3cret",
      expectedSecret: "s3cret",
      now: "2026-10-17T02:00:00.000Z",
    });
    const no = await handleChannelApprove({
      hiveRoot: denied.hive,
      enabled: true,
      itemId: denied.id,
      action: "deny",
      secret: "s3cret",
      expectedSecret: "s3cret",
      now: "2026-10-17T02:00:00.000Z",
    });

    expect(yes).toMatchObject({ ok: true, item: { action: "acknowledge", state: "resolved" } });
    expect(no).toMatchObject({ ok: true, item: { action: "keep_blocked", state: "resolved" } });

    for (const hive of [approved.hive, denied.hive]) {
      const names = await readdir(hive);
      expect(names).not.toContain("hire");
      expect(names).not.toContain("token");
      expect(names).not.toContain("roster.json");
    }
  });

  it("does not answer when the bridge is disabled", async () => {
    const { hive, id } = await openItem();
    const r = await handleChannelApprove({
      hiveRoot: hive,
      enabled: false,
      itemId: id,
      action: "approve",
      secret: "right",
      expectedSecret: "right",
    });
    expect(r).toEqual({ ok: false, code: "ADAPTER_DISABLED" });

    const listed = await listAskMe({ hiveRoot: hive, state: "open" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.items[0]?.state).toBe("open");
  });

  it("does not resolve when an authenticated reply is not an Ask-Me action", async () => {
    const { hive, id } = await openItem();
    const r = await handleChannelApprove({
      hiveRoot: hive,
      enabled: true,
      itemId: id,
      action: "hire-spawn-confirm",
      secret: "right",
      expectedSecret: "right",
    });
    expect(r).toMatchObject({ ok: false, error: "INVALID_INPUT" });

    const listed = await listAskMe({ hiveRoot: hive, state: "open" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.items[0]?.state).toBe("open");
    expect(await readdir(hive)).not.toContain("hire");
  });

  it("rejects a blank shared secret", async () => {
    const r = await handleChannelApprove({
      hiveRoot: "/tmp/hive",
      enabled: true,
      itemId: "ask_1",
      action: "acknowledge",
      secret: "",
      expectedSecret: "",
    });
    expect(r).toEqual({ ok: false, code: "CHANNEL_AUTH_FAILED" });
  });
});
