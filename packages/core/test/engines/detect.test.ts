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
