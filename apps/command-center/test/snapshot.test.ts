import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSnapshot, detectPatternsDirState } from "../src/server/snapshot.js";

const PERSONA = {
  callsign: "Ira" as const,
  expansion: "Intelligent Resource Automation" as const,
};

const FAKE_CLI = `import { appendFileSync, readFileSync } from "node:fs";
const argv = process.argv.slice(2);
const log = process.env.FAKE_CLI_LOG;
if (log) appendFileSync(log, JSON.stringify(argv) + "\\n");
if (process.env.FAKE_CLI_BROKEN === "1") {
  process.stdout.write("not-json");
  process.exit(1);
}
const responses = JSON.parse(readFileSync(process.env.FAKE_CLI_JSON, "utf8"));
const joined = argv.join(" ");
let key = "unknown";
if (joined.startsWith("doctor")) key = "doctor";
else if (joined.startsWith("hive status")) key = "hive status";
else if (joined.startsWith("roster list")) key = "roster list";
else if (joined.startsWith("ask-me list")) key = "ask-me list";
else if (joined.startsWith("autonomy show")) key = "autonomy show";
else if (joined.startsWith("brief show")) key = "brief show";
const body = responses[key];
if (!body) {
  process.stdout.write("not-json");
  process.exit(1);
}
process.stdout.write(JSON.stringify(body));
`;

type CliBundle = {
  root: string;
  repo: string;
  hive: string;
  logPath: string;
};

const roots: string[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

async function writeFakeCli(dir: string, responses: unknown): Promise<{ script: string; logPath: string; jsonPath: string }> {
  const script = join(dir, "fake-superspec.mjs");
  const logPath = join(dir, "cli-log.txt");
  const jsonPath = join(dir, "responses.json");
  await writeFile(script, FAKE_CLI);
  await writeFile(jsonPath, JSON.stringify(responses));
  await writeFile(logPath, "");
  return { script, logPath, jsonPath };
}

function doctorBody(hive: string, repo: string, hiveReady: boolean, engineRungReady: boolean) {
  return {
    ok: true,
    hiveReady,
    engineRungReady,
    ready: hiveReady,
    findings: [
      {
        code: "budget_unmetered",
        severity: "warning",
        message: "Token hook is absent, so budgets are unmetered.",
      },
    ],
    hiveRoot: hive,
    repositoryRoot: repo,
    persona: PERSONA,
  };
}

function coordinationResponses(hive: string, repo: string, hiveReady: boolean, engineRungReady: boolean) {
  return {
    doctor: doctorBody(hive, repo, hiveReady, engineRungReady),
    "hive status": {
      ok: true,
      repositoryRoot: repo,
      hiveRoot: hive,
      autonomy: "supervised",
      awayMode: false,
      features: [
        {
          featureId: "002-ira-command-center",
          taskCounts: { todo: 1, doing: 1, blocked: 0, done: 1 },
          openAskMe: 1,
        },
        { featureId: "../outside", taskCounts: { todo: 1, doing: 0, blocked: 0, done: 0 }, openAskMe: 0 },
      ],
      persona: PERSONA,
    },
    "roster list": {
      ok: true,
      agents: [
        {
          id: "agent-host",
          name: "Host",
          personaPath: null,
          capabilityTags: ["board"],
          engine: null,
          model: null,
          workspace: null,
          worktreePolicy: "isolated",
          status: "busy",
          origin: "placeholder",
          contextUsedRatio: 0,
        },
      ],
    },
    "ask-me list": {
      ok: true,
      items: [
        {
          id: "ask_board",
          featureId: "002-ira-command-center",
          taskId: "T003",
          agentId: "agent-host",
          reasonClass: "ambiguous_requirement",
          question: "Which column?",
          answer: null,
          action: null,
          state: "open",
          createdAt: "2026-10-16T12:00:00.000Z",
          resolvedAt: null,
          ageSeconds: 4,
        },
      ],
    },
    "autonomy show": {
      ok: true,
      settings: {
        autonomy: "autonomous",
        awayMode: true,
        pollIntervalMs: 15000,
      },
      persona: PERSONA,
    },
    "brief show": {
      ok: true,
      brief: {
        id: "brief_board",
        featureId: "002-ira-command-center",
        outcome: "Ship the board",
        constraints: ["no voice"],
        budgetTokens: null,
        budgetUsd: null,
        deliverable: "apps/command-center",
        createdAt: "2026-10-16T12:00:00.000Z",
        updatedAt: "2026-10-16T12:00:00.000Z",
        createdBy: "operator",
      },
      persona: PERSONA,
    },
  };
}

async function writeHiveFixture(hive: string): Promise<{ ledgerPath: string; eventsPath: string }> {
  const ledgerDir = join(hive, "ledger");
  const eventsDir = join(hive, "events");
  await mkdir(ledgerDir, { recursive: true });
  await mkdir(eventsDir, { recursive: true });
  const ledgerPath = join(ledgerDir, "002-ira-command-center.json");
  const ledger = {
    featureId: "002-ira-command-center",
    tasks: [
      {
        id: "T000",
        featureId: "002-ira-command-center",
        title: "Done predecessor",
        implementsFr: ["FR-018"],
        dependsOn: [],
        assigneeAgentId: null,
        status: "done",
        kind: "code",
        complexity: "mechanical",
        reviewFailures: 0,
        ceiling: 3,
        drift: "ok",
        capabilityTags: [],
        updatedAt: "2026-10-16T11:00:00.000Z",
      },
      {
        id: "T001",
        featureId: "002-ira-command-center",
        title: "Draw the board",
        implementsFr: ["FR-018"],
        dependsOn: [],
        assigneeAgentId: "agent-host",
        status: "doing",
        kind: "code",
        complexity: "complex",
        reviewFailures: 0,
        hold: false,
        ceiling: 3,
        drift: "ok",
        capabilityTags: [],
        updatedAt: "2026-10-16T12:00:00.000Z",
      },
      {
        id: "T003",
        featureId: "002-ira-command-center",
        title: "Ready card",
        implementsFr: ["FR-020"],
        dependsOn: ["T000"],
        assigneeAgentId: null,
        status: "todo",
        kind: "code",
        complexity: "moderate",
        reviewFailures: 0,
        ceiling: 3,
        drift: "ok",
        capabilityTags: [],
        updatedAt: "2026-10-16T12:05:00.000Z",
      },
    ],
  };
  await writeFile(ledgerPath, `${JSON.stringify(ledger)}\n`);
  const eventsPath = join(eventsDir, "events.jsonl");
  const lines = [
    JSON.stringify({
      id: "evt_a",
      type: "task.started",
      version: 1,
      ts: "2026-10-16T12:00:00.000Z",
      featureId: "002-ira-command-center",
      actor: { kind: "ira", id: "ira" },
      data: { taskId: "T001" },
    }),
    "not-json",
    JSON.stringify({
      id: "evt_b",
      type: "custom.future",
      version: 1,
      ts: "2026-10-16T12:01:00.000Z",
      featureId: "002-ira-command-center",
      actor: { kind: "operator", id: "operator" },
      data: {},
    }),
  ];
  await writeFile(eventsPath, `${lines.join("\n")}\n`);
  return { ledgerPath, eventsPath };
}

async function freezeTree(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await freezeTree(path);
      await chmod(path, 0o555);
    } else {
      await chmod(path, 0o444);
    }
  }
  await chmod(dir, 0o555);
}

async function thawTree(dir: string): Promise<void> {
  await chmod(dir, 0o755);
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await thawTree(path);
    else await chmod(path, 0o644);
  }
}

async function arrangeCli(hiveReady: boolean, engineRungReady: boolean): Promise<CliBundle & { ledgerPath: string; eventsPath: string }> {
  const root = await makeTemp("cc-snapshot-");
  const repo = join(root, "repo");
  const hive = join(root, "hive");
  await mkdir(repo, { recursive: true });
  const { ledgerPath, eventsPath } = await writeHiveFixture(hive);
  await writeFile(join(root, "outside.json"), "SECRET_OUTSIDE\n");
  const responses = coordinationResponses(hive, repo, hiveReady, engineRungReady);
  const { script, logPath } = await writeFakeCli(root, responses);
  process.env.SUPERSPEC_BIN = script;
  process.env.FAKE_CLI_JSON = join(root, "responses.json");
  process.env.FAKE_CLI_LOG = logPath;
  delete process.env.FAKE_CLI_BROKEN;
  return { root, repo, hive, logPath, ledgerPath, eventsPath };
}

  afterEach(async () => {
  delete process.env.SUPERSPEC_BIN;
  delete process.env.FAKE_CLI_JSON;
  delete process.env.FAKE_CLI_LOG;
  delete process.env.FAKE_CLI_BROKEN;
  for (const root of roots.splice(0)) {
    try {
      await thawTree(join(root, "hive"));
    } catch {
      // hive may be absent
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe("detectPatternsDirState", () => {
  it("returns empty when the patterns directory is missing", async () => {
    const repo = await makeTemp("cc-patterns-missing-");
    expect(detectPatternsDirState(repo)).toBe("empty");
  });

  it("returns empty when the directory has no markdown files", async () => {
    const repo = await makeTemp("cc-patterns-sqlite-");
    const patterns = join(repo, ".superspec", "patterns");
    await mkdir(patterns, { recursive: true });
    await writeFile(join(patterns, "index.sqlite"), "not-a-pattern-summary");
    expect(detectPatternsDirState(repo)).toBe("empty");
  });

  it("returns files-no-query when markdown is present without reading file bytes", async () => {
    const repo = await makeTemp("cc-patterns-md-");
    const patterns = join(repo, ".superspec", "patterns");
    await mkdir(join(patterns, "nested"), { recursive: true });
    const sqlitePath = join(patterns, "index.sqlite");
    const lessonPath = join(patterns, "nested", "lesson.md");
    await writeFile(sqlitePath, "sqlite-bytes");
    await writeFile(lessonPath, "DO_NOT_SURFACE success row");
    await chmod(sqlitePath, 0o000);
    await chmod(lessonPath, 0o000);
    expect(detectPatternsDirState(repo)).toBe("files-no-query");
  });

  it("returns unavailable when the patterns path is not a directory", async () => {
    const repo = await makeTemp("cc-patterns-file-");
    await mkdir(join(repo, ".superspec"), { recursive: true });
    await writeFile(join(repo, ".superspec", "patterns"), "not-a-directory");
    expect(detectPatternsDirState(repo)).toBe("unavailable");
  });

  it("returns unavailable when the patterns directory escapes the repository", async () => {
    const root = await makeTemp("cc-patterns-link-");
    const repo = join(root, "repo");
    const outside = join(root, "outside");
    await mkdir(join(repo, ".superspec"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "leak.md"), "outside lesson");
    await symlink(outside, join(repo, ".superspec", "patterns"));
    expect(detectPatternsDirState(repo)).toBe("unavailable");
  });
});

describe("buildSnapshot", () => {
  it("marks stale when hiveReady is false and still returns coordination fields", async () => {
    const arranged = await arrangeCli(false, true);
    const ledgerBefore = await readFile(arranged.ledgerPath, "utf8");
    const eventsBefore = await readFile(arranged.eventsPath, "utf8");
    await freezeTree(arranged.hive);

    const snapshot = await buildSnapshot({ repositoryRoot: arranged.repo });

    expect(snapshot.ok).toBe(true);
    expect(snapshot.stale).toBe(true);
    expect(snapshot.repositoryRoot).toBe(resolve(arranged.repo));
    expect(snapshot.hiveRoot).toBe(resolve(arranged.hive));
    expect(snapshot.persona).toEqual(PERSONA);
    expect(snapshot.doctor).toMatchObject({
      ok: true,
      hiveReady: false,
      engineRungReady: true,
      ready: false,
    });
    expect(snapshot.doctor.findings).toEqual([
      expect.objectContaining({ code: "budget_unmetered" }),
    ]);
    expect(snapshot.autonomy).toEqual({
      autonomy: "autonomous",
      awayMode: true,
      pollIntervalMs: 15000,
    });
    expect(snapshot.features).toHaveLength(1);
    expect(snapshot.features[0]).toMatchObject({
      featureId: "002-ira-command-center",
      taskCounts: { todo: 1, doing: 1, blocked: 0, done: 1 },
      openAskMe: 1,
      brief: {
        id: "brief_board",
        budgetTokens: null,
        budgetUsd: null,
      },
    });
    const byId = new Map(snapshot.features[0]?.tasks.map((task) => [task.id, task]));
    expect(byId.get("T001")?.status).toBe("doing");
    expect(byId.get("T003")?.readiness).toBe("ready");
    expect(snapshot.agents).toEqual([
      expect.objectContaining({
        id: "agent-host",
        currentTaskId: "T001",
        contextUsedRatio: 0,
        engine: null,
      }),
    ]);
    expect(snapshot.askMe.map((item) => item.id)).toEqual(["ask_board"]);
    expect(snapshot.events.map((event) => event.id)).toEqual(["evt_a", "evt_b"]);
    expect(snapshot.events[1]?.type).toBe("custom.future");
    expect(JSON.stringify(snapshot)).not.toContain("SECRET_OUTSIDE");
    expect(snapshot).not.toHaveProperty("spend");

    await thawTree(arranged.hive);
    expect(await readFile(arranged.ledgerPath, "utf8")).toBe(ledgerBefore);
    expect(await readFile(arranged.eventsPath, "utf8")).toBe(eventsBefore);

    const log = await readFile(arranged.logPath, "utf8");
    expect(log).toContain("doctor");
    expect(log).toContain("hive");
    expect(log).toContain("roster");
    expect(log).toContain("ask-me");
    expect(log).toContain("autonomy");
    expect(log).not.toMatch(/hive init|autonomy set|away |dispatch-task|task hold|task abort/);
  });

  it("keeps coordination visible when only engineRungReady is false", async () => {
    const arranged = await arrangeCli(true, false);
    const snapshot = await buildSnapshot({ repositoryRoot: arranged.repo });

    expect(snapshot.stale).toBe(false);
    expect(snapshot.doctor.hiveReady).toBe(true);
    expect(snapshot.doctor.engineRungReady).toBe(false);
    expect(snapshot.doctor.ready).toBe(true);
    expect(snapshot.features[0]?.tasks.map((task) => task.id)).toEqual(["T000", "T001", "T003"]);
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.askMe).toHaveLength(1);
  });

  it("reads ledger coordination when hive status fails and hiveReady is false", async () => {
    const arranged = await arrangeCli(false, false);
    const responses = coordinationResponses(arranged.hive, arranged.repo, false, false);
    responses["hive status"] = { ok: false, error: "HIVE_CORRUPT", message: "Hive manifest invalid." };
    await writeFile(join(arranged.root, "responses.json"), JSON.stringify(responses));

    const snapshot = await buildSnapshot({ repositoryRoot: arranged.repo });

    expect(snapshot.stale).toBe(true);
    expect(snapshot.doctor.hiveReady).toBe(false);
    expect(snapshot.doctor.engineRungReady).toBe(false);
    expect(snapshot.hiveRoot).toBe(resolve(arranged.hive));
    expect(snapshot.features).toHaveLength(1);
    expect(snapshot.features[0]).toMatchObject({
      featureId: "002-ira-command-center",
      taskCounts: { todo: 1, doing: 1, blocked: 0, done: 1 },
      openAskMe: 1,
    });
    expect(snapshot.features[0]?.tasks.map((task) => task.id)).toEqual(["T000", "T001", "T003"]);
    expect(snapshot.askMe).toHaveLength(1);
    expect(snapshot.events.map((event) => event.id)).toEqual(["evt_a", "evt_b"]);
  });

  it("returns a stale empty board when the CLI cannot be read", async () => {
    const root = await makeTemp("cc-snapshot-down-");
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const { script, logPath } = await writeFakeCli(root, {});
    process.env.SUPERSPEC_BIN = script;
    process.env.FAKE_CLI_JSON = join(root, "responses.json");
    process.env.FAKE_CLI_LOG = logPath;
    process.env.FAKE_CLI_BROKEN = "1";

    const snapshot = await buildSnapshot({ repositoryRoot: repo });

    expect(snapshot.stale).toBe(true);
    expect(snapshot.doctor).toMatchObject({
      ok: false,
      hiveReady: false,
      engineRungReady: false,
      ready: false,
      findings: [],
    });
    expect(snapshot.features).toEqual([]);
    expect(snapshot.agents).toEqual([]);
    expect(snapshot.askMe).toEqual([]);
    expect(snapshot.events).toEqual([]);
    expect(snapshot).not.toHaveProperty("spend");
  });

  it("returns the older event page without changing the live tail default", async () => {
    const arranged = await arrangeCli(true, true);
    const eventsPath = arranged.eventsPath;
    const lines = Array.from({ length: 5 }, (_, index) =>
      JSON.stringify({
        id: `evt_${index}`,
        type: "away.tick",
        version: 1,
        ts: `2026-10-16T12:0${index}:00.000Z`,
        featureId: null,
        actor: { kind: "system", id: "away" },
        data: { n: index },
      }),
    );
    await writeFile(eventsPath, `${lines.join("\n")}\n`);

    const page = await buildSnapshot({
      repositoryRoot: arranged.repo,
      eventsBefore: "evt_3",
      eventLimit: 2,
    });
    const live = await buildSnapshot({ repositoryRoot: arranged.repo });

    expect(page.events.map((event) => event.id)).toEqual(["evt_1", "evt_2"]);
    expect(live.events.map((event) => event.id)).toEqual(["evt_0", "evt_1", "evt_2", "evt_3", "evt_4"]);
  });
});
