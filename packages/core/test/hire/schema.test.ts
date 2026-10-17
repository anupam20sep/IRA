import { describe, it, expect } from "vitest";
import { HireManifestSchema } from "../../src/hire/schema.js";
import { HIRE_TRUST_BANNER } from "../../src/hire/constants.js";

describe("HireManifestSchema", () => {
  it("locks OD-018 trust banner constant", () => {
    expect(HIRE_TRUST_BANNER).toBe("Untrusted import — review all fields before spawn.");
  });

  it("requires hireManifest/v1 and default-deny allowlists", () => {
    const m = HireManifestSchema.parse({
      schemaVersion: "hireManifest/v1",
      id: "ios-developer",
      displayName: "iOS Developer",
      goal: "Ship SwiftUI features.",
      capabilityTags: ["ios"],
      suggestedEngine: "cursor",
      suggestedModelTier: "standard",
      budget: { tokens: 100000, usd: 25 },
      allowlists: { skills: [], mcp: [] },
      persona: { harness: "cursor", scope: "project", body: "---\nname: ios-developer\n---\n" },
    });
    expect(m.allowlists.skills).toEqual([]);
  });
});
