# Ira Hire Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superspec-forge to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hire gallery pipeline to `@superspec-dev/core`: versioned manifests, sanitization, curated catalog search, review-before-spawn, persona install, roster upsert, capability routing hooks, and hire scoring — exposed via CLI/MCP (FR-009).

**Architecture:** New `packages/core/src/hire/` modules converge file, URL, paste, and gallery imports on `HireReview` with identical `uiCopy.trustBanner` and sanitization report scope for every `sourceKind` (FR-013, OD-018). Only the MCP/CLI **`hire-spawn-confirm`** handler calls `hireSpawnConfirm` to write persona files and `RosterAgent` rows with `origin: "hire"` (FR-014); Ask-Me **`acknowledge`** on `untrusted_import` cancels with `HIRE_ACK_CANCELS` and performs no writes. Until doctor reports `sliceAValidated: true`, `hire-spawn-confirm` no-ops with `SLICE_A_ONLY` (OD-020). P-005 registers `HireHooks` on P-001. No worker processes start before confirmation (FR-003, SC-002).

**Tech Stack:** TypeScript 5.5, Node >= 20, ESM, Vitest, Zod, existing MCP server in `packages/core`; storage under `.superspec/hive/hire/` and `hire-gallery/index.json`.

## Global Constraints

- Runtime: Node.js >= 20, `"type": "module"`, NodeNext (match `packages/core`).
- Dependencies: no new runtime npm packages (use `zod`, `@superspec-dev/render`, Command Plane modules from P-001).
- Security: default-deny skills/MCP (FR-010); reject executable payloads and secret-like keys (FR-004); curated and remote manifests share the same sanitize + HITL path (FR-013).
- OD-018 warning copy: `uiCopy.trustBanner` MUST equal exactly `Untrusted import — review all fields before spawn.` for `file`, `url`, `paste`, and `gallery`; `approvalCopyVariant: "curated_catalog"` MUST NOT alter that string; optional `trustHint` label only. Mismatch at confirm → `HIRE_WARNING_LENGTH_MISMATCH` and confirm MUST NOT run.
- OD-018 spawn writer: only `hire-spawn-confirm` performs persona and roster writes; any other confirm path → `HIRE_SPAWN_CONFIRM_REQUIRED`. Ask-Me `action: "acknowledge"` with `reasonClass: "untrusted_import"` MUST cancel (same disk effect as `hire-spawn-cancel`) and return `HIRE_ACK_CANCELS` — MUST NOT spawn.
- OD-020 Slice A: until doctor `sliceAValidated: true`, `hire-spawn-confirm` returns `{ ok: false, code: "SLICE_A_ONLY" }` with no persona or roster write; import, review, cancel, and acknowledge remain live.
- Hive required for spawn: return `HIVE_NOT_INITIALIZED` when hive absent (P-001 contract).
- Model tiers on manifests are abstract `economy` | `standard` | `frontier`; map at dispatch via existing `route-model`, not at hire spawn.
- Testing: **Kind: code** tasks use red-green-refactor with `pnpm exec vitest run <file>` from repo root.

## Depends on (features)

| Upstream | Minimum landing | Blocks P-005 tasks |
|----------|-----------------|-------------------|
| `specs/001-ira-command-plane` | T001–T006 (schemas, store, hive init, hook registry), T010 (Ask-Me `untrusted_import`) | T006, T011–T015, T018 integration |
| `specs/001-ira-command-plane` | Roster upsert + events append APIs from T006–T007 | T011 spawn |
| `@superspec-dev/core` | `discoverPersonas` / MCP `list-personas` (existing) | T020 |

---

## Phase 1: Schema, parse, sanitize

### Task T001: Hire Zod schemas and shared types

**Implements:** FR-002, FR-010

**Depends on:** none

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Normative manifest and review shapes from design.md; multi-field zod with enums (decision tests 1–2).

**Files:**
- Create: `packages/core/src/hire/schema.ts`
- Create: `packages/core/src/hire/types.ts`
- Create: `packages/core/src/hire/constants.ts`
- Test: `packages/core/test/hire/schema.test.ts`

**Interfaces:**
- Consumes: design.md `HireManifest`, `SanitizationReport`, `HireReview`, `SkillConsent`, `HireScore` field names; OD-018 trust banner string
- Produces: `HIRE_TRUST_BANNER` constant; `HireManifestSchema`, `SanitizationReportSchema`, `HireReviewSchema`, `GalleryIndexSchema`; exported inferred types from `types.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { HireManifestSchema } from "../../src/hire/schema.js";
import { HIRE_TRUST_BANNER } from "../../src/hire/constants.js";

describe("HireManifestSchema", () => {
  it("locks OD-018 trust banner constant", () => {
    expect(HIRE_TRUST_BANNER).toBe("Untrusted import — review all fields before spawn.");
  });

  it("requires hireManifest/v1 and default-deny allowlists", () => {
    const m = HireManifestSchema.parse({
      schemaVersion: "hireManifest/v1",
      id: "ios-developer",
      displayName: "iOS Developer",
      goal: "Ship SwiftUI features.",
      capabilityTags: ["ios"],
      suggestedEngine: "cursor",
      suggestedModelTier: "standard",
      budget: { tokens: 100000, usd: 25 },
      allowlists: { skills: [], mcp: [] },
      persona: { harness: "cursor", scope: "project", body: "---\nname: ios-developer\n---\n" },
    });
    expect(m.allowlists.skills).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/schema.test.ts`
Expected: FAIL with cannot find module `hire/schema.js`

- [ ] **Step 3: Write minimal implementation**

Export `HIRE_TRUST_BANNER` from `constants.ts`. Implement zod schemas in `schema.ts` matching design.md (manifest v1, review states, gallery index entry, hire score). Re-export types from `types.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/schema.ts packages/core/src/hire/types.ts packages/core/src/hire/constants.ts packages/core/test/hire/schema.test.ts
git commit -m "feat(hire): add zod schemas for hire manifest and review"
```

---

### Task T002: Manifest parse (YAML/JSON) and size gates

**Implements:** FR-002

**Depends on:** T001

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Multi-format parse plus byte/field limits wired to schema (decision test 2).

**Files:**
- Create: `packages/core/src/hire/manifest.ts`
- Test: `packages/core/test/hire/manifest.test.ts`

**Interfaces:**
- Consumes: `HireManifestSchema`, env defaults `MAX_MANIFEST_BYTES=65536`, `MAX_FIELD_CHARS=16384`
- Produces: `parseManifestBytes(raw: Buffer, sourceLabel: string): { ok: true; manifest: HireManifest; contentSha256: string } | { ok: false; code: "HIRE_MANIFEST_TOO_LARGE" | "HIRE_SANITIZE_FAILED"; message: string }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseManifestBytes } from "../../src/hire/manifest.js";

const SAMPLE = Buffer.from(`schemaVersion: hireManifest/v1
id: qa-bot
displayName: QA
goal: Test features.
capabilityTags: [qa]
suggestedEngine: cursor
suggestedModelTier: economy
budget: { tokens: 50000, usd: 10 }
allowlists: { skills: [], mcp: [] }
persona: { harness: cursor, scope: project, body: "body" }
`);

describe("parseManifestBytes", () => {
  it("parses YAML and returns content hash", () => {
    const r = parseManifestBytes(SAMPLE, "fixture.yaml");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.id).toBe("qa-bot");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/manifest.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Parse YAML or JSON, enforce max bytes, compute `contentSha256`, validate with `HireManifestSchema`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/manifest.ts packages/core/test/hire/manifest.test.ts
git commit -m "feat(hire): parse versioned hire manifests"
```

---

### Task T003: Sanitization, allowlist, and executable rejection

**Implements:** FR-004, FR-010, FR-013

**Depends on:** T002

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Untrusted-input rules, secret-key rejection, and sanitization report invariants (decision tests 2–3).

**Files:**
- Create: `packages/core/src/hire/sanitize.ts`
- Test: `packages/core/test/hire/sanitize.test.ts`

**Interfaces:**
- Consumes: parsed unknown object from manifest step
- Produces: `sanitizeManifestInput(input: unknown): { report: SanitizationReport; manifest: HireManifest | null }` — `manifest` null when `report.rejected.length > 0`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { sanitizeManifestInput } from "../../src/hire/sanitize.js";

describe("sanitizeManifestInput", () => {
  it("rejects executable script blocks", () => {
    const r = sanitizeManifestInput({
      schemaVersion: "hireManifest/v1",
      id: "bad",
      displayName: "Bad",
      goal: "x",
      capabilityTags: [],
      suggestedEngine: "cursor",
      suggestedModelTier: "standard",
      budget: { tokens: 1, usd: 1 },
      allowlists: { skills: [], mcp: [] },
      persona: { harness: "cursor", scope: "project", body: "x" },
      shell: "rm -rf /",
    });
    expect(r.report.rejected.length).toBeGreaterThan(0);
    expect(r.manifest).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/sanitize.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Allowlist fields per design.md, drop unknown keys into `droppedKeys`, reject executable patterns and secret-like keys, emit warnings for empty capability tags. Export `buildSanitizationReport()` so curated and remote imports produce reports with the same field set and detail level (FR-013 parity).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/sanitize.test.ts`
Expected: PASS

- [ ] **Step 5: Add parity test for curated vs remote report shape**

```ts
it("emits equal-scope sanitization reports for gallery and file inputs", () => {
  const gallery = sanitizeManifestInput(GALLERY_FIXTURE).report;
  const remote = sanitizeManifestInput(REMOTE_FIXTURE).report;
  expect(Object.keys(gallery).sort()).toEqual(Object.keys(remote).sort());
});
```

Run: `pnpm exec vitest run packages/core/test/hire/sanitize.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/hire/sanitize.ts packages/core/test/hire/sanitize.test.ts
git commit -m "feat(hire): sanitize untrusted manifest input"
```

---

### Task T004: Capability tag normalization helpers

**Implements:** FR-007

**Depends on:** none

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Deterministic slug rules already specified in design.md (decision test 1).

**Files:**
- Create: `packages/core/src/hire/capabilities.ts`
- Test: `packages/core/test/hire/capabilities.test.ts`

**Interfaces:**
- Consumes: raw string tags from manifest or task
- Produces: `normalizeCapabilityTags(tags: string[]): string[]`; `tagsIntersect(taskTags: string[], agentTags: string[]): string[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { normalizeCapabilityTags } from "../../src/hire/capabilities.js";

describe("normalizeCapabilityTags", () => {
  it("lowercases, trims, dedupes, and validates slug shape", () => {
    expect(normalizeCapabilityTags([" iOS ", "ios", "QA"])).toEqual(["ios", "qa"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/capabilities.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement normalization regex `[a-z0-9][a-z0-9._-]{0,31}`; drop invalid tokens with optional warning hook for later.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/capabilities.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/capabilities.ts packages/core/test/hire/capabilities.test.ts
git commit -m "feat(hire): normalize capability tags for routing"
```

---

## Phase 2: Review store and Ask-Me HITL

### Task T005: HireReview persistence under hive

**Implements:** FR-003, FR-011

**Depends on:** T001, T003

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Locked JSON persistence, state machine, and event append integration (decision tests 2–3).

**Files:**
- Create: `packages/core/src/hire/review.ts`
- Test: `packages/core/test/hire/review.test.ts`

**Interfaces:**
- Consumes: `command-plane/store` locks, `command-plane/paths` hive root
- Produces: `createPendingReview(input): Promise<HireReview>`; `loadReview(reviewId): Promise<HireReview | null>`; `updateReview(reviewId, patch): Promise<HireReview>`; paths under `hire/reviews/<reviewId>.json`; each review stores `uiCopy.trustBanner: HIRE_TRUST_BANNER` regardless of `sourceKind`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPendingReview } from "../../src/hire/review.js";

describe("createPendingReview", () => {
  it("persists pending review without roster side effects", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hire-review-"));
    const review = await createPendingReview({
      hiveRoot,
      sourceKind: "file",
      sourceRef: "/tmp/manifest.yaml",
      approvalCopyVariant: "standard",
      sanitizationReport: { droppedKeys: [], rejected: [], warnings: [], contentSha256: "abc", sanitizedAt: new Date().toISOString() },
      parsedManifest: { id: "x", displayName: "X", goal: "g", capabilityTags: ["qa"], suggestedEngine: "cursor", suggestedModelTier: "standard", budget: { tokens: 1, usd: 1 }, allowlists: { skills: [], mcp: [] }, persona: { harness: "cursor", scope: "project", body: "b" }, schemaVersion: "hireManifest/v1" },
      skillConsents: [],
      contentSha256: "abc",
    });
    expect(review.state).toBe("pending");
    expect(review.reviewId.startsWith("hrv_")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/review.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement CRUD with exclusive lock; append `hire.import_started` / `hire.review_updated` events when hive event log writable.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/review.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/review.ts packages/core/test/hire/review.test.ts
git commit -m "feat(hire): persist pending hire reviews in hive"
```

---

### Task T006: Ask-Me `untrusted_import` on review open

**Implements:** FR-011, FR-013

**Depends on:** T005

**Kind:** code

**Complexity:** complex

**Complexity rationale:** HITL-critical Ask-Me integration and dedupe by `reviewId` (decision test 3).

**Files:**
- Create: `packages/core/src/hire/ask-me-bridge.ts`
- Modify: `packages/core/src/hire/review.ts` (call bridge when review opens)
- Test: `packages/core/test/hire/ask-me-bridge.test.ts`

**Interfaces:**
- Consumes: `command-plane/ask-me` create/list; P-001 `reasonClass: "untrusted_import"` weight 60
- Produces: `openUntrustedImportAskMe({ hiveRoot, reviewId, sourceSummary }): Promise<{ askMeId: string }>` — idempotent for same `reviewId`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openUntrustedImportAskMe } from "../../src/hire/ask-me-bridge.js";

describe("openUntrustedImportAskMe", () => {
  it("creates untrusted_import Ask-Me item linked to review", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hire-ask-"));
    const { askMeId } = await openUntrustedImportAskMe({
      hiveRoot,
      reviewId: "hrv_test",
      sourceSummary: "file:/tmp/m.yaml",
    });
    expect(askMeId.startsWith("ask_")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/ask-me-bridge.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Create Ask-Me item with `reasonClass: "untrusted_import"`; store `askMeId` on review; return existing id when open item already references review.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/ask-me-bridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/ask-me-bridge.ts packages/core/src/hire/review.ts packages/core/test/hire/ask-me-bridge.test.ts
git commit -m "feat(hire): open Ask-Me untrusted_import on review"
```

---

## Phase 3: Gallery and import pipeline

### Task T007: Curated gallery index load and search

**Implements:** FR-001

**Depends on:** T001

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Index schema, env override, and search filtering (decision test 2).

**Files:**
- Create: `packages/core/src/hire/gallery.ts`
- Test: `packages/core/test/hire/gallery.test.ts`

**Interfaces:**
- Consumes: `SUPERSPEC_HIRE_GALLERY` or `<repo>/hire-gallery/index.json`
- Produces: `searchGallery({ query?, tags?, limit? }): GalleryEntry[]`; `loadGalleryManifest(entryId): Promise<Buffer>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { searchGallery } from "../../src/hire/gallery.js";

describe("searchGallery", () => {
  it("matches capability tags case-insensitively", () => {
    const entries = searchGallery({ tags: ["ios"], limit: 5, indexFixture: "minimal" });
    expect(entries.every((e) => e.capabilityTags.map((t) => t.toLowerCase()).includes("ios"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/gallery.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Load index JSON, search by title/description/tags; return `HIRE_GALLERY_UNAVAILABLE` when index missing.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/gallery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/gallery.ts packages/core/test/hire/gallery.test.ts
git commit -m "feat(hire): search curated hire gallery index"
```

---

### Task T008: Unified `hire-import` pipeline (file, url, paste, gallery)

**Implements:** FR-001, FR-009, FR-013, FR-014

**Depends on:** T003, T005, T006, T007

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Single acquire→parse→sanitize→review path across four source kinds (decision test 3).

**Files:**
- Create: `packages/core/src/hire/import.ts`
- Test: `packages/core/test/hire/import.test.ts`

**Interfaces:**
- Consumes: `parseManifestBytes`, `sanitizeManifestInput`, `createPendingReview`, `openUntrustedImportAskMe`, gallery loader
- Produces: `hireImport(request: HireImportRequest): Promise<HireImportResponse>` matching design.md `hire-import` JSON (review form + `uiCopy` + `askMeId`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hireImport } from "../../src/hire/import.js";

describe("hireImport", () => {
  it("does not spawn and returns pending review for file source", async () => {
    const res = await hireImport({
      source: "file",
      path: "packages/core/test/hire/fixtures/ios-developer.yaml",
      hiveRoot: "/tmp/hive-fixture",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.review.state).toBe("pending");
  });

  it("sets identical trustBanner for gallery and file (OD-018)", async () => {
    const fileRes = await hireImport({ source: "file", path: "packages/core/test/hire/fixtures/ios-developer.yaml", hiveRoot: "/tmp/hive-a" });
    const galleryRes = await hireImport({ source: "gallery", entryId: "ios-developer", hiveRoot: "/tmp/hive-b", repositoryRoot: process.cwd() });
    expect(fileRes.ok && galleryRes.ok).toBe(true);
    if (fileRes.ok && galleryRes.ok) {
      expect(galleryRes.uiCopy.trustBanner).toBe(fileRes.uiCopy.trustBanner);
      expect(galleryRes.uiCopy.trustBanner).toBe("Untrusted import — review all fields before spawn.");
      expect(galleryRes.approvalCopyVariant).toBe("curated_catalog");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/import.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement stages 1–4 from design.md; set `approvalCopyVariant: "curated_catalog"` and optional `trustHint` for gallery only; always set `uiCopy.trustBanner` from `HIRE_TRUST_BANNER`; never write roster/persona.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/import.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/import.ts packages/core/test/hire/import.test.ts packages/core/test/hire/fixtures/ios-developer.yaml
git commit -m "feat(hire): unified hire-import review pipeline"
```

---

### Task T009: Review form updates and skill consent records

**Implements:** FR-012, FR-006

**Depends on:** T005

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Editable fields and per-skill consent merge into review JSON (decision test 2).

**Files:**
- Create: `packages/core/src/hire/skills.ts`
- Modify: `packages/core/src/hire/review.ts` (apply edits)
- Test: `packages/core/test/hire/skills.test.ts`

**Interfaces:**
- Consumes: `HireReview`, operator edit payload
- Produces: `applyReviewEdits(reviewId, edits, skillConsents?): Promise<HireReview>`; `scanSkill(path): Promise<{ status: "skipped" | "pass" | "fail"; findings: string[] }>` stub for v1

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { applyReviewEdits } from "../../src/hire/review.js";

describe("applyReviewEdits", () => {
  it("stores operator overrides for engine and budget", async () => {
    const updated = await applyReviewEdits("hrv_fixture", {
      engine: "cursor",
      modelTier: "frontier",
      budgetUsd: 40,
    }, { hiveRoot: "/tmp/hive-fixture" });
    expect(updated.operatorEdits?.modelTier).toBe("frontier");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/skills.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Merge edits into `operatorEdits`; update `skillConsents` decisions; declined skills omitted from allowed list on confirm.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/skills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/skills.ts packages/core/src/hire/review.ts packages/core/test/hire/skills.test.ts
git commit -m "feat(hire): review edits and skill consent records"
```

---

## Phase 4: Spawn, rollback, cancel

### Task T010: `hire-spawn-confirm` — persona files and roster upsert

**Implements:** FR-003, FR-005, FR-012, FR-014

**Depends on:** T005, T006, T009

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Sole spawn writer, OD-018 warning gate, Slice A no-op, atomic persona write (decision test 3).

**Files:**
- Create: `packages/core/src/hire/spawn.ts`
- Test: `packages/core/test/hire/review-spawn.test.ts`

**Interfaces:**
- Consumes: `@superspec-dev/render` frontmatter; command-plane roster upsert; doctor `sliceAValidated`; `HIRE_TRUST_BANNER`; confirmed review fields
- Produces: `hireSpawnConfirm({ reviewId, nameConflictAction?, createWorktree?, sliceAValidated }): Promise<SpawnResult>` — **only** entry that writes persona files and upserts roster `origin: "hire"`; returns `SLICE_A_ONLY` when `sliceAValidated === false`; returns `HIRE_WARNING_LENGTH_MISMATCH` when stored `uiCopy.trustBanner !== HIRE_TRUST_BANNER`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hireSpawnConfirm } from "../../src/hire/spawn.js";

describe("hireSpawnConfirm", () => {
  it("writes persona and roster only when Slice A validated", async () => {
    const res = await hireSpawnConfirm({
      reviewId: "hrv_fixture",
      hiveRoot: "/tmp/hive-fixture",
      repositoryRoot: "/tmp/repo",
      sliceAValidated: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.agent.origin).toBe("hire");
  });

  it("no-ops with SLICE_A_ONLY before Slice A (OD-020)", async () => {
    const res = await hireSpawnConfirm({
      reviewId: "hrv_fixture",
      hiveRoot: "/tmp/hive-fixture",
      repositoryRoot: "/tmp/repo",
      sliceAValidated: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("SLICE_A_ONLY");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/review-spawn.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Temp-file rename for personas; upsert roster under lock; resolve Ask-Me; append `hire.spawned`; do not call `EngineHooks.dispatch`. Reject confirm when trust banner mismatches. Gate all writes on `sliceAValidated === true`. Export no alternate public spawn writer — MCP/CLI `hire-spawn-confirm` is the sole caller.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/review-spawn.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/spawn.ts packages/core/test/hire/review-spawn.test.ts
git commit -m "feat(hire): hire-spawn-confirm writes persona and roster"
```

---

### Task T011: Spawn rollback and duplicate-name conflict

**Implements:** FR-003

**Depends on:** T010

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Partial-failure rollback and interactive conflict codes (decision test 3).

**Files:**
- Modify: `packages/core/src/hire/spawn.ts`
- Test: `packages/core/test/hire/spawn-rollback.test.ts`

**Interfaces:**
- Consumes: existing roster rows with `origin: "hire"`
- Produces: `HIRE_NAME_CONFLICT` with actions `merge|replace|cancel`; deletes temp personas when disk write fails mid-flight

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hireSpawnConfirm } from "../../src/hire/spawn.js";

describe("hireSpawnConfirm rollback", () => {
  it("returns HIRE_NAME_CONFLICT when hire id already on roster", async () => {
    const res = await hireSpawnConfirm({ reviewId: "hrv_dup", hiveRoot: "/tmp/hive-dup", repositoryRoot: "/tmp/repo", sliceAValidated: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("HIRE_NAME_CONFLICT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/spawn-rollback.test.ts`
Expected: FAIL with assertion or missing fixture

- [ ] **Step 3: Write minimal implementation**

Detect roster conflict before final rename; on failure after temp write, remove temp files and skip roster append.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/spawn-rollback.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/spawn.ts packages/core/test/hire/spawn-rollback.test.ts
git commit -m "feat(hire): spawn rollback and name conflict handling"
```

---

### Task T012: Cancel, acknowledge, and reject spawn paths

**Implements:** FR-003, FR-011, FR-014

**Depends on:** T005, T006

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** OD-018 acknowledge cancels with `HIRE_ACK_CANCELS`; cancel parity with `hire-spawn-cancel` (decision test 2).

**Files:**
- Modify: `packages/core/src/hire/spawn.ts`
- Modify: `packages/core/src/hire/ask-me-bridge.ts`
- Test: `packages/core/test/hire/spawn-cancel.test.ts`

**Interfaces:**
- Produces: `hireSpawnCancel(reviewId): Promise<{ ok: true; state: "cancelled" }>` — no persona/roster writes; resolves Ask-Me
- Produces: `handleUntrustedImportAskMeAnswer({ reviewId, action }): Promise<AskMeHireResult>` — `acknowledge` → review `cancelled`, `{ ok: true, code: "HIRE_ACK_CANCELS" }`, zero spawn writes; `keep_blocked` → review stays `pending`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hireSpawnCancel } from "../../src/hire/spawn.js";
import { handleUntrustedImportAskMeAnswer } from "../../src/hire/ask-me-bridge.js";

describe("hire cancel paths (OD-018)", () => {
  it("hire-spawn-cancel marks review cancelled without roster changes", async () => {
    const res = await hireSpawnCancel("hrv_cancel", { hiveRoot: "/tmp/hive-cancel" });
    expect(res.ok).toBe(true);
    expect(res.state).toBe("cancelled");
  });

  it("acknowledge on untrusted_import returns HIRE_ACK_CANCELS and does not spawn", async () => {
    const res = await handleUntrustedImportAskMeAnswer({
      reviewId: "hrv_ack",
      action: "acknowledge",
      reasonClass: "untrusted_import",
      hiveRoot: "/tmp/hive-ack",
    });
    expect(res.ok).toBe(true);
    expect(res.code).toBe("HIRE_ACK_CANCELS");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/spawn-cancel.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Wire `handleUntrustedImportAskMeAnswer` from P-001 `ask-me-answer` when `reasonClass === "untrusted_import"` and payload links `reviewId`. Update review state; append `hire.cancelled`; resolve linked Ask-Me item. Never call `hireSpawnConfirm` from this path.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/spawn-cancel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/spawn.ts packages/core/src/hire/ask-me-bridge.ts packages/core/test/hire/spawn-cancel.test.ts
git commit -m "feat(hire): cancel and acknowledge paths for hire review"
```

---

## Phase 5: Routing hooks and scoring

### Task T013: `HireHooks.matchCapabilities` implementation

**Implements:** FR-007

**Depends on:** T004

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Tie-break rules with hire score and placeholder exclusion (decision test 3).

**Files:**
- Modify: `packages/core/src/hire/capabilities.ts`
- Create: `packages/core/src/hire/hooks-impl.ts`
- Test: `packages/core/test/hire/capabilities.test.ts` (extend)

**Interfaces:**
- Produces: `matchCapabilities(task, roster): RosterAgent | null` per design.md ranking (tag intersection count, hire score, stable id)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { matchCapabilities } from "../../src/hire/hooks-impl.js";

describe("matchCapabilities", () => {
  it("prefers idle hire with matching ios tag", () => {
    const agent = matchCapabilities(
      { capabilityTags: ["ios"] },
      [
        { id: "ios-dev", status: "idle", origin: "hire", capabilityTags: ["ios"], hireScore: { score: 80 } },
        { id: "agent-host", status: "idle", origin: "placeholder", capabilityTags: [] },
      ] as never,
    );
    expect(agent?.id).toBe("ios-dev");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/capabilities.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement ranking in `hooks-impl.ts`; exclude placeholder unless no tag match and no other idle hire.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/capabilities.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/hooks-impl.ts packages/core/src/hire/capabilities.ts packages/core/test/hire/capabilities.test.ts
git commit -m "feat(hire): capability-based roster matching hook"
```

---

### Task T014: Register hire hooks at CLI/MCP bootstrap

**Implements:** FR-007, FR-011, FR-014

**Depends on:** T013, T006, T012

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Wire `registerCommandPlaneHooks({ hire })` and export `onUntrustedImport` delegate (decision test 2).

**Files:**
- Create: `packages/core/src/hire/index.ts`
- Modify: `packages/core/src/cli.ts`, `packages/core/src/mcp-server.ts` (import hire bootstrap)
- Test: `packages/core/test/hire/hooks-register.test.ts`

**Interfaces:**
- Produces: side effect `registerCommandPlaneHooks({ hire: hireHooksImpl })` when hire module loaded; registers Ask-Me answer delegate for hire-linked `untrusted_import` (routes to `handleUntrustedImportAskMeAnswer`, never spawn)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { getRegisteredHireHooks } from "../../src/command-plane/hooks.js";
import "../../src/hire/index.js";

describe("hire hook registration", () => {
  it("registers matchCapabilities and onUntrustedImport", () => {
    const h = getRegisteredHireHooks();
    expect(typeof h?.matchCapabilities).toBe("function");
    expect(typeof h?.onUntrustedImport).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/hooks-register.test.ts`
Expected: FAIL — hooks not registered

- [ ] **Step 3: Write minimal implementation**

Export `hireHooksImpl`; call registration from `hire/index.ts`; import bootstrap from CLI and MCP entrypoints.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/hooks-register.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/index.ts packages/core/src/hire/hooks-impl.ts packages/core/src/cli.ts packages/core/src/mcp-server.ts packages/core/test/hire/hooks-register.test.ts
git commit -m "feat(hire): register HireHooks with command plane"
```

---

### Task T015: Hire performance score and demotion hints

**Implements:** FR-008

**Depends on:** T010

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Aggregate ledger metrics into score file; hints only (decision test 2).

**Files:**
- Create: `packages/core/src/hire/score.ts`
- Test: `packages/core/test/hire/score.test.ts`

**Interfaces:**
- Produces: `updateHireScore(agentId, signals): HireScore`; `demotionHint` when score < threshold (default 40); listen hook on task completion events

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeHireScore } from "../../src/hire/score.js";

describe("computeHireScore", () => {
  it("sets demotionHint when score below threshold", () => {
    const s = computeHireScore({ passRate: 0.2, reviewFailures: 5, spendUsd: 100, budgetUsd: 50 });
    expect(s.demotionHint).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/score.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Formula from design.md; persist under `hire/scores/<agentId>.json`; expose on `hire show` response shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/score.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hire/score.ts packages/core/test/hire/score.test.ts
git commit -m "feat(hire): hire score and demotion hints"
```

---

## Phase 6: CLI, MCP, catalog, integration

### Task T016: CLI `superspec hire` subcommands

**Implements:** FR-009

**Depends on:** T008, T009, T010, T012

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** JSON stdout parity with MCP handlers (decision test 2).

**Files:**
- Modify: `packages/core/src/cli.ts`
- Test: `packages/core/test/hire/cli-hire.test.ts`

**Interfaces:**
- Produces: subcommands `hire import`, `hire review show`, `hire review update`, `hire confirm` (calls `hireSpawnConfirm` only), `hire cancel` (calls `hireSpawnCancel`), `hire gallery search`, `hire show` printing design.md JSON envelopes including `HIRE_ACK_CANCELS` / `SLICE_A_ONLY` error codes

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { runCli } from "../../src/cli-test-harness.js";

describe("cli hire import", () => {
  it("prints ok review json for fixture manifest", async () => {
    const out = await runCli(["hire", "import", "--source", "file", "--path", "packages/core/test/hire/fixtures/ios-developer.yaml"]);
    const json = JSON.parse(out);
    expect(json.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/cli-hire.test.ts`
Expected: FAIL unknown command `hire`

- [ ] **Step 3: Write minimal implementation**

Wire CLI flags to hire service functions; reuse shared handlers with MCP layer.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/cli-hire.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli.ts packages/core/test/hire/cli-hire.test.ts
git commit -m "feat(hire): CLI hire subcommands"
```

---

### Task T017: MCP hire tools and contract tests

**Implements:** FR-009

**Depends on:** T016

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Tool registration and schema parity with CLI (decision test 2).

**Files:**
- Modify: `packages/core/src/mcp-server.ts`
- Test: `packages/core/test/hire/contracts.test.ts`

**Interfaces:**
- Produces: MCP tools `hire-import`, `hire-review-show`, `hire-review-update`, `hire-spawn-confirm` (sole spawn writer — other tools MUST NOT call `hireSpawnConfirm`), `hire-spawn-cancel`, `hire-gallery-search`, `hire-show`; contract test that `ask-me-answer` acknowledge on hire `untrusted_import` returns `HIRE_ACK_CANCELS`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildToolDefinitions } from "../../src/mcp-server.js";

describe("hire MCP contracts", () => {
  it("registers hire-import tool", () => {
    const names = buildToolDefinitions().map((t) => t.name);
    expect(names).toContain("hire-import");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/contracts.test.ts`
Expected: FAIL — `hire-import` not registered

- [ ] **Step 3: Write minimal implementation**

Register tools with zod input schemas from `hire/schema.ts`; handlers call shared hire service module.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp-server.ts packages/core/test/hire/contracts.test.ts
git commit -m "feat(hire): MCP hire tools and contracts"
```

---

### Task T018: Shipped curated catalog provision

**Implements:** FR-001

**Depends on:** T007

**Kind:** provision

**Complexity:** mechanical

**Complexity rationale:** Static index and sample manifests per design paths (decision test 1).

**Files:**
- Create: `hire-gallery/index.json`
- Create: `hire-gallery/manifests/ios-developer.yaml`
- Create: `hire-gallery/manifests/qa-specialist.yaml`
- Create: `hire-gallery/README.md` (Operator checklist)

**Interfaces:**
- Produces: v1 catalog with `trustHint: "curated_catalog"` entries referenced by gallery search tests

- [ ] **Step 1: Author catalog checklist**

Checklist: each manifest validates against `HireManifestSchema`; `manifestSha256` in index matches file bytes; no secrets or executable fields.

- [ ] **Step 2: Add index and manifests**

Populate `hire-gallery/index.json` with at least two entries (`ios`, `qa` tags) pointing at `manifests/*.yaml`.

- [ ] **Step 3: Verify gallery search finds entries**

Run: `pnpm exec vitest run packages/core/test/hire/gallery.test.ts`
Expected: PASS including catalog fixture path

- [ ] **Step 4: Commit**

```bash
git add hire-gallery/
git commit -m "provision: ship curated hire gallery catalog"
```

---

### Task T019: `list-personas` integration after spawn

**Implements:** FR-005

**Depends on:** T010, T014

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Cross-module discovery timing bound SC-003 (decision test 3).

**Files:**
- Test: `packages/core/test/hire/list-personas.integration.test.ts`
- Modify: `packages/core/src/command-plane/doctor.ts` (optional hire probe when present)

**Interfaces:**
- Consumes: `discoverPersonas({ projectRoot })`; MCP `list-personas`
- Produces: integration proof that confirmed spawn persona appears within 5s under test harness

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { discoverPersonas } from "../../src/persona-discovery.js";

describe("list-personas after hire spawn", () => {
  it("includes new hire persona name within SC-003 window", async () => {
    const names = (await discoverPersonas({ projectRoot: "/tmp/repo-fixture" })).map((p) => p.name);
    expect(names).toContain("ios-developer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/list-personas.integration.test.ts`
Expected: FAIL — persona missing

- [ ] **Step 3: Wire spawn fixture paths**

Ensure spawn writes under `.cursor/agents/` in temp repo; stabilize test clock/poll up to 5s.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/list-personas.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/hire/list-personas.integration.test.ts packages/core/src/command-plane/doctor.ts
git commit -m "test(hire): list-personas discovers spawned hire"
```

---

### Task T020: End-to-end curated vs untrusted import integration

**Implements:** FR-011, FR-013, FR-014, SC-002

**Depends on:** T008, T010, T012, T014, T018

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Proves identical pipeline and zero pre-confirm spawn (decision test 3).

**Files:**
- Test: `packages/core/test/hire/pipeline.integration.test.ts`

**Interfaces:**
- Produces: scenarios for gallery entry and remote-style manifest both opening Ask-Me and requiring confirm

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hireImport } from "../../src/hire/import.js";
import { hireSpawnConfirm } from "../../src/hire/spawn.js";
import { handleUntrustedImportAskMeAnswer } from "../../src/hire/ask-me-bridge.js";

describe("hire pipeline SC-002 + OD-018", () => {
  it("never writes roster before hire-spawn-confirm for gallery and file sources", async () => {
    const gallery = await hireImport({ source: "gallery", entryId: "ios-developer", hiveRoot: "/tmp/hive-e2e", repositoryRoot: "/tmp/repo-e2e" });
    expect(gallery.ok).toBe(true);
    const rosterBefore = await readRosterAgentCount("/tmp/hive-e2e");
    expect(rosterBefore).toBe(0);
    await hireSpawnConfirm({ reviewId: gallery.review!.reviewId, hiveRoot: "/tmp/hive-e2e", repositoryRoot: "/tmp/repo-e2e", sliceAValidated: true });
    expect(await readRosterAgentCount("/tmp/hive-e2e")).toBe(1);
  });

  it("acknowledge cancels without roster write", async () => {
    const imp = await hireImport({ source: "file", path: "packages/core/test/hire/fixtures/ios-developer.yaml", hiveRoot: "/tmp/hive-ack-e2e" });
    expect(imp.ok).toBe(true);
    const ack = await handleUntrustedImportAskMeAnswer({ reviewId: imp.review!.reviewId, action: "acknowledge", reasonClass: "untrusted_import", hiveRoot: "/tmp/hive-ack-e2e" });
    expect(ack.code).toBe("HIRE_ACK_CANCELS");
    expect(await readRosterAgentCount("/tmp/hive-ack-e2e")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/pipeline.integration.test.ts`
Expected: FAIL helper or import not wired

- [ ] **Step 3: Implement integration helpers and fixtures**

Add `readRosterAgentCount`; assert sanitization report present for curated path with `approvalCopyVariant: "curated_catalog"` and identical `uiCopy.trustBanner`; assert `hireSpawnConfirm` with `sliceAValidated: false` leaves roster count 0.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/pipeline.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/hire/pipeline.integration.test.ts
git commit -m "test(hire): curated and file imports share confirm gate"
```

---

### Task T021: Public exports for hire module

**Implements:** FR-009

**Depends on:** T014, T017

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Re-export surface only (decision test 1).

**Files:**
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: named exports for hire service entrypoints used by tests and downstream packages

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";

describe("package exports hire", () => {
  it("exports hireImport from package root", async () => {
    const mod = await import("../../src/index.js");
    expect(typeof mod.hireImport).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/hire/exports.test.ts`
Expected: FAIL — `hireImport` undefined

- [ ] **Step 3: Add exports in index.ts**

Export hire public API from `hire/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/hire/exports.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/hire/exports.test.ts
git commit -m "feat(hire): export hire APIs from core package"
```

---

### Task T022: Verify hire suite, matrix, and lint-plan

**Implements:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014

**Depends on:** T021

**Kind:** verify

**Complexity:** mechanical

**Complexity rationale:** Read-only verification commands (decision test 1).

**Files:**
- Read: `specs/005-ira-hire-gallery/plan.md`

- [ ] **Step 1: Run hire test suite**

Run: `pnpm exec vitest run packages/core/test/hire`
Expected: all tests PASS

- [ ] **Step 2: Run lint-plan on this feature plan**

Run: `pnpm dlx tsx -e "import { readFileSync } from 'node:fs'; import { lintPlan } from './packages/core/src/plan-lint.ts'; const t=readFileSync('specs/005-ira-hire-gallery/plan.md','utf8'); const f=lintPlan(t); if(f.length){console.error(f); process.exit(1)} console.log('lint-plan: clean');"`
Expected: `lint-plan: clean`

- [ ] **Step 3: Run build-matrix for FR coverage**

Run: MCP `build-matrix` with `planText` from this plan and spec FR list
Expected: 0 uncovered FR gaps for FR-001–FR-014

---

## Appendix: FR coverage

| FR | Tasks |
|----|-------|
| FR-001 | T007, T008, T016, T017, T018 |
| FR-002 | T001, T002 |
| FR-003 | T005, T008, T010, T011, T012 |
| FR-004 | T003 |
| FR-005 | T010, T019 |
| FR-006 | T009 |
| FR-007 | T004, T013, T014 |
| FR-008 | T015 |
| FR-009 | T008, T016, T017, T021 |
| FR-010 | T001, T003 |
| FR-011 | T005, T006, T012, T014, T020 |
| FR-012 | T009, T010 |
| FR-013 | T003, T006, T008, T020 |
| FR-014 | T008, T010, T012, T014, T016, T017, T020 |
