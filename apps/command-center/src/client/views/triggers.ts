import type { AutonomySlice, BoardSnapshot, SnapshotEvent } from "../../shared/snapshot-types.js";

const DEFAULT_POLL_INTERVAL_MS = 60_000;

function pollIntervalMs(autonomy: AutonomySlice): number {
  const ms = autonomy.pollIntervalMs;
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_POLL_INTERVAL_MS;
}

function latestAwayTick(events: SnapshotEvent[]): SnapshotEvent | null {
  let latest: SnapshotEvent | null = null;
  for (const line of events) {
    if (line.type !== "away.tick") continue;
    if (!latest || line.ts >= latest.ts) {
      latest = line;
    }
  }
  return latest;
}

function nextPollLine(autonomy: AutonomySlice, events: SnapshotEvent[]): string {
  const interval = pollIntervalMs(autonomy);
  if (latestAwayTick(events)) {
    return `Next poll within ${interval} ms of the last away tick`;
  }
  return "Next poll on the away interval";
}

export function renderTriggersView(host: HTMLElement, snapshot: BoardSnapshot): void {
  host.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "ira-triggers-view";
  panel.setAttribute("data-view", "triggers");

  const { autonomy } = snapshot;
  const enabled = autonomy.awayMode === true;
  const state = enabled ? "on" : "off";

  const headline = document.createElement("h2");
  headline.className = "ira-triggers-view__headline";
  headline.textContent = enabled ? "Away poll armed" : "Nothing is scheduled.";
  panel.append(headline);

  const row = document.createElement("article");
  row.className = "ira-trigger-row";
  row.setAttribute("data-trigger-id", "away-poll");
  row.setAttribute("data-trigger-state", state);

  const title = document.createElement("h3");
  title.className = "ira-trigger-row__title";
  title.textContent = "Away poll";
  row.append(title);

  const status = document.createElement("p");
  status.className = "ira-trigger-row__status";
  status.textContent = enabled ? "Enabled" : "Disabled";
  row.append(status);

  if (enabled) {
    const schedule = document.createElement("p");
    schedule.className = "ira-trigger-row__schedule";
    schedule.textContent = nextPollLine(autonomy, snapshot.events);
    row.append(schedule);

    const interval = document.createElement("p");
    interval.className = "ira-trigger-row__interval";
    interval.textContent = `Poll interval: ${pollIntervalMs(autonomy)} ms`;
    row.append(interval);
  }

  panel.append(row);
  host.append(panel);
}
