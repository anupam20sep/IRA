import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import type { DocHit } from "./types.js";

async function walk(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 8) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".git") continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) await walk(full, out, depth + 1);
    else if (ent.isFile() && /\.(md|txt)$/i.test(ent.name)) out.push(full);
  }
}

function classify(rel: string): DocHit["kind"] {
  const p = rel.replace(/\\/g, "/").toLowerCase();
  if (p.includes("/spec.md") || p.endsWith("spec.md")) return "spec";
  if (p.includes("design.md")) return "design";
  if (p.includes("plan.md")) return "plan";
  if (p.includes(".superspec/patterns/") || p.includes("/patterns/")) return "pattern";
  if (p.includes("readme")) return "readme";
  return "other";
}

export async function searchDocs(
  repoRoot: string,
  query: string,
  limit = 40,
): Promise<DocHit[]> {
  const roots = [
    join(repoRoot, "specs"),
    join(repoRoot, "docs"),
    join(repoRoot, ".superspec", "patterns"),
  ];
  const files: string[] = [];
  for (const r of roots) {
    try {
      const s = await stat(r);
      if (s.isDirectory()) await walk(r, files);
    } catch {
      // missing ok
    }
  }

  const q = query.trim().toLowerCase();
  const hits: DocHit[] = [];
  for (const file of files) {
    if (hits.length >= limit) break;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(repoRoot, file);
    const title = rel.split("/").pop() ?? rel;
    if (q) {
      const hay = `${rel}\n${text}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const idx = q ? text.toLowerCase().indexOf(q) : 0;
    const start = Math.max(0, idx - 40);
    const snippet = text.slice(start, start + 160).replace(/\s+/g, " ").trim();
    hits.push({
      id: rel,
      path: rel,
      kind: classify(rel),
      title: title.replace(extname(title), ""),
      snippet,
    });
  }
  return hits;
}
