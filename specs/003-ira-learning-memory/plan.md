# Ira Learning Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superspec-forge to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-local RETRIEVE → JUDGE → DISTILL → CONSOLIDATE learning memory to `@superspec-dev/core`, persisting canonical pattern markdown under `.superspec/patterns/` with a derived SQLite FTS index, wired into forge MCP/CLI and P-001 `LearningHooks`.

**Architecture:** New `packages/core/src/learning-memory/` modules implement the hybrid store, pipeline orchestration, and read-only query surface. Canonical `*.md` under `.superspec/patterns/` is source of truth; SQLite FTS is a derived index when `better-sqlite3` loads. RETRIEVE, query, and distill read paths use capped markdown scan when the index is unavailable (OD-016). On `record-result`, forge returns success after `saveState` and hive sync without awaiting DISTILL, a distill hard timeout, or CONSOLIDATE; background work is scheduled off the handler stack (OD-016). Until doctor reports `sliceAValidated: true`, distill and consolidate perform no pattern file writes (`SLICE_A_ONLY`; OD-020). P-001 `LearningHooks` call the same pipeline via `installLearningMemory`.

**Tech Stack:** TypeScript 5.5, Node >= 20, ESM, Vitest, Zod, `better-sqlite3` (optional FTS5), existing MCP server in `packages/core`.

## Global Constraints

- Runtime: Node.js >= 20, `"type": "module"`, NodeNext resolution (match `packages/core`).
- Amendment: `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` is LOCKED (OD-016, OD-015, OD-020).
- New runtime dependency: `better-sqlite3` only (design decision); binding MAY fail to load — forge/MCP MUST NOT fail (FR-010, OD-016).
- Storage: canonical markdown `<repository-root>/.superspec/patterns/*.md`; derived index `<repository-root>/.superspec/patterns/index.sqlite` gitignored; config `<repository-root>/.superspec/learning.json`.
- Caps: default `maxInjectionBytes` 2048, `maxSummaryBytes` 1024 (FR-007, SC-005).
- **OD-016:** `record-result` order: forge `saveState` → hive sync (if hive) → return forge success JSON → schedule DISTILL off-stack. Handler MUST NOT `await` DISTILL, distill timeout, or CONSOLIDATE. Distill failure MUST NOT fail `record-result`, roll back forge state, or change exit code after successful save (FR-001a). CONSOLIDATE MUST NOT run on the `record-result` stack (FR-011a).
- **OD-016 index optional:** Missing/unopenable SQLite → log `PATTERNS_INDEX_UNAVAILABLE`; RETRIEVE and query use capped markdown scan; distill writes markdown only (skip index upsert); doctor warns; `patterns reindex` rebuilds when SQLite loads.
- **OD-020 Slice A:** Until `sliceAValidated: true`, distill/consolidate pattern writes are no-op `SLICE_A_ONLY` (no pattern file). Forge `record-result` after `saveState` stays live; deferred distill hook is skipped (no background write). RETRIEVE and read-only query stay live.
- No partial pattern writes on redaction hard-fail; worker chat compaction MUST NOT touch `.superspec/patterns/` (FR-006).
- Hook order when hive present: schedule `LearningHooks.distill` off-stack before `TokenHooks.onRecordResult` when both registered — neither blocks forge success (OD-016); dispatch: `LearningHooks.retrieve` before `TokenHooks.beforeDispatch` (P-001). Hook throws caught at P-001 boundary (OD-015).
- Testing: **Kind: code** tasks use red-green-refactor with `pnpm exec vitest run <file>` from repo root.

---

## Phase 1: Dependencies, paths, and schemas

### Task T001: Add better-sqlite3 and gitignore index artifacts

**Implements:** FR-010

**Depends on:** none

**Kind:** provision

**Complexity:** mechanical

**Complexity rationale:** Deterministic dependency and gitignore checklist from design.md (decision test 1).

**Files:**
- Modify: `packages/core/package.json`
- Modify: `.gitignore`
- Test: (none — verified in T017)

**Interfaces:**
- Consumes: design.md gitignore list for index WAL/SHM/lock files
- Produces: `better-sqlite3` in `dependencies`; gitignore lines for `.superspec/patterns/index.sqlite`, `index.sqlite-wal`, `index.sqlite-shm`, `.superspec/patterns/.index.lock`

- [ ] **Step 1: Provision checklist**

Run: `grep -q 'better-sqlite3' packages/core/package.json || echo NEED_DEP`
Expected: after edit, `pnpm install` at repo root completes without error

- [ ] **Step 2: Append gitignore entries**

Add exact paths from design.md Decision “Gitignore derived index only”.

- [ ] **Step 3: Install and lock**

Run: `pnpm install`
Expected: lockfile updated; `node -e "import('better-sqlite3').then(()=>console.log('ok'))"` prints `ok`

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml .gitignore
git commit -m "chore(learning-memory): add better-sqlite3 and gitignore pattern index"
```

---

### Task T002: Pattern store path resolution

**Implements:** FR-002, FR-006, FR-010

**Depends on:** none

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Repository root resolution must match forge/spec dirs and reject traversal (decision test 3).

**Files:**
- Create: `packages/core/src/learning-memory/paths.ts`
- Test: `packages/core/test/learning-memory/paths.test.ts`

**Interfaces:**
- Consumes: `cwd`, optional `process.env.SUPERSPEC_ROOT`
- Produces: `resolvePatternStoreRoot(cwd: string): { ok: true; repositoryRoot: string; patternsDir: string; indexPath: string; lockPath: string } | { ok: false; code: "PATTERNS_ROOT_UNRESOLVED"; message: string }`; `assertSafePatternId(id: string): void`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePatternStoreRoot, assertSafePatternId } from "../../src/learning-memory/paths.js";

describe("resolvePatternStoreRoot", () => {
  it("resolves patterns dir under repo with program.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "lm-root-"));
    await writeFile(join(root, "program.md"), "# program\n");
    const r = resolvePatternStoreRoot(root);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patternsDir).toBe(join(root, ".superspec", "patterns"));
      expect(r.indexPath).toBe(join(root, ".superspec", "patterns", "index.sqlite"));
    }
  });

  it("rejects unsafe pattern ids", () => {
    expect(() => assertSafePatternId("../evil")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/paths.test.ts`
Expected: FAIL with cannot find module `learning-memory/paths.js`

- [ ] **Step 3: Write minimal implementation**

Implement walk to repository root (reuse or mirror `command-plane/paths` when present); return paths per design.md; reject `..` in pattern ids.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/paths.ts packages/core/test/learning-memory/paths.test.ts
git commit -m "feat(learning-memory): resolve pattern store paths for FR-002"
```

---

### Task T003: Pattern Zod schemas and shared types

**Implements:** FR-005, FR-013, FR-010, FR-012

**Depends on:** none

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Multi-field zod frontmatter and query DTOs from design data model (decision tests 1–2).

**Files:**
- Create: `packages/core/src/learning-memory/schema.ts`
- Create: `packages/core/src/learning-memory/types.ts`
- Test: `packages/core/test/learning-memory/schema.test.ts`

**Interfaces:**
- Consumes: design.md Pattern / RetrieveContext / InjectionSummary / DistillContext field names
- Produces: `PatternFrontmatterSchema`, `PatternRecordSchema`, `PatternsListQuerySchema`, `PatternsListResponseSchema`; exported types `PatternKind`, `PatternStatus`, `RetrieveContext`, `InjectionSummary`, `DistillContext`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { PatternFrontmatterSchema } from "../../src/learning-memory/schema.js";

describe("PatternFrontmatterSchema", () => {
  it("parses active failure pattern with evidence refs", () => {
    const parsed = PatternFrontmatterSchema.parse({
      id: "pat_01JABC",
      kind: "failure",
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
      signals: { frTags: ["FR-012"], taskKind: "code", featureId: "003-ira-learning-memory" },
      evidenceRefs: ["task:T004"],
      useCount: 0,
      status: "active",
    });
    expect(parsed.kind).toBe("failure");
    expect(parsed.signals.frTags).toEqual(["FR-012"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/schema.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement zod schemas for frontmatter, full pattern record, MCP list query/response per design.md Contracts.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/schema.ts packages/core/src/learning-memory/types.ts packages/core/test/learning-memory/schema.test.ts
git commit -m "feat(learning-memory): add pattern zod schemas for FR-005"
```

---

### Task T004: Learning configuration loader

**Implements:** FR-014

**Depends on:** T003

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Defaults from design `learning.json` with feature overrides (decision test 1).

**Files:**
- Create: `packages/core/src/learning-memory/config.ts`
- Test: `packages/core/test/learning-memory/config.test.ts`

**Interfaces:**
- Consumes: `repositoryRoot`, optional file at `.superspec/learning.json`
- Produces: `loadLearningConfig(repositoryRoot: string): LearningConfig` with `enabled`, `retrieve`, `distillEnabled`, caps, `judgeMinScore`, per-feature overrides; `isFeatureDistillEnabled(config, featureId): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadLearningConfig, isFeatureDistillEnabled } from "../../src/learning-memory/config.js";

describe("loadLearningConfig", () => {
  it("defaults enabled when file missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "lm-cfg-"));
    const cfg = await loadLearningConfig(root);
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxInjectionBytes).toBe(2048);
  });

  it("honors per-feature distill disable", async () => {
    const root = await mkdtemp(join(tmpdir(), "lm-cfg2-"));
    await mkdir(join(root, ".superspec"), { recursive: true });
    await writeFile(
      join(root, ".superspec", "learning.json"),
      JSON.stringify({ features: { "003-ira-learning-memory": { distillEnabled: false } } }),
    );
    const cfg = await loadLearningConfig(root);
    expect(isFeatureDistillEnabled(cfg, "003-ira-learning-memory")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/config.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Parse JSON with zod; apply defaults from design.md; never delete patterns when disabled.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/config.ts packages/core/test/learning-memory/config.test.ts
git commit -m "feat(learning-memory): load learning.json config for FR-014"
```

---

## Phase 2: Storage, redaction, and retrieval core

### Task T005: Secret redaction before persist

**Implements:** FR-007

**Depends on:** none

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Credential detectors and skip-write policy (decision test 2).

**Files:**
- Create: `packages/core/src/learning-memory/redact.ts`
- Test: `packages/core/test/learning-memory/distill-redact.test.ts` (redact section)

**Interfaces:**
- Consumes: raw summary string
- Produces: `redactPatternSummary(input: string): { ok: true; text: string } | { ok: false; reason: "SECRET_DETECTED" }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { redactPatternSummary } from "../../src/learning-memory/redact.js";

describe("redactPatternSummary", () => {
  it("rejects api-key-like strings", () => {
    const r = redactPatternSummary("Use sk-live-abcdefghijklmnopqrstuvwxyz1234567890");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("SECRET_DETECTED");
  });

  it("passes clean lesson text", () => {
    const r = redactPatternSummary("Prefer atomic writes when updating forge state.");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain("atomic writes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/distill-redact.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement regex/heuristic detectors for API keys, bearer tokens, `AKIA` prefixes; trim to `maxSummaryBytes` at call sites.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/distill-redact.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/redact.ts packages/core/test/learning-memory/distill-redact.test.ts
git commit -m "feat(learning-memory): redact secrets before pattern persist for FR-007"
```

---

### Task T006: Atomic markdown pattern I/O

**Implements:** FR-002, FR-010, FR-013

**Depends on:** T002, T003

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Frontmatter parse/write with atomic rename (decision test 2).

**Files:**
- Create: `packages/core/src/learning-memory/pattern-io.ts`
- Test: `packages/core/test/learning-memory/pattern-io.test.ts`

**Interfaces:**
- Consumes: `patternsDir`, `PatternRecord`
- Produces: `writePatternAtomic(patternsDir, record): Promise<void>`; `readPatternFile(path): Promise<PatternRecord>`; `listPatternMarkdownFiles(patternsDir): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writePatternAtomic, readPatternFile } from "../../src/learning-memory/pattern-io.js";

describe("writePatternAtomic", () => {
  it("writes yaml frontmatter and body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lm-io-"));
    const record = {
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
    };
    await writePatternAtomic(dir, record);
    const text = await readFile(join(dir, "pat_test1.md"), "utf8");
    expect(text).toContain("id: pat_test1");
    expect(text).toContain("Lesson body");
    const round = await readPatternFile(join(dir, "pat_test1.md"));
    expect(round.frontmatter.id).toBe("pat_test1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/pattern-io.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Temp file + rename; yaml frontmatter via existing `yaml` package; enforce `assertSafePatternId`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/pattern-io.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/pattern-io.ts packages/core/test/learning-memory/pattern-io.test.ts
git commit -m "feat(learning-memory): atomic markdown pattern I/O for FR-010"
```

---

### Task T007: SQLite FTS index, optional load, and rebuild

**Implements:** FR-010, FR-005

**Depends on:** T002, T003, T006

**Kind:** code

**Complexity:** complex

**Complexity rationale:** FTS5 schema, graceful degrade when native binding fails, rebuild-from-markdown invariant (OD-016).

**Files:**
- Create: `packages/core/src/learning-memory/index-sqlite.ts`
- Create: `packages/core/src/learning-memory/pattern-index.ts`
- Test: `packages/core/test/learning-memory/index-rebuild.test.ts`

**Interfaces:**
- Consumes: `indexPath`, `lockPath`, pattern records or markdown scan
- Produces: `openPatternIndex(paths): { index: PatternIndex | null; indexAvailable: boolean; unavailableReason?: "BINDING_MISSING" | "OPEN_FAILED" }`; `upsertPattern(index, record): void`; `searchPatterns(index, query): PatternSearchHit[]`; `reindexFromMarkdown(patternsDir, indexPath): ReindexReport`; log token `PATTERNS_INDEX_UNAVAILABLE` when `indexAvailable` is false

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openPatternIndex, reindexFromMarkdown } from "../../src/learning-memory/index-sqlite.js";
import { writePatternAtomic } from "../../src/learning-memory/pattern-io.js";

describe("reindexFromMarkdown", () => {
  it("rebuilds FTS rows from canonical md files", async () => {
    const root = await mkdtemp(join(tmpdir(), "lm-idx-"));
    const patternsDir = join(root, "patterns");
    await writePatternAtomic(patternsDir, {
      frontmatter: {
        id: "pat_idx1",
        kind: "failure",
        createdAt: "2026-10-15T12:00:00.000Z",
        updatedAt: "2026-10-15T12:00:00.000Z",
        signals: { frTags: ["FR-012"], taskKind: "code" },
        evidenceRefs: ["task:T002"],
        useCount: 0,
        status: "active",
      },
      summary: "Always lint plan before route.",
    });
    const indexPath = join(root, "index.sqlite");
    const lockPath = join(root, ".index.lock");
    const report = reindexFromMarkdown(patternsDir, indexPath, lockPath);
    expect(report.indexed).toBe(1);
    const db = openPatternIndex({ indexPath, lockPath });
    const hits = db.search({ frTag: "FR-012", limit: 5 });
    expect(hits.some((h) => h.id === "pat_idx1")).toBe(true);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/index-rebuild.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Create `patterns_meta`, `patterns_fts` FTS5, `patterns_signals`; exclusive lock file; upsert on write path. Wrap `better-sqlite3` import in try/catch; `pattern-index.ts` exposes `indexAvailable` without throwing to forge callers.

- [ ] **Step 3b: Write failing test for missing binding**

Add to `index-rebuild.test.ts`:

```ts
describe("openPatternIndex degrade", () => {
  it("returns indexAvailable false when binding cannot load", () => {
    const opened = openPatternIndexWithLoader({ indexPath: "/tmp/x.sqlite", lockPath: "/tmp/.lock" }, () => {
      throw new Error("dlopen failed");
    });
    expect(opened.indexAvailable).toBe(false);
    expect(opened.index).toBeNull();
  });
});
```

Run: `pnpm exec vitest run packages/core/test/learning-memory/index-rebuild.test.ts`
Expected: FAIL until loader hook implemented

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/index-rebuild.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/index-sqlite.ts packages/core/src/learning-memory/pattern-index.ts packages/core/test/learning-memory/index-rebuild.test.ts
git commit -m "feat(learning-memory): optional SQLite FTS index and reindex for FR-010"
```

---

### Task T008: JUDGE scoring and injection cap

**Implements:** FR-008, SC-005

**Depends on:** T003, T004

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Relevance threshold and byte cap enforcement (decision test 2).

**Files:**
- Create: `packages/core/src/learning-memory/judge.ts`
- Test: `packages/core/test/learning-memory/retrieve-judge.test.ts` (judge section)

**Interfaces:**
- Consumes: ranked candidates, `LearningConfig`, `RetrieveContext`
- Produces: `judgePatterns(candidates, ctx, config): InjectionSummary | null` with `text` and `patternIds`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { judgePatterns } from "../../src/learning-memory/judge.js";

describe("judgePatterns", () => {
  it("drops candidates below min score and enforces byte cap", () => {
    const config = {
      enabled: true,
      retrieve: true,
      distillEnabled: true,
      maxInjectionBytes: 50,
      maxSummaryBytes: 1024,
      judgeMinScore: 0.9,
      distill: { mode: "heuristic" as const },
      features: {},
    };
    const ctx = { taskId: "T001", implementsFr: ["FR-003"], kind: "code" as const };
    const summary = judgePatterns(
      [
        { id: "pat_a", score: 0.2, summary: "noise" },
        { id: "pat_b", score: 0.95, summary: "Short high-value hint." },
      ],
      ctx,
      config,
    );
    expect(summary?.patternIds).toEqual(["pat_b"]);
    expect(Buffer.byteLength(summary!.text, "utf8")).toBeLessThanOrEqual(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/retrieve-judge.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Score by FR tag overlap + FTS rank; sort desc; accumulate until cap.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/retrieve-judge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/judge.ts packages/core/test/learning-memory/retrieve-judge.test.ts
git commit -m "feat(learning-memory): JUDGE relevance and injection cap for FR-008"
```

---

### Task T009: RETRIEVE from FTS or capped markdown scan

**Implements:** FR-003, FR-005, FR-010

**Depends on:** T007, T008, T006

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Signal prefilter plus FTS ranking; capped markdown scan when `indexAvailable` is false (OD-016).

**Files:**
- Create: `packages/core/src/learning-memory/retrieve.ts`
- Create: `packages/core/src/learning-memory/markdown-scan.ts`
- Modify: `packages/core/test/learning-memory/retrieve-judge.test.ts`

**Interfaces:**
- Consumes: `PatternIndex | null`, `patternsDir`, `indexAvailable`, `RetrieveContext`, `LearningConfig`
- Produces: `retrievePatterns(store, ctx, config): Promise<InjectionSummary | null>` — FTS path when index loads; else `scanMarkdownCandidates(patternsDir, ctx, { maxFiles: 200 })` then `judgePatterns`; MUST NOT throw when SQLite absent

- [ ] **Step 1: Write the failing test**

Add to `retrieve-judge.test.ts`:

```ts
import { retrievePatterns } from "../../src/learning-memory/retrieve.js";

describe("retrievePatterns", () => {
  it("returns null when store empty without error", async () => {
    // use temp index with zero rows — fixture helper from test util
    const summary = await retrievePatterns(emptyIndexFixture(), {
      taskId: "T009",
      implementsFr: ["FR-999"],
      kind: "code",
    }, defaultConfig());
    expect(summary).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/retrieve-judge.test.ts`
Expected: FAIL `retrievePatterns` not defined

- [ ] **Step 3: Write minimal implementation**

Build `RetrieveContext` from plan task; query FTS + fr_tag table when index loads; exclude `status=archived` by default. When `indexAvailable` is false, scan frontmatter from `*.md` up to file budget; same injection caps as FTS path.

- [ ] **Step 3b: Write failing markdown-scan test**

```ts
describe("retrievePatterns markdown fallback", () => {
  it("returns judged summary from md files when index unavailable", async () => {
    const repo = await seedMarkdownOnlyStore({ frTag: "FR-012" });
    const summary = await retrievePatterns(
      { index: null, indexAvailable: false, patternsDir: repo.patternsDir },
      { taskId: "T009", implementsFr: ["FR-012"], kind: "code" },
      defaultConfig(),
    );
    expect(summary?.patternIds.length).toBeGreaterThan(0);
  });
});
```

Run: `pnpm exec vitest run packages/core/test/learning-memory/retrieve-judge.test.ts`
Expected: FAIL until markdown-scan exists

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/retrieve-judge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/retrieve.ts packages/core/src/learning-memory/markdown-scan.ts packages/core/test/learning-memory/retrieve-judge.test.ts
git commit -m "feat(learning-memory): RETRIEVE with markdown fallback for FR-010"
```

---

## Phase 3: DISTILL, CONSOLIDATE, pipeline, hooks

### Task T010: CONSOLIDATE merge and archive demotion

**Implements:** FR-009, SC-004

**Depends on:** T006, T007, T020

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** 80% overlap merge within signal bucket (decision test 2).

**Files:**
- Create: `packages/core/src/learning-memory/consolidate.ts`
- Test: `packages/core/test/learning-memory/consolidate.test.ts`

**Interfaces:**
- Consumes: `patternsDir`, `PatternIndex`, new pattern id
- Produces: `consolidateAfterDistill(store, newId): Promise<ConsolidateResult>` merging duplicates per design acceptance scenario

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { consolidateBucket } from "../../src/learning-memory/consolidate.js";

describe("consolidateBucket", () => {
  it("merges summaries with >=80% token overlap", () => {
    const result = consolidateBucket(
      [
        { id: "pat_old", summary: "Use vitest for core unit tests always", signalsKey: "FR-001|code" },
        { id: "pat_new", summary: "Use vitest for core unit tests always!", signalsKey: "FR-001|code" },
      ],
      "pat_new",
    );
    expect(result.canonicalId).toBe("pat_new");
    expect(result.archivedIds).toContain("pat_old");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/consolidate.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Token-set Jaccard ≥ 0.8; update `useCount`; set loser `status=archived` in frontmatter + index.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/consolidate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/consolidate.ts packages/core/test/learning-memory/consolidate.test.ts
git commit -m "feat(learning-memory): CONSOLIDATE duplicate patterns for FR-009"
```

---

### Task T011: DISTILL heuristic extractor

**Implements:** FR-001, FR-004, FR-007, FR-013, FR-010

**Depends on:** T005, T006, T007, T004, T020

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Outcome classification, report path ingestion, optional model path gated by config (decision test 3).

**Files:**
- Create: `packages/core/src/learning-memory/distill.ts`
- Modify: `packages/core/test/learning-memory/distill-redact.test.ts`

**Interfaces:**
- Consumes: `DistillContext`, report file paths, plan task metadata
- Produces: `distillPattern(ctx, store, config): Promise<{ written: boolean; patternId?: string; skipReason?: string }>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { distillPattern } from "../../src/learning-memory/distill.js";

describe("distillPattern", () => {
  it("writes success pattern from passing task context", async () => {
    const store = await makeTempStoreFixture();
    const result = await distillPattern(
      {
        featureId: "003-ira-learning-memory",
        taskId: "T011",
        passed: true,
        kind: "code",
        implementsFr: ["FR-001"],
        implementerReport: undefined,
        reviewerReport: undefined,
      },
      store,
      defaultConfig(),
    );
    expect(result.written).toBe(true);
    expect(result.patternId).toMatch(/^pat_/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/distill-redact.test.ts`
Expected: FAIL `distillPattern` not exported

- [ ] **Step 3: Write minimal implementation**

Heuristic bullets from reviewer/implementer reports when present; classify `kind`; call `resolvePatternWriteGate` — when `SLICE_A_ONLY`, return `{ written: false, skipReason: "SLICE_A_ONLY" }` with no file I/O. Otherwise redact + pattern-io; upsert index only when `indexAvailable`; never write transcripts.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/distill-redact.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/distill.ts packages/core/test/learning-memory/distill-redact.test.ts
git commit -m "feat(learning-memory): DISTILL forge outcomes for FR-001"
```

---

### Task T020: Slice A pattern write gate (OD-020)

**Implements:** FR-001, FR-009, FR-010

**Depends on:** T004, T002

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Doctor snapshot `sliceAValidated` gates distill/consolidate writes without blocking forge save (OD-020).

**Files:**
- Create: `packages/core/src/learning-memory/slice-gate.ts`
- Test: `packages/core/test/learning-memory/slice-gate.test.ts`

**Interfaces:**
- Consumes: `{ sliceAValidated: boolean }` from doctor snapshot or test stub
- Produces: `resolvePatternWriteGate(snapshot): { allowed: true } | { allowed: false; code: "SLICE_A_ONLY" }`; `registerPatternsDoctorProbes(installCtx)` adds warning `PATTERNS_INDEX_UNAVAILABLE` when index unavailable (severity `warn`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolvePatternWriteGate } from "../../src/learning-memory/slice-gate.js";

describe("resolvePatternWriteGate", () => {
  it("denies writes until sliceAValidated", () => {
    const r = resolvePatternWriteGate({ sliceAValidated: false });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("SLICE_A_ONLY");
  });

  it("allows writes after sliceAValidated", () => {
    expect(resolvePatternWriteGate({ sliceAValidated: true }).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/slice-gate.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Pure gate function; no filesystem writes when denied. Wire doctor probe registration stub in `install.ts` for index-unavailable warning (full doctor integration when P-001 hive present).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/slice-gate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/slice-gate.ts packages/core/test/learning-memory/slice-gate.test.ts packages/core/src/learning-memory/install.ts
git commit -m "feat(learning-memory): Slice A write gate for OD-020"
```

---

### Task T012: Pipeline orchestration and error isolation

**Implements:** FR-004, FR-011, FR-001a, FR-011a

**Depends on:** T009, T010, T011, T020

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Phase ordering, try/catch around distill, serialized writes (decision test 3).

**Files:**
- Create: `packages/core/src/learning-memory/pipeline.ts`
- Create: `packages/core/src/learning-memory/index.ts` (module barrel partial)
- Test: `packages/core/test/learning-memory/pipeline.test.ts`

**Interfaces:**
- Consumes: `LearningStore` handle, config, contexts, doctor snapshot for write gate
- Produces: `runRetrieveForTask(store, ctx): Promise<InjectionSummary | null>`; `runDistillAfterResult(store, ctx): Promise<void>` (background only — logs failures, never throws to forge); `runConsolidateAfterDistill(store, patternId): Promise<void>` (off-stack only); `scheduleLearningAfterRecordResult(root, ctx): void` uses `setImmediate` (or equivalent) to run distill → consolidate chain without returning a Promise the MCP handler awaits (OD-016)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { runDistillAfterResult } from "../../src/learning-memory/pipeline.js";

describe("runDistillAfterResult", () => {
  it("swallows distill errors without throwing", async () => {
    const store = {
      distill: vi.fn().mockRejectedValue(new Error("engine down")),
    };
    await expect(
      runDistillAfterResult(store as never, { taskId: "T1", passed: true } as never),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/pipeline.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Wire retrieve → judge and distill → consolidate; mutex per repository for writes; stderr log `learning.phase=*`. `scheduleLearningAfterRecordResult` MUST NOT be awaited on the `record-result` handler stack. Background distill hard timeout abandons work with log only (FR-001a). CONSOLIDATE runs only after async DISTILL in the same off-stack chain, never before forge return (FR-011a).

- [ ] **Step 3b: Write failing test that scheduler does not return an awaitable to handlers**

```ts
describe("scheduleLearningAfterRecordResult", () => {
  it("returns void and runs distill on next tick", async () => {
    const fn = vi.fn();
    scheduleLearningAfterRecordResult(root, ctx, { runDistill: fn });
    expect(fn).not.toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(fn).toHaveBeenCalled();
  });
});
```

Run: `pnpm exec vitest run packages/core/test/learning-memory/pipeline.test.ts`
Expected: FAIL until scheduler implemented

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/pipeline.ts packages/core/src/learning-memory/index.ts packages/core/test/learning-memory/pipeline.test.ts
git commit -m "feat(learning-memory): off-stack pipeline orchestration for OD-016"
```

---

### Task T013: LearningHooks adapter and install

**Implements:** FR-011, FR-003, FR-001

**Depends on:** T012

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Implements P-001 `LearningHooks` contract and registration (decision test 2).

**Files:**
- Create: `packages/core/src/learning-memory/hooks.ts`
- Create: `packages/core/src/learning-memory/install.ts`
- Test: `packages/core/test/learning-memory/hooks-adapter.test.ts`

**Interfaces:**
- Consumes: `registerCommandPlaneHooks`, `LearningHooks`, `RetrieveContext`, `DistillContext` from `packages/core/src/command-plane/hooks.js`
- Produces: `createLearningHooks(projectRoot): LearningHooks`; `installLearningMemory(opts: { projectRoot: string }): void`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createLearningHooks } from "../../src/learning-memory/hooks.js";

describe("createLearningHooks", () => {
  it("exposes retrieve and distill functions", async () => {
    const hooks = createLearningHooks(await tempRepoRoot());
    expect(typeof hooks.retrieve).toBe("function");
    expect(typeof hooks.distill).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/hooks-adapter.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Delegate to `pipeline.ts`; register via `registerCommandPlaneHooks({ learning: hooks })` in `install.ts` when command-plane module loads.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/hooks-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/hooks.ts packages/core/src/learning-memory/install.ts packages/core/test/learning-memory/hooks-adapter.test.ts
git commit -m "feat(learning-memory): LearningHooks adapter for P-001 FR-011"
```

---

## Phase 4: Forge wiring, query surface, integration

### Task T014: Wire retrieve and distill into forge MCP/CLI

**Implements:** FR-003, FR-011, FR-001, FR-001a, FR-011a

**Depends on:** T013, T009, T012

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Cross-cutting edits to `cli.ts`, `mcp-server.ts`, `model-router.ts`, `coordinator-ledger.ts` (decision test 3).

**Files:**
- Modify: `packages/core/src/cli.ts` (`begin-task`, `record-result`, `route-model` handler paths)
- Modify: `packages/core/src/mcp-server.ts` (same tools + optional args)
- Modify: `packages/core/src/model-router.ts` (additive `patternHint`, `patternIds`)
- Modify: `packages/core/src/coordinator-ledger.ts` (Prior patterns section)
- Modify: `packages/core/src/cli-output.ts` (begin-task / record-result verbose lines)
- Test: `packages/core/test/learning-memory/hooks-forge.test.ts`

**Interfaces:**
- Consumes: `runRetrieveForTask`, `runDistillAfterResult`, `loadLearningConfig`, plan task lookup from `parsePlan`
- Produces: begin-task report section `## Prior patterns (learning memory)`; `record-result` returns forge JSON before background distill starts; exit code unchanged when background distill fails; route-model JSON additive fields per design.md

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { runCli } from "../../src/cli.js";

describe("forge learning hooks", () => {
  it("begin-task includes prior patterns when store seeded", async () => {
    const { stdout } = await runCli(["begin-task", "--plan", planPath, "--dir", specDir, "--task", "T001", "-v"]);
    expect(stdout).toContain("Prior patterns");
  });

  it("record-result returns success before a slow distill completes", async () => {
    const t0 = Date.now();
    const { code } = await runCli(["record-result", "--plan", planPath, "--dir", specDir, "--task", "T001", "--passed"]);
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/hooks-forge.test.ts`
Expected: FAIL (missing Prior patterns section)

- [ ] **Step 3: Write minimal implementation**

On `begin-task`, after `saveState`, call `runRetrieveForTask` when config enabled (sync on retrieve path is allowed). On `record-result`: forge `saveState` → hive sync → **return** success JSON → call `scheduleLearningAfterRecordResult` without `await`. Pass report paths into `DistillContext`. When Slice A write gate denies, skip scheduling distill write (log `SLICE_A_ONLY`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/hooks-forge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli.ts packages/core/src/mcp-server.ts packages/core/src/model-router.ts packages/core/src/coordinator-ledger.ts packages/core/src/cli-output.ts packages/core/test/learning-memory/hooks-forge.test.ts
git commit -m "feat(learning-memory): non-blocking forge wiring for OD-016"
```

---

### Task T021: OD-016 and Slice A integration proofs

**Implements:** FR-001, FR-001a, FR-011a, FR-010

**Depends on:** T014, T020

**Kind:** code

**Complexity:** complex

**Complexity rationale:** End-to-end proofs for non-blocking return, distill failure isolation, markdown-only repo, and Slice A no-write (OD-016, OD-020).

**Files:**
- Modify: `packages/core/test/learning-memory/hooks-forge.test.ts`
- Modify: `packages/core/test/learning-memory/pipeline.test.ts`

**Interfaces:**
- Consumes: forge CLI/MCP harness, stub doctor `{ sliceAValidated: false | true }`, mock slow distill
- Produces: tests proving forge exit 0 when distill throws off-stack; zero new `*.md` under Slice A; RETRIEVE succeeds with `indexAvailable: false`

- [ ] **Step 1: Write the failing test**

```ts
describe("OD-016 record-result isolation", () => {
  it("does not change exit code when background distill throws", async () => {
    await withSlowDistillMock(async () => {
      const { code } = await runRecordResultFixture({ passed: true });
      expect(code).toBe(0);
    });
  });
});

describe("OD-020 Slice A distill", () => {
  it("writes no pattern md when sliceAValidated is false", async () => {
    await withDoctorSnapshot({ sliceAValidated: false }, async () => {
      await runRecordResultFixture({ passed: true });
      expect(await countPatternMarkdown(repoRoot)).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/hooks-forge.test.ts packages/core/test/learning-memory/pipeline.test.ts`
Expected: FAIL until fixtures exist

- [ ] **Step 3: Write minimal test fixtures**

Stub doctor snapshot injection; hang distill beyond handler return; count files in `.superspec/patterns/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/hooks-forge.test.ts packages/core/test/learning-memory/pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/learning-memory/hooks-forge.test.ts packages/core/test/learning-memory/pipeline.test.ts
git commit -m "test(learning-memory): OD-016 and Slice A integration proofs"
```

---

### Task T015: Read-only pattern query module

**Implements:** FR-012, SC-007, FR-010

**Depends on:** T007, T003, T006, T009

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Pagination and partial results on corrupt index (decision test 2).

**Files:**
- Create: `packages/core/src/learning-memory/query.ts`
- Test: `packages/core/test/learning-memory/query-contract.test.ts`

**Interfaces:**
- Consumes: `PatternsListQuery`, open index
- Produces: `listPatterns(query): PatternsListResponse` with `PATTERNS_STORE_UNREADABLE` warnings path

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { listPatterns } from "../../src/learning-memory/query.js";

describe("listPatterns", () => {
  it("filters by featureId and frTag", async () => {
    const res = await listPatterns({
      projectRoot: seededRepo,
      featureId: "003-ira-learning-memory",
      frTag: "FR-012",
      limit: 20,
    });
    expect(res.patterns.every((p) => p.signals.frTags.includes("FR-012"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/query-contract.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Map to design MCP response shape; `summaryPreview` first 240 chars. When SQLite unavailable, list/filter via capped markdown scan (same budget as RETRIEVE); MUST NOT fail MCP/CLI call.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/query-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/learning-memory/query.ts packages/core/test/learning-memory/query-contract.test.ts
git commit -m "feat(learning-memory): read-only query with markdown fallback for FR-012"
```

---

### Task T016: CLI patterns subcommands and MCP patterns-list

**Implements:** FR-012, FR-011

**Depends on:** T015

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** JSON stdout parity between CLI and MCP (decision test 2).

**Files:**
- Modify: `packages/core/src/cli.ts` (`patterns list|show|reindex`)
- Modify: `packages/core/src/mcp-server.ts` (`patterns-list` tool)
- Test: extend `packages/core/test/learning-memory/query-contract.test.ts`

**Interfaces:**
- Consumes: `listPatterns`, `showPattern`, `reindexFromMarkdown`
- Produces: MCP tool schema per design.md; CLI help text includes `patterns`

- [ ] **Step 1: Write the failing test**

```ts
describe("patterns-list MCP", () => {
  it("returns JSON matching query module", async () => {
    const res = await invokeMcpTool("patterns-list", { projectRoot: seededRepo, limit: 5 });
    expect(res.patterns).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/query-contract.test.ts`
Expected: FAIL unknown tool patterns-list

- [ ] **Step 3: Write minimal implementation**

Register tool; wire CLI command branch; update unknown-command help string.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/query-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli.ts packages/core/src/mcp-server.ts packages/core/test/learning-memory/query-contract.test.ts
git commit -m "feat(learning-memory): patterns-list MCP and CLI for FR-012"
```

---

### Task T017: Compaction survival integration test

**Implements:** FR-006, SC-003

**Depends on:** T021

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Simulates repeated state dir resets while pattern dir persists (decision test 3).

**Files:**
- Modify: `packages/core/test/learning-memory/hooks-forge.test.ts`

**Interfaces:**
- Consumes: forge state save/load helpers
- Produces: test proving pattern markdown count unchanged after 10 simulated compactions

- [ ] **Step 1: Write the failing test**

```ts
describe("pattern store survives forge state compaction", () => {
  it("retains patterns after ten state re-inits", async () => {
    await distillOnePattern(specDir, { sliceAValidated: true });
    for (let i = 0; i < 10; i++) {
      await rm(stateFile, { force: true });
      await saveState(specDir, initState(tasks));
    }
    const listed = await listPatterns({ projectRoot: repoRoot, limit: 10 });
    expect(listed.patterns.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/hooks-forge.test.ts`
Expected: FAIL test not found or assertion fails

- [ ] **Step 3: Write minimal test fixtures**

Ensure pattern store path is repo-root scoped, not under spec `.superspec/state.json` dir only.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/hooks-forge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/learning-memory/hooks-forge.test.ts
git commit -m "test(learning-memory): patterns survive forge compaction for FR-006"
```

---

### Task T018: Public API exports

**Implements:** FR-011, FR-012

**Depends on:** T016

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Re-export decided surface from package entry (decision test 1).

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/learning-memory/index.ts`

**Interfaces:**
- Produces: exports for `installLearningMemory`, `createLearningHooks`, `listPatterns`, `reindexFromMarkdown`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { installLearningMemory, listPatterns } from "@superspec-dev/core";

describe("package exports", () => {
  it("exports learning memory entrypoints", () => {
    expect(typeof installLearningMemory).toBe("function");
    expect(typeof listPatterns).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/learning-memory/exports.test.ts`
Expected: FAIL export missing

- [ ] **Step 3: Write minimal implementation**

Re-export from `learning-memory/index.ts` via root `index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/learning-memory/exports.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/learning-memory/index.ts packages/core/test/learning-memory/exports.test.ts
git commit -m "feat(learning-memory): export public API from core package"
```

---

### Task T019: Feature verify gate

**Implements:** FR-001, FR-001a, FR-003, FR-004, FR-006, FR-010, FR-011, FR-011a, FR-012, SC-001, SC-002, SC-004, SC-005, SC-006, SC-007

**Depends on:** T017, T018, T021

**Kind:** verify

**Complexity:** mechanical

**Complexity rationale:** Read-only test and lint execution (decision test 1).

**Files:**
- Test: (no new files) uses `packages/core/test/learning-memory/**`

**Interfaces:**
- Consumes: completed learning-memory wiring
- Produces: evidence that learning tests and plan lint pass; forge tools unchanged when learning disabled

- [ ] **Step 1: Run learning-memory test suite**

Run: `pnpm exec vitest run packages/core/test/learning-memory`
Expected: all tests PASS

- [ ] **Step 2: Run lint-plan on this feature plan**

Run: `pnpm dlx tsx -e "import { readFileSync } from 'node:fs'; import { lintPlan } from './packages/core/src/plan-lint.ts'; const t=readFileSync('specs/003-ira-learning-memory/plan.md','utf8'); const f=lintPlan(t); if(f.length){console.error(f); process.exit(1)} console.log('lint-plan: clean');"`
Expected: `lint-plan: clean`

- [ ] **Step 3: Record verify sign-off**

Owner: @tech-lead — Learning memory plan forge-ready; standalone SuperSpec works with learning disabled and without Command Plane hive.

---

## FR coverage checklist (self-review)

| FR | Task(s) |
|----|---------|
| FR-001 | T011, T012, T014, T020, T021, T019 |
| FR-001a | T012, T014, T021, T019 |
| FR-002 | T002, T006 |
| FR-003 | T009, T013, T014 |
| FR-004 | T011, T012, T019 |
| FR-005 | T003, T007, T009 |
| FR-006 | T002, T017, T019 |
| FR-007 | T005, T011 |
| FR-008 | T008 |
| FR-009 | T010, T020 |
| FR-010 | T001, T002, T006, T007, T009, T015, T020, T021, T019 |
| FR-011 | T012, T013, T014, T016, T018 |
| FR-011a | T012, T014, T021, T019 |
| FR-012 | T003, T015, T016, T019 |
| FR-013 | T003, T006, T011 |
| FR-014 | T004 |
