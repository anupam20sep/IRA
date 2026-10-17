import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAskMe } from "../../src/command-plane/ask-me.js";
import { handleUntrustedImportAskMeAnswer } from "../../src/hire/ask-me-bridge.js";
import { HIRE_TRUST_BANNER } from "../../src/hire/constants.js";
import { hireImport, type HireImportSuccess } from "../../src/hire/import.js";
import { loadReview } from "../../src/hire/review.js";
import { hireSpawnConfirm } from "../../src/hire/spawn.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/ios-developer.yaml", import.meta.url));
const GALLERY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const REPORT_FIELDS = ["contentSha256", "droppedKeys", "rejected", "sanitizedAt", "warnings"];
const PERSONA_RELATIVE = join(".cursor", "agents", "ios-developer.md");

type Roots = { hiveRoot: string; repositoryRoot: string };
type OpenedImport = { opened: HireImportSuccess; roots: Roots };

async function readRosterAgentCount(hiveRoot: string): Promise<number> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(hiveRoot, "roster.json"), "utf8"));
    return Array.isArray(raw) ? raw.length : 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
}

async function preparedRoots(): Promise<Roots> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "hire-pipe-repo-"));
  const hiveRoot = await mkdtemp(join(tmpdir(), "hire-pipe-hive-"));
  await writeFile(
    join(hiveRoot, "hive.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      repositoryRoot,
      createdAt: new Date().toISOString(),
    })}\n`,
  );
  await mkdir(join(hiveRoot, "events"), { recursive: true });
  return { hiveRoot, repositoryRoot };
}

async function expectPersonaAbsent(repositoryRoot: string): Promise<void> {
  await expect(access(join(repositoryRoot, PERSONA_RELATIVE))).rejects.toMatchObject({ code: "ENOENT" });
}

async function expectNoSpawn(roots: Roots): Promise<void> {
  expect(await readRosterAgentCount(roots.hiveRoot)).toBe(0);
  await expectPersonaAbsent(roots.repositoryRoot);
  await expect(access(join(roots.hiveRoot, "dispatch-queue"))).rejects.toMatchObject({ code: "ENOENT" });
}

async function expectOpenUntrustedAskMe(pending: OpenedImport): Promise<void> {
  const { opened, roots } = pending;
  expect(opened.review.state).toBe("pending");
  expect(opened.askMeId).toMatch(/^ask_/);
  expect(opened.review.askMeId).toBe(opened.askMeId);
  expect(opened.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);
  expect(opened.review.uiCopy.trustBanner).toBe(HIRE_TRUST_BANNER);
  expect(opened.review.uiCopy.showFullSanitizationReport).toBe(true);
  expect(Object.keys(opened.review.sanitizationReport).sort()).toEqual(REPORT_FIELDS);
  expect(opened.review.sanitizationReport.rejected).toEqual([]);

  const listed = await listAskMe({ hiveRoot: roots.hiveRoot, state: "open" });
  expect(listed.ok).toBe(true);
  if (!listed.ok) return;
  const item = listed.items.find((row) => row.id === opened.askMeId);
  expect(item?.reasonClass).toBe("untrusted_import");
  expect(item?.taskId).toBe(opened.review.reviewId);
}

async function openCuratedAndUntrusted(): Promise<{
  gallery: OpenedImport;
  file: OpenedImport;
  remote: OpenedImport;
}> {
  const galleryRoots = await preparedRoots();
  const fileRoots = await preparedRoots();
  const remoteRoots = await preparedRoots();

  const gallery = await hireImport({
    source: "gallery",
    entryId: "ios-developer",
    hiveRoot: galleryRoots.hiveRoot,
    repositoryRoot: GALLERY_ROOT,
  });
  const file = await hireImport({
    source: "file",
    path: FIXTURE,
    hiveRoot: fileRoots.hiveRoot,
  });
  const body = await readFile(FIXTURE);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
  const remote = await hireImport({
    source: "url",
    url: "https://example.com/ios-developer.yaml",
    hiveRoot: remoteRoots.hiveRoot,
  });

  expect(gallery.ok).toBe(true);
  expect(file.ok).toBe(true);
  expect(remote.ok).toBe(true);
  if (!gallery.ok || !file.ok || !remote.ok) {
    throw new Error("hire import did not open a review");
  }

  return {
    gallery: { opened: gallery, roots: galleryRoots },
    file: { opened: file, roots: fileRoots },
    remote: { opened: remote, roots: remoteRoots },
  };
}

describe("hire pipeline SC-002 + OD-018", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never writes roster before hire-spawn-confirm for gallery and file sources", async () => {
    const { gallery, file, remote } = await openCuratedAndUntrusted();

    await expectOpenUntrustedAskMe(gallery);
    await expectOpenUntrustedAskMe(file);
    await expectOpenUntrustedAskMe(remote);

    expect(gallery.opened.review.sourceKind).toBe("gallery");
    expect(gallery.opened.approvalCopyVariant).toBe("curated_catalog");
    expect(gallery.opened.trustHint).toBe("curated_catalog");
    expect(file.opened.review.sourceKind).toBe("file");
    expect(file.opened.approvalCopyVariant).toBe("standard");
    expect(file.opened.trustHint).toBeUndefined();
    expect(remote.opened.review.sourceKind).toBe("url");
    expect(remote.opened.approvalCopyVariant).toBe("standard");
    expect(gallery.opened.uiCopy.trustBanner).toBe(file.opened.uiCopy.trustBanner);
    expect(gallery.opened.uiCopy.trustBanner).toBe(remote.opened.uiCopy.trustBanner);
    expect(Object.keys(gallery.opened.review.sanitizationReport).sort()).toEqual(
      Object.keys(file.opened.review.sanitizationReport).sort(),
    );
    expect(Object.keys(gallery.opened.review.sanitizationReport).sort()).toEqual(
      Object.keys(remote.opened.review.sanitizationReport).sort(),
    );

    for (const pending of [gallery, file, remote]) {
      await expectNoSpawn(pending.roots);
      const blocked = await hireSpawnConfirm({
        reviewId: pending.opened.review.reviewId,
        hiveRoot: pending.roots.hiveRoot,
        repositoryRoot: pending.roots.repositoryRoot,
        sliceAValidated: false,
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.code).toBe("SLICE_A_ONLY");
      await expectNoSpawn(pending.roots);
      expect((await loadReview(pending.roots.hiveRoot, pending.opened.review.reviewId))?.state).toBe("pending");
    }

    const spawned = await hireSpawnConfirm({
      reviewId: gallery.opened.review.reviewId,
      hiveRoot: gallery.roots.hiveRoot,
      repositoryRoot: gallery.roots.repositoryRoot,
      sliceAValidated: true,
    });
    expect(spawned.ok).toBe(true);
    if (spawned.ok) {
      expect(spawned.agent).toMatchObject({ id: "ios-developer", origin: "hire", status: "idle" });
    }
    expect(await readRosterAgentCount(gallery.roots.hiveRoot)).toBe(1);
    await expectNoSpawn(file.roots);
    await expectNoSpawn(remote.roots);

    const fileSpawned = await hireSpawnConfirm({
      reviewId: file.opened.review.reviewId,
      hiveRoot: file.roots.hiveRoot,
      repositoryRoot: file.roots.repositoryRoot,
      sliceAValidated: true,
    });
    expect(fileSpawned.ok).toBe(true);
    expect(await readRosterAgentCount(file.roots.hiveRoot)).toBe(1);
    await expectNoSpawn(remote.roots);
  });

  it("acknowledge cancels without roster write", async () => {
    const { gallery, file, remote } = await openCuratedAndUntrusted();

    for (const pending of [file, gallery, remote]) {
      await expectNoSpawn(pending.roots);
      const ack = await handleUntrustedImportAskMeAnswer({
        reviewId: pending.opened.review.reviewId,
        action: "acknowledge",
        reasonClass: "untrusted_import",
        hiveRoot: pending.roots.hiveRoot,
      });
      expect(ack.ok).toBe(true);
      expect("code" in ack ? ack.code : undefined).toBe("HIRE_ACK_CANCELS");
      expect((await loadReview(pending.roots.hiveRoot, pending.opened.review.reviewId))?.state).toBe("cancelled");
      await expectNoSpawn(pending.roots);

      const afterAck = await hireSpawnConfirm({
        reviewId: pending.opened.review.reviewId,
        hiveRoot: pending.roots.hiveRoot,
        repositoryRoot: pending.roots.repositoryRoot,
        sliceAValidated: true,
      });
      expect(afterAck.ok).toBe(false);
      await expectNoSpawn(pending.roots);
    }
  });
});
