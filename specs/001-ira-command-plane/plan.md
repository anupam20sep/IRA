# Ira Command Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superspec-forge to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@superspec-dev/core` with Ira Command Plane (hive, Ask-Me, `dispatch-task`, pause/abort, doctor Slice A gates) per LOCKED amendment OD-009–OD-020 — CLI/MCP JSON only, no UI.

**Architecture:** `packages/core/src/command-plane/` persists under `<repo>/.superspec/hive/`. Forge alone writes `specs/<feature>/.superspec/state.json`; hive mirrors after successful forge writes (sync failure does not roll back forge). Steer path when hive exists is only `dispatch-task` → hooks → internal `begin-task`. Host engines queue `DispatchIntent` (`null` dispatch); Ira never parents host CLIs.

**Tech Stack:** TypeScript 5.5, Node >= 20, ESM, Vitest, Zod, existing MCP server in `packages/core`.

## Slice A / P0 (forge before full program)

**P0 = must land before doctor can report `sliceAValidated: true` (FR-034, OD-020).** Forge windows **W1–W12** below are P0; **W13–W16** complete CLI/MCP parity and verification.

| P0 task | Delivers |
|---------|----------|
| T001–T004 | Schemas, paths, OD-012 `withLock`, Ira persona |
| T005 | Hook registry fail-closed (OD-015) |
| T006–T008 | Hive init (`allowAbsentCi` default false), ledger sync, forge bridge + `DISPATCH_PATH_REQUIRED` |
| T010 | Ask-Me create/list/answer |
| T012 | `dispatch-task` (FR-029, FR-032, Slice A token gate) |
| T013 | `task-hold` / `task-abort` (OD-011) |
| T014 | Idle wake calls `dispatch-task` only |
| T018 | Doctor `hiveReady`, `engineRungReady`, `sliceAValidated` four checks |

## Global Constraints

- LOCKED: `docs/superspec/specs/ira-architecture-amendment-2026-10-16.md` wins over conflicting design/plan text.
- Runtime: Node.js >= 20, `"type": "module"`, NodeNext (match `packages/core`).
- Dependencies: no new runtime npm packages; hive locks only via `withLock` in core (OD-012).
- Storage: hive at `<repository-root>/.superspec/hive/`; forge state at `specs/<feature>/.superspec/state.json`; hive gitignored.
- Steer: when hive exists, only `dispatch-task` (board, idle wake, away tick, CLI, MCP); direct `begin-task` → `DISPATCH_PATH_REQUIRED` (OD-010).
- Pause/abort: `task-hold` / `task-abort`; never `record-result --passed false` for pause; abort needs `confirm: true` (OD-011).
- Away CI: `allowAbsentCi` missing = `false`; absent/missing CI → `ci_absent` unless exactly `true`; `red` → `ci_not_green`; heartbeat before dispatch (OD-013).
- Doctor: `hiveReady` ≠ `engineRungReady`; legacy `ready` === `hiveReady`; dispatch requires `hiveReady` (OD-014).
- Slice A: deferred P-003/P-004/P-005/non-host spawn → `SLICE_A_ONLY` no-op; host `beforeDispatch` allow without spend write (OD-020).
- Naming: callsign **Ira**; expansion **Intelligent Resource Automation** (FR-011).
- Defaults: autonomy `supervised`, telemetry `off`, `maxReviewFailures` 3 (FR-008, FR-024, FR-027).
- Testing: **Kind: code** tasks use red-green-refactor with `pnpm exec vitest run <file>` from repo root.

---

## Phase 1: Schemas, paths, store, hooks

### Task T001: Hive Zod schemas and shared types

**Implements:** FR-012, FR-015, FR-025, FR-024, FR-030

**Depends on:** none

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Multi-entity zod contracts including ledger `hold` and settings `allowAbsentCi` (decision tests 1–2).

**Files:**
- Create: `packages/core/src/command-plane/schema.ts`
- Create: `packages/core/src/command-plane/types.ts`
- Test: `packages/core/test/command-plane/schema.test.ts`

**Interfaces:**
- Consumes: design.md data model
- Produces: zod parsers for manifest, settings (`allowAbsentCi` optional), ledger task (`hold`, `abortReason`), Ask-Me, events; `COMMAND_PLANE_ERROR_CODES` including `DISPATCH_PATH_REQUIRED`, `DISPATCH_HELD`, `HIVE_NOT_READY`, `SLICE_A_ONLY`, `HOOK_FAILED_CLOSED`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { AutonomySettingsSchema, HiveTaskSchema } from "../../src/command-plane/schema.js";

describe("AutonomySettingsSchema", () => {
  it("treats missing allowAbsentCi as false at read time", () => {
    const parsed = AutonomySettingsSchema.parse({
      schemaVersion: 1,
      autonomy: "supervised",
      awayMode: false,
      pollIntervalMs: 60000,
      maxReviewFailures: 3,
      featureCeilings: {},
      telemetry: "off",
      updatedAt: "2026-10-15T00:00:00.000Z",
    });
    expect(parsed.allowAbsentCi).toBe(false);
  });
});

describe("HiveTaskSchema", () => {
  it("defaults hold false", () => {
    const t = HiveTaskSchema.parse({
      id: "T001",
      featureId: "f",
      title: "x",
      implementsFr: ["FR-001"],
      dependsOn: [],
      assigneeAgentId: null,
      status: "todo",
      kind: "code",
      complexity: "moderate",
      reviewFailures: 0,
      ceiling: 3,
      drift: "ok",
      capabilityTags: [],
      updatedAt: "2026-10-15T00:00:00.000Z",
    });
    expect(t.hold).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/schema.test.ts`
Expected: FAIL cannot find module `command-plane/schema.js`

- [ ] **Step 3: Write minimal implementation**

Implement schemas matching design.md; export error code list and inferred types.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/schema.ts packages/core/src/command-plane/types.ts packages/core/test/command-plane/schema.test.ts
git commit -m "feat(command-plane): hive schemas with hold and allowAbsentCi"
```

---

### Task T002: Repository root and hive path resolution

**Implements:** FR-028

**Depends on:** none

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Linked-worktree `commondir` resolution must not fork hive (decision test 3).

**Files:**
- Create: `packages/core/src/command-plane/paths.ts`
- Test: `packages/core/test/command-plane/paths.test.ts`

**Interfaces:**
- Consumes: `SUPERSPEC_ROOT` override for tests
- Produces: `resolveRepositoryRoot(cwd): { ok: true, repositoryRoot, hiveRoot } | { ok: false, error }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveRepositoryRoot } from "../../src/command-plane/paths.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("resolveRepositoryRoot", () => {
  it("anchors hive under main root with program.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "cp-path-"));
    await writeFile(join(root, "program.md"), "# p\n");
    process.env.SUPERSPEC_ROOT = root;
    const res = resolveRepositoryRoot(root);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.hiveRoot).toBe(join(root, ".superspec/hive"));
    delete process.env.SUPERSPEC_ROOT;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/paths.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement git main-worktree walk per design Decision “Resolve hive root”.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/paths.ts packages/core/test/command-plane/paths.test.ts
git commit -m "feat(command-plane): main-worktree hive path for FR-028"
```

---

### Task T003: Atomic store and OD-012 exclusive locks

**Implements:** FR-012, FR-013, FR-014, FR-015, FR-031

**Depends on:** T001, T002

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Lock steal only on dead pid + matching nonce; age must not steal (OD-012, decision test 3).

**Files:**
- Create: `packages/core/src/command-plane/store.ts`
- Test: `packages/core/test/command-plane/store.test.ts`

**Interfaces:**
- Consumes: hive root paths
- Produces: `withLock(lockPath, { waitMs }, fn)`, `writeJsonAtomic`, `appendJsonlLine`; busy codes `SCRIBE_BUSY`, `LEDGER_BUSY`, `MAILBOX_BUSY`, `EVENT_BUSY`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { shouldStealLock } from "../../src/command-plane/store.js";

describe("shouldStealLock (OD-012)", () => {
  it("never steals when holder pid is alive regardless of lock age", () => {
    expect(shouldStealLock({ pidAlive: true, nonceStable: true, ageMs: 120_000 })).toBe(false);
  });
  it("steals only when pid dead and nonce stable on re-read", () => {
    expect(shouldStealLock({ pidAlive: false, nonceStable: true, ageMs: 120_000 })).toBe(true);
    expect(shouldStealLock({ pidAlive: false, nonceStable: false, ageMs: 120_000 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/store.test.ts`
Expected: FAIL `shouldStealLock` is not exported

- [ ] **Step 3: Write minimal implementation**

Implement `withLock` with `wx` create `{ pid, nonce }`, wait bounds (blackboard 0 ms, ledger/mailbox/events 2000 ms), release only when nonce matches; no age-based steal.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/store.ts packages/core/test/command-plane/store.test.ts
git commit -m "feat(command-plane): OD-012 withLock steal predicate"
```

---

### Task T004: Ira persona constants

**Implements:** FR-011

**Depends on:** none

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Fixed persona strings (decision test 1).

**Files:**
- Create: `packages/core/src/command-plane/persona.ts`
- Test: `packages/core/test/command-plane/persona.test.ts`

**Interfaces:**
- Produces: `IRA_PERSONA`, `personaField()`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { IRA_PERSONA } from "../../src/command-plane/persona.js";

describe("IRA_PERSONA", () => {
  it("uses Ira callsign and full expansion", () => {
    expect(IRA_PERSONA.callsign).toBe("Ira");
    expect(IRA_PERSONA.expansion).toBe("Intelligent Resource Automation");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/persona.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Export persona constants and JSON helper.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/persona.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/persona.ts packages/core/test/command-plane/persona.test.ts
git commit -m "feat(command-plane): Ira persona for FR-011"
```

---

### Task T005: Hook registry with fail-closed try/catch

**Implements:** FR-024, FR-033, FR-034

**Depends on:** T001

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Hook throws must not fail forge after saveState; deny with `HOOK_FAILED_CLOSED` (OD-015, decision test 3).

**Files:**
- Create: `packages/core/src/command-plane/hooks.ts`
- Test: `packages/core/test/command-plane/hooks.test.ts`

**Interfaces:**
- Produces: `registerCommandPlaneHooks`, `safeBeforeDispatch`, `safeEngineDispatch` wrapping try/catch; append `hook.failed` when log writable

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { registerCommandPlaneHooks, safeBeforeDispatch } from "../../src/command-plane/hooks.js";

describe("safeBeforeDispatch", () => {
  it("returns allow false when hook throws", async () => {
    registerCommandPlaneHooks({
      token: {
        async beforeDispatch() {
          throw new Error("boom");
        },
      },
    });
    const gate = await safeBeforeDispatch({
      intent: { featureId: "f", taskId: "T001", agentId: "a", personaPath: null, workspace: null, hiveRoot: "/h", specDir: "/s", attempt: 1, tier: "economy", freshSubagent: true },
      brief: { budgetTokens: null, budgetUsd: null },
    });
    expect(gate).toEqual({ allow: false, reason: "HOOK_FAILED_CLOSED" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/hooks.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement hook interfaces from design.md; wrap listed hooks in try/catch; never rethrow to MCP handler.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/hooks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/hooks.ts packages/core/test/command-plane/hooks.test.ts
git commit -m "feat(command-plane): fail-closed hook registry for OD-015"
```

---

## Phase 2: Hive init, ledger, forge bridge

### Task T006: Hive init and settings defaults

**Implements:** FR-008, FR-012, FR-023, FR-025, FR-028, FR-026

**Depends on:** T002, T003, T004, T005

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Layout + defaults including implicit `allowAbsentCi: false` (decision test 2).

**Files:**
- Create: `packages/core/src/command-plane/hive-init.ts`
- Create: `packages/core/src/command-plane/index.ts`
- Test: `packages/core/test/command-plane/hive-init.test.ts`

**Interfaces:**
- Produces: `hiveInit({ cwd, repair? })` creating hive layout; settings supervised/telemetry off/ceiling 3; gitignore line `.superspec/hive/`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hiveInit } from "../../src/command-plane/hive-init.js";

describe("hiveInit", () => {
  it("creates settings without allowAbsentCi field (read as false)", async () => {
    const root = await mkdtemp(join(tmpdir(), "cp-hive-"));
    process.env.SUPERSPEC_ROOT = root;
    await import("node:fs/promises").then((fs) => fs.writeFile(join(root, "program.md"), "# p\n"));
    await hiveInit({ cwd: root });
    const settings = JSON.parse(await readFile(join(root, ".superspec/hive/settings.json"), "utf8"));
    expect(settings.autonomy).toBe("supervised");
    expect(settings.allowAbsentCi).toBeUndefined();
    delete process.env.SUPERSPEC_ROOT;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/hive-init.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement idempotent hive-init per design layout including `dispatch-queue/` and `locks/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/hive-init.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/hive-init.ts packages/core/src/command-plane/index.ts packages/core/test/command-plane/hive-init.test.ts
git commit -m "feat(command-plane): hive-init defaults for FR-008"
```

---

### Task T007: Ledger sync from plan and forge

**Implements:** FR-003, FR-019

**Depends on:** T006

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Forge wins on status/reviewFailures; drift and traceability (decision test 3).

**Files:**
- Create: `packages/core/src/command-plane/ledger-sync.ts`
- Test: `packages/core/test/command-plane/ledger-sync.test.ts`

**Interfaces:**
- Produces: `syncHiveFromForge`, status maps, `implementsFr` copy from plan

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mapForgeStatusToHive } from "../../src/command-plane/ledger-sync.js";

describe("mapForgeStatusToHive", () => {
  it("maps in_progress to doing", () => {
    expect(mapForgeStatusToHive("in_progress")).toBe("doing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/ledger-sync.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement sync authority split and best-effort `hive.sync_failed` event on failure without touching forge state.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/ledger-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/ledger-sync.ts packages/core/test/command-plane/ledger-sync.test.ts
git commit -m "feat(command-plane): ledger sync for FR-003"
```

---

### Task T008: Forge reconcile, hive sync, DISPATCH_PATH_REQUIRED

**Implements:** FR-016, FR-017, FR-018, FR-027, FR-029

**Depends on:** T007

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Guard direct `begin-task` when hive exists; sync must not roll back forge (OD-010, decision test 3).

**Files:**
- Modify: `packages/core/src/forge-loop.ts`
- Modify: `packages/core/src/mcp-server.ts`
- Modify: `packages/core/src/cli.ts`
- Test: `packages/core/test/command-plane/forge-sync.test.ts`

**Interfaces:**
- Produces: `reconcileState`; `assertBeginTaskAllowed(hivePresent, internalCall)`; `maybeSyncHive` after successful forge writes

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { assertBeginTaskAllowed } from "../../src/command-plane/dispatch-guard.js";

describe("assertBeginTaskAllowed", () => {
  it("rejects external begin-task when hive exists", () => {
    expect(assertBeginTaskAllowed({ hiveExists: true, internalFromDispatch: false }).ok).toBe(false);
    expect(assertBeginTaskAllowed({ hiveExists: true, internalFromDispatch: false }).code).toBe("DISPATCH_PATH_REQUIRED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/forge-sync.test.ts`
Expected: FAIL cannot find `dispatch-guard.js`

- [ ] **Step 3: Write minimal implementation**

Add reconcileState; wire hive sync after forge success; block non-internal begin-task when hive.json present; pass maxReviewFailures from hive settings.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/forge-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/forge-loop.ts packages/core/src/mcp-server.ts packages/core/src/cli.ts packages/core/src/command-plane/dispatch-guard.ts packages/core/test/command-plane/forge-sync.test.ts
git commit -m "feat(command-plane): forge sync and DISPATCH_PATH_REQUIRED"
```

---

## Phase 3: Brief, Ask-Me, replan, dispatch, hold

### Task T009: Goal brief submit and roster placeholder

**Implements:** FR-002, FR-020

**Depends on:** T007

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Staff from parsePlan + agent-host placeholder (decision test 2).

**Files:**
- Create: `packages/core/src/command-plane/brief.ts`
- Create: `packages/core/src/command-plane/roster.ts`
- Test: `packages/core/test/command-plane/brief.test.ts`

**Interfaces:**
- Produces: `briefSubmit` persisting brief, ledger rows, assignment

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { pickFirstAssignment } from "../../src/command-plane/brief.js";

describe("pickFirstAssignment", () => {
  it("assigns agent-host when roster empty", () => {
    expect(pickFirstAssignment([], "T001")?.agentId).toBe("agent-host");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/brief.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement brief-submit flow per design; insert placeholder roster row when empty.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/brief.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/brief.ts packages/core/src/command-plane/roster.ts packages/core/test/command-plane/brief.test.ts
git commit -m "feat(command-plane): brief submit for FR-002"
```

---

### Task T010: Ask-Me inbox and critical classes

**Implements:** FR-004, FR-009, FR-010

**Depends on:** T006, T003

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Critical-class ordering and answer actions (decision test 3).

**Files:**
- Create: `packages/core/src/command-plane/ask-me.ts`
- Test: `packages/core/test/command-plane/ask-me.test.ts`

**Interfaces:**
- Produces: `openAskMeItem`, `listAskMe`, `answerAskMe`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { compareAskMeOrder } from "../../src/command-plane/ask-me.js";

describe("compareAskMeOrder", () => {
  it("sorts budget_exceed before ambiguous_requirement", () => {
    const a = { reasonClass: "budget_exceed", createdAt: "2026-10-15T02:00:00.000Z" };
    const b = { reasonClass: "ambiguous_requirement", createdAt: "2026-10-15T01:00:00.000Z" };
    expect(compareAskMeOrder(a, b)).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/ask-me.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement wx-create items, dedupe by (featureId, taskId, reasonClass), answer actions.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/ask-me.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/ask-me.ts packages/core/test/command-plane/ask-me.test.ts
git commit -m "feat(command-plane): Ask-Me for FR-004"
```

---

### Task T011: Replan on real review failure only

**Implements:** FR-005, FR-027, FR-030

**Depends on:** T008, T010

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Single reviewFailures counter; pause/abort must not increment (OD-011, decision test 3).

**Files:**
- Create: `packages/core/src/command-plane/replan.ts`
- Test: `packages/core/test/command-plane/replan.test.ts`

**Interfaces:**
- Produces: `applyReplanAfterFailure`, `replanKindForFailure`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { pauseIncrementsReviewFailures } from "../../src/command-plane/replan.js";

describe("pauseIncrementsReviewFailures", () => {
  it("is false for task-hold path", () => {
    expect(pauseIncrementsReviewFailures()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/replan.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Wire replan only after `record-result` with `passed: false`; at ceiling open Ask-Me `repeated_review_failure`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/replan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/replan.ts packages/core/test/command-plane/replan.test.ts
git commit -m "feat(command-plane): replan policy for FR-005"
```

---

### Task T012: dispatch-task steer command

**Implements:** FR-001, FR-020, FR-029, FR-032, FR-033, FR-034

**Depends on:** T008, T005, T010, T011

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Fixed hook order, hiveReady gate, host queue, Slice A token gate (OD-009/010/020, decision test 3).

**Files:**
- Create: `packages/core/src/command-plane/dispatch.ts`
- Test: `packages/core/test/command-plane/dispatch.test.ts`

**Interfaces:**
- Produces: `dispatchTask({ featureId, taskId, cwd?, internal? })` implementing steps 1–7 from FR-029; `queueHostDispatchIntent` at `dispatch-queue/<featureId>/<taskId>.json` mode 0600

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { dispatchRefusalForHold } from "../../src/command-plane/dispatch.js";

describe("dispatchRefusalForHold", () => {
  it("returns DISPATCH_HELD when hold true", () => {
    expect(dispatchRefusalForHold({ hold: true })).toEqual({ ok: false, code: "DISPATCH_HELD" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/dispatch.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement full dispatch-task pipeline: hiveReady check, DAG/hold/Ask-Me/CI/traceability gates, Slice A `beforeDispatch` (host allow, byok/local deny SLICE_A_ONLY), engine dispatch null for host, internal begin-task + hive sync; cleanup queue on begin-task failure.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/dispatch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/dispatch.ts packages/core/test/command-plane/dispatch.test.ts
git commit -m "feat(command-plane): dispatch-task for FR-029"
```

---

### Task T013: task-hold and task-abort

**Implements:** FR-030

**Depends on:** T007, T012

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Hive-only hold and abort without record-result (OD-011, decision test 2).

**Files:**
- Create: `packages/core/src/command-plane/task-control.ts`
- Test: `packages/core/test/command-plane/task-control.test.ts`

**Interfaces:**
- Produces: `taskHold({ featureId, taskId, hold })`, `taskAbort({ featureId, taskId, confirm, abortReason })`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { abortWithoutConfirmWritesNothing } from "../../src/command-plane/task-control.js";

describe("taskAbort", () => {
  it("requires confirm true", () => {
    expect(abortWithoutConfirmWritesNothing({ confirm: false }).writes).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/task-control.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement hold/resume events; abort clears in_progress without incrementing reviewFailures; return ABORT_UNSUPPORTED when only failure path would burn review.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/task-control.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/task-control.ts packages/core/test/command-plane/task-control.test.ts
git commit -m "feat(command-plane): task-hold and task-abort for FR-030"
```

---

### Task T014: Idle wake via dispatch-task

**Implements:** FR-006, FR-029

**Depends on:** T009, T012, T011

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Must call dispatch-task not argv begin-task (OD-010, decision test 3).

**Files:**
- Modify: `packages/core/src/command-plane/dispatch.ts`
- Modify: `packages/core/src/mcp-server.ts` (record-result path)
- Modify: `packages/core/src/cli.ts`
- Test: `packages/core/test/command-plane/idle-wake.test.ts`

**Interfaces:**
- Produces: `idleWakeAfterPass(ctx)` calling `dispatchTask` internally; observe mode emits `task.recommended` only

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { idleWakeUsesDispatchTask } from "../../src/command-plane/dispatch.js";

describe("idleWakeUsesDispatchTask", () => {
  it("is true for supervised and autonomous", () => {
    expect(idleWakeUsesDispatchTask("supervised")).toBe(true);
    expect(idleWakeUsesDispatchTask("observe")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/idle-wake.test.ts`
Expected: FAIL export missing

- [ ] **Step 3: Write minimal implementation**

On passing record-result, assign next DAG-ready task and invoke dispatch-task before tool return; never call begin-task directly from idle wake.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/idle-wake.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/dispatch.ts packages/core/src/mcp-server.ts packages/core/src/cli.ts packages/core/test/command-plane/idle-wake.test.ts
git commit -m "feat(command-plane): idle wake dispatch-task for FR-006"
```

---

## Phase 4: Mailbox, blackboard, away, doctor

### Task T015: Hive mailboxes single-writer

**Implements:** FR-013

**Depends on:** T003, T010

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Role checks and escalate routing (decision test 2).

**Files:**
- Create: `packages/core/src/command-plane/mailbox.ts`
- Test: `packages/core/test/command-plane/mailbox.test.ts`

**Interfaces:**
- Produces: `mailboxPost`, `mailboxRead`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { assertMailboxRole } from "../../src/command-plane/mailbox.js";

describe("assertMailboxRole", () => {
  it("rejects worker posting to inbox", () => {
    expect(() => assertMailboxRole({ role: "worker", box: "inbox" })).toThrow(/MAILBOX_ROLE/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/mailbox.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement JSONL append under mailbox locks; escalate to Ask-Me when needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/mailbox.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/mailbox.ts packages/core/test/command-plane/mailbox.test.ts
git commit -m "feat(command-plane): mailboxes for FR-013"
```

---

### Task T016: Blackboard scribe and hive-ci-set

**Implements:** FR-014, FR-026

**Depends on:** T006, T003

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Single scribe lock and CI field for away gate (decision test 2).

**Files:**
- Create: `packages/core/src/command-plane/blackboard.ts`
- Test: `packages/core/test/command-plane/blackboard.test.ts`

**Interfaces:**
- Produces: `blackboardUpdate`, `hiveCiSet({ featureId, state, source })`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { evaluateCiGate } from "../../src/command-plane/blackboard.js";

describe("evaluateCiGate (OD-013)", () => {
  it("blocks absent when allowAbsentCi false", () => {
    expect(evaluateCiGate({ ci: null, allowAbsentCi: false })).toEqual({ pass: false, reason: "ci_absent" });
  });
  it("passes absent when allowAbsentCi true", () => {
    expect(evaluateCiGate({ ci: "absent", allowAbsentCi: true })).toEqual({ pass: true, reason: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/blackboard.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement blackboard scribe with 0 ms wait; store CI state on feature entry.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/blackboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/blackboard.ts packages/core/test/command-plane/blackboard.test.ts
git commit -m "feat(command-plane): blackboard CI gate for FR-026"
```

---

### Task T017: Away mode heartbeat and dispatch-task tick

**Implements:** FR-007, FR-026, FR-025, FR-029

**Depends on:** T014, T016, T010, T012

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Heartbeat fsync, CI table, calls dispatch-task only (OD-013, decision test 3).

**Files:**
- Create: `packages/core/src/command-plane/away.ts`
- Test: `packages/core/test/command-plane/away.test.ts`

**Interfaces:**
- Produces: `awaySet`, `awayTick`, `writeAwayHeartbeat`, skip reasons `heartbeat_failed`, `ci_absent`, `ci_not_green`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { awayTickOrder } from "../../src/command-plane/away.js";

describe("awayTickOrder", () => {
  it("writes heartbeat before dispatch consideration", () => {
    expect(awayTickOrder()).toEqual(["heartbeat", "gates", "dispatch-task"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/away.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement 60s poll, away.pid, tick calling dispatch-task; autonomous-only auto dispatch from poll.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/away.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/away.ts packages/core/test/command-plane/away.test.ts
git commit -m "feat(command-plane): away mode OD-013 for FR-007"
```

---

### Task T018: Doctor hiveReady, engineRungReady, sliceAValidated

**Implements:** FR-022, FR-023, FR-034

**Depends on:** T006, T007, T017, T012, T010, T013

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Split readiness booleans and four Slice A checks recomputed each run (OD-014/020, decision test 3).

**Files:**
- Create: `packages/core/src/command-plane/doctor.ts`
- Test: `packages/core/test/command-plane/doctor.test.ts`

**Interfaces:**
- Produces: `runDoctor` returning `hiveReady`, `engineRungReady`, `ready===hiveReady`, `sliceAValidated`, `worktreeKind`, `sandboxed:false` in Slice A; finding `AWAY_PID_STALE` error without deleting away.pid

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeHiveReady } from "../../src/command-plane/doctor.js";

describe("computeHiveReady", () => {
  it("stays true when only engine finding present", () => {
    expect(computeHiveReady({ hiveFindings: [], engineFindings: [{ code: "ENGINE_NONE_HEALTHY" }] })).toBe(true);
  });
  it("false when AWAY_PID_STALE present", () => {
    expect(computeHiveReady({ hiveFindings: [{ code: "AWAY_PID_STALE" }], engineFindings: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/doctor.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Implement doctor checks from design; run Slice A self-checks (host dispatch queues intent, Ask-Me round-trip) to set sliceAValidated.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/doctor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/command-plane/doctor.ts packages/core/test/command-plane/doctor.test.ts
git commit -m "feat(command-plane): doctor hiveReady and Slice A for FR-022"
```

---

## Phase 5: CLI, MCP, contracts, verification

### Task T019: CLI JSON subcommands

**Implements:** FR-001, FR-021

**Depends on:** T018

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Wire all handlers including dispatch-task, task hold/abort (decision test 2).

**Files:**
- Modify: `packages/core/src/cli.ts`
- Test: `packages/core/test/cli.test.ts`

**Interfaces:**
- Produces: CLI commands from design Contracts table including `dispatch-task`, `task hold`, `task abort`, `away --allow-absent-ci`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { runCli } from "../src/cli.js";

describe("cli dispatch-task help", () => {
  it("registers dispatch-task subcommand", async () => {
    const out = await runCli(["dispatch-task", "--help"]);
    expect(out.stdout).toMatch(/dispatch-task/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/cli.test.ts -t "dispatch-task"`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Add command-plane subcommands printing JSON envelopes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli.ts packages/core/test/cli.test.ts
git commit -m "feat(command-plane): CLI surface for FR-001"
```

---

### Task T020: MCP tool registration

**Implements:** FR-001, FR-018, FR-021

**Depends on:** T019

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Register dispatch-task, task-hold, task-abort beside forge tools (decision test 2).

**Files:**
- Modify: `packages/core/src/mcp-server.ts`
- Test: `packages/core/test/mcp-server.test.ts`

**Interfaces:**
- Produces: MCP tools including `dispatch-task`, `task-hold`, `task-abort`, `doctor`, hive tools

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildToolDefinitions } from "../src/mcp-server.js";

describe("mcp dispatch-task", () => {
  it("registers dispatch-task and task-hold", () => {
    const names = buildToolDefinitions().map((t) => t.name);
    expect(names).toContain("dispatch-task");
    expect(names).toContain("task-hold");
    expect(names).toContain("task-abort");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/mcp-server.test.ts -t "dispatch-task"`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Register tools with zod inputs matching design contracts; preserve forge tools when hive absent.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/mcp-server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp-server.ts packages/core/test/mcp-server.test.ts
git commit -m "feat(command-plane): MCP tools for FR-018"
```

---

### Task T021: CLI/MCP contract parity

**Implements:** FR-001, FR-021

**Depends on:** T020

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Assert shared error codes (decision test 1).

**Files:**
- Create: `packages/core/test/command-plane/contracts.test.ts`

**Interfaces:**
- Consumes: `COMMAND_PLANE_ERROR_CODES`, tool names

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { COMMAND_PLANE_ERROR_CODES } from "../../src/command-plane/types.js";

describe("contracts", () => {
  it("includes amendment steer codes", () => {
    expect(COMMAND_PLANE_ERROR_CODES).toContain("DISPATCH_PATH_REQUIRED");
    expect(COMMAND_PLANE_ERROR_CODES).toContain("DISPATCH_HELD");
    expect(COMMAND_PLANE_ERROR_CODES).toContain("SLICE_A_ONLY");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/contracts.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Add contract tests for MCP/CLI parity on dispatch-task JSON shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/command-plane/contracts.test.ts
git commit -m "test(command-plane): contract parity for FR-021"
```

---

### Task T022: Integration tests (dispatch path, hold, away CI)

**Implements:** FR-003, FR-018, FR-019, FR-029, FR-030, FR-031

**Depends on:** T020

**Kind:** code

**Complexity:** complex

**Complexity rationale:** SC-003, SC-008, SC-009, SC-011 coverage (decision test 3).

**Files:**
- Create: `packages/core/test/command-plane/integration-forge-hive.test.ts`

**Interfaces:**
- Consumes: temp repo fixtures

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";

describe("integration dispatch-task path", () => {
  it("rejects direct begin-task when hive exists", async () => {
    expect(false).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/command-plane/integration-forge-hive.test.ts`
Expected: FAIL assertion

- [ ] **Step 3: Write minimal implementation**

Build temp workspace: hive-init, brief, dispatch-task success, direct begin-task DISPATCH_PATH_REQUIRED, task-hold leaves reviewFailures unchanged, away ci_absent when allowAbsentCi false.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/command-plane/integration-forge-hive.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/command-plane/integration-forge-hive.test.ts
git commit -m "test(command-plane): integration for amendment invariants"
```

---

### Task T023: Public package exports

**Implements:** FR-018

**Depends on:** T020

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Re-export decided API (decision test 1).

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Produces: exports for hooks, types, dispatch helpers

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { registerCommandPlaneHooks, IRA_PERSONA } from "@superspec-dev/core";

describe("core exports", () => {
  it("exports command plane surface", () => {
    expect(IRA_PERSONA.callsign).toBe("Ira");
    expect(typeof registerCommandPlaneHooks).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/smoke.test.ts -t "exports"`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Re-export public command-plane symbols from index.ts.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/smoke.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/smoke.test.ts
git commit -m "feat(command-plane): export public API"
```

---

### Task T024: Verify core suite and plan lint

**Implements:** FR-017, FR-019

**Depends on:** T023

**Kind:** verify

**Complexity:** mechanical

**Complexity rationale:** Deterministic verification checklist (decision test 1).

**Files:**
- Test: uses existing `packages/core/test/**`

**Interfaces:**
- Produces: green vitest run and clean plan lint

- [ ] **Step 1: Run full core tests**

Run: `pnpm exec vitest run packages/core/test`
Expected: all tests PASS

- [ ] **Step 2: Run lint-plan on this feature plan**

Run: `pnpm dlx tsx -e "import { readFileSync } from 'node:fs'; import { lintPlan } from './packages/core/src/plan-lint.ts'; const f=lintPlan(readFileSync('specs/001-ira-command-plane/plan.md','utf8')); if(f.length){console.error(JSON.stringify(f,null,2)); process.exit(1)} console.log('lint-plan: clean');"`
Expected: `lint-plan: clean`

- [ ] **Step 3: Record verify sign-off**

Owner: @tech-lead — P-001 plan forge-ready; Slice A P0 tasks T001–T018 satisfied before full program continuation.

---

## FR coverage checklist (self-review)

| FR | Task(s) |
|----|---------|
| FR-001 | T019, T020, T021 |
| FR-002 | T009 |
| FR-003 | T007, T022 |
| FR-004 | T010 |
| FR-005 | T011 |
| FR-006 | T014 |
| FR-007 | T017 |
| FR-008 | T006 |
| FR-009 | T010, T019, T020 |
| FR-010 | T010, T011, T012 |
| FR-011 | T004 |
| FR-012 | T001, T003, T006 |
| FR-013 | T015 |
| FR-014 | T016 |
| FR-015 | T001, T003 |
| FR-016 | T008 |
| FR-017 | T008, T024 |
| FR-018 | T008, T020, T022, T023 |
| FR-019 | T007, T014, T022, T024 |
| FR-020 | T009, T012, T014 |
| FR-021 | T019, T020, T021 |
| FR-022 | T018 |
| FR-023 | T006, T018 |
| FR-024 | T001, T005, T018 |
| FR-025 | T006, T017, T019 |
| FR-026 | T016, T017 |
| FR-027 | T008, T011, T013 |
| FR-028 | T002, T006 |
| FR-029 | T008, T012, T014, T017 |
| FR-030 | T001, T011, T013 |
| FR-031 | T003, T022 |
| FR-032 | T012 |
| FR-033 | T005, T012 |
| FR-034 | T005, T012, T018 |
