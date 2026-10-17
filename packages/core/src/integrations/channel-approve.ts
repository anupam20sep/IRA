import { timingSafeEqual } from "node:crypto";
import { answerAskMe, type AnswerAskMeResult } from "../command-plane/ask-me.js";
import type { AskMeAction } from "../command-plane/types.js";

/** Channel verbs and Ask-Me actions. Approve records consent; it does not hire or raise budget. */
const ACTION_MAP: Record<string, AskMeAction> = {
  acknowledge: "acknowledge",
  retry: "retry",
  keep_blocked: "keep_blocked",
  approve: "acknowledge",
  deny: "keep_blocked",
};

const DEFAULT_TEXT: Record<AskMeAction, string> = {
  acknowledge: "Approved via channel.",
  retry: "Retry via channel.",
  keep_blocked: "Denied via channel.",
};

export type ChannelApproveInput = {
  hiveRoot: string;
  enabled: boolean;
  itemId: string;
  action: string;
  secret: string;
  expectedSecret: string;
  text?: string;
  now?: string;
};

export type ChannelApproveFailure = {
  ok: false;
  code: "CHANNEL_AUTH_FAILED" | "ADAPTER_DISABLED";
};

export type ChannelApproveResult = AnswerAskMeResult | ChannelApproveFailure;

function secretMatches(provided: string, expected: string): boolean {
  if (provided.length === 0 || expected.length === 0) return false;
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function answerText(action: AskMeAction | undefined, text: string | undefined): string {
  const supplied = typeof text === "string" ? text.trim() : "";
  if (supplied.length > 0) return supplied;
  if (action) return DEFAULT_TEXT[action];
  return "Channel reply.";
}

/**
 * Map an authenticated channel reply onto `ask-me-answer` only (FR-006, FR-003).
 * Disabled bridges and bad secrets return before the hive is read.
 */
export async function handleChannelApprove(input: ChannelApproveInput): Promise<ChannelApproveResult> {
  if (!input.enabled) {
    return { ok: false, code: "ADAPTER_DISABLED" };
  }
  const provided = typeof input.secret === "string" ? input.secret : "";
  const expected = typeof input.expectedSecret === "string" ? input.expectedSecret : "";
  if (!secretMatches(provided, expected)) {
    return { ok: false, code: "CHANNEL_AUTH_FAILED" };
  }

  const mapped = ACTION_MAP[input.action];
  return answerAskMe({
    hiveRoot: input.hiveRoot,
    id: input.itemId,
    text: answerText(mapped, input.text),
    action: mapped ?? (input.action as AskMeAction),
    now: input.now,
  });
}
