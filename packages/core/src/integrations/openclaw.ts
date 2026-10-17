import { createHash } from "node:crypto";
import { listAskMe, openAskMeItem } from "../command-plane/ask-me.js";
import { loadIntegrationConfig } from "./config.js";
import { runAdapterSafe } from "./fail-closed.js";

const QUESTION_LIMIT = 4000;
const HIRE_REVIEW_ID = /hrv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export type OpenClawChannelMessage = {
  text: string;
  channelId: string;
  flow?: "create" | "list";
};

export type OpenClawOpenAskMeInput = {
  hiveRoot: string;
  question: string;
  channelId: string;
  taskId: string;
  reasonClass: "untrusted_import";
};

export type OpenClawOpenAskMe = (input: OpenClawOpenAskMeInput) => Promise<{ askMeId?: string }>;

export type HandleOpenClawInboundInput = {
  hiveRoot: string;
  message: OpenClawChannelMessage;
  /** Overrides hive config when set. Omitted uses the OpenClaw adapter flag. */
  enabled?: boolean;
  openAskMe?: OpenClawOpenAskMe;
};

export type HandleOpenClawInboundResult =
  | { askMeId: string }
  | { askMeIds: string[] }
  | { rejected: string };

const ADAPTER_FAILED: HandleOpenClawInboundResult = { rejected: "ADAPTER_FAILED" };

/**
 * Map one OpenClaw channel message to Ask-Me create or list.
 * Disabled adapters reject. Throws stay inside this adapter.
 */
export async function handleOpenClawInbound(
  input: HandleOpenClawInboundInput,
): Promise<HandleOpenClawInboundResult> {
  return runAdapterSafe("openclaw", () => mapOpenClawInbound(input), ADAPTER_FAILED);
}

async function mapOpenClawInbound(input: HandleOpenClawInboundInput): Promise<HandleOpenClawInboundResult> {
  if (!(await adapterEnabled(input))) return { rejected: "ADAPTER_DISABLED" };

  const message = readMessage(input.message);
  if (!message.ok) return { rejected: message.rejected };
  if (message.flow === "list") return listChannelAskMe(input.hiveRoot, message.channelId);

  const question = channelQuestion(message.channelId, message.text);
  if (!question) return { rejected: "INVALID_MESSAGE" };

  const opened = await (input.openAskMe ?? defaultOpenAskMe)({
    hiveRoot: input.hiveRoot,
    question,
    channelId: message.channelId,
    taskId: channelTaskId(message.channelId, message.text),
    // Ask-Me has no channel_approval class. Untrusted channel text uses untrusted_import.
    reasonClass: "untrusted_import",
  });
  if (!opened.askMeId) return { rejected: "ASK_ME_FAILED" };
  return { askMeId: opened.askMeId };
}

async function adapterEnabled(input: HandleOpenClawInboundInput): Promise<boolean> {
  if (typeof input.enabled === "boolean") return input.enabled;
  const config = await loadIntegrationConfig(input.hiveRoot);
  return config.adapters.openclaw.enabled;
}

type ReadMessageResult =
  | { ok: true; text: string; channelId: string; flow: "create" | "list" }
  | { ok: false; rejected: "INVALID_MESSAGE" };

function readMessage(message: OpenClawChannelMessage): ReadMessageResult {
  if (!message || typeof message.text !== "string" || typeof message.channelId !== "string") {
    return { ok: false, rejected: "INVALID_MESSAGE" };
  }
  const channelId = message.channelId.trim();
  const text = message.text.trim();
  const flow = messageFlow(message.flow);
  if (!flow || channelId.length === 0) return { ok: false, rejected: "INVALID_MESSAGE" };
  if (flow === "create" && text.length === 0) return { ok: false, rejected: "INVALID_MESSAGE" };
  if (HIRE_REVIEW_ID.test(channelId) || HIRE_REVIEW_ID.test(text)) {
    return { ok: false, rejected: "INVALID_MESSAGE" };
  }
  return { ok: true, text, channelId, flow };
}

function messageFlow(flow: OpenClawChannelMessage["flow"]): "create" | "list" | null {
  if (flow === undefined || flow === "create") return "create";
  if (flow === "list") return "list";
  return null;
}

function channelQuestion(channelId: string, text: string): string | null {
  const question = `OpenClaw channel ${channelId}: ${text}`;
  if (question.length > QUESTION_LIMIT) return null;
  return question;
}

function channelTaskId(channelId: string, text: string): string {
  const digest = createHash("sha256").update(channelId).update("\0").update(text).digest("hex").slice(0, 20);
  return `${channelTaskPrefix(channelId)}${digest}`;
}

function channelTaskPrefix(channelId: string): string {
  return `oc:${encodeURIComponent(channelId)}:`;
}

async function defaultOpenAskMe(input: OpenClawOpenAskMeInput): Promise<{ askMeId?: string }> {
  const opened = await openAskMeItem({
    hiveRoot: input.hiveRoot,
    featureId: null,
    taskId: input.taskId,
    agentId: null,
    reasonClass: input.reasonClass,
    question: input.question,
  });
  if (!opened.ok) return {};
  return { askMeId: opened.item.id };
}

async function listChannelAskMe(hiveRoot: string, channelId: string): Promise<HandleOpenClawInboundResult> {
  const listed = await listAskMe({ hiveRoot, state: "open" });
  if (!listed.ok) return { rejected: "ASK_ME_FAILED" };
  const prefix = channelTaskPrefix(channelId);
  return {
    askMeIds: listed.items.filter((item) => item.taskId?.startsWith(prefix)).map((item) => item.id),
  };
}
