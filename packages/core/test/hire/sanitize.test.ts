import { describe, it, expect } from "vitest";
import { buildSanitizationReport, sanitizeManifestInput } from "../../src/hire/sanitize.js";

const VALID_MANIFEST = {
  schemaVersion: "hireManifest/v1",
  id: "ios-developer",
  displayName: "iOS Developer",
  goal: "Ship native iOS features.",
  capabilityTags: ["ios"],
  suggestedEngine: "cursor",
  suggestedModelTier: "standard",
  budget: { tokens: 200000, usd: 50 },
  allowlists: { skills: ["swift"], mcp: [] },
  persona: { harness: "cursor", scope: "project", body: "---\nname: ios-developer\n---\n" },
};

const GALLERY_FIXTURE = {
  ...VALID_MANIFEST,
  metadata: { galleryTitle: "iOS Developer", sourceUri: "gallery://ios-developer" },
  skills: ["swiftui"],
};

const REMOTE_FIXTURE = {
  ...VALID_MANIFEST,
  note: "pasted from chat",
};

describe("sanitizeManifestInput", () => {
  it("rejects executable script blocks", () => {
    const r = sanitizeManifestInput({
      schemaVersion: "hireManifest/v1",
      id: "bad",
      displayName: "Bad",
      goal: "x",
      capabilityTags: [],
      suggestedEngine: "cursor",
      suggestedModelTier: "standard",
      budget: { tokens: 1, usd: 1 },
      allowlists: { skills: [], mcp: [] },
      persona: { harness: "cursor", scope: "project", body: "x" },
      shell: "rm -rf /",
    });
    expect(r.report.rejected.length).toBeGreaterThan(0);
    expect(r.manifest).toBeNull();
  });

  it("emits equal-scope sanitization reports for gallery and file inputs", () => {
    const gallery = sanitizeManifestInput(GALLERY_FIXTURE).report;
    const remote = sanitizeManifestInput(REMOTE_FIXTURE).report;
    expect(Object.keys(gallery).sort()).toEqual(Object.keys(remote).sort());
    expect(Object.keys(gallery).sort()).toEqual([
      "contentSha256",
      "droppedKeys",
      "rejected",
      "sanitizedAt",
      "warnings",
    ]);
  });

  it("drops unknown keys and keeps an allowlisted manifest", () => {
    const r = sanitizeManifestInput({ ...VALID_MANIFEST, note: "hello", owner: 1 });
    expect(r.report.rejected).toEqual([]);
    expect(r.report.droppedKeys).toEqual(["note", "owner"]);
    expect(r.manifest).toMatchObject({
      id: "ios-developer",
      allowlists: { skills: ["swift"], mcp: [] },
      budget: { tokens: 200000, usd: 50 },
    });
    expect(r.manifest).not.toHaveProperty("note");
  });

  it("rejects secret-like keys even inside allowlisted objects", () => {
    const r = sanitizeManifestInput({
      ...VALID_MANIFEST,
      budget: { tokens: 1, usd: 1, apiKey: "sk-test", token: "t" },
      persona: { ...VALID_MANIFEST.persona, password: "hunter2", secret: "s" },
    });
    expect(r.manifest).toBeNull();
    const paths = r.report.rejected.map((item) => item.path);
    expect(paths).toEqual(expect.arrayContaining([
      "budget.apiKey",
      "budget.token",
      "persona.password",
      "persona.secret",
    ]));
  });

  it("does not treat budget.tokens as a secret key", () => {
    const r = sanitizeManifestInput(VALID_MANIFEST);
    expect(r.report.rejected).toEqual([]);
    expect(r.manifest?.budget.tokens).toBe(200000);
  });

  it("warns when capability tags are empty and defaults omitted allowlists to deny-all", () => {
    const { allowlists: _allowlists, ...withoutAllowlists } = VALID_MANIFEST;
    const r = sanitizeManifestInput({ ...withoutAllowlists, capabilityTags: [] });
    expect(r.manifest).not.toBeNull();
    expect(r.manifest?.allowlists).toEqual({ skills: [], mcp: [] });
    expect(r.report.warnings).toContain("capability tags are empty");
  });

  it("rejects nested objects outside the allowlist instead of keeping their fields", () => {
    const r = sanitizeManifestInput({
      ...VALID_MANIFEST,
      payload: { goal: "hidden", shell: "echo hi" },
    });
    expect(r.manifest).toBeNull();
    expect(r.report.droppedKeys).not.toContain("payload.goal");
    expect(r.report.rejected.some((item) => item.path === "payload" || item.path.startsWith("payload."))).toBe(
      true,
    );
  });

  it("accepts design allowlisted skills and metadata without dropping them", () => {
    const r = sanitizeManifestInput(GALLERY_FIXTURE);
    expect(r.report.rejected).toEqual([]);
    expect(r.report.droppedKeys).toEqual([]);
    expect(r.manifest?.id).toBe("ios-developer");
    expect(r.manifest).not.toHaveProperty("skills");
    expect(r.manifest).not.toHaveProperty("metadata");
  });

  it("rejects unsupported schema versions", () => {
    const version = sanitizeManifestInput({ ...VALID_MANIFEST, schemaVersion: "hireManifest/v0" });
    expect(version.manifest).toBeNull();
    expect(version.report.rejected.some((item) => item.path === "schemaVersion")).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { displayName: _displayName, ...missingName } = VALID_MANIFEST;
    const r = sanitizeManifestInput(missingName);
    expect(r.manifest).toBeNull();
    expect(r.report.rejected.some((item) => item.path === "displayName")).toBe(true);
  });

  it("rejects string fields over MAX_FIELD_CHARS", () => {
    const prev = process.env.MAX_FIELD_CHARS;
    process.env.MAX_FIELD_CHARS = "8";
    try {
      const oversized = sanitizeManifestInput(VALID_MANIFEST);
      expect(oversized.manifest).toBeNull();
      expect(oversized.report.rejected.some((item) => item.reason.includes("MAX_FIELD_CHARS"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MAX_FIELD_CHARS;
      else process.env.MAX_FIELD_CHARS = prev;
    }
  });
});

describe("buildSanitizationReport", () => {
  it("always returns the same field set", () => {
    const report = buildSanitizationReport({
      droppedKeys: ["note"],
      rejected: [{ path: "shell", reason: "executable payload" }],
      warnings: ["capability tags are empty"],
      contentSha256: "abc",
    });
    expect(Object.keys(report).sort()).toEqual([
      "contentSha256",
      "droppedKeys",
      "rejected",
      "sanitizedAt",
      "warnings",
    ]);
    expect(report.droppedKeys).toEqual(["note"]);
    expect(report.sanitizedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
