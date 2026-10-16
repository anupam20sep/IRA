import type { BoardSnapshot, SnapshotAgent, SnapshotTask } from "../../shared/snapshot-types.js";

const ENGINE_DEGRADATION_COPY =
  "No healthy engine rung is available. Coordination data remains visible.";

export function contextGaugeLabel(ratio: number | undefined): string {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) {
    return "unknown";
  }
  const pct = Math.round(ratio * 100);
  return `${pct}% used`;
}

export function resolveDoingTaskForAgent(
  agentId: string,
  tasks: readonly SnapshotTask[],
): SnapshotTask | null {
  let best: SnapshotTask | null = null;
  for (const row of tasks) {
    if (row.assigneeAgentId !== agentId || row.status !== "doing") {
      continue;
    }
    if (!best || row.updatedAt.localeCompare(best.updatedAt) > 0) {
      best = row;
    }
  }
  return best;
}

function allTasks(snapshot: BoardSnapshot): SnapshotTask[] {
  return snapshot.features.flatMap((feature) => feature.tasks);
}

function displayEngineModel(agent: SnapshotAgent): string {
  const engine = agent.engine?.trim() || "unknown";
  const model = agent.model?.trim() || "unknown";
  return `${engine} / ${model}`;
}

function renderContextGauge(host: HTMLElement, ratio: number | undefined): void {
  const wrap = document.createElement("div");
  wrap.className = "ira-fleet-context";
  const label = document.createElement("span");
  label.className = "ira-fleet-context__label";
  label.textContent = "Context";
  const gauge = document.createElement("span");
  gauge.className = "ira-fleet-context__gauge";
  gauge.setAttribute("data-context-gauge", "");
  gauge.textContent = contextGaugeLabel(ratio);
  if (typeof ratio === "number" && Number.isFinite(ratio)) {
    const meter = document.createElement("meter");
    meter.min = 0;
    meter.max = 1;
    meter.value = Math.min(1, Math.max(0, ratio));
    meter.setAttribute("data-context-meter", "");
    wrap.append(label, meter, gauge);
  } else {
    wrap.append(label, gauge);
  }
  host.append(wrap);
}

function renderWorkerCard(agent: SnapshotAgent, tasks: readonly SnapshotTask[]): HTMLElement {
  const card = document.createElement("article");
  card.className = "ira-fleet-card";
  card.setAttribute("data-agent-id", agent.id);

  const heading = document.createElement("h3");
  heading.className = "ira-fleet-card__name";
  heading.textContent = agent.name;
  card.append(heading);

  const status = document.createElement("p");
  status.className = "ira-fleet-card__status";
  status.setAttribute("data-agent-status", agent.status);
  status.textContent = `Status: ${agent.status}`;
  card.append(status);

  const engineLine = document.createElement("p");
  engineLine.className = "ira-fleet-card__engine";
  engineLine.textContent = `Engine / model: ${displayEngineModel(agent)}`;
  card.append(engineLine);

  const current = resolveDoingTaskForAgent(agent.id, tasks);
  const taskLine = document.createElement("p");
  taskLine.className = "ira-fleet-card__task";
  taskLine.setAttribute("data-current-task", "");
  taskLine.textContent = current ? current.title : "none recorded";
  card.append(taskLine);

  if (agent.capabilityTags.length > 0) {
    const tags = document.createElement("p");
    tags.className = "ira-fleet-card__tags";
    tags.textContent = `Tags: ${agent.capabilityTags.join(", ")}`;
    card.append(tags);
  }

  renderContextGauge(card, agent.contextUsedRatio);
  return card;
}

export function renderFleetView(host: HTMLElement, snapshot: BoardSnapshot): void {
  host.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "ira-fleet-view";
  panel.setAttribute("data-view", "fleet");

  const { hiveReady, engineRungReady } = snapshot.doctor;
  if (hiveReady && !engineRungReady) {
    const notice = document.createElement("p");
    notice.className = "ira-fleet-engine-degradation";
    notice.setAttribute("data-fleet-engine-degradation", "");
    notice.textContent = ENGINE_DEGRADATION_COPY;
    panel.append(notice);
  }

  const grid = document.createElement("div");
  grid.className = "ira-fleet-grid";
  grid.setAttribute("data-fleet-grid", "");

  const tasks = allTasks(snapshot);
  for (const row of snapshot.agents) {
    grid.append(renderWorkerCard(row, tasks));
  }

  panel.append(grid);
  host.append(panel);
}
