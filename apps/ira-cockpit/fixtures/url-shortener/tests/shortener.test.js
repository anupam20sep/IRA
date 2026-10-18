import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";

async function withServer(run) {
  const { handler, store } = createApp();
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  const base = `http://127.0.0.1:${port}`;
  try {
    await run(base, store);
  } finally {
    server.close();
  }
}

test("FR-001/002 shorten returns code", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/shorten`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/long/path" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.code);
    assert.equal(body.url, "https://example.com/long/path");
  });
});

test("FR-003 redirect resolves short code", async () => {
  await withServer(async (base) => {
    const created = await fetch(`${base}/api/shorten`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/x" }),
    }).then((r) => r.json());
    const res = await fetch(`${base}/r/${created.code}`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "https://example.com/x");
  });
});

test("FR-004 rejects non-http URLs", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/shorten`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "javascript:alert(1)" }),
    });
    assert.equal(res.status, 400);
  });
});

test("FR-005 lists recent links", async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/shorten`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://a.example" }),
    });
    const res = await fetch(`${base}/api/links`);
    const list = await res.json();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 1);
  });
});
