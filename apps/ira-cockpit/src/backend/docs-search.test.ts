import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { searchDocs } from "./docs-search.js";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("searchDocs", () => {
  it("finds matching specs and classifies kind", async () => {
    const root = await mkdtemp(join(tmpdir(), "ira-docs-"));
    temps.push(root);
    const feature = join(root, "specs", "auth-refresh");
    await mkdir(feature, { recursive: true });
    await writeFile(
      join(feature, "spec.md"),
      "# Auth refresh\n\nUsers can refresh tokens securely.\n",
      "utf8",
    );
    await writeFile(join(feature, "design.md"), "# Design\nJWT rotation.\n", "utf8");

    const hits = await searchDocs(root, "refresh");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.kind === "spec")).toBe(true);
    expect(hits.every((h) => h.snippet.length > 0)).toBe(true);
  });

  it("returns empty when query misses", async () => {
    const root = await mkdtemp(join(tmpdir(), "ira-docs-"));
    temps.push(root);
    await mkdir(join(root, "specs", "x"), { recursive: true });
    await writeFile(join(root, "specs", "x", "spec.md"), "hello world", "utf8");
    const hits = await searchDocs(root, "zzzz-no-match");
    expect(hits).toEqual([]);
  });

  it("indexes patterns directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "ira-docs-"));
    temps.push(root);
    const patterns = join(root, ".superspec", "patterns");
    await mkdir(patterns, { recursive: true });
    await writeFile(join(patterns, "pat_demo.md"), "fastapi auth pattern", "utf8");
    const hits = await searchDocs(root, "fastapi");
    expect(hits.some((h) => h.kind === "pattern")).toBe(true);
  });
});
