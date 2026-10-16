import { buildMorningBriefLines } from "../brief-copy.js";
import type { BoardSnapshot } from "../../shared/snapshot-types.js";

export type BriefViewDeps = {
  postMutation: (path: string, init?: Omit<RequestInit, "method">) => Promise<Response>;
};

function aggregateCounts(snapshot: BoardSnapshot) {
  return snapshot.features.reduce(
    (acc, feature) => ({
      done: acc.done + feature.taskCounts.done,
      blocked: acc.blocked + feature.taskCounts.blocked,
      doing: acc.doing + feature.taskCounts.doing,
    }),
    { done: 0, blocked: 0, doing: 0 },
  );
}

function totalOpenAskMe(snapshot: BoardSnapshot): number {
  return snapshot.features.reduce((sum, feature) => sum + feature.openAskMe, 0);
}

function parseConstraints(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseBudgetField(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return { ok: false };
  return { ok: true, value: parsed };
}

export function formatBriefAcknowledgement(
  featureId: string,
  body: { brief?: { id?: string }; tasks?: unknown[] },
): string {
  const briefId = body.brief?.id ?? "unknown";
  const taskCount = Array.isArray(body.tasks) ? body.tasks.length : 0;
  return `Brief ${briefId} accepted for ${featureId} (${taskCount} tasks).`;
}

export function renderBriefView(
  host: HTMLElement,
  snapshot: BoardSnapshot,
  deps: BriefViewDeps,
): void {
  host.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "ira-brief-view";
  panel.setAttribute("data-view", "brief");

  const counts = aggregateCounts(snapshot);
  const morningLines = buildMorningBriefLines({
    ...counts,
    openAskMe: totalOpenAskMe(snapshot),
    pollIntervalMs: snapshot.autonomy.pollIntervalMs,
    awayMode: snapshot.autonomy.awayMode,
  });

  const morning = document.createElement("div");
  morning.className = "ira-brief-morning";
  morning.setAttribute("data-morning-brief", "");
  morning.setAttribute("lang", "en");
  for (const line of morningLines) {
    const row = document.createElement("p");
    row.className = "ira-brief-morning__line";
    row.textContent = line;
    morning.append(row);
  }
  panel.append(morning);

  const goalHeading = document.createElement("h3");
  goalHeading.textContent = "Goal brief";
  panel.append(goalHeading);

  const form = document.createElement("form");
  form.className = "ira-brief-form";
  form.setAttribute("data-brief-form", "");
  form.noValidate = true;

  const defaultFeature = snapshot.features[0]?.featureId ?? "";

  const featureField = document.createElement("label");
  featureField.textContent = "Feature";
  const featureSelect = document.createElement("select");
  featureSelect.setAttribute("data-brief-field", "featureId");
  for (const feature of snapshot.features) {
    const option = document.createElement("option");
    option.value = feature.featureId;
    option.textContent = feature.featureId;
    featureSelect.append(option);
  }
  if (defaultFeature) featureSelect.value = defaultFeature;
  featureField.append(featureSelect);
  form.append(featureField);

  form.append(labeledTextarea("Outcome", "outcome"));
  form.append(labeledInput("Deliverable", "deliverable"));
  form.append(labeledTextarea("Constraints (one per line)", "constraints"));
  form.append(labeledInput("Budget tokens", "budgetTokens"));
  form.append(labeledInput("Budget USD", "budgetUsd"));

  const validation = document.createElement("p");
  validation.className = "ira-brief-validation";
  validation.setAttribute("data-brief-validation", "");
  validation.hidden = true;
  form.append(validation);

  const ack = document.createElement("p");
  ack.className = "ira-brief-ack";
  ack.setAttribute("data-brief-ack", "");
  ack.hidden = true;
  form.append(ack);

  const submit = document.createElement("button");
  submit.type = "button";
  submit.textContent = "Submit brief";
  submit.setAttribute("data-action", "brief-submit");
  form.append(submit);

  submit.addEventListener("click", () => {
    validation.hidden = true;
    validation.textContent = "";
    ack.hidden = true;
    ack.textContent = "";

    const featureId = featureSelect.value.trim();
    const outcome = form.querySelector('[data-brief-field="outcome"]') as HTMLTextAreaElement;
    const deliverable = form.querySelector('[data-brief-field="deliverable"]') as HTMLInputElement;
    const constraintsRaw = form.querySelector('[data-brief-field="constraints"]') as HTMLTextAreaElement;
    const budgetTokensRaw = form.querySelector('[data-brief-field="budgetTokens"]') as HTMLInputElement;
    const budgetUsdRaw = form.querySelector('[data-brief-field="budgetUsd"]') as HTMLInputElement;

    const outcomeText = outcome.value.trim();
    const deliverableText = deliverable.value.trim();

    if (!outcomeText || !deliverableText) {
      validation.textContent = "Outcome and deliverable are required.";
      validation.hidden = false;
      return;
    }

    const budgetTokens = parseBudgetField(budgetTokensRaw.value);
    const budgetUsd = parseBudgetField(budgetUsdRaw.value);
    if (!budgetTokens.ok || !budgetUsd.ok) {
      validation.textContent = "Budget values must be blank or a non-negative number.";
      validation.hidden = false;
      return;
    }

    const body = {
      featureId,
      outcome: outcomeText,
      constraints: parseConstraints(constraintsRaw.value),
      budgetTokens: budgetTokens.value,
      budgetUsd: budgetUsd.value,
      deliverable: deliverableText,
    };

    void deps
      .postMutation("/api/brief", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      .then(async (response) => {
        if (!response.ok) return;
        let parsed: { brief?: { id?: string }; tasks?: unknown[] } = {};
        try {
          parsed = (await response.json()) as typeof parsed;
        } catch {
          return;
        }
        ack.textContent = formatBriefAcknowledgement(featureId, parsed);
        ack.hidden = false;
      });
  });

  panel.append(form);
  host.append(panel);
}

function labeledInput(label: string, field: string): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const input = document.createElement("input");
  input.setAttribute("data-brief-field", field);
  wrap.append(input);
  return wrap;
}

function labeledTextarea(label: string, field: string): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const area = document.createElement("textarea");
  area.setAttribute("data-brief-field", field);
  wrap.append(area);
  return wrap;
}
