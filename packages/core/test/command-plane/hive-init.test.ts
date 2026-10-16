import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { access, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { hiveInit } from "../../src/command-plane/hive-init.js";

const roots: string[] = [];
const priorSuperspecRoot = process.env.SUPERSPEC_ROOT;

beforeEach(() => {
  delete process.env.SUPERSPEC_ROOT;
});

afterEach(async () => {
  if (priorSuperspecRoot === undefined) delete process.env.SUPERSPEC_ROOT;
  else process.env.SUPERSPEC_ROOT = priorSuperspecRoot;
  await Promise.all(roots.splice(0).map((dir) => rmSafe(dir)));
});

async function rmSafe(dir: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(dir, { recursive: true, force: true });
}

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cp-hive-"));
  roots.push(root);
  await writeFile(join(root, "program.md"), "# p\n");
  return root;
}

describe("hiveInit", () => {
  it("creates settings without allowAbsentCi field (read as false)", async () => {
    const root = await tempRepo();
    process.env.SUPERSPEC_ROOT = root;
    const result = await hiveInit({ cwd: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(join(root, ".superspec/hive/settings.json"), "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    expect(settings.autonomy).toBe("supervised");
    expect(settings.telemetry).toBe("off");
    expect(settings.maxReviewFailures).toBe(3);
    expect(settings.awayMode).toBe(false);
    expect(settings.pollIntervalMs).toBe(60000);
    expect(settings.featureCeilings).toEqual({});
    expect(settings.allowAbsentCi).toBeUndefined();
    expect(raw.includes("allowAbsentCi")).toBe(false);
  });

  it("creates hive layout including dispatch-queue and locks", async () => {
    const root = await tempRepo();
    process.env.SUPERSPEC_ROOT = root;
    await hiveInit({ cwd: root });
    const hive = join(root, ".superspec/hive");
    for (const segment of [
      "dispatch-queue",
      "locks",
      "briefs",
      "ledger",
      "ask-me",
      "events",
      "mailboxes",
    ]) {
      const st = await stat(join(hive, segment));
      expect(st.isDirectory()).toBe(true);
    }
    await access(join(hive, "hive.json"));
    await access(join(hive, "settings.json"));
    await access(join(hive, "roster.json"));
    await access(join(hive, "blackboard.json"));
    await access(join(hive, "events/events.jsonl"));
  });

  it("writes Ira persona into hive.json", async () => {
    const root = await tempRepo();
    process.env.SUPERSPEC_ROOT = root;
    await hiveInit({ cwd: root });
    const manifest = JSON.parse(await readFile(join(root, ".superspec/hive/hive.json"), "utf8"));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.repositoryRoot).toBe(resolve(root));
    expect(manifest.persona).toEqual({
      callsign: "Ira",
      expansion: "Intelligent Resource Automation",
    });
  });

  it("appends .superspec/hive/ to .gitignore when missing", async () => {
    const root = await tempRepo();
    process.env.SUPERSPEC_ROOT = root;
    await hiveInit({ cwd: root });
    const gitignore = await readFile(join(root, ".gitignore"), "utf8");
    expect(gitignore.split("\n").some((line) => line.trim() === ".superspec/hive/")).toBe(true);
  });

  it("is idempotent when schemaVersion is 1", async () => {
    const root = await tempRepo();
    process.env.SUPERSPEC_ROOT = root;
    const first = await hiveInit({ cwd: root });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);

    const settingsBefore = await readFile(join(root, ".superspec/hive/settings.json"), "utf8");
    const second = await hiveInit({ cwd: root });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    const settingsAfter = await readFile(join(root, ".superspec/hive/settings.json"), "utf8");
    expect(settingsAfter).toBe(settingsBefore);
  });

  it("returns HIVE_SCHEMA_MISMATCH for unsupported hive schemaVersion", async () => {
    const root = await tempRepo();
    process.env.SUPERSPEC_ROOT = root;
    const hive = join(root, ".superspec/hive");
    await import("node:fs/promises").then((fs) => fs.mkdir(hive, { recursive: true }));
    await writeFile(
      join(hive, "hive.json"),
      JSON.stringify({ schemaVersion: 99, repositoryRoot: root, createdAt: new Date().toISOString() }),
    );
    const result = await hiveInit({ cwd: root });
    expect(result).toEqual({ ok: false, error: "HIVE_SCHEMA_MISMATCH" });
  });

  it("returns HIVE_ROOT_UNRESOLVED when program.md is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "cp-hive-bad-"));
    roots.push(root);
    const result = await hiveInit({ cwd: root });
    expect(result).toEqual({ ok: false, error: "HIVE_ROOT_UNRESOLVED" });
  });
});
