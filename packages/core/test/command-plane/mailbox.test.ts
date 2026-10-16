import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hiveInit } from "../../src/command-plane/hive-init.js";
import { withLock } from "../../src/command-plane/store.js";
import { AskMeItemSchema } from "../../src/command-plane/schema.js";
import {
  assertMailboxRole,
  mailboxPost,
  mailboxRead,
} from "../../src/command-plane/mailbox.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;

beforeEach(() => {
  delete process.env.SUPERSPEC_ROOT;
});

afterEach(async () => {
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempHive(): Promise<{ root: string; hive: string; specDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "cp-mailbox-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# p\n");
  const specDir = join(root, "specs", "001-demo");
  await mkdir(specDir, { recursive: true });
  await writeFile(join(specDir, "plan.md"), "# Plan\n\nDispatch uses dispatch-task only.\n");
  await writeFile(join(specDir, "spec.md"), "# Spec\n");
  process.env.SUPERSPEC_ROOT = root;
  const init = await hiveInit({ cwd: root });
  expect(init.ok).toBe(true);
  return { root, hive: join(root, ".superspec", "hive"), specDir };
}

describe("assertMailboxRole", () => {
  it("rejects worker posting to inbox", () => {
    expect(() => assertMailboxRole({ role: "worker", box: "inbox", operation: "write" })).toThrow(/MAILBOX_ROLE/);
  });

  it("rejects ira posting to outbox", () => {
    expect(() => assertMailboxRole({ role: "ira", box: "outbox", operation: "write" })).toThrow(/MAILBOX_ROLE/);
  });

  it("allows worker outbox and ira inbox writes", () => {
    expect(() => assertMailboxRole({ role: "worker", box: "outbox", operation: "write" })).not.toThrow();
    expect(() => assertMailboxRole({ role: "ira", box: "inbox", operation: "write" })).not.toThrow();
  });
});

describe("mailboxPost and mailboxRead", () => {
  it("appends worker outbox JSONL under the outbox lock", async () => {
    const { hive } = await tempHive();
    const posted = await mailboxPost({
      hiveRoot: hive,
      role: "worker",
      agentId: "agent-host",
      box: "outbox",
      message: {
        toAgentId: "ira",
        kind: "result",
        body: "done",
        relatedTaskId: "T001",
        featureId: "001-demo",
      },
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    expect(posted.id).toMatch(/^msg_/);

    const outboxPath = join(hive, "mailboxes", "agent-host", "outbox.jsonl");
    const lines = (await readFile(outboxPath, "utf8")).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0] ?? "");
    expect(row.fromAgentId).toBe("agent-host");
    expect(row.kind).toBe("result");

    const read = await mailboxRead({
      hiveRoot: hive,
      role: "worker",
      agentId: "agent-host",
      box: "outbox",
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.messages).toHaveLength(1);
    expect(read.messages[0]?.id).toBe(posted.id);
  });

  it("returns MAILBOX_BUSY when the outbox lock is held", async () => {
    const { hive } = await tempHive();
    const lockPath = join(hive, "locks", "mailbox-agent-host-outbox.lock");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const held = withLock(lockPath, { waitMs: 0 }, async () => {
      await gate;
    });

    await new Promise((r) => setTimeout(r, 30));

    const posted = await mailboxPost({
      hiveRoot: hive,
      role: "worker",
      agentId: "agent-host",
      box: "outbox",
      message: {
        toAgentId: "ira",
        kind: "handoff",
        body: "blocked",
        relatedTaskId: null,
        featureId: "001-demo",
      },
      lockWaitMs: 0,
    });
    release();
    await held;

    expect(posted).toEqual({ ok: false, error: "MAILBOX_BUSY", message: expect.stringContaining("MAILBOX_BUSY") });
  });

  it("opens Ask-Me on escalate to ira", async () => {
    const { hive } = await tempHive();
    const posted = await mailboxPost({
      hiveRoot: hive,
      role: "worker",
      agentId: "agent-host",
      box: "outbox",
      message: {
        toAgentId: "ira",
        kind: "escalate",
        body: "Need approval to force-push main",
        relatedTaskId: "T002",
        featureId: "001-demo",
      },
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    expect(posted.askMeId).toMatch(/^ask_/);

    const askRaw = await readFile(join(hive, "ask-me", `${posted.askMeId}.json`), "utf8");
    const item = AskMeItemSchema.parse(JSON.parse(askRaw));
    expect(item.reasonClass).toBe("destructive_git");
    expect(item.state).toBe("open");
  });

  it("answers clarify from plan artifacts without Ask-Me", async () => {
    const { hive } = await tempHive();
    const posted = await mailboxPost({
      hiveRoot: hive,
      role: "worker",
      agentId: "agent-host",
      box: "outbox",
      message: {
        toAgentId: "ira",
        kind: "clarify",
        body: "Should we use dispatch-task only?",
        relatedTaskId: "T001",
        featureId: "001-demo",
      },
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    expect(posted.answered).toBe(true);
    expect(posted.askMeId).toBeUndefined();

    const askDir = join(hive, "ask-me");
    const files = await readdirSafe(askDir);
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(0);
  });

  it("routes ira inbox delivery for the target agent", async () => {
    const { hive } = await tempHive();
    const posted = await mailboxPost({
      hiveRoot: hive,
      role: "ira",
      agentId: "agent-host",
      box: "inbox",
      message: {
        toAgentId: "agent-host",
        kind: "handoff",
        body: "Take T003 next",
        relatedTaskId: "T003",
        featureId: "001-demo",
      },
    });
    expect(posted.ok).toBe(true);

    const inboxPath = join(hive, "mailboxes", "agent-host", "inbox.jsonl");
    const lines = (await readFile(inboxPath, "utf8")).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "").fromAgentId).toBe("ira");
  });
});

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    return await readdir(dir);
  } catch {
    return [];
  }
}
