import { computeReadiness } from "../dag.js";
import { canAbort, canDispatch, canPause, canReassign } from "../steer-guards.js";
import type { BoardSnapshot, SnapshotAgent, SnapshotTask } from "../../shared/snapshot-types.js";

export type TasksViewDeps = {
  postMutation: (path: string, init?: Omit<RequestInit, "method">) => Promise<Response>;
  steerDisabled: boolean;
  confirm?: (message?: string) => boolean;
  prompt?: (message?: string, defaultValue?: string) => string | null;
};

type KanbanColumn = "Ready" | "Waiting" | "Doing" | "Blocked" | "Done";

const COLUMNS: KanbanColumn[] = ["Ready", "Waiting", "Doing", "Blocked", "Done"];

const PAUSE_HELPER =
  "Sets hold on the task; does not record a failed review.";

function tasksById(tasks: SnapshotTask[]): ReadonlyMap<string, SnapshotTask> {
  return new Map(tasks.map((row) => [row.id, row]));
}

function agentStatus(agents: SnapshotAgent[], agentId: string | null) {
  if (!agentId) return null;
  return agents.find((agent) => agent.id === agentId)?.status ?? null;
}

function columnForTask(
  task: SnapshotTask,
  map: ReadonlyMap<string, SnapshotTask>,
): KanbanColumn {
  if (task.status === "doing") return "Doing";
  if (task.status === "blocked") return "Blocked";
  if (task.status === "done") return "Done";
  return computeReadiness(task, map) === "ready" ? "Ready" : "Waiting";
}

function jsonPost(
  postMutation: TasksViewDeps["postMutation"],
  path: string,
  body: Record<string, unknown>,
): void {
  void postMutation(path, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function steerPayload(featureId: string, taskId: string): Record<string, unknown> {
  return { featureId, taskId };
}

export function renderTasksView(
  host: HTMLElement,
  snapshot: BoardSnapshot,
  deps: TasksViewDeps,
): void {
  host.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "ira-tasks-view";
  panel.setAttribute("data-view", "tasks");

  const board = document.createElement("div");
  board.className = "ira-tasks-kanban";
  board.setAttribute("data-kanban", "");

  const confirmFn = deps.confirm ?? ((message?: string) => globalThis.confirm(message));
  const promptFn = deps.prompt ?? ((message?: string) => globalThis.prompt(message ?? ""));

  for (const feature of snapshot.features) {
    const map = tasksById(feature.tasks);
    const columns = new Map<KanbanColumn, SnapshotTask[]>(
      COLUMNS.map((name) => [name, []]),
    );

    for (const row of feature.tasks) {
      const column = columnForTask(row, map);
      columns.get(column)!.push(row);
    }

    for (const name of COLUMNS) {
      const columnEl = document.createElement("section");
      columnEl.className = "ira-kanban-column";
      columnEl.setAttribute("data-kanban-column", name);

      const heading = document.createElement("h3");
      heading.textContent = name;
      columnEl.append(heading);

      const list = document.createElement("ul");
      list.className = "ira-kanban-cards";

      for (const row of columns.get(name) ?? []) {
        list.append(
          renderTaskCard(
            row,
            feature.featureId,
            snapshot.agents,
            map,
            snapshot.doctor.hiveReady === true,
            deps,
            confirmFn,
            promptFn,
          ),
        );
      }

      columnEl.append(list);
      board.append(columnEl);
    }
  }

  panel.append(board);
  host.append(panel);
}

function renderTaskCard(
  task: SnapshotTask,
  featureId: string,
  agents: SnapshotAgent[],
  map: ReadonlyMap<string, SnapshotTask>,
  hiveReady: boolean,
  deps: TasksViewDeps,
  confirmFn: (message?: string) => boolean,
  promptFn: (message?: string, defaultValue?: string) => string | null,
): HTMLLIElement {
  const card = document.createElement("li");
  card.className = "ira-task-card";
  card.setAttribute("data-task-id", task.id);

  const title = document.createElement("span");
  title.className = "ira-task-card__title";
  title.textContent = task.title;
  card.append(title);

  if (task.hold === true) {
    const badge = document.createElement("span");
    badge.className = "ira-task-card__held";
    badge.setAttribute("data-held-badge", "");
    badge.textContent = "Held";
    card.append(badge);
  }

  const controls = document.createElement("div");
  controls.className = "ira-task-card__controls";

  appendSteerControls(
    controls,
    task,
    featureId,
    agents,
    map,
    hiveReady,
    deps,
    confirmFn,
    promptFn,
  );

  card.append(controls);
  return card;
}

function appendSteerControls(
  host: HTMLElement,
  task: SnapshotTask,
  featureId: string,
  agents: SnapshotAgent[],
  map: ReadonlyMap<string, SnapshotTask>,
  hiveReady: boolean,
  deps: TasksViewDeps,
  confirmFn: (message?: string) => boolean,
  promptFn: (message?: string, defaultValue?: string) => string | null,
): void {
  const assignee = agentStatus(agents, task.assigneeAgentId);
  const dispatchGuard = canDispatch({
    task,
    tasksById: map,
    hiveReady: hiveReady && !deps.steerDisabled,
    assigneeStatus: assignee,
  });
  const showDispatch =
    task.status === "todo" && computeReadiness(task, map) === "ready";
  if (showDispatch) {
    host.append(
      actionButton("Dispatch", "dispatch", !dispatchGuard.ok || deps.steerDisabled, () => {
        if (!dispatchGuard.ok || deps.steerDisabled) return;
        jsonPost(deps.postMutation, "/api/tasks/dispatch", steerPayload(featureId, task.id));
      }),
    );
  }

  if (canPause(task).ok) {
    const pauseWrap = document.createElement("div");
    pauseWrap.className = "ira-task-steer-pause";
    pauseWrap.append(
      actionButton("Pause", "pause", deps.steerDisabled, () => {
        jsonPost(deps.postMutation, "/api/tasks/pause", steerPayload(featureId, task.id));
      }),
    );
    const helper = document.createElement("p");
    helper.className = "ira-task-steer-pause__helper";
    helper.textContent = PAUSE_HELPER;
    pauseWrap.append(helper);
    host.append(pauseWrap);
  }

  if (canAbort({ status: task.status, confirm: true }).ok) {
    host.append(
      actionButton("Abort", "abort", deps.steerDisabled, () => {
        if (deps.steerDisabled) return;
        const reason = promptFn("Abort reason?")?.trim() ?? "";
        if (reason.length === 0) return;
        if (!confirmFn("Abort this task? This cannot be undone.")) return;
        jsonPost(deps.postMutation, "/api/tasks/abort", {
          ...steerPayload(featureId, task.id),
          confirm: true,
          reason,
        });
      }),
    );
  }

  appendReassignPicker(host, task, featureId, agents, deps);
}

function appendReassignPicker(
  host: HTMLElement,
  task: SnapshotTask,
  featureId: string,
  agents: SnapshotAgent[],
  deps: TasksViewDeps,
): void {
  if (task.status !== "todo" && task.status !== "doing") {
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "ira-task-reassign";
  const select = document.createElement("select");
  select.setAttribute("data-action", "reassign-target");
  select.disabled = deps.steerDisabled;

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Reassign to…";
  select.append(empty);

  for (const agent of agents) {
    const option = document.createElement("option");
    option.value = agent.id;
    option.textContent = agent.name;
    select.append(option);
  }

  const button = actionButton("Reassign", "reassign", deps.steerDisabled, () => {
    const agentId = select.value.trim();
    const target = agents.find((row) => row.id === agentId);
    const guard = canReassign({
      status: task.status,
      targetAgentId: agentId,
      targetStatus: target?.status ?? null,
    });
    if (!guard.ok || deps.steerDisabled) return;
    jsonPost(deps.postMutation, "/api/tasks/reassign", {
      ...steerPayload(featureId, task.id),
      agentId,
    });
  });

  wrap.append(select, button);
  host.append(wrap);
}

function actionButton(
  label: string,
  action: string,
  disabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("data-action", action);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}
