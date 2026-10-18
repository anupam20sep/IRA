/**
 * End-to-end feature suite against the Demo Shop example project
 * (fixtures/demo-shop) with Cursor agent integration.
 */
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { writeAgentFile, writeSkillFile } from "./agent-files.js";
import { searchDocs } from "./docs-search.js";
import { detectEngines } from "./engines.js";
import { listFeatureStages } from "./features.js";
import {
  onboardProject,
  removeConfiguredProject,
  resolveConfiguredProjects,
} from "./projects.js";
import { buildCockpitSnapshot, buildProjectSnapshot } from "./snapshot.js";
import { mapSnapshotToLive } from "../store/live-map.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "../../fixtures/demo-shop");

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function cloneFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ira-demo-shop-"));
  temps.push(dir);
  await cp(FIXTURE, dir, { recursive: true });
  return dir;
}

async function cockpitWithProject(projectPath: string): Promise<{
  cockpit: string;
  projectId: string;
}> {
  const cockpit = await mkdtemp(join(tmpdir(), "ira-cockpit-cfg-"));
  temps.push(cockpit);
  await writeFile(
    join(cockpit, "ira.config.json"),
    JSON.stringify({ projects: [] }, null, 2),
    "utf8",
  );
  const project = await onboardProject(cockpit, {
    path: projectPath,
    name: "Demo Shop",
    id: "demo-shop",
  });
  return { cockpit, projectId: project.id };
}

describe("Demo Shop example — full feature suite", () => {
  it("fixture has Cursor agents and specs on disk", async () => {
    const architect = await readFile(
      join(FIXTURE, ".cursor/agents/shop-architect.md"),
      "utf8",
    );
    expect(architect).toContain("name: shop-architect");
    expect(architect).toContain("capabilityTags:");

    const frontend = await readFile(
      join(FIXTURE, ".cursor/agents/shop-frontend.md"),
      "utf8",
    );
    expect(frontend).toContain("shop-frontend");

    const rule = await readFile(join(FIXTURE, ".cursor/rules/ira-demo.mdc"), "utf8");
    expect(rule).toContain("cockpit project root");

    const skill = await readFile(
      join(FIXTURE, "skills/inventory-sync/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("name: inventory-sync");
  });

  it("lists nested specs (not as separate projects)", async () => {
    const stages = await listFeatureStages(FIXTURE);
    expect(stages.map((s) => s.featureId).sort()).toEqual([
      "001-catalog",
      "002-checkout",
    ]);
    const catalog = stages.find((s) => s.featureId === "001-catalog");
    expect(catalog?.hasSpec).toBe(true);
    expect(catalog?.hasDesign).toBe(true);
    expect(catalog?.hasPlan).toBe(true);
    expect(catalog?.hasStatus).toBe(true);
    expect(catalog?.stage).toBe("forge");

    const checkout = stages.find((s) => s.featureId === "002-checkout");
    expect(checkout?.hasPlan).toBe(false);
    expect(checkout?.stage).toBe("architect");
  });

  it("searches docs across specs, docs, and patterns", async () => {
    const bySku = await searchDocs(FIXTURE, "Neon Mug");
    expect(bySku.some((h) => h.path.includes("catalog-overview"))).toBe(true);

    const byCheckout = await searchDocs(FIXTURE, "shipping address");
    expect(byCheckout.some((h) => h.kind === "spec")).toBe(true);

    const byPattern = await searchDocs(FIXTURE, "paginated product");
    expect(byPattern.some((h) => h.kind === "pattern")).toBe(true);
  });

  it("detects engines catalog (host-spawn flags)", async () => {
    const pack = await detectEngines();
    expect(pack.engines.find((e) => e.id === "cursor-agent")?.hostSpawnOnly).toBe(
      true,
    );
  });

  it("onboards Demo Shop from UI API path and builds multi-project snapshot", async () => {
    const shop = await cloneFixture();
    const { cockpit, projectId } = await cockpitWithProject(shop);

    const projects = await resolveConfiguredProjects(cockpit);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe("demo-shop");
    expect(projects[0]?.path).toBe(shop);

    const snapshot = await buildCockpitSnapshot(projects);
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.projects[0]?.id).toBe(projectId);
    expect(snapshot.projects[0]?.specs).toHaveLength(2);

    // Cursor personas discovered via list-personas against the shop root
    const names = snapshot.projects[0]?.personas.map((p) => p.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["shop-architect", "shop-frontend"]));
    expect(
      snapshot.projects[0]?.personas.every((p) => p.source === "cursor"),
    ).toBe(true);

    const mapped = mapSnapshotToLive(snapshot);
    expect(mapped.projects).toHaveLength(1);
    expect(mapped.projects[0]?.specs.map((s) => s.id).sort()).toEqual([
      "001-catalog",
      "002-checkout",
    ]);
    expect(mapped.catalogAgents.some((a) => a.name === "shop-architect")).toBe(
      true,
    );
    expect(mapped.liveMeta.projectCount).toBe(1);

    // Remove via same API used by Setup UI
    const removed = await removeConfiguredProject(cockpit, "demo-shop");
    expect(removed.removed).toBe(true);
    expect(await resolveConfiguredProjects(cockpit)).toHaveLength(0);
  });

  it("writes a new Cursor agent into the onboarded project", async () => {
    const shop = await cloneFixture();
    const path = await writeAgentFile({
      repoRoot: shop,
      harness: "cursor",
      id: "shop-qa",
      name: "Shop QA",
      description: "QA specialist for Demo Shop",
      capabilityTags: "qa, e2e",
      body: "Write regression checks for catalog and checkout.",
    });
    expect(path).toBe(join(shop, ".cursor/agents/shop-qa.md"));
    const text = await readFile(path, "utf8");
    expect(text).toContain("name: shop-qa");
    expect(text).toContain("# Shop QA");

    const snap = await buildProjectSnapshot({
      id: "demo-shop",
      name: "Demo Shop",
      path: shop,
    });
    expect(snap.personas.map((p) => p.name)).toEqual(
      expect.arrayContaining(["shop-architect", "shop-frontend", "shop-qa"]),
    );
  });

  it("writes a skill into the onboarded project", async () => {
    const shop = await cloneFixture();
    const path = await writeSkillFile({
      repoRoot: shop,
      id: "receipt-email",
      name: "Receipt Email",
      description: "Send order confirmation emails",
      body: "## Steps\n1. Render receipt\n2. Send via mailer\n",
    });
    expect(path).toBe(join(shop, "skills/receipt-email/SKILL.md"));
    const text = await readFile(path, "utf8");
    expect(text).toContain("name: receipt-email");
  });

  it("keeps Demo Shop as one project when a second repo is also onboarded", async () => {
    const shop = await cloneFixture();
    const other = await mkdtemp(join(tmpdir(), "ira-other-"));
    temps.push(other);
    await mkdir(join(other, "specs", "lonely"), { recursive: true });
    await writeFile(join(other, "specs", "lonely", "spec.md"), "# Lonely\n", "utf8");
    await writeFile(join(other, "package.json"), '{"name":"other"}', "utf8");

    const cockpit = await mkdtemp(join(tmpdir(), "ira-multi-"));
    temps.push(cockpit);
    await writeFile(join(cockpit, "ira.config.json"), '{"projects":[]}', "utf8");

    await onboardProject(cockpit, { path: shop, id: "demo-shop", name: "Demo Shop" });
    await onboardProject(cockpit, { path: other, id: "other", name: "Other" });

    const snapshot = await buildCockpitSnapshot(
      await resolveConfiguredProjects(cockpit),
    );
    expect(snapshot.projects).toHaveLength(2);
    const demo = snapshot.projects.find((p) => p.id === "demo-shop");
    expect(demo?.specs).toHaveLength(2);
    const mapped = mapSnapshotToLive(snapshot);
    expect(mapped.projects.map((p) => p.id).sort()).toEqual(["demo-shop", "other"]);
    expect(mapped.projects.find((p) => p.id === "demo-shop")?.specs).toHaveLength(2);
  });
});
