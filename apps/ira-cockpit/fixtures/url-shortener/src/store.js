import { randomBytes } from "node:crypto";

/** @typedef {{ code: string, url: string, createdAt: string }} Link */

export function createStore() {
  /** @type {Map<string, Link>} */
  const links = new Map();

  function makeCode() {
    return randomBytes(4).toString("base64url").slice(0, 6);
  }

  /**
   * @param {string} url
   * @returns {Link}
   */
  function shorten(url) {
    if (!/^https?:\/\//i.test(url)) {
      const err = new Error("URL must start with http:// or https://");
      err.code = "INVALID_URL";
      throw err;
    }
    let code = makeCode();
    while (links.has(code)) code = makeCode();
    const link = { code, url, createdAt: new Date().toISOString() };
    links.set(code, link);
    return link;
  }

  /** @param {string} code */
  function resolve(code) {
    return links.get(code) ?? null;
  }

  function list() {
    return [...links.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  return { shorten, resolve, list };
}
