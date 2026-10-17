import { describe, it, expect } from "vitest";
import { installLearningMemory, listPatterns } from "@superspec-dev/core";

describe("package exports", () => {
  it("exports learning memory entrypoints", () => {
    expect(typeof installLearningMemory).toBe("function");
    expect(typeof listPatterns).toBe("function");
  });
});
