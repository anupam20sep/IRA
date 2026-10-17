import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildRouteModelResponse,
  recordTierOverride,
} from "../../src/token-governor/routing-hints.js";

describe("routing-hints", () => {
  it("prefers economy hint when quotaRemainingPercent is below threshold", () => {
    const r = buildRouteModelResponse({
      complexity: "moderate",
      attempt: 1,
      quotaRemainingPercent: 10,
      settings: { lowQuotaPercent: 20 } as any,
    });
    expect(["economy", "standard", "frontier"]).toContain(r.tier);
    expect(r.quotaApplied).toBe(true);
    expect(r.routingHint?.preferredTier).toBe("economy");
    expect(r.routingHint?.reason).toBe("low_quota");
  });

  it("omits quota hint when quota signal missing", () => {
    const r = buildRouteModelResponse({ complexity: "mechanical", attempt: 1 });
    expect(r.quotaApplied).toBe(false);
    expect(r.routingHint).toBeUndefined();
    expect(r.overrideApplied).toBe(false);
  });

  it("applies operator override tier without introducing a fourth tier", () => {
    const r = buildRouteModelResponse({
      complexity: "mechanical",
      attempt: 1,
      operatorOverrideTier: "frontier",
    });
    expect(r.tier).toBe("frontier");
    expect(r.overrideApplied).toBe(true);
    expect(["economy", "standard", "frontier"]).toContain(r.tier);
  });

  it("records tier override append-only to tier-overrides.jsonl", async () => {
    const hive = await mkdtemp(join(tmpdir(), "hive-"));
    await mkdir(join(hive, "token"), { recursive: true });
    const row = await recordTierOverride(hive, {
      agentId: "agent-host",
      featureId: "004-ira-token-context",
      requestedTier: "frontier",
      reason: "operator priority",
      complexity: "mechanical",
      attempt: 1,
    });
    expect(row.id.startsWith("ovr_")).toBe(true);
    expect(row.requestedTier).toBe("frontier");
    expect(row.routeModelTier).toBe("economy");
    expect(row.actor).toBe("operator");
    const raw = await readFile(join(hive, "token", "tier-overrides.jsonl"), "utf8");
    expect(raw.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(raw.trim()).id).toBe(row.id);
  });
});
