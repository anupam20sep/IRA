import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writePatternAtomic,
  readPatternFile,
  listPatternMarkdownFiles,
} from "../../src/learning-memory/pattern-io.js";

const sampleRecord = () => ({
  frontmatter: {
    id: "pat_test1",
    kind: "success" as const,
    createdAt: "2026-10-15T12:00:00.000Z",
    updatedAt: "2026-10-15T12:00:00.000Z",
    signals: { frTags: ["FR-001"], taskKind: "code" as const },
    evidenceRefs: ["task:T001"],
    useCount: 0,
    status: "active" as const,
  },
  summary: "Lesson body",
});

describe("writePatternAtomic", () => {
  it("writes yaml frontmatter and body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lm-io-"));
    const record = sampleRecord();
    await writePatternAtomic(dir, record);
    const text = await readFile(join(dir, "pat_test1.md"), "utf8");
    expect(text).toContain("id: pat_test1");
    expect(text).toContain("Lesson body");
    const round = await readPatternFile(join(dir, "pat_test1.md"));
    expect(round.frontmatter.id).toBe("pat_test1");
  });

  it("rejects unsafe pattern ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lm-io-"));
    const record = sampleRecord();
    record.frontmatter.id = "../evil";
    await expect(writePatternAtomic(dir, record)).rejects.toThrow(/unsafe pattern id/i);
  });
});

describe("listPatternMarkdownFiles", () => {
  it("lists only markdown files in the patterns directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lm-io-"));
    await writeFile(join(dir, "pat_a.md"), "# a\n", "utf8");
    await writeFile(join(dir, "pat_b.md"), "# b\n", "utf8");
    await writeFile(join(dir, "index.sqlite"), "binary", "utf8");
    await writeFile(join(dir, "notes.txt"), "nope", "utf8");

    const listed = await listPatternMarkdownFiles(dir);
    expect(listed.sort()).toEqual([join(dir, "pat_a.md"), join(dir, "pat_b.md")].sort());
  });
});
