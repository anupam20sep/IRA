import { randomUUID } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { openAskMeItem } from "./ask-me.js";
import { safeOnUntrustedImport } from "./hooks.js";
import { agentIdSchema, AskMeReasonClassSchema, featureIdSchema } from "./schema.js";
import { EVENT_LOCK_WAIT_MS, appendJsonlLine, lockWaitMs, withLock } from "./store.js";
import { IraEventSchema } from "./schema.js";
import type { AskMeReasonClass, CommandPlaneErrorCode } from "./types.js";

const MAX_BODY = 65536;

const MailKindSchema = z.enum(["clarify", "result", "handoff", "escalate"]);

export type MailboxRole = "ira" | "worker";
export type MailboxBox = "inbox" | "outbox";

export type MailMessageInput = {
  toAgentId: string;
  kind: z.infer<typeof MailKindSchema>;
  body: string;
  relatedTaskId: string | null;
  featureId: string | null;
};

export type MailMessage = MailMessageInput & {
  id: string;
  ts: string;
  fromAgentId: string;
};

export type MailboxFailure = { ok: false; error: CommandPlaneErrorCode; message: string };

export type MailboxPostSuccess = {
  ok: true;
  id: string;
  askMeId?: string;
  answered?: boolean;
};

export type MailboxPostResult = MailboxPostSuccess | MailboxFailure;

export type MailboxReadResult =
  | { ok: true; messages: MailMessage[] }
  | MailboxFailure;

type RoleCheck = {
  role: MailboxRole;
  box: MailboxBox;
  operation: "read" | "write";
};

/** Single-writer rules for hive mailboxes (FR-013). */
export function assertMailboxRole(input: RoleCheck): void {
  if (input.operation === "read") return;
  if (input.box === "inbox" && input.role !== "ira") {
    throw mailboxRoleError("Only Ira may write inbox mailboxes.");
  }
  if (input.box === "outbox" && input.role !== "worker") {
    throw mailboxRoleError("Only workers may write outbox mailboxes.");
  }
}

function mailboxRoleError(message: string): Error {
  const err = new Error(`${message} MAILBOX_ROLE`);
  err.name = "CommandPlaneError";
  return err;
}

export async function mailboxPost(input: {
  hiveRoot: string;
  role: MailboxRole;
  agentId: string;
  box: MailboxBox;
  message: MailMessageInput;
  now?: string;
  lockWaitMs?: number;
}): Promise<MailboxPostResult> {
  try {
    assertMailboxRole({ role: input.role, box: input.box, operation: "write" });
  } catch (err) {
    return fail("MAILBOX_ROLE", err instanceof Error ? err.message : "MAILBOX_ROLE");
  }

  const agent = agentIdSchema.safeParse(input.agentId);
  if (!agent.success) return fail("INVALID_INPUT", "agentId is invalid.");

  const parsed = parseMessage(input.message);
  if (!parsed.ok) return parsed;

  const hive = await requireHive(input.hiveRoot);
  if (!hive.ok) return hive;

  const ts = input.now ?? new Date().toISOString();
  const record: MailMessage = {
    ...parsed.value,
    id: `msg_${randomUUID()}`,
    ts,
    fromAgentId: input.role === "ira" ? "ira" : agent.data,
  };

  const mailboxDir = join(input.hiveRoot, "mailboxes", agent.data);
  await mkdir(mailboxDir, { recursive: true, mode: 0o700 });
  const file = join(mailboxDir, `${input.box}.jsonl`);

  if (input.box === "outbox") {
    const lockPath = join(input.hiveRoot, "locks", `mailbox-${agent.data}-outbox.lock`);
    const waitMs = input.lockWaitMs ?? lockWaitMs(lockPath);
    const locked = await withLock(lockPath, { waitMs }, async () => {
      await appendJsonlLine(file, record);
      return record;
    });
    if (!locked.ok) {
      return fail("MAILBOX_BUSY", `Mailbox outbox is busy (${locked.code}).`);
    }
  } else {
    await appendJsonlLine(file, record);
  }

  await appendMailboxRouted(input.hiveRoot, record, ts);

  if (input.role === "worker" && input.box === "outbox" && record.toAgentId === "ira") {
    return adjudicateWorkerToIra(input.hiveRoot, record, ts);
  }

  return { ok: true, id: record.id };
}

export async function mailboxRead(input: {
  hiveRoot: string;
  role: MailboxRole;
  agentId: string;
  box: MailboxBox;
  limit?: number;
}): Promise<MailboxReadResult> {
  const agent = agentIdSchema.safeParse(input.agentId);
  if (!agent.success) return fail("INVALID_INPUT", "agentId is invalid.");

  const hive = await requireHive(input.hiveRoot);
  if (!hive.ok) return hive;

  const file = join(input.hiveRoot, "mailboxes", agent.data, `${input.box}.jsonl`);
  const messages = await readJsonlMessages(file, input.limit ?? 50);
  return { ok: true, messages };
}

function parseMessage(message: MailMessageInput): { ok: true; value: MailMessageInput } | MailboxFailure {
  if (!MailKindSchema.safeParse(message.kind).success) {
    return fail("INVALID_INPUT", "message kind is invalid.");
  }
  if (typeof message.body !== "string" || message.body.length === 0) {
    return fail("INVALID_INPUT", "message body is required.");
  }
  if (message.body.length > MAX_BODY) {
    return fail("INVALID_INPUT", "message body exceeds maximum length.");
  }
  if (typeof message.toAgentId !== "string" || message.toAgentId.length === 0) {
    return fail("INVALID_INPUT", "toAgentId is required.");
  }
  if (message.featureId !== null && !featureIdSchema.safeParse(message.featureId).success) {
    return fail("INVALID_INPUT", "featureId is invalid.");
  }
  return { ok: true, value: message };
}

async function adjudicateWorkerToIra(
  hiveRoot: string,
  record: MailMessage,
  ts: string,
): Promise<MailboxPostResult> {
  if (record.kind === "clarify") {
    const answer = await resolveClarifyFromArtifacts(hiveRoot, record);
    if (answer) {
      return { ok: true, id: record.id, answered: true };
    }
    const opened = await openEscalation(hiveRoot, record, "ambiguous_requirement", ts);
    if (!opened.ok) return opened;
    return { ok: true, id: record.id, askMeId: opened.askMeId };
  }

  if (record.kind === "escalate") {
    const reasonClass = inferReasonClass(record.body);
    if (reasonClass === "untrusted_import") {
      const hook = await safeOnUntrustedImport(
        {
          featureId: record.featureId,
          agentId: record.fromAgentId,
          detail: record.body,
        },
        { hiveRoot, featureId: record.featureId },
      );
      if (hook && "askMeId" in hook) {
        return { ok: true, id: record.id, askMeId: hook.askMeId };
      }
    }
    const opened = await openEscalation(hiveRoot, record, reasonClass, ts);
    if (!opened.ok) return opened;
    return { ok: true, id: record.id, askMeId: opened.askMeId };
  }

  return { ok: true, id: record.id };
}

async function openEscalation(
  hiveRoot: string,
  record: MailMessage,
  reasonClass: AskMeReasonClass,
  ts: string,
): Promise<{ ok: true; askMeId: string } | MailboxFailure> {
  const opened = await openAskMeItem({
    hiveRoot,
    featureId: record.featureId,
    taskId: record.relatedTaskId,
    agentId: record.fromAgentId,
    reasonClass,
    question: record.body,
    now: ts,
  });
  if (!opened.ok) {
    return fail(opened.error, opened.message);
  }
  return { ok: true, askMeId: opened.item.id };
}

export function inferReasonClass(body: string): AskMeReasonClass {
  const explicit = parseExplicitReasonClass(body);
  if (explicit) return explicit;

  const lower = body.toLowerCase();
  if (/(force-push|hard-reset|delete history|production deploy)/.test(lower)) {
    return "destructive_git";
  }
  if (/budget|token cap|usd cap/.test(lower)) return "budget_exceed";
  if (/constitution|principle violation/.test(lower)) return "constitution_violation";
  if (/(add fr-|new acceptance|scope change|plan edit)/.test(lower)) return "spec_scope_change";
  if (/untrusted|import|hire|spawn manifest/.test(lower)) return "untrusted_import";
  if (/review fail|ceiling/.test(lower)) return "repeated_review_failure";
  return "ambiguous_requirement";
}

function parseExplicitReasonClass(body: string): AskMeReasonClass | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (!value || typeof value !== "object") return null;
    const reasonClass = (value as { reasonClass?: unknown }).reasonClass;
    const parsed = AskMeReasonClassSchema.safeParse(reasonClass);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function resolveClarifyFromArtifacts(hiveRoot: string, record: MailMessage): Promise<boolean> {
  if (!record.featureId) return false;
  const repositoryRoot = join(hiveRoot, "..", "..");
  const specDir = join(repositoryRoot, "specs", record.featureId);
  const snippets: string[] = [];
  for (const name of ["spec.md", "plan.md"]) {
    try {
      snippets.push(await readFile(join(specDir, name), "utf8"));
    } catch {
      // missing artifact
    }
  }
  const haystack = snippets.join("\n").toLowerCase();
  if (!haystack) return false;

  const tokens = record.body
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .flatMap((word) => (word.includes("-") ? [word, ...word.split("-")] : [word]))
    .filter((word) => word.length >= 4);
  if (tokens.length === 0) return false;

  const hits = tokens.filter((token) => haystack.includes(token));
  const needed = Math.min(2, tokens.length);
  return hits.length >= needed;
}

async function readJsonlMessages(file: string, limit: number): Promise<MailMessage[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const messages: MailMessage[] = [];
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== "object") continue;
      const row = value as Partial<MailMessage>;
      if (typeof row.id !== "string" || typeof row.ts !== "string") continue;
      if (!MailKindSchema.safeParse(row.kind).success) continue;
      if (typeof row.body !== "string" || typeof row.fromAgentId !== "string") continue;
      if (typeof row.toAgentId !== "string") continue;
      messages.push({
        id: row.id,
        ts: row.ts,
        fromAgentId: row.fromAgentId,
        toAgentId: row.toAgentId,
        kind: row.kind as MailMessage["kind"],
        body: row.body,
        relatedTaskId: row.relatedTaskId ?? null,
        featureId: row.featureId ?? null,
      });
    } catch {
      // skip corrupt line
    }
  }
  if (messages.length <= limit) return messages;
  return messages.slice(messages.length - limit);
}

async function appendMailboxRouted(hiveRoot: string, record: MailMessage, ts: string): Promise<void> {
  try {
    await access(join(hiveRoot, "events"), constants.W_OK);
  } catch {
    return;
  }
  const event = IraEventSchema.safeParse({
    id: `evt_${randomUUID()}`,
    type: "mailbox.routed",
    version: 1,
    ts,
    featureId: record.featureId,
    actor: { kind: record.fromAgentId === "ira" ? "ira" : "worker", id: record.fromAgentId },
    data: {
      messageId: record.id,
      fromAgentId: record.fromAgentId,
      toAgentId: record.toAgentId,
    },
  });
  if (!event.success) return;
  const file = join(hiveRoot, "events", "events.jsonl");
  await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
    appendJsonlLine(file, event.data),
  );
}

async function requireHive(hiveRoot: string): Promise<{ ok: true } | MailboxFailure> {
  try {
    await access(join(hiveRoot, "hive.json"), constants.R_OK);
    return { ok: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return fail("HIVE_NOT_INITIALIZED", "Hive is not initialized.");
    }
    return fail("HIVE_CORRUPT", "Hive manifest is unreadable.");
  }
}

function fail(error: CommandPlaneErrorCode, message: string): MailboxFailure {
  return { ok: false, error, message };
}
