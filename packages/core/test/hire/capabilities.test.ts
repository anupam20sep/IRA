import { describe, expect, it, vi } from "vitest";
import { normalizeCapabilityTags, tagsIntersect } from "../../src/hire/capabilities.js";

describe("normalizeCapabilityTags", () => {
  it("lowercases, trims, dedupes, and validates slug shape", () => {
    expect(normalizeCapabilityTags([" iOS ", "ios", "QA"])).toEqual(["ios", "qa"]);
  });

  it("drops invalid tokens and invokes optional onInvalidTag", () => {
    const onInvalidTag = vi.fn();
    expect(
      normalizeCapabilityTags(["valid.tag", "Bad Space", ""], { onInvalidTag }),
    ).toEqual(["valid.tag"]);
    expect(onInvalidTag).toHaveBeenCalledTimes(2);
  });
});

describe("tagsIntersect", () => {
  it("returns normalized tags present on both sides", () => {
    expect(tagsIntersect([" iOS ", "qa"], ["IOS", "security"])).toEqual(["ios"]);
  });
});
