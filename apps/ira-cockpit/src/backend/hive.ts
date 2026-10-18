import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runSuperspecJson } from "./cli.js";
import type { AskMeItem, DoctorSnapshot, RosterAgent } from "./types.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export async function loadDoctor(repoRoot: string): Promise<DoctorSnapshot> {
  const res = await runSuperspecJson(repoRoot, ["doctor"]);
  if (!res.ok) {
    return {
      ok: false,
      hiveReady: false,
      engineRungReady: false,
      hiveRoot: null,
      repositoryRoot: repoRoot,
      findings: [{ code: "CLI_ERROR", severity: "error", message: res.error }],
    };
  }
  const d = asRecord(res.json) ?? {};
  const findings = Array.isArray(d.findings) ? d.findings : [];
  return {
    ok: Boolean(d.ok ?? d.ready ?? d.hiveReady),
    hiveReady: Boolean(d.hiveReady),
    engineRungReady: Boolean(d.engineRungReady),
    hiveRoot: typeof d.hiveRoot === "string" ? d.hiveRoot : null,
    repositoryRoot: typeof d.repositoryRoot === "string" ? d.repositoryRoot : repoRoot,
    sliceAValidated: Boolean(d.sliceAValidated),
    findings: findings.map((f) => {
      const row = asRecord(f) ?? {};
      return {
        code: typeof row.code === "string" ? row.code : undefined,
        severity: typeof row.severity === "string" ? row.severity : undefined,
        message: typeof row.message === "string" ? row.message : undefined,
      };
    }),
  };
}

export async function loadAskMe(repoRoot: string): Promise<AskMeItem[]> {
  const res = await runSuperspecJson(repoRoot, ["ask-me", "list"]);
  if (!res.ok) return [];
  const d = asRecord(res.json) ?? {};
  const items = Array.isArray(d.items) ? d.items : [];
  return items.map((raw) => {
    const row = asRecord(raw) ?? {};
    return {
      id: String(row.id ?? ""),
      featureId: row.featureId == null ? null : String(row.featureId),
      taskId: row.taskId == null ? null : String(row.taskId),
      agentId: row.agentId == null ? null : String(row.agentId),
      reasonClass: String(row.reasonClass ?? "unknown"),
      question: String(row.question ?? ""),
      answer: row.answer == null ? null : String(row.answer),
      state: row.state == null ? undefined : String(row.state),
    };
  }).filter((i) => i.id);
}

export async function loadRoster(hiveRoot: string | null): Promise<RosterAgent[]> {
  if (!hiveRoot) return [];
  try {
    const text = await readFile(join(hiveRoot, "roster.json"), "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((raw) => {
      const row = asRecord(raw) ?? {};
      return {
        id: String(row.id ?? ""),
        name: row.name == null ? undefined : String(row.name),
        displayName: row.displayName == null ? undefined : String(row.displayName),
        status: row.status == null ? undefined : String(row.status),
        engine: row.engine == null ? undefined : String(row.engine),
        personaPath: row.personaPath == null ? undefined : String(row.personaPath),
        capabilityTags: Array.isArray(row.capabilityTags)
          ? row.capabilityTags.map(String)
          : undefined,
        origin: row.origin == null ? undefined : String(row.origin),
        budgetUsd: typeof row.budgetUsd === "number" ? row.budgetUsd : undefined,
        spendUsd: typeof row.spendUsd === "number" ? row.spendUsd : undefined,
      };
    }).filter((a) => a.id);
  } catch {
    return [];
  }
}

export async function loadSettings(
  hiveRoot: string | null,
): Promise<Record<string, unknown> | null> {
  if (!hiveRoot) return null;
  try {
    const text = await readFile(join(hiveRoot, "settings.json"), "utf8");
    const parsed = JSON.parse(text) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

export async function loadRecentEvents(
  hiveRoot: string | null,
  limit = 50,
): Promise<Array<{ ts?: string; type?: string; message?: string; raw?: string }>> {
  if (!hiveRoot) return [];
  try {
    const text = await readFile(join(hiveRoot, "events", "events.jsonl"), "utf8");
    const lines = text.split("\n").filter(Boolean).slice(-limit).reverse();
    return lines.map((line) => {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        return {
          ts: row.ts == null ? undefined : String(row.ts),
          type: row.type == null ? undefined : String(row.type),
          message:
            row.message == null
              ? row.summary == null
                ? undefined
                : String(row.summary)
              : String(row.message),
          raw: line.slice(0, 400),
        };
      } catch {
        return { raw: line.slice(0, 400) };
      }
    });
  } catch {
    return [];
  }
}

export async function answerAskMe(
  repoRoot: string,
  id: string,
  answer: string,
): Promise<CliResultLike> {
  const res = await runSuperspecJson(repoRoot, [
    "ask-me",
    "answer",
    "--id",
    id,
    "--answer",
    answer,
  ]);
  return res.ok
    ? { ok: true, data: res.json }
    : { ok: false, error: res.error };
}

type CliResultLike = { ok: true; data: unknown } | { ok: false; error: string };
