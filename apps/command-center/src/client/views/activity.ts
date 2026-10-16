import type { SnapshotEvent } from "../../shared/snapshot-types.js";

export type ActivityViewState = {
  prepended: SnapshotEvent[];
};

export type ActivityViewDeps = {
  fetchEventsBefore: (eventsBefore: string) => Promise<SnapshotEvent[]>;
  state: ActivityViewState;
};

function mergeEvents(prepended: SnapshotEvent[], tail: SnapshotEvent[]): SnapshotEvent[] {
  const seen = new Set<string>();
  const merged: SnapshotEvent[] = [];
  for (const row of [...prepended, ...tail]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

function formatDataSummary(data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return "";
  const parts = keys.map((key) => `${key}=${String(data[key])}`);
  return parts.join(" ");
}

function renderEventRow(row: SnapshotEvent): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "ira-activity-event";
  item.setAttribute("data-event-id", row.id);

  const line = document.createElement("span");
  line.className = "ira-activity-event__line";
  const feature = row.featureId ?? "—";
  const dataSummary = formatDataSummary(row.data);
  const dataPart = dataSummary.length > 0 ? ` ${dataSummary}` : "";
  line.textContent = `${row.ts} ${row.type} ${feature} ${row.actor.kind}:${row.actor.id}${dataPart}`;
  item.append(line);
  return item;
}

export function renderActivityView(
  host: HTMLElement,
  tailEvents: SnapshotEvent[],
  deps: ActivityViewDeps,
): void {
  host.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "ira-activity-view";
  panel.setAttribute("data-view", "activity");

  const events = mergeEvents(deps.state.prepended, tailEvents);

  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "ira-activity-empty";
    empty.setAttribute("data-activity-empty", "");
    empty.textContent = "No events recorded.";
    panel.append(empty);
    host.append(panel);
    return;
  }

  const loadWrap = document.createElement("div");
  loadWrap.className = "ira-activity-load";
  const loadBtn = document.createElement("button");
  loadBtn.type = "button";
  loadBtn.className = "ira-activity-load__button";
  loadBtn.setAttribute("data-load-earlier", "");
  loadBtn.textContent = "Load earlier";
  loadWrap.append(loadBtn);
  panel.append(loadWrap);

  const list = document.createElement("ol");
  list.className = "ira-activity-list";
  list.setAttribute("data-activity-list", "");
  for (const row of events) {
    list.append(renderEventRow(row));
  }
  panel.append(list);
  host.append(panel);

  queueMicrotask(() => {
    list.scrollTop = list.scrollHeight;
  });

  loadBtn.addEventListener("click", () => {
    const anchorId = events[0]?.id;
    if (!anchorId) return;
    loadBtn.disabled = true;
    void deps.fetchEventsBefore(anchorId).then((older) => {
      if (older.length === 0) {
        loadWrap.remove();
        return;
      }
      deps.state.prepended = mergeEvents(older, deps.state.prepended);
      renderActivityView(host, tailEvents, deps);
    });
  });
}
