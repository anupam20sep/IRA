import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "../command-plane/store.js";

const SHARE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ShareTokenScope = "board_read";

type ShareTokenRecord = {
  id: string;
  hash: string;
  createdAt: string;
  expiresAt: string;
  scope: ShareTokenScope;
};

type ShareTokensFile = {
  schemaVersion: 1;
  tokens: ShareTokenRecord[];
};

export type ShareTokenCreateResult = {
  token: string;
  expiresAt: string;
};

export type ShareTokenVerifyResult =
  | { ok: true; scope: ShareTokenScope }
  | { ok: false };

export type ShareMutateGateResult =
  | { ok: true }
  | { ok: false; status: 401; error: "SHARE_READ_ONLY"; message: string };

function shareTokensPath(hiveRoot: string): string {
  return join(hiveRoot, "integrations", "share-tokens.json");
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

async function readShareTokensFile(hiveRoot: string): Promise<ShareTokensFile> {
  try {
    const raw = await readFile(shareTokensPath(hiveRoot), "utf8");
    const parsed = JSON.parse(raw) as ShareTokensFile;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tokens)) {
      return { schemaVersion: 1, tokens: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, tokens: [] };
    }
    throw err;
  }
}

function findActiveRecord(
  file: ShareTokensFile,
  token: string,
  nowMs: number,
): ShareTokenRecord | undefined {
  const hash = hashShareToken(token);
  return file.tokens.find(
    (record) =>
      constantTimeEqualHex(record.hash, hash) && Date.parse(record.expiresAt) > nowMs,
  );
}

/** Create an opaque read-only board share token; only the hash is persisted. */
export async function createShareToken(hiveRoot: string): Promise<ShareTokenCreateResult> {
  const integrationsDir = join(hiveRoot, "integrations");
  await mkdir(integrationsDir, { recursive: true, mode: 0o700 });

  const now = Date.now();
  const expiresAt = new Date(now + SHARE_TOKEN_TTL_MS).toISOString();
  const token = `sshr_${randomBytes(32).toString("base64url")}`;
  const record: ShareTokenRecord = {
    id: randomUUID(),
    hash: hashShareToken(token),
    createdAt: new Date(now).toISOString(),
    expiresAt,
    scope: "board_read",
  };

  const file = await readShareTokensFile(hiveRoot);
  file.tokens.push(record);
  await writeJsonAtomic(shareTokensPath(hiveRoot), file);

  return { token, expiresAt };
}

/** Verify a share token; distinct from loopback mutation bearer (OD-017). */
export async function verifyShareToken(
  hiveRoot: string,
  token: string,
): Promise<ShareTokenVerifyResult> {
  const file = await readShareTokensFile(hiveRoot);
  const record = findActiveRecord(file, token, Date.now());
  if (!record) return { ok: false };
  return { ok: true, scope: record.scope };
}

/** Block mutating board routes when auth is a share token (FR-007 / D3). */
export async function assertShareCannotMutate(
  hiveRoot: string,
  bearerToken: string,
): Promise<ShareMutateGateResult> {
  const verified = await verifyShareToken(hiveRoot, bearerToken);
  if (verified.ok) {
    return {
      ok: false,
      status: 401,
      error: "SHARE_READ_ONLY",
      message: "Share tokens are read-only.",
    };
  }
  return { ok: true };
}
