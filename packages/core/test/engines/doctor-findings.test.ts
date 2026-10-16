import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LOCAL_CONTEXT_FLOOR } from "../../src/engines/types.js";
import {
  collectEngineDoctorFindings,
  computeEngineRungReady,
  mergeDoctorReadiness,
} from "../../src/engines/doctor-findings.js";
import { ensureEnginesLayout } from "../../src/engines/paths.js";

async function hiveRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "doctor-findings-"));
  await writeFile(join(root, "hive.json"), JSON.stringify({ schemaVersion: 1, repositoryRoot: root }));
  await ensureEnginesLayout(root);
  return root;
}

describe("mergeDoctorReadiness", () => {
  it("keeps hiveReady true when only engine findings are errors", () => {
    const r = mergeDoctorReadiness(true, [
      { code: "LOCAL_CONTEXT_UNKNOWN", severity: "error", message: "x", remedy: "y" },
    ]);
    expect(r.hiveReady).toBe(true);
    expect(r.engineRungReady).toBe(false);
    expect(r.ready).toBe(true);
  });

  it("does not conflate ready with engineRungReady", () => {
    const r = mergeDoctorReadiness(false, [
      { code: "LOCAL_CONTEXT_UNKNOWN", severity: "error", message: "x", remedy: "y" },
    ]);
    expect(r.hiveReady).toBe(false);
    expect(r.ready).toBe(false);
    expect(r.ready).toBe(r.hiveReady);
  });
});

describe("computeEngineRungReady", () => {
  it("allows host delegate when only local context findings are blocking", () => {
    const ready = computeEngineRungReady(
      [{ code: "LOCAL_CONTEXT_UNKNOWN", severity: "error", message: "x", remedy: "y" }],
      true,
      [],
    );
    expect(ready).toBe(true);
  });

  it("is false without host delegate and only local blocking findings", () => {
    const ready = computeEngineRungReady(
      [{ code: "LOCAL_CONTEXT_BELOW_FLOOR", severity: "error", message: "x", remedy: "y" }],
      false,
      [],
    );
    expect(ready).toBe(false);
  });

  it("uses a healthy post-Slice-A rung when host delegate is unavailable", () => {
    const ready = computeEngineRungReady(
      [{ code: "LOCAL_CONTEXT_UNKNOWN", severity: "error", message: "x", remedy: "y" }],
      false,
      [{ engineId: "opencode", healthy: true }],
    );
    expect(ready).toBe(true);
  });

  it("is false when ENGINE_NONE_HEALTHY is present and no alternate rung", () => {
    const ready = computeEngineRungReady(
      [{ code: "ENGINE_NONE_HEALTHY", severity: "error", message: "x", remedy: "y" }],
      false,
      [{ engineId: "opencode", healthy: false }],
    );
    expect(ready).toBe(false);
  });
});

describe("collectEngineDoctorFindings", () => {
  it("returns no findings when the hive is not initialized", async () => {
    const root = await mkdtemp(join(tmpdir(), "doctor-findings-bare-"));
    expect(await collectEngineDoctorFindings(root)).toEqual([]);
  });

  it("emits LOCAL_CONTEXT_BELOW_FLOOR from local-pack profile without touching hive readiness merge", async () => {
    const hive = await hiveRoot();
    await writeFile(
      join(hive, "engines", "local-pack.json"),
      JSON.stringify({
        engineId: "opencode",
        backend: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "small",
        advertisedContext: 8192,
        contextSource: "declared",
      }),
    );
    const findings = await collectEngineDoctorFindings(hive);
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "LOCAL_CONTEXT_BELOW_FLOOR", severity: "error" }),
    );
    const merged = mergeDoctorReadiness(true, findings);
    expect(merged.hiveReady).toBe(true);
    expect(merged.engineRungReady).toBe(false);
    expect(findings[0]?.message).toContain(String(LOCAL_CONTEXT_FLOOR));
  });
});
