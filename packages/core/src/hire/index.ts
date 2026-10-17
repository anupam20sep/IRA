import type { AskMeAction, AskMeItem } from "../command-plane/types.js";
import { registerCommandPlaneHooks } from "../command-plane/hooks.js";
import type { AskMeHireResult } from "./ask-me-bridge.js";
import { handleUntrustedImportAskMeAnswer } from "./ask-me-bridge.js";
import { bindHireHiveRoot, hireHooksImpl } from "./hooks-impl.js";

const REVIEW_ID_RE = /^hrv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HireAskMeAnswerDelegateInput = {
  hiveRoot: string;
  item: AskMeItem;
  action: AskMeAction;
  text: string;
};

export type HireAskMeAnswerDelegateResult = { hire: AskMeHireResult };

type HireAskMeAnswerDelegate = (
  input: HireAskMeAnswerDelegateInput,
) => Promise<HireAskMeAnswerDelegateResult | null>;

let hireAskMeAnswerDelegate: HireAskMeAnswerDelegate | null = null;

/** Returns the hire Ask-Me answer delegate when registered (P-001 `ask-me-answer` wiring). */
export function getHireAskMeAnswerDelegate(): HireAskMeAnswerDelegate | null {
  return hireAskMeAnswerDelegate;
}

function reviewIdFromAskMeItem(item: AskMeItem): string | null {
  const taskId = item.taskId?.trim() ?? "";
  if (REVIEW_ID_RE.test(taskId)) return taskId;
  const token = item.question.split(/\s+/).find((part) => REVIEW_ID_RE.test(part));
  return token && REVIEW_ID_RE.test(token) ? token : null;
}

function registerHireAskMeAnswerDelegate(): void {
  hireAskMeAnswerDelegate = async (input) => {
    if (input.item.reasonClass !== "untrusted_import") return null;
    const reviewId = reviewIdFromAskMeItem(input.item);
    if (!reviewId) return null;
    const hire = await handleUntrustedImportAskMeAnswer({
      hiveRoot: input.hiveRoot,
      reviewId,
      action: input.action,
      reasonClass: input.item.reasonClass,
    });
    return { hire };
  };
}

/** Bind hive context and register hire hooks plus Ask-Me answer delegate. */
export function bootstrapHire(hiveRoot: string | null): void {
  bindHireHiveRoot(hiveRoot);
  registerCommandPlaneHooks({ hire: hireHooksImpl });
  registerHireAskMeAnswerDelegate();
}

registerCommandPlaneHooks({ hire: hireHooksImpl });
registerHireAskMeAnswerDelegate();

export { hireHooksImpl } from "./hooks-impl.js";
