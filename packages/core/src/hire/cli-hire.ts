import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readSliceAValidated } from "../engines/dispatch.js";
import { RosterAgentSchema } from "../command-plane/schema.js";
import { resolveRepositoryRoot } from "../command-plane/paths.js";
import type { CommandPlaneErrorCode } from "../command-plane/types.js";
import { HireCancelError } from "./cancel.js";
import { hireImport } from "./import.js";
import { searchGallery } from "./gallery.js";
import { applyReviewEdits, HireReviewError, loadReview, type ReviewOperatorEdits } from "./review.js";
import { hireSpawnCancel, hireSpawnConfirm } from "./spawn.js";
import { loadHireScore } from "./score.js";
import type { SkillConsentUpdate } from "./skills.js";

export type HireCliResult = { code: number; stdout: string };

type HireCtx =
  | { ok: true; repositoryRoot: string; hiveRoot: string }
  | { ok: false; error: CommandPlaneErrorCode; message: string; hint?: string };

function envelope(body: Record<string, unknown> | { ok: boolean }): HireCliResult {
  const ok = (body as { ok?: boolean }).ok !== false;
  return { code: ok ? 0 : 1, stdout: JSON.stringify(body, null, 2) };
}

function envelopeFail(error: CommandPlaneErrorCode, message: string, hint?: string): HireCliResult {
  return envelope({
    ok: false,
    error,
    message,
    ...(hint ? { hint } : {}),
  });
}

async function resolveHireCtx(cwdOpt: string | undefined, requireHiveJson: boolean): Promise<HireCtx> {
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

function mapHireCommandError(err: unknown): HireCliResult {
  if (err instanceof HireReviewError || err instanceof HireCancelError) {
    return envelope({ ok: false, error: err.code, message: err.message });
  }
  return envelopeFail("INVALID_INPUT", err instanceof Error ? err.message : String(err));
}

export async function runHireCli(argv: string[]): Promise<HireCliResult> {
  const [head, second, ...tail] = argv;

  if (head === undefined || head === "--help" || head === "-h") {
    return {
      code: 0,
      stdout: [
        "superspec hire import --source file|url|paste|gallery [--path|--url|--body|--entry] [--cwd path]",
        "superspec hire review show --review <id> [--cwd path]",
        "superspec hire review update --review <id> --json-edits <json> [--cwd path]",
        "superspec hire confirm --review <id> [--on-conflict merge|replace|cancel] [--create-worktree] [--cwd path]",
        "superspec hire cancel --review <id> [--cwd path]",
        "superspec hire gallery search [--query text] [--tag tag]… [--limit n] [--cwd path]",
        "superspec hire show --agent <id> [--cwd path]",
      ].join("\n"),
    };
  }

  try {
    if (head === "import") {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: {
          source: { type: "string" },
          path: { type: "string" },
          url: { type: "string" },
          body: { type: "string" },
          entry: { type: "string" },
          cwd: { type: "string" },
        },
        allowPositionals: false,
      });
      const ctx = await resolveHireCtx(values.cwd as string | undefined, false);
      if (!ctx.ok) return envelope(ctx);

      const source = values.source as string | undefined;
      if (source === "file") {
        const path = values.path as string | undefined;
        if (!path?.trim()) return envelopeFail("INVALID_INPUT", "Manifest path is required (--path).");
        return envelope(
          await hireImport({
            source: "file",
            path,
            hiveRoot: ctx.hiveRoot,
            cwd: values.cwd as string | undefined,
            repositoryRoot: ctx.repositoryRoot,
          }),
        );
      }
      if (source === "url") {
        const url = values.url as string | undefined;
        if (!url?.trim()) return envelopeFail("INVALID_INPUT", "Manifest URL is required (--url).");
        return envelope(
          await hireImport({
            source: "url",
            url,
            hiveRoot: ctx.hiveRoot,
            repositoryRoot: ctx.repositoryRoot,
          }),
        );
      }
      if (source === "paste") {
        const body = values.body as string | undefined;
        if (body === undefined) return envelopeFail("INVALID_INPUT", "Paste body is required (--body).");
        return envelope(
          await hireImport({
            source: "paste",
            body,
            hiveRoot: ctx.hiveRoot,
            repositoryRoot: ctx.repositoryRoot,
          }),
        );
      }
      if (source === "gallery") {
        const entryId = values.entry as string | undefined;
        if (!entryId?.trim()) return envelopeFail("INVALID_INPUT", "Gallery entry id is required (--entry).");
        return envelope(
          await hireImport({
            source: "gallery",
            entryId,
            hiveRoot: ctx.hiveRoot,
            repositoryRoot: ctx.repositoryRoot,
          }),
        );
      }
      return envelopeFail("INVALID_INPUT", "--source must be file, url, paste, or gallery.");
    }

    if (head === "review" && second === "show") {
      const { values } = parseArgs({
        args: tail,
        options: { review: { type: "string" }, cwd: { type: "string" } },
      });
      const reviewId = values.review as string | undefined;
      if (!reviewId?.trim()) return envelopeFail("INVALID_INPUT", "--review is required.");
      const ctx = await resolveHireCtx(values.cwd as string | undefined, false);
      if (!ctx.ok) return envelope(ctx);
      const review = await loadReview(ctx.hiveRoot, reviewId);
      if (!review) {
        return envelope({ ok: false, error: "HIRE_REVIEW_NOT_FOUND", message: `Hire review ${reviewId} was not found.` });
      }
      return envelope({ ok: true, review });
    }

    if (head === "review" && second === "update") {
      const { values } = parseArgs({
        args: tail,
        options: { review: { type: "string" }, "json-edits": { type: "string" }, cwd: { type: "string" } },
      });
      const reviewId = values.review as string | undefined;
      const rawEdits = values["json-edits"] as string | undefined;
      if (!reviewId?.trim()) return envelopeFail("INVALID_INPUT", "--review is required.");
      if (!rawEdits?.trim()) return envelopeFail("INVALID_INPUT", "--json-edits is required.");
      const ctx = await resolveHireCtx(values.cwd as string | undefined, false);
      if (!ctx.ok) return envelope(ctx);

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawEdits) as Record<string, unknown>;
      } catch {
        return envelopeFail("INVALID_INPUT", "--json-edits must be valid JSON.");
      }

      const skillConsents = parsed.skillConsents as SkillConsentUpdate[] | undefined;
      const edits =
        parsed.edits && typeof parsed.edits === "object" && !Array.isArray(parsed.edits)
          ? (parsed.edits as ReviewOperatorEdits)
          : (Object.fromEntries(
              Object.entries(parsed).filter(([key]) => key !== "skillConsents" && key !== "edits"),
            ) as ReviewOperatorEdits);

      try {
        const review = await applyReviewEdits(reviewId, edits, {
          hiveRoot: ctx.hiveRoot,
          ...(skillConsents ? { skillConsents } : {}),
        });
        return envelope({ ok: true, review });
      } catch (err) {
        return mapHireCommandError(err);
      }
    }

    if (head === "confirm") {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: {
          review: { type: "string" },
          "on-conflict": { type: "string" },
          "create-worktree": { type: "boolean" },
          cwd: { type: "string" },
        },
      });
      const reviewId = values.review as string | undefined;
      if (!reviewId?.trim()) return envelopeFail("INVALID_INPUT", "--review is required.");
      const ctx = await resolveHireCtx(values.cwd as string | undefined, true);
      if (!ctx.ok) return envelope(ctx);

      const conflict = values["on-conflict"] as string | undefined;
      let nameConflictAction: "merge" | "replace" | "cancel" | undefined;
      if (conflict !== undefined) {
        if (conflict !== "merge" && conflict !== "replace" && conflict !== "cancel") {
          return envelopeFail("INVALID_INPUT", "--on-conflict must be merge, replace, or cancel.");
        }
        nameConflictAction = conflict;
      }

      const sliceAValidated = await readSliceAValidated(ctx.hiveRoot);
      const result = await hireSpawnConfirm({
        reviewId,
        hiveRoot: ctx.hiveRoot,
        repositoryRoot: ctx.repositoryRoot,
        nameConflictAction,
        createWorktree: values["create-worktree"] === true,
        sliceAValidated,
      });
      return envelope(result);
    }

    if (head === "cancel") {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: { review: { type: "string" }, cwd: { type: "string" } },
      });
      const reviewId = values.review as string | undefined;
      if (!reviewId?.trim()) return envelopeFail("INVALID_INPUT", "--review is required.");
      const ctx = await resolveHireCtx(values.cwd as string | undefined, false);
      if (!ctx.ok) return envelope(ctx);
      try {
        return envelope(await hireSpawnCancel(reviewId, { hiveRoot: ctx.hiveRoot }));
      } catch (err) {
        return mapHireCommandError(err);
      }
    }

    if (head === "gallery" && second === "search") {
      const { values } = parseArgs({
        args: tail,
        options: {
          query: { type: "string" },
          tag: { type: "string", multiple: true },
          limit: { type: "string" },
          cwd: { type: "string" },
        },
      });
      const ctx = await resolveHireCtx(values.cwd as string | undefined, false);
      if (!ctx.ok) return envelope(ctx);
      const tagsRaw = values.tag;
      const tags = Array.isArray(tagsRaw) ? tagsRaw : tagsRaw ? [tagsRaw] : undefined;
      const limitRaw = values.limit as string | undefined;
      const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
      const entries = searchGallery({
        query: values.query as string | undefined,
        tags,
        limit: Number.isFinite(limit) ? limit : undefined,
        repositoryRoot: ctx.repositoryRoot,
      });
      return envelope({ ok: true, entries });
    }

    if (head === "show") {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: { agent: { type: "string" }, cwd: { type: "string" } },
      });
      const agentId = values.agent as string | undefined;
      if (!agentId?.trim()) return envelopeFail("INVALID_INPUT", "--agent is required.");
      const ctx = await resolveHireCtx(values.cwd as string | undefined, true);
      if (!ctx.ok) return envelope(ctx);

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
        return envelope({ ok: false, error: "INVALID_INPUT", message: `Agent ${agentId} was not found on the roster.` });
      }
      const hireScore = await loadHireScore(ctx.hiveRoot, agentId);
      return envelope({
        ok: true,
        agent,
        ...(hireScore ? { hireScore } : {}),
      });
    }

    return envelopeFail("INVALID_INPUT", `unknown hire subcommand: ${head}${second ? ` ${second}` : ""}`);
  } catch (err) {
    return envelopeFail("INVALID_INPUT", err instanceof Error ? err.message : String(err));
  }
}
