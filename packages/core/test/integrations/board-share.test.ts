import { describe, it, expect } from "vitest";
import {
  assertShareCannotMutate,
  createShareToken,
  verifyShareToken,
} from "../../src/integrations/board-share.js";

describe("board share token", () => {
  it("verifies created token as board_read", async () => {
    const dir = "/tmp/hive-share-" + Date.now();
    const { token } = await createShareToken(dir);
    const v = await verifyShareToken(dir, token);
    expect(v).toEqual({ ok: true, scope: "board_read" });
  });

  it("refuses mutations when bearer is a share token", async () => {
    const dir = "/tmp/hive-share-mut-" + Date.now();
    const { token } = await createShareToken(dir);
    const gate = await assertShareCannotMutate(dir, token);
    expect(gate).toEqual({
      ok: false,
      status: 401,
      error: "SHARE_READ_ONLY",
      message: "Share tokens are read-only.",
    });
  });
});
