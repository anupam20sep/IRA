import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyBearerToken, type BearerAuthRequest } from "../src/server/auth.js";

async function writeLoopbackToken(hiveRoot: string, token: string): Promise<void> {
  const authDir = join(hiveRoot, "auth");
  await mkdir(authDir, { recursive: true });
  await chmod(authDir, 0o700);
  const tokenPath = join(authDir, "loopback.token");
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600);
}

function req(partial: Partial<BearerAuthRequest> & Pick<BearerAuthRequest, "headers">): BearerAuthRequest {
  return { url: "/api/tasks/dispatch", ...partial };
}

describe("verifyBearerToken", () => {
  let hiveRoot: string;
  const token = "loopback-secret-abc";

  beforeEach(async () => {
    hiveRoot = await mkdtemp(join(tmpdir(), "cc-auth-"));
    await writeLoopbackToken(hiveRoot, token);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("returns TOKEN_REQUIRED when Authorization is missing", async () => {
    const result = await verifyBearerToken(req({ headers: {} }), hiveRoot);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "TOKEN_REQUIRED",
      message: expect.any(String),
    });
  });

  it("returns TOKEN_REQUIRED when Bearer token does not match the file", async () => {
    const result = await verifyBearerToken(
      req({ headers: { authorization: "Bearer wrong-token" } }),
      hiveRoot,
    );
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "TOKEN_REQUIRED",
      message: expect.any(String),
    });
  });

  it("returns ok when Bearer token matches loopback.token", async () => {
    const result = await verifyBearerToken(
      req({ headers: { authorization: `Bearer ${token}` } }),
      hiveRoot,
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects query-string token patterns even with a valid Bearer header", async () => {
    const result = await verifyBearerToken(
      req({
        headers: { authorization: `Bearer ${token}` },
        url: "/api/tasks/dispatch?access_token=leak",
      }),
      hiveRoot,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("TOKEN_REQUIRED");
    expect(result.status).toBe(401);
  });

  it("does not invoke CLI spawn when auth fails", async () => {
    let spawnCount = 0;
    const spawnCli = () => {
      spawnCount += 1;
    };

    const gate = async (request: BearerAuthRequest) => {
      const auth = await verifyBearerToken(request, hiveRoot);
      if (!auth.ok) return auth;
      spawnCli();
      return auth;
    };

    await gate(req({ headers: {} }));
    await gate(req({ headers: { authorization: "Bearer wrong" } }));
    expect(spawnCount).toBe(0);

    await gate(req({ headers: { authorization: `Bearer ${token}` } }));
    expect(spawnCount).toBe(1);
  });
});
