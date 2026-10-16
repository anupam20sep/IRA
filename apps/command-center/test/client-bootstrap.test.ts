/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BEARER_SESSION_KEY,
  DEFAULT_API_ORIGIN,
  SNAPSHOT_POLL_MS,
  createMutatingFetch,
  createLiveUpdates,
  getApiOrigin,
  isMutatingMethod,
} from "../src/client/main.js";

describe("getApiOrigin", () => {
  it("defaults to loopback port 4731", () => {
    expect(getApiOrigin()).toBe(DEFAULT_API_ORIGIN);
  });

  it("uses document location origin when present", () => {
    expect(getApiOrigin({ origin: "http://127.0.0.1:4731" })).toBe("http://127.0.0.1:4731");
  });
});

describe("isMutatingMethod", () => {
  it("treats POST PUT PATCH DELETE as mutating", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isMutatingMethod(method)).toBe(true);
    }
  });

  it("does not treat GET as mutating", () => {
    expect(isMutatingMethod("GET")).toBe(false);
  });
});

describe("createMutatingFetch", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("includes Bearer Authorization on mutating requests when token is stored", async () => {
    sessionStorage.setItem(BEARER_SESSION_KEY, "loopback-test-token");
    const baseFetch = vi.fn(async () => new Response("{}"));
    const fetch = createMutatingFetch(baseFetch, () => sessionStorage.getItem(BEARER_SESSION_KEY));

    await fetch("/api/tasks/dispatch", { method: "POST", body: "{}" });

    expect(baseFetch).toHaveBeenCalledOnce();
    const init = baseFetch.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer loopback-test-token");
  });

  it("does not add Authorization on GET", async () => {
    sessionStorage.setItem(BEARER_SESSION_KEY, "loopback-test-token");
    const baseFetch = vi.fn(async () => new Response("{}"));
    const fetch = createMutatingFetch(baseFetch, () => sessionStorage.getItem(BEARER_SESSION_KEY));

    await fetch("/api/snapshot");

    const init = baseFetch.mock.calls[0]![1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBeNull();
  });
});

describe("createLiveUpdates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts snapshot polling when EventSource errors", () => {
    type MockEs = {
      url: string;
      onerror: (() => void) | null;
      close: () => void;
      addEventListener: ReturnType<typeof vi.fn>;
    };

    let created: MockEs | undefined;
    const MockEventSource = vi.fn(function MockEventSource(this: MockEs, url: string) {
      created = { url, onerror: null, close: vi.fn(), addEventListener: vi.fn() };
      return created;
    }) as unknown as typeof EventSource;

    const fetchSnapshot = vi.fn(async () => null);
    const pollSpy = vi.spyOn(globalThis, "setInterval");

    const live = createLiveUpdates({
      apiOrigin: DEFAULT_API_ORIGIN,
      EventSource: MockEventSource,
      fetchSnapshot,
    });
    live.connect();

    expect(MockEventSource).toHaveBeenCalledWith(`${DEFAULT_API_ORIGIN}/api/events`);
    expect(created).toBeDefined();
    created!.onerror?.();

    expect(pollSpy).toHaveBeenCalledWith(expect.any(Function), SNAPSHOT_POLL_MS);

    live.disconnect();
  });
});
