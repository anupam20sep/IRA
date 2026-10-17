import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";

describe("cli hire import", () => {
  it("prints ok review json for fixture manifest", async () => {
    const { stdout } = await runCli([
      "hire",
      "import",
      "--source",
      "file",
      "--path",
      "packages/core/test/hire/fixtures/ios-developer.yaml",
    ]);
    const json = JSON.parse(stdout);
    expect(json.ok).toBe(true);
  });
});
