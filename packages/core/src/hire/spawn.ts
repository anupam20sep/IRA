import { randomBytes, randomUUID } from "node:crypto";
import { accessSync, constants, statSync, type Stats } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { answerAskMe } from "../command-plane/ask-me.js";
import { IraEventSchema, RosterAgentSchema } from "../command-plane/schema.js";
import {
  EVENT_LOCK_WAIT_MS,
  LEDGER_LOCK_WAIT_MS,
  appendJsonlLine,
  withLock,
  writeJsonAtomic,
} from "../command-plane/store.js";
import type { RosterAgent } from "../command-plane/types.js";
import { HireAskMeError, openUntrustedImportAskMe } from "./ask-me-bridge.js";
import { cancelPendingHireReview } from "./cancel.js";
import { HIRE_TRUST_BANNER } from "./constants.js";
import { HireReviewError, loadReview, updateReview } from "./review.js";
import { HireReviewSchema } from "./schema.js";
import { allowedSkillsAfterConsent } from "./skills.js";
import type { HireManifest, HireReview, PersonaHarness, PersonaScope } from "./types.js";

const ASK_ID = /^ask_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVIEW_ID_RE = /^hrv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tags that imply a code-writing hire and an isolated worktree (design spawn step 4). */
const CODE_TAGS = new Set(["ios", "android", "backend", "frontend", "api", "mobile", "web"]);

export type HireSpawnConfirmInput = {
  reviewId: string;
  hiveRoot: string;
  repositoryRoot: string;
  nameConflictAction?: "merge" | "replace" | "cancel";
  createWorktree?: boolean;
  sliceAValidated: boolean;
};

export type SpawnedHireAgent = {
  id: string;
  origin: "hire";
  personaPath: string;
  capabilityTags: string[];
  status: "idle";
};

export type SpawnResult =
  | { ok: true; agent: SpawnedHireAgent; askMeResolved: boolean }
  | { ok: false; code: string; message: string };

type PersonaTarget = { path: string; body: string };

/**
 * Sole persona and roster writer for hire spawn (OD-018).
 * Does not call engine dispatch. Slice A blocks every side effect (OD-020).
 */
export async function hireSpawnConfirm(input: HireSpawnConfirmInput): Promise<SpawnResult> {
  if (input.sliceAValidated !== true) {
    return { ok: false, code: "SLICE_A_ONLY", message: "Hire spawn is unavailable until Slice A is validated." };
  }

  const loaded = await readConfirmableReview(input.hiveRoot, input.reviewId);
  if (!loaded.ok) return loaded;

  const hive = await readHive(input.hiveRoot);
  if (!hive.ok) return hive;

  const repositoryRoot = input.repositoryRoot?.trim() ?? "";
  if (repositoryRoot.length === 0) {
    return { ok: false, code: "INVALID_INPUT", message: "Repository root is missing." };
  }

  const linked = await ensureAskMeLinked(input.hiveRoot, loaded.review);
  if (!linked.ok) return linked;

  const built = buildSpawn(linked.review, repositoryRoot, input.createWorktree === true);
  if (!built.ok) return built;

  await mkdir(join(input.hiveRoot, "locks"), { recursive: true, mode: 0o700 });
  const locked = await withLock(join(input.hiveRoot, "locks", "roster.lock"), { waitMs: LEDGER_LOCK_WAIT_MS }, () =>
    writeSpawn(input.hiveRoot, built.targets, built.agent),
  );
  if (!locked.ok) return { ok: false, code: locked.code, message: "Roster lock is busy." };
  if (!locked.value.ok) return locked.value;

  const askMeResolved = await resolveConfirmAskMe(input.hiveRoot, linked.review);
  if (!askMeResolved.ok) return askMeResolved;

  await appendHireSpawnedEvent(input.hiveRoot, {
    reviewId: linked.review.reviewId,
    agentId: built.agent.id,
    personaPath: built.agent.personaPath ?? "",
    capabilityTags: built.agent.capabilityTags,
  });

  try {
    await updateReview(input.hiveRoot, linked.review.reviewId, { state: "spawned" });
  } catch (err) {
    if (err instanceof HireReviewError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }

  return {
    ok: true,
    askMeResolved: true,
    agent: {
      id: built.agent.id,
      origin: "hire",
      personaPath: built.agent.personaPath ?? "",
      capabilityTags: [...built.agent.capabilityTags],
      status: "idle",
    },
  };
}

export async function hireSpawnCancel(
  reviewId: string,
  options: { hiveRoot: string },
): Promise<{ ok: true; state: "cancelled" }> {
  await cancelPendingHireReview(options.hiveRoot, reviewId);
  return { ok: true, state: "cancelled" };
}

async function readConfirmableReview(hiveRoot: string, reviewId: string): Promise<
  { ok: true; review: HireReview } | Extract<SpawnResult, { ok: false }>
> {
  if (!REVIEW_ID_RE.test(reviewId)) {
    return { ok: false, code: "HIRE_REVIEW_NOT_FOUND", message: `Hire review ${reviewId} was not found.` };
  }

  let text: string;
  try {
    text = await readFile(join(hiveRoot, "hire", "reviews", `${reviewId}.json`), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, code: "HIRE_REVIEW_NOT_FOUND", message: `Hire review ${reviewId} was not found.` };
    }
    throw err;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, code: "HIRE_REVIEW_NOT_FOUND", message: `Hire review ${reviewId} was not found.` };
  }

  const banner =
    raw && typeof raw === "object" && "uiCopy" in raw
      ? (raw as { uiCopy?: { trustBanner?: unknown } }).uiCopy?.trustBanner
      : undefined;
  if (banner !== HIRE_TRUST_BANNER) {
    return {
      ok: false,
      code: "HIRE_WARNING_LENGTH_MISMATCH",
      message: "Trust banner does not match the hire warning.",
    };
  }

  const parsed = HireReviewSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "HIRE_REVIEW_NOT_FOUND", message: `Hire review ${reviewId} was not found.` };
  }

  const review = parsed.data;
  if (review.state === "spawned") {
    return { ok: false, code: "HIRE_ALREADY_SPAWNED", message: `Hire review ${reviewId} is already spawned.` };
  }
  if (review.state !== "pending") {
    return {
      ok: false,
      code: "HIRE_INVALID_TRANSITION",
      message: `Hire review ${reviewId} is ${review.state} and cannot be spawned.`,
    };
  }
  if (review.sanitizationReport.rejected.length > 0) {
    return { ok: false, code: "HIRE_SANITIZE_FAILED", message: "Sanitization rejected the manifest." };
  }
  return { ok: true, review };
}

async function readHive(hiveRoot: string): Promise<{ ok: true } | Extract<SpawnResult, { ok: false }>> {
  try {
    const value: unknown = JSON.parse(await readFile(join(hiveRoot, "hive.json"), "utf8"));
    const version = value && typeof value === "object" ? (value as { schemaVersion?: unknown }).schemaVersion : undefined;
    if (version === 1) return { ok: true };
    if (typeof version === "number") {
      return { ok: false, code: "HIVE_SCHEMA_MISMATCH", message: "Hive schema version is not supported." };
    }
    return { ok: false, code: "HIVE_CORRUPT", message: "Hive manifest is unreadable." };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, code: "HIVE_NOT_INITIALIZED", message: "Hive is not initialized." };
    }
    return { ok: false, code: "HIVE_CORRUPT", message: "Hive manifest is unreadable." };
  }
}

async function ensureAskMeLinked(
  hiveRoot: string,
  review: HireReview,
): Promise<{ ok: true; review: HireReview } | Extract<SpawnResult, { ok: false }>> {
  if (ASK_ID.test(review.askMeId)) return { ok: true, review };
  try {
    await openUntrustedImportAskMe({
      hiveRoot,
      reviewId: review.reviewId,
      sourceSummary: review.sourceRef,
    });
  } catch (err) {
    if (err instanceof HireAskMeError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
  const linked = await loadReview(hiveRoot, review.reviewId);
  if (!linked || !ASK_ID.test(linked.askMeId)) {
    return { ok: false, code: "HIVE_NOT_INITIALIZED", message: "Ask-Me item is not linked to this review." };
  }
  return { ok: true, review: linked };
}

function buildSpawn(
  review: HireReview,
  repositoryRoot: string,
  createWorktree: boolean,
): { ok: true; agent: RosterAgent; targets: PersonaTarget[] } | Extract<SpawnResult, { ok: false }> {
  const manifest = review.parsedManifest;
  const edits = review.operatorEdits ?? {};
  const capabilityTags = stringList(edits.capabilityTags, manifest.capabilityTags);
  const allowedSkills = allowedSkillsAfterConsent(
    stringList(edits.allowedSkills, manifest.allowlists.skills),
    review.skillConsents,
  );
  const displayName = typeof edits.displayName === "string" && edits.displayName.trim().length > 0
    ? edits.displayName.trim()
    : manifest.displayName;
  const goal = typeof edits.goal === "string" && edits.goal.trim().length > 0 ? edits.goal.trim() : manifest.goal;
  const engine = typeof edits.engine === "string" && edits.engine.trim().length > 0
    ? edits.engine.trim()
    : manifest.suggestedEngine;
  const model = typeof edits.modelTier === "string" && edits.modelTier.trim().length > 0
    ? edits.modelTier.trim()
    : manifest.suggestedModelTier;

  const paths = personaTargets(repositoryRoot, manifest.id, manifest.persona.harness, manifest.persona.scope);
  const personaPath = paths[0] ?? null;
  const row: RosterAgent = {
    id: manifest.id,
    name: displayName,
    personaPath,
    capabilityTags,
    engine,
    model,
    budgetTokens: numberOrNull(edits.budgetTokens, manifest.budget.tokens),
    budgetUsd: numberOrNull(edits.budgetUsd, manifest.budget.usd),
    workspace: null,
    worktreePolicy: createWorktree || capabilityTags.some((tag) => CODE_TAGS.has(tag.toLowerCase())) ? "isolated" : "shared",
    allowedSkills,
    allowedMcp: stringList(edits.allowedMcp, manifest.allowlists.mcp),
    status: "idle",
    origin: "hire",
  };
  const parsed = RosterAgentSchema.safeParse(row);
  if (!parsed.success || personaPath === null) {
    return { ok: false, code: "INVALID_INPUT", message: "Confirmed hire fields are not a valid roster row." };
  }
  const targets = paths.map((path) => ({
    path,
    body: personaDocument(manifest, displayName, goal, capabilityTags, path),
  }));
  return { ok: true, agent: parsed.data, targets };
}

function personaDocument(
  manifest: HireManifest,
  displayName: string,
  goal: string,
  capabilityTags: string[],
  path: string,
): string {
  const description = oneLine(goal || displayName);
  const tags = capabilityTags.map(oneLine).join(", ");
  const body = manifest.persona.body.replace(/^\n+/, "").replace(/\s+$/, "");
  if (path.endsWith(".toml")) {
    return `name = ${tomlString(manifest.id)}\ndescription = ${tomlString(description)}\ncapabilityTags = ${tomlString(tags)}\n\n${body}\n`;
  }
  return `---\nname: ${oneLine(manifest.id)}\ndescription: ${oneLine(description)}\ncapabilityTags: ${oneLine(tags)}\n---\n${body}\n`;
}

function personaTargets(
  repositoryRoot: string,
  id: string,
  harness: PersonaHarness,
  scope: PersonaScope,
): string[] {
  const fileName = harness === "codex" ? `${id}.toml` : `${id}.md`;
  const folder = harness === "cursor" ? ".cursor" : harness === "claude" ? ".claude" : ".codex";
  const project = join(repositoryRoot, folder, "agents", fileName);
  const home = join(homedir(), folder, "agents", fileName);
  if (scope === "home") return [home];
  if (scope === "both") return [project, home];
  return [project];
}

async function writeSpawn(
  hiveRoot: string,
  targets: PersonaTarget[],
  agent: RosterAgent,
): Promise<Extract<SpawnResult, { ok: false }> | { ok: true }> {
  const written: string[] = [];
  try {
    for (const target of targets) {
      await writeTextAtomic(target.path, target.body);
      written.push(target.path);
    }
    const roster = await readRoster(hiveRoot);
    if (!roster.ok) {
      await rollbackFiles(written);
      return roster;
    }
    const next = upsertAgent(roster.agents, agent);
    const parsed = RosterAgentSchema.array().safeParse(next);
    if (!parsed.success) {
      await rollbackFiles(written);
      return { ok: false, code: "INVALID_INPUT", message: "Roster row is invalid." };
    }
    await writeJsonAtomic(join(hiveRoot, "roster.json"), parsed.data);
    return { ok: true };
  } catch (err) {
    await rollbackFiles(written);
    throw err;
  }
}

function upsertAgent(roster: RosterAgent[], agent: RosterAgent): RosterAgent[] {
  const index = roster.findIndex((row) => row.id === agent.id);
  if (index < 0) return [...roster, agent];
  const next = roster.slice();
  next[index] = agent;
  return next;
}

async function readRoster(
  hiveRoot: string,
): Promise<{ ok: true; agents: RosterAgent[] } | Extract<SpawnResult, { ok: false }>> {
  try {
    const parsed = RosterAgentSchema.array().safeParse(JSON.parse(await readFile(join(hiveRoot, "roster.json"), "utf8")));
    if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "roster.json is invalid." };
    return { ok: true, agents: parsed.data };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, agents: [] };
    return { ok: false, code: "INVALID_INPUT", message: "roster.json is invalid." };
  }
}

async function resolveConfirmAskMe(
  hiveRoot: string,
  review: HireReview,
): Promise<{ ok: true } | Extract<SpawnResult, { ok: false }>> {
  const askMeId = review.askMeId.trim();
  if (!ASK_ID.test(askMeId)) {
    return { ok: false, code: "HIVE_NOT_INITIALIZED", message: "Ask-Me item is not linked to this review." };
  }
  const result = await answerAskMe({
    hiveRoot,
    id: askMeId,
    text: "Confirmed via hire-spawn-confirm.",
    action: "retry",
  });
  if (!result.ok && result.error === "ASK_ME_ALREADY_RESOLVED") return { ok: true };
  if (!result.ok) return { ok: false, code: result.error, message: result.message };
  return { ok: true };
}

async function appendHireSpawnedEvent(
  hiveRoot: string,
  data: { reviewId: string; agentId: string; personaPath: string; capabilityTags: string[] },
): Promise<void> {
  const file = writableEventLog(hiveRoot);
  if (!file) return;
  const parsed = IraEventSchema.safeParse({
    id: `evt_${randomUUID()}`,
    type: "hire.spawned",
    version: 1,
    ts: new Date().toISOString(),
    featureId: null,
    actor: { kind: "ira", id: "ira" },
    data,
  });
  if (!parsed.success) return;
  try {
    await withLock(join(hiveRoot, "locks", "events.lock"), { waitMs: EVENT_LOCK_WAIT_MS }, () =>
      appendJsonlLine(file, parsed.data),
    );
  } catch {
    // A missing or unwritable log must not fail a completed spawn.
  }
}

async function writeTextAtomic(filePath: string, text: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(tmp, text, { encoding: "utf8", flag: "wx", mode: 0o644 });
  try {
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

async function rollbackFiles(paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => unlink(path).catch(() => undefined)));
}

function writableEventLog(hiveRoot: string): string | null {
  const dir = join(hiveRoot, "events");
  const file = join(dir, "events.jsonl");
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    return null;
  }
  let info: Stats;
  try {
    info = statSync(file);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? file : null;
  }
  if (!info.isFile()) return null;
  try {
    accessSync(file, constants.W_OK);
    return file;
  } catch {
    return null;
  }
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return [...fallback];
  return [...value];
}

function numberOrNull(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function tomlString(value: string): string {
  return `"${oneLine(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
