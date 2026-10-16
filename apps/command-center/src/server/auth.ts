import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export type BearerAuthRequest = {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
};

export type BearerAuthOk = { ok: true };

export type BearerAuthFail = {
  ok: false;
  status: 401;
  error: "TOKEN_REQUIRED";
  message: string;
};

export type BearerAuthResult = BearerAuthOk | BearerAuthFail;

const TOKEN_REQUIRED_MESSAGE = "Authorization Bearer token required.";

const QUERY_TOKEN_PARAM_NAMES = new Set(["token", "access_token", "bearer", "auth"]);

function tokenRequired(message: string = TOKEN_REQUIRED_MESSAGE): BearerAuthFail {
  return {
    ok: false,
    status: 401,
    error: "TOKEN_REQUIRED",
    message,
  };
}

function headerValue(headers: BearerAuthRequest["headers"], name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function extractBearerToken(headers: BearerAuthRequest["headers"]): string | null {
  const value = headerValue(headers, "authorization");
  if (!value) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value.trim());
  return match ? match[1] : null;
}

function urlHasQueryStringToken(url: string | undefined): boolean {
  if (!url) return false;
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return false;
  const params = new URLSearchParams(url.slice(queryStart + 1));
  for (const key of params.keys()) {
    if (QUERY_TOKEN_PARAM_NAMES.has(key.toLowerCase())) return true;
  }
  return false;
}

function constantTimeEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    timingSafeEqual(providedBuf, providedBuf);
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

async function readExpectedToken(hiveRoot: string): Promise<string | null> {
  const authDir = join(hiveRoot, "auth");
  const tokenPath = join(authDir, "loopback.token");
  try {
    const [fileStat, dirStat] = await Promise.all([stat(tokenPath), stat(authDir)]);
    const fileMode = fileStat.mode & 0o777;
    const dirMode = dirStat.mode & 0o777;
    if (fileMode !== 0o600 || dirMode !== 0o700) return null;
    const contents = await readFile(tokenPath, "utf8");
    return contents.trimEnd();
  } catch {
    return null;
  }
}

export async function verifyBearerToken(
  req: BearerAuthRequest,
  hiveRoot: string,
): Promise<BearerAuthResult> {
  if (urlHasQueryStringToken(req.url)) {
    return tokenRequired("Query-string tokens are not allowed.");
  }

  const bearer = extractBearerToken(req.headers);
  if (!bearer) {
    return tokenRequired();
  }

  const expected = await readExpectedToken(hiveRoot);
  if (expected === null || !constantTimeEqual(bearer, expected)) {
    return tokenRequired();
  }

  return { ok: true };
}
