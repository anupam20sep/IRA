import type { BoardSnapshot, PatternsDirState } from "../../shared/snapshot-types.js";

const NO_PATTERNS = "No patterns are stored yet.";
const FILES_NO_QUERY =
  "Patterns are on disk. Summaries stay hidden until the learning-memory query surface is available.";

export function memoryStatusMessage(state: PatternsDirState): string {
  if (state === "files-no-query") return FILES_NO_QUERY;
  return NO_PATTERNS;
}

export function renderMemoryView(host: HTMLElement, snapshot: BoardSnapshot): void {
  host.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "ira-memory-view";
  panel.setAttribute("data-view", "memory");

  const status = document.createElement("p");
  status.className = "ira-memory-status";
  status.setAttribute("data-patterns-dir-state", snapshot.patternsDirState);
  status.textContent = memoryStatusMessage(snapshot.patternsDirState);
  panel.append(status);

  host.append(panel);
}
