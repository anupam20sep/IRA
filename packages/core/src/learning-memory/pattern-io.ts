import { randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readSkill } from "@superspec-dev/render";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { assertSafePatternId } from "./paths.js";
import { PatternRecordSchema } from "./schema.js";
import type { z } from "zod";

export type PatternRecord = z.infer<typeof PatternRecordSchema>;

function patternFilePath(patternsDir: string, id: string): string {
  return join(patternsDir, `${id}.md`);
}

function serializePatternRecord(record: PatternRecord): string {
  const yaml = stringifyYaml(record.frontmatter).trimEnd();
  return `---\n${yaml}\n---\n${record.summary}`;
}

async function writeFileAtomic(filePath: string, payload: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const handle = await open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } catch (err) {
    await handle.close();
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  await handle.close();
  try {
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** Write one pattern markdown file atomically under `patternsDir`. */
export async function writePatternAtomic(
  patternsDir: string,
  record: PatternRecord,
): Promise<void> {
  assertSafePatternId(record.frontmatter.id);
  PatternRecordSchema.parse(record);
  const filePath = patternFilePath(patternsDir, record.frontmatter.id);
  await writeFileAtomic(filePath, serializePatternRecord(record));
}

/** Read and validate a pattern markdown file. */
export async function readPatternFile(path: string): Promise<PatternRecord> {
  const text = await readFile(path, "utf8");
  const { frontmatter, body } = readSkill(text, basename(path, ".md"));
  if (!frontmatter.trim()) {
    throw new Error(`Pattern file missing YAML frontmatter: ${path}`);
  }
  const parsed = parseYaml(frontmatter);
  return PatternRecordSchema.parse({
    frontmatter: parsed,
    summary: body,
  });
}

/** List absolute paths to `*.md` pattern files in `patternsDir`. */
export async function listPatternMarkdownFiles(patternsDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(patternsDir);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
  return entries
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(patternsDir, name))
    .sort();
}
