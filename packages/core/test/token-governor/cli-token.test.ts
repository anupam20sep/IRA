import { describe, it, expect } from "vitest";
import { tokenCliCommands } from "../../src/token-governor/cli-token.js";

describe("token CLI", () => {
  it("lists spend query command", () => {
    expect(tokenCliCommands.some((c) => c.name === "token spend query")).toBe(true);
  });
});
