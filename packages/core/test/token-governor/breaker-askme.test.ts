import { describe, it, expect } from "vitest";
import { AskMeReasonClassSchema } from "../../src/command-plane/schema.js";

describe("Ask-Me reason classes", () => {
  it("includes circuit_breaker_stop", () => {
    expect(AskMeReasonClassSchema.parse("circuit_breaker_stop")).toBe("circuit_breaker_stop");
  });
});
