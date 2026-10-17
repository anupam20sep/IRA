# Implementation Plan: ira-integrations

**Branch**: `007-ira-integrations`  
**Spec**: `specs/007-ira-integrations/spec.md`  
**Design**: `specs/007-ira-integrations/design.md`

**Architecture:** Optional adapters under `packages/core/src/integrations/`, all disabled by default. Registry loads `.superspec/hive/integrations/config.json`. Doctor findings never clear `hiveReady`. Channel paths may touch Ask-Me only. Board share tokens are read-only and distinct from OD-017 loopback bearer.

**Tech Stack:** TypeScript 5, Node ≥ 20, ESM, Vitest, Zod (existing core deps).

## Global Constraints

- No new runtime npm packages for MVP.
- Adapters default disabled; missing config ≡ disabled.
- Channel/OpenClaw MUST NOT call `hire-spawn-confirm`, `dispatch-task`, or budget setters.
- Adapter throws fail-closed for that adapter only (FR-009).
- Kind: code tasks use red-green-refactor with `pnpm exec vitest run <file>` from repo root.

---

### Task T001: Integration config schema and defaults

**Implements:** FR-002

**Depends on:** none

**Kind:** code

**Complexity:** mechanical

**Files:**
- Create: `packages/core/src/integrations/schema.ts`
- Create: `packages/core/src/integrations/types.ts`
- Test: `packages/core/test/integrations/schema.test.ts`

**Interfaces:**
- Produces: `IntegrationConfigSchema`, default all `enabled: false`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseIntegrationConfig } from "../../src/integrations/schema.js";

describe("IntegrationConfig", () => {
  it("defaults all adapters disabled when empty object", () => {
    const c = parseIntegrationConfig({});
    expect(c.adapters.openclaw.enabled).toBe(false);
    expect(c.adapters.hermes.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/integrations/schema.test.ts`
Expected: FAIL module not found

- [ ] **Step 3: Write minimal implementation**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/integrations/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/integrations/schema.ts packages/core/src/integrations/types.ts packages/core/test/integrations/schema.test.ts
git commit -m "feat(integrations): config schema defaults disabled"
```

---

### Task T002: Load and persist integration config

**Implements:** FR-002

**Depends on:** T001

**Kind:** code

**Complexity:** mechanical

**Files:**
- Create: `packages/core/src/integrations/config.ts`
- Test: `packages/core/test/integrations/config.test.ts`

**Interfaces:**
- Produces: `loadIntegrationConfig(hiveRoot)`, `saveIntegrationConfig(hiveRoot, config)`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { loadIntegrationConfig } from "../../src/integrations/config.js";

describe("loadIntegrationConfig", () => {
  it("returns defaults when file missing", async () => {
    const c = await loadIntegrationConfig("/tmp/no-hive-integrations");
    expect(c.adapters.boardShare.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/integrations/config.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/integrations/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/integrations/config.ts packages/core/test/integrations/config.test.ts
git commit -m "feat(integrations): load/save integration config"
```

---

### Task T003: Fail-closed adapter runner

**Implements:** FR-003, FR-009

**Depends on:** T001

**Kind:** code

**Complexity:** moderate

**Files:**
- Create: `packages/core/src/integrations/fail-closed.ts`
- Test: `packages/core/test/integrations/fail-closed.test.ts`

**Interfaces:**
- Produces: `runAdapterSafe(name, fn, fallback)` — catch → fallback, never throw

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { runAdapterSafe } from "../../src/integrations/fail-closed.js";

describe("runAdapterSafe", () => {
  it("returns fallback when adapter throws", async () => {
    const r = await runAdapterSafe("openclaw", async () => { throw new Error("boom"); }, { ok: false });
    expect(r).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/integrations/fail-closed.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/integrations/fail-closed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/integrations/fail-closed.ts packages/core/test/integrations/fail-closed.test.ts
git commit -m "feat(integrations): fail-closed adapter runner"
```

---

### Task T004: OpenClaw channel → Ask-Me mapping

**Implements:** FR-004, FR-003

**Depends on:** T002, T003

**Kind:** code

**Complexity:** complex

**Files:**
- Create: `packages/core/src/integrations/openclaw.ts`
- Test: `packages/core/test/integrations/openclaw.test.ts`

**Interfaces:**
- Produces: `handleOpenClawInbound({ hiveRoot, message })` → creates Ask-Me or rejects; never hire-spawn-confirm

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { handleOpenClawInbound } from "../../src/integrations/openclaw.js";

describe("handleOpenClawInbound", () => {
  it("rejects when adapter disabled", async () => {
    const r = await handleOpenClawInbound({
      hiveRoot: "/tmp/hive",
      enabled: false,
      message: { text: "approve please", channelId: "c1" },
    });
    expect(r).toEqual({ rejected: "ADAPTER_DISABLED" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/integrations/openclaw.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

When enabled, open Ask-Me with reasonClass `untrusted_import` or `channel_approval` per design; assert no call to hireSpawnConfirm (spy).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/integrations/openclaw.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/integrations/openclaw.ts packages/core/test/integrations/openclaw.test.ts
git commit -m "feat(integrations): OpenClaw inbound to Ask-Me"
```

---

### Task T005: Hermes adapter health and degrade

**Implements:** FR-005, FR-008

**Depends on:** T002, T003

**Kind:** code

**Complexity:** moderate

**Files:**
- Create: `packages/core/src/integrations/hermes.ts`
- Test: `packages/core/test/integrations/hermes.test.ts`

**Interfaces:**
- Produces: `probeHermesAdapter({ enabled, mcpEndpoint })` → `{ ok, detail }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { probeHermesAdapter } from "../../src/integrations/hermes.js";

describe("probeHermesAdapter", () => {
  it("reports unavailable when enabled but endpoint missing", async () => {
    const r = await probeHermesAdapter({ enabled: true, mcpEndpoint: undefined });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/integrations/hermes.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/integrations/hermes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/integrations/hermes.ts packages/core/test/integrations/hermes.test.ts
git commit -m "feat(integrations): Hermes adapter health probe"
```

---

### Task T006: Channel approve → ask-me-answer

**Implements:** FR-006, FR-003

**Depends on:** T002, T003

**Kind:** code

**Complexity:** complex

**Files:**
- Create: `packages/core/src/integrations/channel-approve.ts`
- Test: `packages/core/test/integrations/channel-approve.test.ts`

**Interfaces:**
- Produces: `handleChannelApprove({ hiveRoot, itemId, action, secret, expectedSecret })` → ask-me-answer or reject

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { handleChannelApprove } from "../../src/integrations/channel-approve.js";

describe("handleChannelApprove", () => {
  it("rejects bad secret without mutating Ask-Me", async () => {
    const r = await handleChannelApprove({
      hiveRoot: "/tmp/hive",
      enabled: true,
      itemId: "ask_1",
      action: "acknowledge",
      secret: "wrong",
      expectedSecret: "right",
    });
    expect(r).toEqual({ ok: false, code: "CHANNEL_AUTH_FAILED" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/integrations/channel-approve.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/integrations/channel-approve.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/integrations/channel-approve.ts packages/core/test/integrations/channel-approve.test.ts
git commit -m "feat(integrations): channel approve to ask-me-answer"
```

---

### Task T007: Board share token create/verify

**Implements:** FR-007

**Depends on:** T002

**Kind:** code

**Complexity:** moderate

**Files:**
- Create: `packages/core/src/integrations/board-share.ts`
- Test: `packages/core/test/integrations/board-share.test.ts`

**Interfaces:**
- Produces: `createShareToken`, `verifyShareToken`; mutating check helper `assertShareCannotMutate`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createShareToken, verifyShareToken } from "../../src/integrations/board-share.js";

describe("board share token", () => {
  it("verifies created token as board_read", async () => {
    const dir = "/tmp/hive-share-" + Date.now();
    const { token } = await createShareToken(dir);
    const v = await verifyShareToken(dir, token);
    expect(v).toEqual({ ok: true, scope: "board_read" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/integrations/board-share.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/integrations/board-share.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/integrations/board-share.ts packages/core/test/integrations/board-share.test.ts
git commit -m "feat(integrations): board share read-only tokens"
```

---

### Task T008: Integration doctor findings

**Implements:** FR-008, FR-001

**Depends on:** T004, T005, T007

**Kind:** code

**Complexity:** moderate

**Files:**
- Create: `packages/core/src/integrations/doctor-findings.ts`
- Modify: `packages/core/src/command-plane/doctor.ts` (merge findings; never clear hiveReady)
- Test: `packages/core/test/integrations/doctor-findings.test.ts`

**Interfaces:**
- Produces: `integrationDoctorFindings(hiveRoot)` — missing optional adapters → info/warn only

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { integrationDoctorFindings } from "../../src/integrations/doctor-findings.js";

describe("integrationDoctorFindings", () => {
  it("does not emit error severity for disabled adapters", async () => {
    const f = await integrationDoctorFindings("/tmp/hive");
    expect(f.every((x) => x.severity !== "error")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/integrations/doctor-findings.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/integrations/doctor-findings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/integrations/doctor-findings.ts packages/core/src/command-plane/doctor.ts packages/core/test/integrations/doctor-findings.test.ts
git commit -m "feat(integrations): doctor findings without hiveReady clear"
```

---

### Task T009: CLI + MCP integrations surface

**Implements:** FR-002, FR-007

**Depends on:** T002, T007, T008

**Kind:** code

**Complexity:** moderate

**Files:**
- Create: `packages/core/src/integrations/cli-integrations.ts`
- Modify: `packages/core/src/cli.ts`, `packages/core/src/mcp-server.ts`
- Create: `packages/core/src/integrations/index.ts`
- Test: `packages/core/test/integrations/cli-mcp.test.ts`

**Interfaces:**
- Produces: `integrations status|enable|disable|share-create`; MCP `integrations-status`, `integrations-share-create`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildToolDefinitions } from "../../src/mcp-server.js";

describe("integrations MCP", () => {
  it("registers integrations-status", () => {
    expect(buildToolDefinitions().map((t) => t.name)).toContain("integrations-status");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/integrations/cli-mcp.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/integrations/cli-mcp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/integrations/ packages/core/src/cli.ts packages/core/src/mcp-server.ts packages/core/test/integrations/cli-mcp.test.ts
git commit -m "feat(integrations): CLI and MCP status/share commands"
```

---

### Task T010: Standalone + no-hire-spawn integration proofs

**Implements:** FR-001, FR-003, SC-001, SC-003

**Depends on:** T004, T006, T008

**Kind:** code

**Complexity:** complex

**Files:**
- Create: `packages/core/test/integrations/standalone.integration.test.ts`

**Interfaces:**
- Produces: proofs that disabled adapters leave doctor hiveReady path alone; channel inbound never calls hireSpawnConfirm

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";

describe("integrations standalone", () => {
  it("channel inbound does not import hireSpawnConfirm", async () => {
    const spy = vi.fn();
    vi.doMock("../../src/hire/spawn.js", () => ({ hireSpawnConfirm: spy }));
    const { handleOpenClawInbound } = await import("../../src/integrations/openclaw.js");
    await handleOpenClawInbound({
      hiveRoot: "/tmp/x",
      enabled: true,
      message: { text: "hi", channelId: "c" },
      openAskMe: async () => ({ askMeId: "ask_x" }),
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/integrations/standalone.integration.test.ts`
Expected: FAIL or adjust to project mock style

- [ ] **Step 3: Write minimal implementation**

Stabilize fixtures; assert deny list.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/integrations/standalone.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/integrations/standalone.integration.test.ts
git commit -m "test(integrations): standalone and no hire-spawn proofs"
```

---

### Task T011: Public exports and verify gate

**Implements:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009

**Depends on:** T009, T010

**Kind:** verify

**Complexity:** mechanical

**Files:**
- Modify: `packages/core/src/index.ts` (re-export integrations public API)
- Test: `packages/core/test/integrations/exports.test.ts`

- [ ] **Step 1: Run integrations suite**

Run: `pnpm exec vitest run packages/core/test/integrations`
Expected: all PASS

- [ ] **Step 2: Run lint-plan**

Run: `pnpm dlx tsx -e "import { readFileSync } from 'node:fs'; import { lintPlan } from './packages/core/src/plan-lint.ts'; const f=lintPlan(readFileSync('specs/007-ira-integrations/plan.md','utf8')); if(f.length){console.error(f);process.exit(1)}; console.log('lint ok');"`
Expected: `lint ok`

- [ ] **Step 3: Run build-matrix**

Run: node matrix for FR-001–FR-009
Expected: 0 gaps

- [ ] **Step 4: Typecheck**

Run: `pnpm --dir packages/core exec tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Sign-off**

Owner: @qa — mark forge complete when Steps 1–4 pass.

---

## Appendix: FR coverage

| FR | Tasks |
|----|-------|
| FR-001 | T008, T010, T011 |
| FR-002 | T001, T002, T009, T011 |
| FR-003 | T003, T004, T006, T010 |
| FR-004 | T004, T010 |
| FR-005 | T005, T008 |
| FR-006 | T006, T010 |
| FR-007 | T007, T009 |
| FR-008 | T005, T008 |
| FR-009 | T003, T010 |
