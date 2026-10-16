import type { BoardSnapshot } from "../shared/snapshot-types.js";
import { renderShell, type ShellView } from "./shell.js";
import { renderFleetView } from "./views/fleet.js";
import { renderAskMeView } from "./views/ask-me.js";
import { renderTasksView } from "./views/tasks.js";

const REFETCH_PREFIXES = ["task.", "ask_me.", "brief.", "away.", "autonomy.", "hive."] as const;

function eventTriggersRefetch(type: string): boolean {
  if (type === "doctor.ran") return true;
  return REFETCH_PREFIXES.some((prefix) => type.startsWith(prefix));
}

export const BEARER_SESSION_KEY = "ira.commandCenter.bearerToken";
export const VIEW_SESSION_KEY = "ira.commandCenter.view";
export const DEFAULT_API_ORIGIN = "http://127.0.0.1:4731";
export const SNAPSHOT_POLL_MS = 1000;
/** Server emits comment heartbeats every 1s; EventSource does not surface them in the browser. */
export const SSE_HEARTBEAT_MS = 1000;
export const MISSED_HEARTBEATS_FOR_STALE = 2;

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const GOD_VIEWS: ShellView[] = [
  "tasks",
  "fleet",
  "activity",
  "memory",
  "spend",
  "ask-me",
  "triggers",
];

export function getApiOrigin(
  location?: Pick<Location, "origin" | "hostname" | "port">,
): string {
  if (location?.origin?.trim()) {
    if (location.hostname !== undefined) {
      return location.hostname === "127.0.0.1" && location.port === "4731"
        ? location.origin
        : DEFAULT_API_ORIGIN;
    }
    return location.origin;
  }
  const loc = globalThis.location;
  if (loc?.hostname === "127.0.0.1" && loc.port === "4731") {
    return loc.origin;
  }
  return DEFAULT_API_ORIGIN;
}

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

export function readBearerToken(storage: Pick<Storage, "getItem"> = sessionStorage): string | null {
  const token = storage.getItem(BEARER_SESSION_KEY)?.trim();
  return token && token.length > 0 ? token : null;
}

export function createMutatingFetch(
  baseFetch: typeof fetch,
  getToken: () => string | null = () => readBearerToken(),
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (!isMutatingMethod(method)) {
      return baseFetch(input, init);
    }
    const headers = new Headers(init?.headers);
    const token = getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return baseFetch(input, { ...init, headers });
  };
}

export type ViewMount = (host: HTMLElement, snapshot: BoardSnapshot) => void;

function placeholderMount(label: string): ViewMount {
  return (host, snapshot) => {
    host.replaceChildren();
    const panel = document.createElement("section");
    panel.className = "ira-view-placeholder";
    panel.setAttribute("data-view", label);
    const heading = document.createElement("h2");
    heading.textContent = label;
    panel.append(heading);
    const meta = document.createElement("p");
    meta.textContent = snapshot.generatedAt;
    panel.append(meta);
    host.append(panel);
  };
}

const VIEW_MOUNTS: Record<ShellView, ViewMount> = {
  brief: placeholderMount("Brief"),
  tasks: placeholderMount("Tasks"),
  fleet: placeholderMount("Fleet"),
  activity: placeholderMount("Activity"),
  memory: placeholderMount("Memory"),
  spend: placeholderMount("Spend"),
  "ask-me": placeholderMount("Ask-Me"),
  triggers: placeholderMount("Triggers"),
};

export function parseViewFromHash(hash: string): ShellView {
  const trimmed = hash.replace(/^#\/?/, "").trim().toLowerCase();
  if (trimmed === "brief" || trimmed.length === 0) {
    return "brief";
  }
  if ((GOD_VIEWS as string[]).includes(trimmed)) {
    return trimmed as ShellView;
  }
  return "brief";
}

export function currentViewFromLocation(location: Pick<Location, "hash"> = globalThis.location): ShellView {
  return parseViewFromHash(location.hash);
}

export type LiveUpdatesDeps = {
  apiOrigin: string;
  EventSource: typeof EventSource;
  fetchSnapshot: () => Promise<BoardSnapshot | null>;
  onSnapshot?: (snapshot: BoardSnapshot) => void;
  onStreamStale?: (stale: boolean) => void;
  onHiveEvent?: (type: string) => void;
};

export type LiveUpdatesHandle = {
  connect(): void;
  disconnect(): void;
};

export function createLiveUpdates(deps: LiveUpdatesDeps): LiveUpdatesHandle {
  let source: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let streamStale = false;

  const markStreamStale = (stale: boolean) => {
    if (streamStale === stale) return;
    streamStale = stale;
    deps.onStreamStale?.(stale);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const applySnapshot = async () => {
    const snapshot = await deps.fetchSnapshot();
    if (snapshot) {
      deps.onSnapshot?.(snapshot);
    }
  };

  const startPolling = () => {
    if (pollTimer) return;
    markStreamStale(true);
    void applySnapshot();
    pollTimer = setInterval(() => {
      void applySnapshot();
    }, SNAPSHOT_POLL_MS);
  };

  const wireSource = (es: EventSource) => {
    es.addEventListener("snapshot", () => {
      markStreamStale(false);
      void applySnapshot();
    });
    es.addEventListener("hive", (event) => {
      markStreamStale(false);
      const message = event as MessageEvent<string>;
      try {
        const parsed = JSON.parse(message.data) as { type?: string };
        if (typeof parsed.type === "string") {
          deps.onHiveEvent?.(parsed.type);
          if (eventTriggersRefetch(parsed.type)) {
            void applySnapshot();
          }
        }
      } catch {
        // Ignore malformed hive frames; Activity view will not see this line.
      }
    });
    es.onerror = () => {
      es.close();
      source = null;
      startPolling();
    };
    es.onopen = () => {
      stopPolling();
      markStreamStale(false);
    };
  };

  return {
    connect() {
      this.disconnect();
      source = new deps.EventSource(`${deps.apiOrigin}/api/events`);
      wireSource(source);
    },
    disconnect() {
      stopPolling();
      source?.close();
      source = null;
      markStreamStale(false);
    },
  };
}

export type BootstrapDeps = {
  root: HTMLElement;
  apiOrigin?: string;
  storage?: Pick<Storage, "getItem" | "setItem">;
  fetchImpl?: typeof fetch;
  EventSource?: typeof EventSource;
};

export type CommandCenterClient = {
  fetch: typeof fetch;
  getSnapshot(): BoardSnapshot | null;
  refetchSnapshot(): Promise<BoardSnapshot | null>;
  postMutation(path: string, init?: Omit<RequestInit, "method">): Promise<Response>;
  mountCurrentView(): void;
  disconnect(): void;
};

function ensureStaleOverlay(root: HTMLElement, snapshot: BoardSnapshot, visible: boolean): void {
  let overlay = root.querySelector("[data-stale-overlay]") as HTMLElement | null;
  if (!visible) {
    overlay?.remove();
    return;
  }
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "ira-stale-overlay";
    overlay.setAttribute("data-stale-overlay", "");
    root.prepend(overlay);
  }
  overlay.textContent = `Stale snapshot from ${snapshot.generatedAt}. Data may not be current.`;
}

export function bootstrapClient(deps: BootstrapDeps): CommandCenterClient {
  const root = deps.root;
  const apiOrigin = deps.apiOrigin ?? getApiOrigin();
  const storage = deps.storage ?? sessionStorage;
  const baseFetch = deps.fetchImpl ?? fetch.bind(globalThis);
  const clientFetch = createMutatingFetch(baseFetch, () => readBearerToken(storage));

  let snapshot: BoardSnapshot | null = null;
  let presentationStale = false;

  let postMutationRef: (path: string, init?: Omit<RequestInit, "method">) => Promise<Response> =
    async () => new Response(null, { status: 500 });

  const mountCurrentView = () => {
    const view = currentViewFromLocation();
    storage.setItem(VIEW_SESSION_KEY, view);
    const host = root.querySelector("[data-view-host]") as HTMLElement | null;
    if (!host || !snapshot) return;
    if (view === "tasks") {
      const steerDisabled =
        presentationStale || snapshot.stale || snapshot.doctor.hiveReady !== true;
      renderTasksView(host, snapshot, { postMutation: postMutationRef, steerDisabled });
      return;
    }
    if (view === "fleet") {
      renderFleetView(host, snapshot);
      return;
    }
    if (view === "ask-me") {
      renderAskMeView(host, snapshot, { postMutation: postMutationRef });
      return;
    }
    VIEW_MOUNTS[view](host, snapshot);
  };

  const render = () => {
    if (!snapshot) return;
    renderShell(root, snapshot);
    if (presentationStale || snapshot.stale) {
      ensureStaleOverlay(root, snapshot, true);
    } else {
      ensureStaleOverlay(root, snapshot, false);
    }
    mountCurrentView();
  };

  const refetchSnapshot = async (): Promise<BoardSnapshot | null> => {
    const response = await clientFetch(`${apiOrigin}/api/snapshot`);
    if (!response.ok) {
      presentationStale = true;
      render();
      return snapshot;
    }
    snapshot = (await response.json()) as BoardSnapshot;
    if (!presentationStale) {
      presentationStale = snapshot.stale;
    }
    render();
    return snapshot;
  };

  const live = createLiveUpdates({
    apiOrigin,
    EventSource: deps.EventSource ?? EventSource,
    fetchSnapshot: refetchSnapshot,
    onSnapshot(next) {
      snapshot = next;
      if (!presentationStale) {
        presentationStale = next.stale;
      }
      render();
    },
    onStreamStale(stale) {
      presentationStale = stale || (snapshot?.stale ?? false);
      render();
    },
  });

  const onHashChange = () => {
    mountCurrentView();
  };

  window.addEventListener("hashchange", onHashChange);

  const postMutation = async (path: string, init: Omit<RequestInit, "method"> = {}) => {
    const response = await clientFetch(`${apiOrigin}${path}`, { ...init, method: "POST" });
    if (response.ok) {
      await refetchSnapshot();
    }
    return response;
  };
  postMutationRef = postMutation;

  void refetchSnapshot();
  live.connect();

  return {
    fetch: clientFetch,
    getSnapshot: () => snapshot,
    refetchSnapshot,
    postMutation,
    mountCurrentView,
    disconnect() {
      window.removeEventListener("hashchange", onHashChange);
      live.disconnect();
    },
  };
}

function main(): void {
  const root = document.getElementById("app");
  if (!root) return;
  bootstrapClient({ root });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
}
