import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  onboardProject,
  projectIdFromPath,
  removeConfiguredProject,
  resolveConfiguredProjects,
} from "./projects.js";
import { readFile } from "node:fs/promises";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("projectIdFromPath", () => {
  it("uses explicit id when provided", () => {
    expect(projectIdFromPath("/tmp/foo", "My Repo")).toBe("my-repo");
  });

  it("derives stable id from basename + hash", () => {
    const a = projectIdFromPath("/Users/x/superspec");
    const b = projectIdFromPath("/Users/x/superspec");
    expect(a).toBe(b);
    expect(a).toMatch(/^superspec-/);
  });
});

describe("resolveConfiguredProjects", () => {
  it("loads multiple project paths from ira.config.json", async () => {
    const cockpit = await mkdtemp(join(tmpdir(), "ira-cfg-"));
    temps.push(cockpit);
    const repoA = join(cockpit, "repo-a");
    const repoB = join(cockpit, "repo-b");
    await mkdir(repoA);
    await mkdir(repoB);
    await writeFile(
      join(cockpit, "ira.config.json"),
      JSON.stringify({
        projects: [
          { id: "alpha", name: "Alpha", path: repoA },
          { id: "beta", name: "Beta", path: repoB },
        ],
      }),
      "utf8",
    );

    const projects = await resolveConfiguredProjects(cockpit);
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.id)).toEqual(["alpha", "beta"]);
    expect(projects[0]?.path).toBe(repoA);
    expect(projects[1]?.name).toBe("Beta");
  });

  it("falls back to repositoryRoot when projects[] empty", async () => {
    const cockpit = await mkdtemp(join(tmpdir(), "ira-cfg-"));
    temps.push(cockpit);
    const root = join(cockpit, "only-root");
    await mkdir(root);
    await writeFile(
      join(cockpit, "ira.config.json"),
      JSON.stringify({ repositoryRoot: root }),
      "utf8",
    );

    const projects = await resolveConfiguredProjects(cockpit);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.path).toBe(root);
  });

  it("skips missing paths", async () => {
    const cockpit = await mkdtemp(join(tmpdir(), "ira-cfg-"));
    temps.push(cockpit);
    const ok = join(cockpit, "ok");
    await mkdir(ok);
    await writeFile(
      join(cockpit, "ira.config.json"),
      JSON.stringify({
        projects: [
          { path: ok },
          { path: join(cockpit, "missing-forever") },
        ],
      }),
      "utf8",
    );

    const projects = await resolveConfiguredProjects(cockpit);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.path).toBe(ok);
  });
});

describe("onboardProject / removeConfiguredProject", () => {
  it("persists a new repo path to ira.config.json", async () => {
    const cockpit = await mkdtemp(join(tmpdir(), "ira-onboard-"));
    temps.push(cockpit);
    const first = join(cockpit, "first");
    const second = join(cockpit, "second");
    await mkdir(first);
    await mkdir(second);
    await writeFile(
      join(cockpit, "ira.config.json"),
      JSON.stringify({
        projects: [{ id: "first", name: "First", path: first }],
        voice: { enabled: true },
      }),
      "utf8",
    );

    const added = await onboardProject(cockpit, {
      path: second,
      name: "Second App",
    });
    expect(added.path).toBe(second);
    expect(added.name).toBe("Second App");

    const resolved = await resolveConfiguredProjects(cockpit);
    expect(resolved).toHaveLength(2);
    expect(resolved.some((p) => p.path === second)).toBe(true);

    const saved = JSON.parse(
      await readFile(join(cockpit, "ira.config.json"), "utf8"),
    ) as { projects: unknown[]; voice?: { enabled?: boolean } };
    expect(saved.projects).toHaveLength(2);
    expect(saved.voice?.enabled).toBe(true);

    const publicCopy = JSON.parse(
      await readFile(join(cockpit, "public", "ira.config.json"), "utf8"),
    ) as { projects: unknown[] };
    expect(publicCopy.projects).toHaveLength(2);
  });

  it("rejects missing paths and duplicates", async () => {
    const cockpit = await mkdtemp(join(tmpdir(), "ira-onboard-"));
    temps.push(cockpit);
    const repo = join(cockpit, "repo");
    await mkdir(repo);
    await writeFile(
      join(cockpit, "ira.config.json"),
      JSON.stringify({ projects: [{ path: repo }] }),
      "utf8",
    );

    await expect(
      onboardProject(cockpit, { path: join(cockpit, "nope") }),
    ).rejects.toThrow(/does not exist/);
    await expect(onboardProject(cockpit, { path: repo })).rejects.toThrow(
      /already onboarded/,
    );
  });

  it("removes a project by id", async () => {
    const cockpit = await mkdtemp(join(tmpdir(), "ira-onboard-"));
    temps.push(cockpit);
    const a = join(cockpit, "a");
    const b = join(cockpit, "b");
    await mkdir(a);
    await mkdir(b);
    await writeFile(
      join(cockpit, "ira.config.json"),
      JSON.stringify({
        projects: [
          { id: "a", name: "A", path: a },
          { id: "b", name: "B", path: b },
        ],
      }),
      "utf8",
    );

    const result = await removeConfiguredProject(cockpit, "b");
    expect(result.removed).toBe(true);
    expect(result.projects.map((p) => p.id)).toEqual(["a"]);
  });
});
