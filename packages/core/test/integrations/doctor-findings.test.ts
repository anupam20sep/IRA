import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationDoctorFindings } from "../../src/integrations/doctor-findings.js";
import { runDoctor } from "../../src/command-plane/doctor.js";
import { hiveInit } from "../../src/command-plane/hive-init.js";

const TOOLS = ["hive-init", "dispatch-task", "doctor"] as const;

describe("integrationDoctorFindings", () => {
  it("does not emit error severity for disabled adapters", async () => {
    const f = await integrationDoctorFindings("/tmp/hive");
    expect(f.every((x) => x.severity !== "error")).toBe(true);
  });

  it("warns when Hermes is enabled without an endpoint", async () => {
    const hive = await mkdtemp(join(tmpdir(), "int-doc-"));
    try {
      await mkdir(join(hive, "integrations"), { recursive: true });
      await writeFile(
        join(hive, "integrations", "config.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          adapters: { hermes: { enabled: true } },
        })}\n`,
      );
      const f = await integrationDoctorFindings(hive);
      expect(f.some((x) => x.code === "INTEGRATION_HERMES_DEGRADED" && x.severity === "warning")).toBe(
        true,
      );
      expect(f.every((x) => x.severity !== "error")).toBe(true);
    } finally {
      await rm(hive, { recursive: true, force: true });
    }
  });
});

describe("runDoctor integration findings", () => {
  it("keeps hiveReady when integration findings include warnings", async () => {
    const root = await mkdtemp(join(tmpdir(), "int-doc-repo-"));
    try {
      await writeFile(join(root, "program.md"), "# program\n");
      await mkdir(join(root, ".git"));
      process.env.SUPERSPEC_ROOT = root;
      const init = await hiveInit({ cwd: root });
      if (!init.ok) throw new Error(init.error);
      await mkdir(join(init.hiveRoot, "integrations"), { recursive: true });
      await writeFile(
        join(init.hiveRoot, "integrations", "config.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          adapters: { hermes: { enabled: true } },
        })}\n`,
      );

      const report = await runDoctor({ cwd: root, mcpToolNames: TOOLS });
      expect(report.findings.some((x) => x.code === "INTEGRATION_HERMES_DEGRADED")).toBe(true);
      expect(report.hiveReady).toBe(true);
      expect(report.ready).toBe(report.hiveReady);
    } finally {
      delete process.env.SUPERSPEC_ROOT;
      await rm(root, { recursive: true, force: true });
    }
  });
});
