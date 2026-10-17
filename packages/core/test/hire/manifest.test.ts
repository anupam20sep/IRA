import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { parseManifestBytes } from "../../src/hire/manifest.js";

const SAMPLE = Buffer.from(`schemaVersion: hireManifest/v1
id: qa-bot
displayName: QA
goal: Test features.
capabilityTags: [qa]
suggestedEngine: cursor
suggestedModelTier: economy
budget: { tokens: 50000, usd: 10 }
allowlists: { skills: [], mcp: [] }
persona: { harness: cursor, scope: project, body: "body" }
`);

const VALID_MANIFEST = {
  schemaVersion: "hireManifest/v1" as const,
  id: "qa-bot",
  displayName: "QA",
  goal: "Test features.",
  capabilityTags: ["qa"],
  suggestedEngine: "cursor",
  suggestedModelTier: "economy" as const,
  budget: { tokens: 50000, usd: 10 },
  allowlists: { skills: [], mcp: [] },
  persona: { harness: "cursor" as const, scope: "project" as const, body: "body" },
};

describe("parseManifestBytes", () => {
  it("parses YAML and returns content hash", () => {
    const r = parseManifestBytes(SAMPLE, "fixture.yaml");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.id).toBe("qa-bot");
      expect(r.contentSha256).toBe(createHash("sha256").update(SAMPLE).digest("hex"));
    }
  });

  it("parses JSON when source label is .json", () => {
    const raw = Buffer.from(JSON.stringify(VALID_MANIFEST));
    const r = parseManifestBytes(raw, "fixture.json");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.displayName).toBe("QA");
  });

  it("rejects manifests over MAX_MANIFEST_BYTES", () => {
    const prev = process.env.MAX_MANIFEST_BYTES;
    process.env.MAX_MANIFEST_BYTES = "64";
    try {
      const r = parseManifestBytes(SAMPLE, "fixture.yaml");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("HIRE_MANIFEST_TOO_LARGE");
    } finally {
      if (prev === undefined) delete process.env.MAX_MANIFEST_BYTES;
      else process.env.MAX_MANIFEST_BYTES = prev;
    }
  });

  it("rejects string fields over MAX_FIELD_CHARS", () => {
    const prev = process.env.MAX_FIELD_CHARS;
    process.env.MAX_FIELD_CHARS = "8";
    try {
      const r = parseManifestBytes(SAMPLE, "fixture.yaml");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("HIRE_SANITIZE_FAILED");
    } finally {
      if (prev === undefined) delete process.env.MAX_FIELD_CHARS;
      else process.env.MAX_FIELD_CHARS = prev;
    }
  });

  it("rejects invalid manifest shape after parse", () => {
    const raw = Buffer.from(JSON.stringify({ schemaVersion: "hireManifest/v1", id: "bad id spaces" }));
    const r = parseManifestBytes(raw, "bad.json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("HIRE_SANITIZE_FAILED");
  });
});
