# Ira Engine Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superspec-forge to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement P-006 engine roster in `@superspec-dev/core`: versioned presets, PATH detection, roster bind, credential matrix, local-pack 64k gate, failover ladder, cross-engine review policy, normalized `engine.*` hive events, and `EngineHooks` registration — all via CLI/MCP without Command Center — with amendment fail-closed host spawn and Slice A forge gating.

**Architecture:** New `packages/core/src/engines/` modules persist under `<repository-root>/.superspec/hive/engines/`. `registerCommandPlaneHooks({ engine })` wires `detectInstalled`, `dispatch`, and `normalizeEvent` at CLI/MCP startup with OD-015 hook try/catch (deny on throw; forge `saveState` success preserved). Host engines (`claude`, `codex`, `cursor-agent`; input alias `cursor` → `cursor-agent`) always get `EngineHooks.dispatch` → `null`: the attached host runs the fresh subagent; Ira MUST NOT parent those CLIs from IDE-attached MCP (`HOST_SPAWN_FORBIDDEN`). Away/idle wake writes `<hiveRoot>/dispatch-queue/<featureId>/<taskId>.json` mode `0600` and starts no host CLI. Until doctor reports `sliceAValidated: true`, detached spawn of `opencode`, `crush`, `aider`, and `custom` returns `{ ok: false, code: "SLICE_A_ONLY" }` and starts no child. After Slice A validates, those four ids run only as a detached supervisor child (`superspec engines supervise`, `detached: true`, `shell: false`, stdio not MCP pipes, OD-019 scrubbed env). Events append only through P-001 hive writer + `locks/events.lock`. Doctor emits separate `hiveReady` (coordination store) and `engineRungReady` (engine rung health); engine findings MUST NOT set `hiveReady` false.

**Tech Stack:** TypeScript 5, Node >= 20, ESM, Vitest, Zod (existing core deps), `node:child_process` `execFile`/`spawn` with argv arrays only — never `shell: true`; `fetch` for loopback model probes; reuses P-001 `command-plane/store.ts`, `hooks.ts`, `paths.ts`, `model-router.ts`, `harness-model-map.ts`, `persona-discovery.ts`.

## Global Constraints

- Runtime: Node.js >= 20, `"type": "module"`, NodeNext resolution (match `packages/core`).
- Dependencies: no new runtime npm packages (no PTY/ACP SDK); MCP process MUST NOT `execFile`/`spawn` argv0 `claude`, `codex`, `cursor-agent`, or `agent` (OD-009, FR-023).
- Storage: engine state under `.superspec/hive/engines/` (`policy.json`, `local-pack.json`, `custom.json`, `health.json`); host intents under `.superspec/hive/dispatch-queue/` mode `0600`; roster via P-001 `roster.json`; secrets never in hive JSON (FR-011).
- Host delegate: when MCP is attached to a host, `delegateToHost` defaults to that host; persisted `delegateToHost: null`, `away.pid` match, and `engines hooks install` MUST NOT authorize Ira-parent host spawn (FR-023).
- Slice A (OD-020): live P-006 surface is host-delegate only until `sliceAValidated: true`; non-host supervisor spawn is no-op `SLICE_A_ONLY` with no side effect (FR-027).
- Supervisor (OD-015, OD-019): non-host children only in detached supervisor; `SUPERVISOR_IN_MCP_FORBIDDEN` for in-process supervisor from MCP handler; supervisor `env` is a new object with base allowlist only — MUST NOT spread `process.env`; `byokEnvAllowlist` names copied only when effective rung is `byok`; drop names matching `KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL` (FR-026).
- Doctor (OD-014): `hiveReady` and `engineRungReady` are separate booleans; legacy `ready` if emitted equals `hiveReady` only; `worktreeKind` (`main`|`linked`) and `sandboxed` independent; linked worktree MUST NOT imply `sandboxed: true` (`WORKTREE_IS_NOT_SANDBOX`, FR-019).
- Model tiers: roster `model` and `routeModel` use only `economy` | `standard` | `frontier` (FR-016); per-agent roster tier overrides `intent.tier` for that agent only.
- Local context floor: `LOCAL_CONTEXT_FLOOR = 65536`; unknown advertised context fails that local rung only; MUST NOT set `hiveReady` false (FR-006, FR-014).
- Failover: subscription → BYOK → local at `dispatch` boundary only; re-call `TokenHooks.beforeDispatch` on effective engine after rung change (OD-010 step 5, FR-012); no mid-turn engine swap (FR-013); stored roster preference is not rewritten on failover.
- Event types: `engine.start`, `engine.tool`, `engine.stop`, `engine.error`, `engine.tokens`, `engine.failover`, `engine.policy_degraded`; no fabricated token counts (FR-010).
- Catalog: `ENGINE_CATALOG_VERSION = 1`; seven builtin ids plus `custom:<instanceId>` rows in `engines/custom.json`; detached supervisor allowlist: `opencode`, `crush`, `aider`, `custom` only (FR-024).
- Testing: **Kind: code** tasks use red-green-refactor with `pnpm exec vitest run <file>` from repo root.

**Prerequisite:** P-001 Command Plane (`packages/core/src/command-plane/*`, `DispatchIntent`, `EngineHooks`, `registerCommandPlaneHooks`, hive init, Ask-Me, event append, doctor `sliceAValidated` computation) MUST land before forge tasks T014–T021.

## Forge tracks (OD-020)

| Track | Tasks | Forge when |
|-------|-------|------------|
| **Slice A P0** | T001–T021 | Always (program.md forge order step 2) |
| **Post–Slice A deferred** | T022–T024 | Only after doctor reports `sliceAValidated: true` |

Post–Slice A tasks MUST NOT be forged in parallel with Slice A validation; execution-map windows **DW1–DW3** are gated on `sliceAValidated`.

---

## Phase 1: Types, catalog, detection

### Task T001: Engine domain types and Zod schemas

**Implements:** FR-020

**Depends on:** none

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Multi-entity contracts from design.md data model (decision tests 1–2).

**Files:**
- Create: `packages/core/src/engines/types.ts`
- Create: `packages/core/src/engines/schema.ts`
- Test: `packages/core/test/engines/schema.test.ts`

**Interfaces:**
- Consumes: design.md entities `EnginePreset`, `CustomEngine`, `LocalPackProfile`, `FailoverPolicy`, `CredentialMatrixRow`, `EngineHealth`, `LadderRung`, `EngineStrategy`
- Produces: `EngineId`, `AuthMode`, `EngineHealthStatus`, `FailoverPolicySchema`, `LocalPackProfileSchema`, `CustomEnginesFileSchema`, `ENGINE_CATALOG_VERSION`, `LOCAL_CONTEXT_FLOOR`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { FailoverPolicySchema, LOCAL_CONTEXT_FLOOR } from "../../src/engines/schema.js";

describe("FailoverPolicySchema", () => {
  it("requires fixed three-rung ladder order", () => {
    const p = FailoverPolicySchema.parse({
      schemaVersion: 1,
      failoverEnabled: true,
      ladder: ["subscription", "byok", "local"],
      crossEngineReview: false,
      delegateToHost: null,
      hitl: ["budget_exceed", "destructive_git"],
      quotaGroups: [],
    });
    expect(p.ladder[2]).toBe("local");
  });
});

describe("LOCAL_CONTEXT_FLOOR", () => {
  it("is 65536", () => {
    expect(LOCAL_CONTEXT_FLOOR).toBe(65536);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/schema.test.ts`
Expected: FAIL with cannot find module `engines/schema.js`

- [ ] **Step 3: Write minimal implementation**

Implement `schema.ts` with zod parsers matching design.md; re-export constants and inferred types from `types.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/types.ts packages/core/src/engines/schema.ts packages/core/test/engines/schema.test.ts
git commit -m "feat(engines): add engine zod schemas for FR-020"
```

---

### Task T002: Versioned builtin engine catalog

**Implements:** FR-002, FR-020

**Depends on:** T001

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Structured preset table with spawn argv and strategy per engine (decision test 2).

**Files:**
- Create: `packages/core/src/engines/catalog.ts`
- Test: `packages/core/test/engines/catalog.test.ts`

**Interfaces:**
- Consumes: `EngineId`, `EngineStrategy`, `LadderRung` from `types.ts`
- Produces: `listBuiltinPresets(): EnginePreset[]`, `getBuiltinPreset(engineId: EngineId): EnginePreset | null`, `parseCustomEngineId(engine: string): { kind: "builtin"; id: EngineId } | { kind: "custom"; instanceId: string } | null`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { listBuiltinPresets, getBuiltinPreset } from "../../src/engines/catalog.js";

describe("catalog", () => {
  it("lists exactly seven builtin engine ids at version 1", () => {
    const ids = listBuiltinPresets().map((p) => p.engineId).sort();
    expect(ids).toEqual(
      ["aider", "claude", "codex", "crush", "cursor-agent", "custom", "opencode"].sort(),
    );
    expect(ids).toContain("claude");
    expect(getBuiltinPreset("claude")?.strategy).toBe("hooks");
    expect(getBuiltinPreset("opencode")?.strategy).toBe("acp");
    expect(getBuiltinPreset("aider")?.strategy).toBe("pty");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/catalog.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Ship catalog v1 presets per design.md strategy table (hooks / acp / pty), spawn args, status args, auth env names, model allowlists, and MIT attribution header referencing Munder preset shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/catalog.test.ts`
Expected: PASS (adjust test to expect all seven ids including crush)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/catalog.ts packages/core/test/engines/catalog.test.ts
git commit -m "feat(engines): ship versioned builtin catalog for FR-002"
```

---

### Task T003: PATH-based engine detection

**Implements:** FR-002, FR-015

**Depends on:** T002

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** Allowlisted PATH lookup mirroring catalog binaries (decision test 3).

**Files:**
- Create: `packages/core/src/engines/detect.ts`
- Test: `packages/core/test/engines/detect.test.ts`

**Interfaces:**
- Consumes: `listBuiltinPresets()`, fake `PATH` via injected `envPath` and `execFile` stub
- Produces: `detectInstalled(options?: { envPath?: string; execFile?: typeof import("node:child_process").execFile }): Promise<Array<{ engineId: string; installed: boolean; binary: string | null }>>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { detectInstalled } from "../../src/engines/detect.js";

describe("detectInstalled", () => {
  it("marks claude installed when binary responds to --version", async () => {
    const execFile = vi.fn((_cmd, _args, _opts, cb) => cb(null, "1.0.0", ""));
    const rows = await detectInstalled({
      envPath: "/bin",
      execFile: execFile as never,
    });
    const claude = rows.find((r) => r.engineId === "claude");
    expect(claude?.installed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/detect.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Parallel `--version` probes with 1500 ms timeout; special-case `cursor-agent` then generic `agent` only when version text contains `Cursor`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/detect.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/detect.ts packages/core/test/engines/detect.test.ts
git commit -m "feat(engines): PATH detection for target CLIs FR-015"
```

---

## Phase 2: Hive layout, bind, health, matrix

### Task T004: Engines hive paths and policy bootstrap

**Implements:** FR-008, FR-020

**Depends on:** T001

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** New hive subtree with atomic JSON defaults (decision test 2).

**Files:**
- Create: `packages/core/src/engines/paths.ts`
- Create: `packages/core/src/engines/store.ts`
- Test: `packages/core/test/engines/paths.test.ts`

**Interfaces:**
- Consumes: P-001 `withLock`, `resolveHiveRoot` from `command-plane/paths.js`
- Produces: `enginesRoot(hiveRoot: string): string`, `ensureEnginesLayout(hiveRoot: string): Promise<{ ok: true } | { ok: false; error: "HIVE_NOT_INITIALIZED" }>`, `readPolicy(hiveRoot)`, `writePolicy(hiveRoot, policy)`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureEnginesLayout, enginesRoot } from "../../src/engines/paths.js";

describe("engines paths", () => {
  it("writes default policy.json with three-rung ladder", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    const r = await ensureEnginesLayout(hive);
    expect(r.ok).toBe(true);
    const raw = await readFile(join(enginesRoot(hive), "policy.json"), "utf8");
    expect(raw).toContain('"subscription"');
    expect(raw).toContain('"local"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/paths.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Create `policy.json`, empty `custom.json` shell, `health.json`, `local-pack.json` stubs under `engines/`; use P-001 lock pattern for writes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/paths.ts packages/core/src/engines/store.ts packages/core/test/engines/paths.test.ts
git commit -m "feat(engines): bootstrap hive/engines layout"
```

---

### Task T005: Roster engine bind validation and atomic write

**Implements:** FR-001, FR-003, FR-019, FR-021

**Depends on:** T002, T003, T004

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Cross-cutting roster + catalog + detection validation (decision test 2–3).

**Files:**
- Create: `packages/core/src/engines/bind.ts`
- Test: `packages/core/test/engines/bind.test.ts`

**Interfaces:**
- Consumes: `detectInstalled`, `getBuiltinPreset`, P-001 `loadRoster`/`saveRoster`, `discoverPersonas`
- Produces: `bindRosterEngine(hiveRoot: string, input: BindInput): Promise<BindResult>` with errors `ENGINE_NOT_FOUND`, `ENGINE_MISSING`, `MODEL_REJECTED`, `ROSTER_BUSY`, `INVALID_INPUT`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { validateBindInput } from "../../src/engines/bind.js";

describe("validateBindInput", () => {
  it("rejects workspace inside hive root", () => {
    const r = validateBindInput({
      agentId: "implementer",
      personaPath: "/repo/.cursor/agents/implementer.md",
      engine: "codex",
      model: "economy",
      workspace: "/repo/.superspec/hive",
      worktreePolicy: "isolated",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("INVALID_INPUT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/bind.test.ts`
Expected: FAIL with `validateBindInput` not exported

- [ ] **Step 3: Write minimal implementation**

Validate persona path, engine id, installed binary, model allowlist/tiers; default `worktreePolicy: "isolated"`; atomic roster rewrite under `locks/roster.lock`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/bind.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/bind.ts packages/core/test/engines/bind.test.ts
git commit -m "feat(engines): roster bind validation for FR-001"
```

---

### Task T006: Engine health cache and auth probes

**Implements:** FR-009, FR-014, FR-017

**Depends on:** T003, T004

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Multi-signal health table per preset (decision test 2).

**Files:**
- Create: `packages/core/src/engines/health.ts`
- Test: `packages/core/test/engines/health.test.ts`

**Interfaces:**
- Consumes: `catalog` status argv, env presence checks (never log values)
- Produces: `refreshEngineHealth(hiveRoot: string): Promise<EngineHealth[]>`, `getCachedHealth(hiveRoot, engineId)`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { authModeFromSignals } from "../../src/engines/health.js";

describe("authModeFromSignals", () => {
  it("returns missing when binary not installed", () => {
    expect(authModeFromSignals({ installed: false }).health).toBe("missing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/health.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Map design.md auth/health table; persist to `engines/health.json`; update on doctor and session errors (`rate_limited`, `quota_exhausted` → degraded).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/health.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/health.ts packages/core/test/engines/health.test.ts
git commit -m "feat(engines): per-engine health cache FR-009"
```

---

### Task T007: Credential matrix and secret redaction

**Implements:** FR-009, FR-011

**Depends on:** T006, T002

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Projection + redaction rules for serialized JSON (decision test 2).

**Files:**
- Create: `packages/core/src/engines/matrix.ts`
- Create: `packages/core/src/engines/redact.ts`
- Test: `packages/core/test/engines/matrix.test.ts`

**Interfaces:**
- Consumes: `getCachedHealth`, `listBuiltinPresets`, custom rows from `engines/custom.json`
- Produces: `buildCredentialMatrix(hiveRoot: string): Promise<{ catalogVersion: number; rows: CredentialMatrixRow[] }>`, `redactMessage(text: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { redactMessage } from "../../src/engines/redact.js";

describe("redactMessage", () => {
  it("redacts sk- prefixed tokens", () => {
    expect(redactMessage("failed sk-abc123secret")).not.toContain("sk-abc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/matrix.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Matrix rows without forbidden key names; scan tests for `apiKey`, `token`, `password`, `sk-`, `ghp_`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/matrix.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/matrix.ts packages/core/src/engines/redact.ts packages/core/test/engines/matrix.test.ts
git commit -m "feat(engines): secret-free credential matrix FR-011"
```

---

## Phase 3: Local pack, normalization, failover, review

### Task T008: Local pack profile and 64k context gate

**Implements:** FR-006, FR-007, FR-014

**Depends on:** T004

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Multi-backend probes and fail-closed unknown context (decision test 3).

**Files:**
- Create: `packages/core/src/engines/local-pack.ts`
- Test: `packages/core/test/engines/local-pack.test.ts`
- Create: `packages/core/test/engines/fixtures/ollama-show-small.json`

**Interfaces:**
- Consumes: `LOCAL_CONTEXT_FLOOR`, injected `execFile` / `fetch`
- Produces: `setLocalPack(hiveRoot, profile): Promise<LocalPackResult>`, `evaluateContextGate(profile): Promise<{ ok: true; advertisedContext: number } | { ok: false; code: "LOCAL_CONTEXT_BELOW_FLOOR" | "LOCAL_CONTEXT_UNKNOWN" }>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { evaluateContextFromProbe } from "../../src/engines/local-pack.js";

describe("evaluateContextFromProbe", () => {
  it("fails closed when probe returns no context fields", () => {
    const r = evaluateContextFromProbe({ backend: "ollama", probeValue: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LOCAL_CONTEXT_UNKNOWN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/local-pack.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Probe order per design.md (ollama show JSON, LM Studio/vLLM `/v1/models`, BYOK requires declared context); loopback URL validation for local backends.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/local-pack.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/local-pack.ts packages/core/test/engines/local-pack.test.ts packages/core/test/engines/fixtures/
git commit -m "feat(engines): local pack 64k context gate FR-006"
```

---

### Task T009: Normalized engine event mapping

**Implements:** FR-010, FR-022

**Depends on:** T001, T007

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Allowlist, dedupe start, tokens only when numeric (decision test 3).

**Files:**
- Create: `packages/core/src/engines/normalize.ts`
- Test: `packages/core/test/engines/normalize.test.ts`
- Create: `packages/core/test/engines/fixtures/hook-session-start.json`

**Interfaces:**
- Consumes: P-001 `IraEvent` shape, `redactMessage`
- Produces: `normalizeEngineEvent(raw, ctx): IraEvent | null`, vendor alias map for hooks/acp/pty/jsonl custom

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { normalizeEngineEvent } from "../../src/engines/normalize.js";

describe("normalizeEngineEvent", () => {
  it("returns null for tokens payload without numeric counts", () => {
    const ev = normalizeEngineEvent(
      { type: "tokens", data: { inputTokens: "nope" } },
      { agentId: "a1", engineId: "codex", taskId: "T001", sessionId: "ses_1" },
    );
    expect(ev).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/normalize.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Map to `engine.start|tool|stop|error|tokens`; second start same sessionId → null; strip tool args and prompts.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/normalize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/normalize.ts packages/core/test/engines/normalize.test.ts packages/core/test/engines/fixtures/
git commit -m "feat(engines): normalize lifecycle events FR-010"
```

---

### Task T010: Failover ladder selection at dispatch boundary

**Implements:** FR-008, FR-012, FR-013, FR-017

**Depends on:** T004, T006, T008

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Ladder walk, HITL gates, quota degraded rungs (decision test 3).

**Files:**
- Create: `packages/core/src/engines/failover.ts`
- Test: `packages/core/test/engines/failover.test.ts`

**Interfaces:**
- Consumes: `readPolicy`, health cache, local context gate, `TokenHooks.beforeDispatch` stub
- Produces: `selectEffectiveEngine(ctx: FailoverContext): FailoverDecision` emitting `engine.failover` payload when rung changes

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { selectEffectiveEngine } from "../../src/engines/failover.js";

describe("selectEffectiveEngine", () => {
  it("keeps preferred engine when healthy", () => {
    const d = selectEffectiveEngine({
      preferredEngineId: "codex",
      health: { codex: { health: "ok", authMode: "subscription" } },
      policy: { failoverEnabled: true, ladder: ["subscription", "byok", "local"] },
      localGateOk: true,
    });
    expect(d.engineId).toBe("codex");
    expect(d.failoverEvent).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/failover.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Walk ladder; `authMode: unknown` not auto-failover candidate; when effective engine changes, call `TokenHooks.beforeDispatch` again before spawn/`{ accepted: true }`; skip rungs whose preset `emits` omits `tokens` when numeric budget cap set (FR-012); append failover event data before spawn; `ENGINE_NONE_HEALTHY` path returns Ask-Me class `ambiguous_requirement`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/failover.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/failover.ts packages/core/test/engines/failover.test.ts
git commit -m "feat(engines): subscription→BYOK→local failover FR-008"
```

---

### Task T011: Cross-engine review policy

**Implements:** FR-004

**Depends on:** T004, T006

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Reviewer persona heuristics and degrade event (decision test 2).

**Files:**
- Create: `packages/core/src/engines/review-policy.ts`
- Test: `packages/core/test/engines/review-policy.test.ts`

**Interfaces:**
- Consumes: `crossEngineReview` flag from policy, persona basename contains `reviewer`, latest `engine.start` per task
- Produces: `applyCrossEngineReview(ctx): { engineId: string; policyDegraded?: { reason: "single_healthy_engine" } }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isReviewerPersona } from "../../src/engines/review-policy.js";

describe("isReviewerPersona", () => {
  it("detects task-reviewer persona path", () => {
    expect(isReviewerPersona("/repo/agents/task-reviewer.md")).toBe(true);
    expect(isReviewerPersona("/repo/agents/implementer.md")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/review-policy.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Default policy off; when on, pick different healthy engine or emit `engine.policy_degraded`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/review-policy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/review-policy.ts packages/core/test/engines/review-policy.test.ts
git commit -m "feat(engines): cross-engine review policy FR-004"
```

---

### Task T012: Dispatch model resolution (tiers and vendor slugs)

**Implements:** FR-003, FR-016, FR-005

**Depends on:** T002, T008, T005

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Integrates routeModel tiers without widening HarnessId (decision test 2).

**Files:**
- Create: `packages/core/src/engines/resolve-model.ts`
- Test: `packages/core/test/engines/resolve-model.test.ts`

**Interfaces:**
- Consumes: `routeModel`, `mapHarnessModel`, roster `model`, `local-pack.json` tiers map
- Produces: `resolveDispatchModel(intent, rosterRow, effectiveEngineId): { tier: "economy"|"standard"|"frontier"; vendorModel: string }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveDispatchModel } from "../../src/engines/resolve-model.js";

describe("resolveDispatchModel", () => {
  it("uses roster tier override over intent tier", () => {
    const r = resolveDispatchModel(
      { tier: "economy", agentId: "implementer" } as never,
      { model: "frontier", engine: "codex" } as never,
      "codex",
    );
    expect(r.tier).toBe("frontier");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/resolve-model.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Roster tier overrides intent; explicit vendor slug validated against allowlist; OpenCode/Crush/Aider use local-pack model unless tier map present.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/resolve-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/resolve-model.ts packages/core/test/engines/resolve-model.test.ts
git commit -m "feat(engines): per-agent model resolution FR-016"
```

---

## Phase 4: Slice A — host delegate, spawn guards, surfaces

### Task T013: Supervisor env scrub and detached spawn spec (no live child in Slice A)

**Implements:** FR-026, FR-025, FR-024

**Depends on:** T009, T012

**Kind:** code

**Complexity:** complex

**Complexity rationale:** OD-019 allowlist builder and OD-015 spawn argv contract without MCP-parented children (decision test 3).

**Files:**
- Create: `packages/core/src/engines/supervisor.ts`
- Create: `packages/core/src/engines/env-scrub.ts`
- Test: `packages/core/test/engines/env-scrub.test.ts`
- Test: `packages/core/test/engines/supervisor-spawn-spec.test.ts`

**Interfaces:**
- Consumes: catalog `byokEnvAllowlist`, effective rung, intent path, `process.env` fixture (must not be spread into output)
- Produces: `buildSupervisorEnv(input: EnvScrubInput): Record<string, string>`, `buildDetachedSupervisorSpawnSpec(intentPath: string, env: Record<string, string>): { argv: string[]; detached: true; shell: false; stdio: "ignore" | ["pipe","pipe"] }`, `assertSupervisorNotInMcp(caller: "mcp-handler"|"cli-supervise"): void`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildSupervisorEnv } from "../../src/engines/env-scrub.js";

describe("buildSupervisorEnv", () => {
  it("drops ANTHROPIC_API_KEY on non-byok rung and never spreads process.env", () => {
    const env = buildSupervisorEnv({
      rung: "local",
      processEnv: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-secret", HOME: "/home/op" },
      byokAllowlist: ["OPENAI_API_KEY"],
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/op");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/env-scrub.test.ts`
Expected: FAIL with cannot find module `engines/env-scrub.js`

- [ ] **Step 3: Write minimal implementation**

Implement OD-019 base allowlist; copy allowlist names only when `rung === "byok"`; drop credential-like names; spawn spec uses argv `["superspec","engines","supervise", intentPath]` with `detached: true`, `shell: false`. Export guard that throws `SUPERVISOR_IN_MCP_FORBIDDEN` when invoked from MCP handler context.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/env-scrub.test.ts packages/core/test/engines/supervisor-spawn-spec.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/supervisor.ts packages/core/src/engines/env-scrub.ts packages/core/test/engines/env-scrub.test.ts packages/core/test/engines/supervisor-spawn-spec.test.ts
git commit -m "feat(engines): OD-019 supervisor env scrub and spawn spec FR-026"
```

---

### Task T014: EngineHooks dispatch — host null, dispatch-queue, SLICE_A_ONLY

**Implements:** FR-023, FR-024, FR-027, FR-018, FR-008, FR-013, FR-019

**Depends on:** T005, T010, T011, T012, T013

**Kind:** code

**Complexity:** complex

**Complexity rationale:** Central dispatch integrates failover, review, host-delegate null, away queue, and Slice A non-host gate (decision test 3).

**Files:**
- Create: `packages/core/src/engines/dispatch.ts`
- Create: `packages/core/src/engines/dispatch-queue.ts`
- Create: `packages/core/src/engines/host-spawn-guard.ts`
- Create: `packages/core/src/engines/hooks-impl.ts`
- Test: `packages/core/test/engines/dispatch.test.ts`

**Interfaces:**
- Consumes: P-001 `DispatchIntent`, `TokenHooks.beforeDispatch`, `readSliceAValidated(hiveRoot)`, policy `delegateToHost`, modules above
- Produces: `createEngineHooks(hiveRoot: string): EngineHooks` with `dispatch` returning `null | { accepted: boolean } | { ok: false; code: "SLICE_A_ONLY" }`; `persistDispatchIntent(intent): Promise<string>` → queue path; `guardHostSpawn(engineId, ctx): { ok: true } | { ok: false; code: "HOST_SPAWN_FORBIDDEN" }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { sliceAGuardNonHostSpawn } from "../../src/engines/dispatch.js";

describe("sliceAGuardNonHostSpawn", () => {
  it("returns SLICE_A_ONLY for opencode when sliceAValidated is false", () => {
    expect(
      sliceAGuardNonHostSpawn({ sliceAValidated: false, effectiveEngineId: "opencode" }),
    ).toEqual({ ok: false, code: "SLICE_A_ONLY" });
    expect(
      sliceAGuardNonHostSpawn({ sliceAValidated: false, effectiveEngineId: "claude" }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/dispatch.test.ts`
Expected: FAIL with `sliceAGuardNonHostSpawn` is not exported

- [ ] **Step 3: Write minimal implementation**

Host engines (`claude`, `codex`, `cursor-agent`) always return `null` from `dispatch` (including `delegateToHost: null`, away, hooks install). Away/idle wake writes `dispatch-queue/<featureId>/<taskId>.json` mode `0600`. Any MCP code path that would spawn host argv0 returns `HOST_SPAWN_FORBIDDEN`. For `opencode`|`crush`|`aider`|`custom`, when `!sliceAValidated`, return `SLICE_A_ONLY` and spawn nothing; when validated, defer actual `spawn` to T022 (stub `{ accepted: false }` or call supervisor module without starting child until T022 lands). Reject `freshSubagent: false`; enforce isolated workspace rules (FR-019).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/dispatch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/dispatch.ts packages/core/src/engines/dispatch-queue.ts packages/core/src/engines/host-spawn-guard.ts packages/core/src/engines/hooks-impl.ts packages/core/test/engines/dispatch.test.ts
git commit -m "feat(engines): host-delegate dispatch and Slice A spawn gate FR-023 FR-027"
```

---

### Task T015: Hook ingest command and hooks install

**Implements:** FR-010, FR-014

**Depends on:** T009, T013

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Hook bridge wiring to normalize + append (decision test 2).

**Files:**
- Modify: `packages/core/src/cli.ts` (hidden `engines hook-ingest`)
- Create: `packages/core/src/engines/hook-ingest.ts`
- Create: `packages/core/src/engines/hooks-install.ts`
- Test: `packages/core/test/engines/hook-ingest.test.ts`

**Interfaces:**
- Consumes: `normalizeEngineEvent`, session id env `SUPERSPEC_ENGINE_SESSION`
- Produces: `runHookIngest(stdinJson: string, sessionId: string): Promise<{ ok: true }>`, `installProjectHookBridge(projectRoot: string, host: "claude"|"codex"|"cursor-agent"): Promise<{ ok: true; path: string }>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseHookStdin } from "../../src/engines/hook-ingest.js";

describe("parseHookStdin", () => {
  it("parses single JSON object from stdin buffer", () => {
    const obj = parseHookStdin(Buffer.from('{"type":"start"}'));
    expect(obj.type).toBe("start");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/hook-ingest.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Append via hive writer; `hooks install` adds `hook-ingest` beside existing SuperSpec hook reminder in `hooks/hooks*.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/hook-ingest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/hook-ingest.ts packages/core/src/engines/hooks-install.ts packages/core/src/cli.ts packages/core/test/engines/hook-ingest.test.ts
git commit -m "feat(engines): hook-ingest bridge for host hooks"
```

---

### Task T016: MCP engines tools

**Implements:** FR-021

**Depends on:** T003, T005, T007, T004, T008, T010, T011

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** JSON parity handlers registered in mcp-server (decision test 2).

**Files:**
- Modify: `packages/core/src/mcp-server.ts`
- Create: `packages/core/src/engines/mcp-handlers.ts`
- Test: `packages/core/test/engines/mcp-handlers.test.ts`

**Interfaces:**
- Consumes: detect, bind, matrix, policy show/set, local-pack set
- Produces: MCP tools `engines-detect`, `engines-bind`, `engines-matrix`, `engines-policy-show`, `engines-policy-set`, `engines-local-pack-set` returning design.md JSON envelopes

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { enginesDetectHandler } from "../../src/engines/mcp-handlers.js";

describe("enginesDetectHandler", () => {
  it("returns ok true and catalogVersion 1", async () => {
    const out = await enginesDetectHandler({}, { detectInstalled: async () => [] });
    expect(out.ok).toBe(true);
    expect(out.catalogVersion).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/mcp-handlers.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Register tools in `mcp-server.ts`; shared error codes from design.md contracts section.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/mcp-handlers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/mcp-handlers.ts packages/core/src/mcp-server.ts packages/core/test/engines/mcp-handlers.test.ts
git commit -m "feat(engines): MCP engines-* tools FR-021"
```

---

### Task T017: CLI engines commands

**Implements:** FR-021

**Depends on:** T016

**Kind:** code

**Complexity:** mechanical

**Complexity rationale:** CLI mirrors MCP JSON stdout (decision test 1).

**Files:**
- Modify: `packages/core/src/cli.ts`
- Create: `packages/core/src/engines/cli-engines.ts`
- Test: `packages/core/test/engines/cli-engines.test.ts`

**Interfaces:**
- Consumes: same handlers as `mcp-handlers.ts`
- Produces: subcommands `superspec engines detect|bind|matrix|policy show|policy set|local-pack set|hooks install`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildEnginesCliHelpLines } from "../../src/engines/cli-engines.js";

describe("buildEnginesCliHelpLines", () => {
  it("lists detect and bind subcommands", () => {
    const lines = buildEnginesCliHelpLines();
    expect(lines.join("\n")).toContain("engines detect");
    expect(lines.join("\n")).toContain("engines bind");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/cli-engines.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Wire argv parsing; stdout single JSON object; exit 0/1 matching MCP semantics.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/cli-engines.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/cli-engines.ts packages/core/src/cli.ts packages/core/test/engines/cli-engines.test.ts
git commit -m "feat(engines): CLI engines commands FR-021"
```

---

### Task T018: Doctor engine findings — hiveReady vs engineRungReady

**Implements:** FR-014, FR-015, FR-006, FR-019

**Depends on:** T006, T008, T015

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** OD-014 split readiness bits and OD-019 worktree/sandbox independence (decision test 2).

**Files:**
- Modify: `packages/core/src/command-plane/doctor.ts` (or equivalent P-001 module)
- Create: `packages/core/src/engines/doctor-findings.ts`
- Test: `packages/core/test/engines/doctor-findings.test.ts`

**Interfaces:**
- Consumes: detection, health, local gate, hook install state, git worktree kind probe
- Produces: `collectEngineDoctorFindings(hiveRoot: string): Promise<DoctorFinding[]>`, `computeEngineRungReady(findings, hostDelegateAvailable, postSliceARungs): boolean`, `mergeDoctorReadiness(baseHiveReady, findings): { hiveReady: boolean; engineRungReady: boolean; ready?: boolean }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mergeDoctorReadiness } from "../../src/engines/doctor-findings.js";

describe("mergeDoctorReadiness", () => {
  it("keeps hiveReady true when only engine findings are errors", () => {
    const r = mergeDoctorReadiness(true, [
      { code: "LOCAL_CONTEXT_UNKNOWN", severity: "error", message: "x" },
    ]);
    expect(r.hiveReady).toBe(true);
    expect(r.engineRungReady).toBe(false);
    expect(r.ready).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/doctor-findings.test.ts`
Expected: FAIL with `mergeDoctorReadiness` is not exported

- [ ] **Step 3: Write minimal implementation**

Integrate findings from design.md table; emit `hiveReady`, `engineRungReady`, `worktreeKind`, `sandboxed` (Slice A `sandboxed: false`); correct `WORKTREE_IS_NOT_SANDBOX` when sandbox was derived from worktree; legacy `ready` equals `hiveReady` only.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/doctor-findings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/doctor-findings.ts packages/core/test/engines/doctor-findings.test.ts
git commit -m "feat(engines): doctor hiveReady vs engineRungReady FR-014"
```

---

### Task T019: Register EngineHooks at startup (hook fail-closed)

**Implements:** FR-021, FR-018, FR-025

**Depends on:** T014, T015, T016

**Kind:** code

**Complexity:** moderate

**Complexity rationale:** Startup wiring across CLI and MCP entrypoints (decision test 2).

**Files:**
- Create: `packages/core/src/engines/register.ts`
- Modify: `packages/core/src/cli-entry.ts`
- Modify: `packages/core/src/mcp-server.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/engines/register.test.ts`

**Interfaces:**
- Consumes: `createEngineHooks`, P-001 `registerCommandPlaneHooks`
- Produces: `registerEngineHooks(hiveRoot: string): void`, export from package index

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { registerEngineHooks } from "../../src/engines/register.js";

describe("registerEngineHooks", () => {
  it("calls registerCommandPlaneHooks with engine key", () => {
    const spy = vi.fn();
    registerEngineHooks("/tmp/hive", { registerCommandPlaneHooks: spy } as never);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ engine: expect.any(Object) }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/register.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Call after hive root resolved on MCP/CLI startup; wrap registered hooks so throws become `{ allow: false }` / `{ accepted: false }` plus optional `hook.failed` / `HOOK_FAILED_CLOSED` without exiting the process (OD-015); no-op when hive missing (detect still works).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/register.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engines/register.ts packages/core/src/cli-entry.ts packages/core/src/mcp-server.ts packages/core/src/index.ts packages/core/test/engines/register.test.ts
git commit -m "feat(engines): register EngineHooks on startup"
```

---

## Phase 5: Integration and verification

### Task T020: Slice A integration — host null, queue, SLICE_A_ONLY

**Implements:** FR-023, FR-024, FR-027, FR-008, FR-006

**Depends on:** T019

**Kind:** code

**Complexity:** complex

**Complexity rationale:** SC-010/SC-013 fixtures with zero host children and non-host spawn blocked pre–Slice A (decision test 3).

**Files:**
- Create: `packages/core/test/engines/integration-slice-a.test.ts`
- Create: `packages/core/test/engines/fixtures/policy-failover.json`
- Create: `packages/core/test/engines/helpers/dispatch-fixture.ts`

**Interfaces:**
- Consumes: full registered hooks, temp hive, `sliceAValidated: false` doctor stub, spawn spy
- Produces: tests proving host `dispatch` → `null`, `dispatch-queue` file mode `0600`, `HOST_SPAWN_FORBIDDEN` on forbidden host spawn path, `SLICE_A_ONLY` for `opencode`, local gate refusal with `hiveReady` unchanged

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";

describe("integration slice A dispatch", () => {
  it("returns SLICE_A_ONLY for opencode when sliceAValidated is false", async () => {
    const { runDispatchFixture } = await import("./helpers/dispatch-fixture.js");
    const r = await runDispatchFixture("opencode-pre-slice-a");
    expect(r).toEqual({ ok: false, code: "SLICE_A_ONLY" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/integration-slice-a.test.ts`
Expected: FAIL cannot find helper module

- [ ] **Step 3: Write minimal implementation**

Add `helpers/dispatch-fixture.ts` building temp hive with roster + policy + health stubs; exercise `createEngineHooks().dispatch` with spawn spy asserting zero host argv0 children.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/integration-slice-a.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/engines/integration-slice-a.test.ts packages/core/test/engines/fixtures/ packages/core/test/engines/helpers/
git commit -m "test(engines): Slice A host-delegate integration fixtures"
```

---

### Task T021: Slice A verification gate

**Implements:** FR-002, FR-009, FR-016, FR-021, FR-023, FR-027

**Depends on:** T020

**Kind:** verify

**Complexity:** mechanical

**Complexity rationale:** Read-only verification commands for Slice A track (decision test 5).

**Files:**
- Test: all `packages/core/test/engines/*.test.ts` except deferred-only tests added in T023

**Interfaces:**
- Consumes: completed Slice A tasks T001–T020

- [ ] **Step 1: Run Slice A engines Vitest suite**

Run: `pnpm exec vitest run packages/core/test/engines --exclude integration-post-slice-a.test.ts`
Expected: all tests PASS

- [ ] **Step 2: Run plan lint on this feature plan**

Run: `pnpm dlx tsx -e "import { readFileSync } from 'node:fs'; import { lintPlan } from './packages/core/src/plan-lint.ts'; const f = lintPlan(readFileSync('specs/006-ira-engine-adapters/plan.md','utf8')); if (f.length) { console.error(JSON.stringify(f,null,2)); process.exit(1); } console.log('lint ok');"`
Expected: stdout `lint ok` and exit code 0

- [ ] **Step 3: Run build-matrix for FR traceability**

Run: `pnpm exec superspec build-matrix specs/006-ira-engine-adapters/plan.md specs/006-ira-engine-adapters/spec.md`
Expected: PASS with zero uncovered FR-### requirements (plan maps FR-001–FR-027 across T001–T024)

- [ ] **Step 4: Confirm route-model tiers unchanged**

Run: `pnpm exec vitest run packages/core/test/model-router.test.ts`
Expected: PASS — only `economy` | `standard` | `frontier`

- [ ] **Step 5: Sign-off record**

Owner: @qa — mark Slice A forge complete when Steps 1–2 pass and doctor can report host-delegate path live; defer DW windows until `sliceAValidated`.

---

## Phase 5: Post–Slice A deferred — detached supervisor spawn

### Task T022: Detached supervisor CLI and live child spawn

**Implements:** FR-024, FR-025, FR-010, FR-022

**Depends on:** T014, T021

**Kind:** code

**Complexity:** complex

**Complexity rationale:** OD-015 detached child for allowlisted ids only after `sliceAValidated` (decision test 3).

**Files:**
- Modify: `packages/core/src/cli.ts` (add `engines supervise`)
- Modify: `packages/core/src/engines/supervisor.ts`
- Create: `packages/core/src/engines/supervise-runner.ts`
- Test: `packages/core/test/engines/supervise-runner.test.ts`

**Interfaces:**
- Consumes: `buildDetachedSupervisorSpawnSpec`, intent JSON path, `sliceAValidated` gate from doctor
- Produces: `runSuperviseIntent(intentPath: string): Promise<{ ok: true; pid: number } | { ok: false; code: string }>`, `mapAcpNotification(...)`, PTY-class Aider/custom observation inside supervise process only

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { spawnDetachedSupervisor } from "../../src/engines/supervise-runner.js";

describe("spawnDetachedSupervisor", () => {
  it("uses detached true and shell false", async () => {
    const spawn = vi.fn(() => ({ pid: 4242, unref: () => {}, stdio: ["ignore", "ignore", "ignore"] }));
    const r = await spawnDetachedSupervisor({ intentPath: "/tmp/intent.json", spawnFn: spawn as never });
    expect(r.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ detached: true, shell: false }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/supervise-runner.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

Wire `superspec engines supervise <intentPath>` entrypoint; MCP `dispatch` calls spawn helper only when `sliceAValidated` and engine id ∈ `{opencode,crush,aider,custom}`; child crash → roster offline + `adapter_crash` without taking down MCP.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/supervise-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli.ts packages/core/src/engines/supervisor.ts packages/core/src/engines/supervise-runner.ts packages/core/test/engines/supervise-runner.test.ts
git commit -m "feat(engines): detached supervisor spawn post Slice A FR-024"
```

---

### Task T023: Post–Slice A integration — detached pid and scrubbed env

**Implements:** FR-024, FR-026, FR-004, FR-010

**Depends on:** T022

**Kind:** code

**Complexity:** complex

**Complexity rationale:** SC-011/SC-012 supervisor fixtures (decision test 3).

**Files:**
- Create: `packages/core/test/engines/integration-post-slice-a.test.ts`

**Interfaces:**
- Consumes: temp hive, `sliceAValidated: true`, injectable spawn
- Produces: tests proving supervisor pid ≠ MCP pid, stdio not MCP pipes, env scrub allowlist, failover event before `engine.start`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";

describe("integration post Slice A", () => {
  it("accepts opencode dispatch when sliceAValidated is true", async () => {
    const { runPostSliceAFixture } = await import("./helpers/post-slice-a-fixture.js");
    const r = await runPostSliceAFixture("opencode-accepted");
    expect(r.accepted).toBe(true);
    expect(r.supervisorPid).not.toBe(r.mcpPid);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/engines/integration-post-slice-a.test.ts`
Expected: FAIL cannot find helper module

- [ ] **Step 3: Write minimal implementation**

Add `helpers/post-slice-a-fixture.ts`; assert env lacks credential-like keys on non-BYOK rung; include cross-engine review degrade fixture.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/engines/integration-post-slice-a.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/engines/integration-post-slice-a.test.ts packages/core/test/engines/helpers/post-slice-a-fixture.ts
git commit -m "test(engines): post Slice A supervisor integration SC-011 SC-012"
```

---

### Task T024: Full P-006 verification gate

**Implements:** FR-001 through FR-027 (traceability)

**Depends on:** T023

**Kind:** verify

**Complexity:** mechanical

**Complexity rationale:** Read-only verification after deferred windows (decision test 5).

**Files:**
- Test: all `packages/core/test/engines/*.test.ts`

**Interfaces:**
- Consumes: completed tasks T001–T023

- [ ] **Step 1: Run full engines Vitest suite**

Run: `pnpm exec vitest run packages/core/test/engines`
Expected: all tests PASS

- [ ] **Step 2: Run plan lint**

Run: `pnpm dlx tsx -e "import { readFileSync } from 'node:fs'; import { lintPlan } from './packages/core/src/plan-lint.ts'; const f = lintPlan(readFileSync('specs/006-ira-engine-adapters/plan.md','utf8')); if (f.length) { console.error(JSON.stringify(f,null,2)); process.exit(1); } console.log('lint ok');"`
Expected: stdout `lint ok` and exit code 0

- [ ] **Step 3: Run build-matrix for full FR coverage**

Run: `pnpm exec superspec build-matrix specs/006-ira-engine-adapters/plan.md specs/006-ira-engine-adapters/spec.md`
Expected: PASS with zero uncovered FR-### requirements

- [ ] **Step 4: Confirm route-model tiers unchanged**

Run: `pnpm exec vitest run packages/core/test/model-router.test.ts`
Expected: PASS — only `economy` | `standard` | `frontier`

- [ ] **Step 5: Sign-off record**

Owner: @qa — mark P-006 forge complete when Steps 1–3 pass; matrix payloads contain zero secret-like fields in tests.
