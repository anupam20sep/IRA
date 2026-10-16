import type { BoardSnapshot } from "../../shared/snapshot-types.js";

const NO_SPEND = "No spend recorded.";
const BUDGETS_UNSET = "Budgets: unset.";

function budgetUnmeteredMessages(snapshot: BoardSnapshot): string[] {
  return snapshot.doctor.findings
    .filter((finding) => finding.code === "budget_unmetered")
    .map((finding) => finding.message);
}

export function renderSpendView(host: HTMLElement, snapshot: BoardSnapshot): void {
  host.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "ira-spend-view";
  panel.setAttribute("data-view", "spend");

  const spendLine = document.createElement("p");
  spendLine.className = "ira-spend-empty";
  spendLine.setAttribute("data-spend-status", "");
  spendLine.textContent = NO_SPEND;
  panel.append(spendLine);

  const budgetLine = document.createElement("p");
  budgetLine.className = "ira-spend-budgets";
  budgetLine.setAttribute("data-budget-status", "");
  budgetLine.textContent = BUDGETS_UNSET;
  panel.append(budgetLine);

  for (const message of budgetUnmeteredMessages(snapshot)) {
    const finding = document.createElement("p");
    finding.className = "ira-spend-finding";
    finding.setAttribute("data-doctor-finding", "budget_unmetered");
    finding.textContent = message;
    panel.append(finding);
  }

  host.append(panel);
}
