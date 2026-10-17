import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HIRE_TRUST_BANNER } from "../../src/hire/constants.js";
import { hireImport } from "../../src/hire/import.js";

const FIXTURE = "packages/core/test/hire/fixtures/ios-developer.yaml";

async function rosterSnapshot(hiveRoot: string): Promise<string | null> {
  try {
    return await readFile(join(hiveRoot, "roster.json"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function storedReview(hiveRoot: string, reviewId: string): Promise<{
  state: string;
  sourceKind: string;
  uiCopy: { trustBanner: string; showFullSanitizationReport: boolean };
}> {
  const text = await readFile(join(hiveRoot, "hire", "reviews", `${reviewId}.json`), "utf8");
  return JSON.parse(text) as {
    state: string;
    sourceKind: string;
    uiCopy: { trustBanner: string; showFullSanitizationReport: boolean };
  };
}

describe("hireImport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not spawn and returns pending review for file source", async () => {
    const hiveRoot = "/tmp/hive-fixture";
    const rosterBefore = await rosterSnapshot(hiveRoot);
    const res = await hireImport({
      source: "file",
      path: FIXTURE,
      hiveRoot,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.review.state).toBe("pending");
      expect(res.review.sourceKind).toBe("file");
      expect(res.review.form.displayName).toBe("iOS Developer");
      expect(res.review.askMeId.length).toBeGreaterThan(0);
      expect(res.review.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);
      expect(res.review.uiCopy.showFullSanitizationReport).toBe(true);
      const stored = await storedReview(hiveRoot, res.review.reviewId);
      expect(stored.state).toBe("pending");
      expect(stored.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);
      expect(stored.uiCopy.showFullSanitizationReport).toBe(true);
    }
    expect(await rosterSnapshot(hiveRoot)).toBe(rosterBefore);
    await expect(access(join(hiveRoot, ".cursor", "agents"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("sets identical trustBanner for gallery and file (OD-018)", async () => {
    const galleryHive = "/tmp/hive-b";
    const rosterBefore = await rosterSnapshot(galleryHive);
    const fileRes = await hireImport({ source: "file", path: FIXTURE, hiveRoot: "/tmp/hive-a" });
    const galleryRes = await hireImport({
      source: "gallery",
      entryId: "ios-developer",
      hiveRoot: galleryHive,
      repositoryRoot: process.cwd(),
    });
    expect(fileRes.ok && galleryRes.ok).toBe(true);
    if (fileRes.ok && galleryRes.ok) {
      expect(galleryRes.review.state).toBe("pending");
      expect(galleryRes.review.sourceKind).toBe("gallery");
      expect(galleryRes.uiCopy.trustBanner).toBe(fileRes.uiCopy.trustBanner);
      expect(galleryRes.uiCopy.trustBanner).toBe("Untrusted import — review all fields before spawn.");
      expect(galleryRes.review.uiCopy.showFullSanitizationReport).toBe(true);
      expect(fileRes.review.uiCopy.showFullSanitizationReport).toBe(true);
      expect(galleryRes.review.sanitizationReport.rejected).toEqual([]);
      expect(fileRes.review.sanitizationReport.rejected).toEqual([]);
      expect(galleryRes.approvalCopyVariant).toBe("curated_catalog");
      expect(galleryRes.trustHint).toBe("curated_catalog");
      expect(fileRes.approvalCopyVariant).toBe("standard");
      expect(fileRes.trustHint).toBeUndefined();
      const stored = await storedReview(galleryHive, galleryRes.review.reviewId);
      expect(stored.sourceKind).toBe("gallery");
      expect(stored.state).toBe("pending");
      expect(stored.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);
    }
    expect(await rosterSnapshot(galleryHive)).toBe(rosterBefore);
    await expect(access(join(galleryHive, ".cursor", "agents"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("opens a pending paste review with the standard banner and no trust hint", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hire-import-paste-"));
    const body = await readFile(FIXTURE, "utf8");
    const res = await hireImport({ source: "paste", body, hiveRoot });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.review.state).toBe("pending");
      expect(res.review.sourceKind).toBe("paste");
      expect(res.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);
      expect(res.approvalCopyVariant).toBe("standard");
      expect(res.trustHint).toBeUndefined();
    }
  });

  it("opens a pending https url review with the standard banner and no spawn", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hire-import-url-ok-"));
    const body = await readFile(FIXTURE);
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await hireImport({
      source: "url",
      url: "https://example.com/manifest.yaml",
      hiveRoot,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.review.state).toBe("pending");
      expect(res.review.sourceKind).toBe("url");
      expect(res.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);
      expect(res.review.uiCopy.showFullSanitizationReport).toBe(true);
      expect(res.approvalCopyVariant).toBe("standard");
      expect(res.trustHint).toBeUndefined();
      expect(res.review.form.displayName).toBe("iOS Developer");
      const stored = await storedReview(hiveRoot, res.review.reviewId);
      expect(stored.state).toBe("pending");
      expect(stored.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(await rosterSnapshot(hiveRoot)).toBeNull();
    await expect(access(join(hiveRoot, ".cursor", "agents"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an https url that redirects to http without opening a review", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hire-import-url-down-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://example.com/manifest.yaml" },
          }),
      ),
    );

    const res = await hireImport({
      source: "url",
      url: "https://example.com/manifest.yaml",
      hiveRoot,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("INVALID_INPUT");
    await expect(access(join(hiveRoot, "hire", "reviews"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await rosterSnapshot(hiveRoot)).toBeNull();
  });

  it("rejects a non-https url before opening a review", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hire-import-url-"));
    const res = await hireImport({
      source: "url",
      url: "http://example.com/manifest.yaml",
      hiveRoot,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("INVALID_INPUT");
    await expect(access(join(hiveRoot, "hire", "reviews"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects executable keys without writing a review", async () => {
    const hiveRoot = await mkdtemp(join(tmpdir(), "hire-import-exec-"));
    const body = `${await readFile(FIXTURE, "utf8")}\nscript: echo hi\n`;
    const res = await hireImport({ source: "paste", body, hiveRoot });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("HIRE_SANITIZE_FAILED");
    await expect(access(join(hiveRoot, "hire", "reviews"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await rosterSnapshot(hiveRoot)).toBeNull();
  });
});
