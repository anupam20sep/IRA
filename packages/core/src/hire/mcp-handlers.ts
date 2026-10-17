import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readSliceAValidated } from "../engines/dispatch.js";
import type { McpToolDef } from "../command-plane/mcp-command-plane-tools.js";
import { resolveRepositoryRoot } from "../command-plane/paths.js";
import { AskMeItemSchema, RosterAgentSchema } from "../command-plane/schema.js";
import type { CommandPlaneErrorCode } from "../command-plane/types.js";
import { HireCancelError } from "./cancel.js";
import { getHireAskMeAnswerDelegate } from "./index.js";
import { hireImport } from "./import.js";
import { searchGallery } from "./gallery.js";
import { applyReviewEdits, HireReviewError, loadReview, type ReviewOperatorEdits } from "./review.js";
import { hireSpawnCancel, hireSpawnConfirm } from "./spawn.js";
import { loadHireScore } from "./score.js";
import { HireSourceKindSchema } from "./schema.js";
import type { SkillConsentUpdate } from "./skills.js";

export const HIRE_MCP_TOOL_NAMES = [
  "hire-import",
  "hire-review-show",
  "hire-review-update",
  "hire-spawn-confirm",
  "hire-spawn-cancel",
  "hire-gallery-search",
  "hire-show",
] as const;

type HiveCtx =
  | { ok: true; repositoryRoot: string; hiveRoot: string }
  | { ok: false; error: CommandPlaneErrorCode; message: string; hint?: string };

function hireJson(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function envelopeFail(error: CommandPlaneErrorCode, message: string, hint?: string) {
  return hireJson({
    ok: false,
    error,
    message,
    ...(hint ? { hint } : {}),
  });
}

async function resolveHireHiveCtx(
  cwdOpt: string | undefined,
  requireHiveJson: boolean,
): Promise<HiveCtx> {
  const cwd = cwdOpt ?? process.cwd();
  const resolved = resolveRepositoryRoot(cwd);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      message: "Could not resolve repository root.",
      hint: "Add program.md at the SuperSpec repository root, then run superspec hive init.",
    };
  }
  if (requireHiveJson) {
    try {
      await access(join(resolved.hiveRoot, "hive.json"), constants.R_OK);
    } catch {
      return {
        ok: false,
        error: "HIVE_NOT_INITIALIZED",
        message: "Hive is not initialized.",
        hint: "Run superspec hive init, then superspec doctor",
      };
    }
  }
  return { ok: true, repositoryRoot: resolved.repositoryRoot, hiveRoot: resolved.hiveRoot };
}

function mapHireError(err: unknown) {
  if (err instanceof HireReviewError || err instanceof HireCancelError) {
    return hireJson({ ok: false, error: err.code, message: err.message });
  }
  return envelopeFail("INVALID_INPUT", err instanceof Error ? err.message : String(err));
}

export function buildHireMcpTools(): McpToolDef[] {
  return [
    {
      name: "hire-import",
      description: "Import a hire manifest from file, url, paste, or gallery into a pending review.",
      schema: {
        cwd: z.string().optional(),
        source: HireSourceKindSchema,
        path: z.string().optional(),
        url: z.string().optional(),
        body: z.string().optional(),
        entryId: z.string().optional(),
      },
      handler: async (args) => {
        const ctx = await resolveHireHiveCtx(args.cwd as string | undefined, false);
        if (!ctx.ok) return hireJson(ctx);
        const source = args.source as z.infer<typeof HireSourceKindSchema>;
        if (source === "file") {
          const path = args.path as string | undefined;
          if (!path?.trim()) return envelopeFail("INVALID_INPUT", "Manifest path is required (path).");
          return hireJson(
            await hireImport({
              source: "file",
              path,
              hiveRoot: ctx.hiveRoot,
              cwd: args.cwd as string | undefined,
              repositoryRoot: ctx.repositoryRoot,
            }),
          );
        }
        if (source === "url") {
          const url = args.url as string | undefined;
          if (!url?.trim()) return envelopeFail("INVALID_INPUT", "Manifest URL is required (url).");
          return hireJson(
            await hireImport({
              source: "url",
              url,
              hiveRoot: ctx.hiveRoot,
              repositoryRoot: ctx.repositoryRoot,
            }),
          );
        }
        if (source === "paste") {
          const body = args.body as string | undefined;
          if (body === undefined) return envelopeFail("INVALID_INPUT", "Paste body is required (body).");
          return hireJson(
            await hireImport({
              source: "paste",
              body,
              hiveRoot: ctx.hiveRoot,
              repositoryRoot: ctx.repositoryRoot,
            }),
          );
        }
        if (source === "gallery") {
          const entryId = args.entryId as string | undefined;
          if (!entryId?.trim()) return envelopeFail("INVALID_INPUT", "Gallery entry id is required (entryId).");
          return hireJson(
            await hireImport({
              source: "gallery",
              entryId,
              hiveRoot: ctx.hiveRoot,
              repositoryRoot: ctx.repositoryRoot,
            }),
          );
        }
        return envelopeFail("INVALID_INPUT", "source must be file, url, paste, or gallery.");
      },
    },
    {
      name: "hire-review-show",
      description: "Load a hire review by id.",
      schema: { cwd: z.string().optional(), reviewId: z.string().min(1) },
      handler: async (args) => {
        const ctx = await resolveHireHiveCtx(args.cwd as string | undefined, false);
        if (!ctx.ok) return hireJson(ctx);
        const review = await loadReview(ctx.hiveRoot, args.reviewId as string);
        if (!review) {
          return hireJson({
            ok: false,
            error: "HIRE_REVIEW_NOT_FOUND",
            message: `Hire review ${args.reviewId as string} was not found.`,
          });
        }
        return hireJson({ ok: true, review });
      },
    },
    {
      name: "hire-review-update",
      description: "Apply operator edits to a pending hire review.",
      schema: {
        cwd: z.string().optional(),
        reviewId: z.string().min(1),
        edits: z.record(z.unknown()).optional(),
        skillConsents: z
          .array(
            z.object({
              skillId: z.string(),
              decision: z.enum(["pending", "accepted", "declined"]),
            }),
          )
          .optional(),
      },
      handler: async (args) => {
        const ctx = await resolveHireHiveCtx(args.cwd as string | undefined, false);
        if (!ctx.ok) return hireJson(ctx);
        const reviewId = args.reviewId as string;
        const edits = (args.edits as ReviewOperatorEdits | undefined) ?? {};
        const skillConsents = args.skillConsents as SkillConsentUpdate[] | undefined;
        try {
          const review = await applyReviewEdits(reviewId, edits, {
            hiveRoot: ctx.hiveRoot,
            ...(skillConsents ? { skillConsents } : {}),
          });
          return hireJson({ ok: true, review });
        } catch (err) {
          return mapHireError(err);
        }
      },
    },
    {
      name: "hire-spawn-confirm",
      description:
        "Confirm hire spawn — sole writer for persona files and hire roster rows. Does not start engine workers.",
      schema: {
        cwd: z.string().optional(),
        reviewId: z.string().min(1),
        nameConflictAction: z.enum(["merge", "replace", "cancel"]).optional(),
        createWorktree: z.boolean().optional(),
      },
      handler: async (args) => {
        const ctx = await resolveHireHiveCtx(args.cwd as string | undefined, true);
        if (!ctx.ok) return hireJson(ctx);
        const sliceAValidated = await readSliceAValidated(ctx.hiveRoot);
        const result = await hireSpawnConfirm({
          reviewId: args.reviewId as string,
          hiveRoot: ctx.hiveRoot,
          repositoryRoot: ctx.repositoryRoot,
          nameConflictAction: args.nameConflictAction as "merge" | "replace" | "cancel" | undefined,
          createWorktree: args.createWorktree === true,
          sliceAValidated,
        });
        return hireJson(result);
      },
    },
    {
      name: "hire-spawn-cancel",
      description: "Cancel a pending hire review without persona or roster writes.",
      schema: { cwd: z.string().optional(), reviewId: z.string().min(1) },
      handler: async (args) => {
        const ctx = await resolveHireHiveCtx(args.cwd as string | undefined, false);
        if (!ctx.ok) return hireJson(ctx);
        try {
          return hireJson(await hireSpawnCancel(args.reviewId as string, { hiveRoot: ctx.hiveRoot }));
        } catch (err) {
          return mapHireError(err);
        }
      },
    },
    {
      name: "hire-gallery-search",
      description: "Search the curated hire gallery index.",
      schema: {
        cwd: z.string().optional(),
        query: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().min(1).optional(),
      },
      handler: async (args) => {
        const ctx = await resolveHireHiveCtx(args.cwd as string | undefined, false);
        if (!ctx.ok) return hireJson(ctx);
        const entries = searchGallery({
          query: args.query as string | undefined,
          tags: args.tags as string[] | undefined,
          limit: args.limit as number | undefined,
          repositoryRoot: ctx.repositoryRoot,
        });
        return hireJson({ ok: true, entries });
      },
    },
    {
      name: "hire-show",
      description: "Show a hire roster agent and optional hire score.",
      schema: { cwd: z.string().optional(), agentId: z.string().min(1) },
      handler: async (args) => {
        const ctx = await resolveHireHiveCtx(args.cwd as string | undefined, true);
        if (!ctx.ok) return hireJson(ctx);
        const agentId = args.agentId as string;
        let rosterRaw: unknown;
        try {
          rosterRaw = JSON.parse(await readFile(join(ctx.hiveRoot, "roster.json"), "utf8"));
        } catch {
          return envelopeFail("HIVE_CORRUPT", "Roster is unreadable.");
        }
        const parsed = RosterAgentSchema.array().safeParse(rosterRaw);
        if (!parsed.success) return envelopeFail("HIVE_CORRUPT", "Roster is unreadable.");
        const agent = parsed.data.find((row) => row.id === agentId);
        if (!agent) {
          return hireJson({
            ok: false,
            error: "INVALID_INPUT",
            message: `Agent ${agentId} was not found on the roster.`,
          });
        }
        const hireScore = await loadHireScore(ctx.hiveRoot, agentId);
        return hireJson({
          ok: true,
          agent,
          ...(hireScore ? { hireScore } : {}),
        });
      },
    },
  ];
}

async function readAskMeItem(hiveRoot: string, id: string) {
  try {
    const parsed = AskMeItemSchema.safeParse(
      JSON.parse(await readFile(join(hiveRoot, "ask-me", `${id}.json`), "utf8")),
    );
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Wrap command-plane ask-me-answer to attach hire OD-018 results for untrusted_import. */
export function wrapAskMeAnswerWithHire(
  baseHandler: McpToolDef["handler"],
): McpToolDef["handler"] {
  return async (args) => {
    const delegate = getHireAskMeAnswerDelegate();
    if (!delegate) return baseHandler(args);

    const ctx = await resolveHireHiveCtx(args.cwd as string | undefined, true);
    if (!ctx.ok) return baseHandler(args);

    const id = args.id as string;
    const action = args.action as "retry" | "keep_blocked" | "acknowledge";
    const text = args.text as string;
    const item = await readAskMeItem(ctx.hiveRoot, id);
    if (!item || item.reasonClass !== "untrusted_import") return baseHandler(args);

    const bridged = await delegate({ hiveRoot: ctx.hiveRoot, item, action, text });
    if (!bridged) return baseHandler(args);

    if (action === "keep_blocked") {
      return hireJson({ ok: true, item, task: null, hire: bridged.hire });
    }

    if (action === "acknowledge") {
      const resolved = await readAskMeItem(ctx.hiveRoot, id);
      return hireJson({
        ok: true,
        item: resolved ?? item,
        task: null,
        hire: bridged.hire,
      });
    }

    return hireJson({
      ok: false,
      error: "INVALID_INPUT",
      message: "Retry is not supported for hire untrusted_import.",
      hire: bridged.hire,
    });
  };
}
