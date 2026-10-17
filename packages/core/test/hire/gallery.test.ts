import { describe, it, expect } from "vitest";
import { searchGallery, loadGalleryManifest } from "../../src/hire/gallery.js";

describe("searchGallery", () => {
  it("matches capability tags case-insensitively", () => {
    const entries = searchGallery({ tags: ["ios"], limit: 5, indexFixture: "minimal" });
    expect(entries.every((e) => e.capabilityTags.map((t) => t.toLowerCase()).includes("ios"))).toBe(
      true,
    );
    expect(entries.length).toBeGreaterThan(0);
  });

  it("filters by query across title and description", () => {
    const entries = searchGallery({ query: "swiftui", indexFixture: "minimal" });
    expect(entries.some((e) => e.id === "ios-developer")).toBe(true);
  });

  it("returns HIRE_GALLERY_UNAVAILABLE when index is missing", () => {
    expect(() =>
      searchGallery({ repositoryRoot: "/tmp/nonexistent-gallery-root-xyz" }),
    ).toThrow(expect.objectContaining({ code: "HIRE_GALLERY_UNAVAILABLE" }));
  });
});

describe("loadGalleryManifest", () => {
  it("loads manifest bytes for a catalog entry", async () => {
    const r = await loadGalleryManifest("ios-developer", { indexFixture: "minimal" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bytes.length).toBeGreaterThan(0);
    }
  });

  it("returns HIRE_GALLERY_UNAVAILABLE for unknown entry", async () => {
    const r = await loadGalleryManifest("missing-entry", { indexFixture: "minimal" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("HIRE_GALLERY_UNAVAILABLE");
  });
});
