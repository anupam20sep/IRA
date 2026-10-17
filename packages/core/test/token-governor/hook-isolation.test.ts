import { describe, it, expect } from "vitest";
import { invokeTokenBeforeDispatchSafely } from "../../src/command-plane/hooks.js";

describe("token hook isolation", () => {
  it("maps beforeDispatch throw to budget_exceed deny", async () => {
    const gate = await invokeTokenBeforeDispatchSafely(async () => {
      throw new Error("forecast blew up");
    });
    expect(gate.allow).toBe(false);
    if (!gate.allow) {
      expect(gate.reasonClass).toBe("budget_exceed");
      expect(gate.detail?.reason).toBe("HOOK_FAILED_CLOSED");
    }
  });
});
