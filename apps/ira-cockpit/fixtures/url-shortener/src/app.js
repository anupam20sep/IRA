import { createStore } from "./store.js";

/**
 * @param {ReturnType<typeof createStore>} [store]
 */
export function createApp(store = createStore()) {
  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handler(req, res) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/shorten") {
      const body = await readJson(req);
      try {
        const link = store.shorten(String(body.url ?? ""));
        return json(res, 201, { code: link.code, url: link.url });
      } catch (e) {
        const err = /** @type {{ code?: string, message?: string }} */ (e);
        if (err.code === "INVALID_URL") return json(res, 400, { error: err.message });
        throw e;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/links") {
      return json(res, 200, store.list());
    }

    const redirect = url.pathname.match(/^\/r\/([^/]+)$/);
    if (req.method === "GET" && redirect) {
      const link = store.resolve(redirect[1] ?? "");
      if (!link) return json(res, 404, { error: "not found" });
      res.writeHead(302, { Location: link.url });
      res.end();
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(INDEX_HTML);
      return;
    }

    json(res, 404, { error: "not found" });
  }

  return { handler, store };
}

/** @param {import('node:http').IncomingMessage} req */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>URL Shortener</title></head>
<body>
  <h1>URL Shortener</h1>
  <form id="f">
    <input id="url" name="url" type="url" placeholder="https://example.com" required style="width:28rem"/>
    <button type="submit">Shorten</button>
  </form>
  <p id="out"></p>
  <script>
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      const url = document.getElementById('url').value;
      const res = await fetch('/api/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      document.getElementById('out').textContent = res.ok
        ? location.origin + '/r/' + data.code
        : (data.error || 'failed');
    };
  </script>
</body>
</html>`;
