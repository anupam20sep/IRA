/**
 * Ask-Me / approvals inbox IA adapted from Munder Difflin (MIT).
 * @see https://github.com/chaitanyagiri/munder-difflin — AskMeTab.tsx; askMeOrder.ts
 * @see https://munderdiffl.in/blog/command-center-guide/
 * LimeZu pixel assets are not copied.
 */
import type { AskMeAction, BoardSnapshot, SnapshotAskMe } from "../../shared/snapshot-types.js";

export type AskMeViewDeps = {
  postMutation: (path: string, init?: Omit<RequestInit, "method">) => Promise<Response>;
  fetchShow: (id: string) => Promise<SnapshotAskMe | null>;
  confirm?: (message?: string) => boolean;
  initialSelectedId?: string | null;
};

const ACTIONS: AskMeAction[] = ["retry", "keep_blocked", "acknowledge"];

const CONFIRM_MESSAGE = "Submit this answer to Ira?";

function openItems(snapshot: BoardSnapshot): SnapshotAskMe[] {
  return snapshot.askMe.filter((item) => item.state === "open");
}

function jsonPost(
  postMutation: AskMeViewDeps["postMutation"],
  body: Record<string, unknown>,
): void {
  void postMutation("/api/ask-me/answer", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function appendDetailField(
  parent: HTMLElement,
  attr: string,
  value: string | null,
): void {
  const row = document.createElement("p");
  row.className = "ira-ask-me-detail-field";
  row.setAttribute(attr, "");
  row.textContent = value ?? "—";
  parent.append(row);
}

function renderShowDetail(detail: HTMLElement, item: SnapshotAskMe): void {
  appendDetailField(detail, "data-ask-me-reason-class", item.reasonClass);
  appendDetailField(detail, "data-ask-me-feature-id", item.featureId);
  appendDetailField(detail, "data-ask-me-task-id", item.taskId);
  appendDetailField(detail, "data-ask-me-agent-id", item.agentId);
  appendDetailField(detail, "data-ask-me-state", item.state);
  appendDetailField(detail, "data-ask-me-created-at", item.createdAt);

  const question = document.createElement("p");
  question.className = "ira-ask-me-question";
  question.setAttribute("data-ask-me-question", "");
  question.textContent = item.question;
  detail.append(question);
}

function renderAnswerForm(
  detail: HTMLElement,
  item: SnapshotAskMe,
  deps: AskMeViewDeps,
  confirmFn: (message?: string) => boolean,
): void {
  const form = document.createElement("div");
  form.className = "ira-ask-me-answer-form";

  const text = document.createElement("textarea");
  text.setAttribute("data-ask-me-answer-text", "");
  text.rows = 3;
  text.placeholder = "Your answer (required)";

  const action = document.createElement("select");
  action.setAttribute("data-ask-me-action", "");
  for (const name of ACTIONS) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name.replace("_", " ");
    action.append(option);
  }

  const submit = document.createElement("button");
  submit.type = "button";
  submit.textContent = "Submit answer";
  submit.setAttribute("data-action", "ask-me-submit");
  submit.addEventListener("click", () => {
    const answerText = text.value.trim();
    if (answerText.length === 0) {
      return;
    }
    if (!confirmFn(CONFIRM_MESSAGE)) {
      return;
    }
    jsonPost(deps.postMutation, {
      id: item.id,
      text: answerText,
      action: action.value as AskMeAction,
      confirm: true,
    });
  });

  form.append(text, action, submit);
  detail.append(form);
}

export function renderAskMeView(
  host: HTMLElement,
  snapshot: BoardSnapshot,
  deps: AskMeViewDeps,
): void {
  host.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "ira-ask-me-view";
  panel.setAttribute("data-view", "ask-me");

  const inbox = document.createElement("ul");
  inbox.className = "ira-ask-me-inbox";
  inbox.setAttribute("data-ask-me-inbox", "");

  const items = openItems(snapshot);
  let selectedId =
    deps.initialSelectedId && items.some((row) => row.id === deps.initialSelectedId)
      ? deps.initialSelectedId
      : (items[0]?.id ?? null);

  const detail = document.createElement("section");
  detail.className = "ira-ask-me-detail";
  detail.setAttribute("data-ask-me-detail", "");

  const confirmFn = deps.confirm ?? ((message?: string) => globalThis.confirm(message));
  let detailGeneration = 0;

  const paintDetail = () => {
    detail.replaceChildren();
    const listRow = items.find((row) => row.id === selectedId);
    if (!listRow) {
      const empty = document.createElement("p");
      empty.textContent = items.length === 0 ? "No open Ask-Me items." : "Select an item.";
      detail.append(empty);
      return;
    }

    const loading = document.createElement("p");
    loading.className = "ira-ask-me-detail-loading";
    loading.setAttribute("data-ask-me-detail-loading", "");
    loading.textContent = "Loading detail…";
    detail.append(loading);

    const generation = ++detailGeneration;
    void deps.fetchShow(listRow.id).then((showItem) => {
      if (generation !== detailGeneration) {
        return;
      }
      detail.replaceChildren();
      if (!showItem) {
        const failed = document.createElement("p");
        failed.textContent = "Could not load Ask-Me detail.";
        detail.append(failed);
        return;
      }
      renderShowDetail(detail, showItem);
      renderAnswerForm(detail, showItem, deps, confirmFn);
    });
  };

  for (const item of items) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ira-ask-me-row";
    row.setAttribute("data-ask-me-id", item.id);
    row.textContent = item.question;
    row.addEventListener("click", () => {
      selectedId = item.id;
      paintDetail();
    });
    inbox.append(row);
  }

  paintDetail();
  panel.append(inbox, detail);
  host.append(panel);
}
