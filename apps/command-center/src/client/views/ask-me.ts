import type { AskMeAction, BoardSnapshot, SnapshotAskMe } from "../../shared/snapshot-types.js";

export type AskMeViewDeps = {
  postMutation: (path: string, init?: Omit<RequestInit, "method">) => Promise<Response>;
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

  const paintDetail = () => {
    detail.replaceChildren();
    const selected = items.find((row) => row.id === selectedId);
    if (!selected) {
      const empty = document.createElement("p");
      empty.textContent = items.length === 0 ? "No open Ask-Me items." : "Select an item.";
      detail.append(empty);
      return;
    }

    const question = document.createElement("p");
    question.className = "ira-ask-me-question";
    question.setAttribute("data-ask-me-question", "");
    question.textContent = selected.question;
    detail.append(question);

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
        id: selected.id,
        text: answerText,
        action: action.value as AskMeAction,
        confirm: true,
      });
    });

    form.append(text, action, submit);
    detail.append(form);
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
