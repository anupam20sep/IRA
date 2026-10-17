import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { runCli } from "../../src/cli.js";
import { buildToolDefinitions } from "../../src/mcp-server.js";
import { loadIntegrationConfig } from "../../src/integrations/config.js";

describe("integrations MCP", () => {
  it("registers integrations-status", () => {
    expect(buildToolDefinitions().map((t) => t.name)).toContain("integrations-status");
  });

  it("registers integrations-share-create", () => {
    expect(buildToolDefinitions().map((t) => t.name)).toContain("integrations-share-create");
  });
});

describe("integrations CLI", () => {
  it("status reports all adapters disabled by default", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hive-cli-status-"));
    const { code, stdout } = await runCli(["integrations", "status", "--hive-root", hiveRoot]);
    expect(code).toBe(0);
    const body = JSON.parse(stdout);
    expect(body.ok).toBe(true);
    expect(body.config.adapters.openclaw.enabled).toBe(false);
    expect(body.config.adapters.boardShare.enabled).toBe(false);
  });

  it("enable and disable persist adapter flags", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hive-cli-toggle-"));
    const enable = await runCli(["integrations", "enable", "openclaw", "--hive-root", hiveRoot]);
    expect(enable.code).toBe(0);
    const enabled = JSON.parse(enable.stdout);
    expect(enabled.ok).toBe(true);
    expect(enabled.config.adapters.openclaw.enabled).toBe(true);

    const config = await loadIntegrationConfig(hiveRoot);
    expect(config.adapters.openclaw.enabled).toBe(true);

    const disable = await runCli(["integrations", "disable", "openclaw", "--hive-root", hiveRoot]);
    expect(disable.code).toBe(0);
    const disabled = JSON.parse(disable.stdout);
    expect(disabled.config.adapters.openclaw.enabled).toBe(false);
  });

  it("share-create returns token and expiry", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hive-cli-share-"));
    await runCli(["integrations", "enable", "boardShare", "--hive-root", hiveRoot]);
    const { code, stdout } = await runCli(["integrations", "share-create", "--hive-root", hiveRoot]);
    expect(code).toBe(0);
    const body = JSON.parse(stdout);
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
  });
});
