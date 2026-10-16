import { execFile as nodeExecFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { LEDGER_LOCK_WAIT_MS, withLock, writeJsonAtomic } from "../command-plane/store.js";
import { enginesLockPath, hiveInitialized } from "./store.js";
import { LocalPackProfileSchema } from "./schema.js";
import {
  LOCAL_CONTEXT_FLOOR,
  type LocalPackBackend,
  type LocalPackContextSource,
  type LocalPackProfile,
} from "./types.js";

export { LOCAL_CONTEXT_FLOOR };

const PROBE_TIMEOUT_MS = 5000;

const DEFAULT_BASE_URL: Record<Exclude<LocalPackBackend, "byok">, string> = {
  ollama: "http://127.0.0.1:11434",
  lmstudio: "http://127.0.0.1:1234",
  vllm: "http://127.0.0.1:8000",
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

const SECRET_QUERY = /^(api[-_]?key|key|token|access_token|secret|password)$/i;

type ExecFileFn = typeof nodeExecFile;

export type LocalPackDeps = {
  execFile?: ExecFileFn;
  fetch?: typeof fetch;
};

export type ContextGateCode = "LOCAL_CONTEXT_BELOW_FLOOR" | "LOCAL_CONTEXT_UNKNOWN";

export type ContextGateResult =
  | { ok: true; advertisedContext: number; contextSource: LocalPackContextSource }
  | { ok: false; code: ContextGateCode; message: string };

export type LocalPackRequest = {
  engineId: LocalPackProfile["engineId"];
  backend: LocalPackBackend;
  model: string;
  baseUrl?: string;
  advertisedContext?: number | null;
  tiers?: LocalPackProfile["tiers"];
};

export type LocalPackResult =
  | { ok: true; profile: LocalPackProfile }
  | {
      ok: false;
      code: ContextGateCode | "HIVE_NOT_INITIALIZED" | "INVALID_INPUT" | "LEDGER_BUSY";
      message: string;
    };

type ProbeInput = {
  backend: LocalPackBackend;
  probeValue: unknown;
  model?: string;
  advertisedContext?: number | null;
};

type GateProfile = {
  backend: LocalPackBackend;
  model: string;
  baseUrl?: string;
  advertisedContext?: number | null;
};

function contextMessage(model: string, shown: number | "unknown"): string {
  return `Local model "${model}" advertises ${shown} context; minimum is ${LOCAL_CONTEXT_FLOOR}. Raise context (Ollama: set num_ctx to at least ${LOCAL_CONTEXT_FLOOR}) or bind another model.`;
}

function modelName(model: string | undefined): string {
  const trimmed = model?.trim();
  return trimmed ? trimmed : "unknown";
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function judge(
  value: number | null,
  model: string | undefined,
  contextSource: LocalPackContextSource,
): ContextGateResult {
  const name = modelName(model);
  if (value === null) {
    return { ok: false, code: "LOCAL_CONTEXT_UNKNOWN", message: contextMessage(name, "unknown") };
  }
  if (value < LOCAL_CONTEXT_FLOOR) {
    return { ok: false, code: "LOCAL_CONTEXT_BELOW_FLOOR", message: contextMessage(name, value) };
  }
  return { ok: true, advertisedContext: value, contextSource };
}

function parseNumCtx(parameters: string): number | null {
  const match = /(?:^|\s)num_ctx\s+(\d+)/.exec(parameters);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function firstContextLength(record: unknown): number | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  for (const [key, value] of Object.entries(record)) {
    if (key === "context_length" || key.endsWith(".context_length")) {
      const parsed = asNonNegativeInt(value);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function modelRows(probe: unknown): Record<string, unknown>[] {
  const list = Array.isArray(probe)
    ? probe
    : probe && typeof probe === "object" && Array.isArray((probe as { data?: unknown }).data)
      ? (probe as { data: unknown[] }).data
      : [];
  return list.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row),
  );
}

function namedModel(probe: unknown, model: string | undefined): Record<string, unknown> | null {
  if (!model) return null;
  for (const row of modelRows(probe)) {
    if (row.id === model || row.name === model) return row;
  }
  return null;
}

function readProbe(backend: LocalPackBackend, probeValue: unknown, model: string | undefined): number | null {
  if (backend === "ollama") {
    if (!probeValue || typeof probeValue !== "object" || Array.isArray(probeValue)) return null;
    const body = probeValue as Record<string, unknown>;
    if (typeof body.parameters === "string") {
      const numCtx = parseNumCtx(body.parameters);
      if (numCtx !== null) return numCtx;
    }
    return firstContextLength(body.model_info) ?? firstContextLength(body.details);
  }

  const row = namedModel(probeValue, model);
  if (!row) return null;
  if (backend === "lmstudio") {
    return asNonNegativeInt(row.context_length) ?? asNonNegativeInt(row.max_context_length);
  }
  if (backend === "vllm") return asNonNegativeInt(row.max_model_len);
  return null;
}

/** Pure probe parse. A finished probe with no context field is unknown, even if a number was declared. */
export function evaluateContextFromProbe(input: ProbeInput): ContextGateResult {
  if (input.backend === "byok") {
    return judge(asNonNegativeInt(input.advertisedContext), input.model, "declared");
  }
  return judge(readProbe(input.backend, input.probeValue, input.model), input.model, "probe");
}

function resolveBaseUrl(backend: LocalPackBackend, baseUrl: string | undefined): string | null {
  const trimmed = baseUrl?.trim();
  if (trimmed) return trimmed;
  if (backend === "byok") return null;
  return DEFAULT_BASE_URL[backend];
}

function canonicalBaseUrl(url: URL): string {
  if ((url.pathname === "/" || url.pathname === "") && !url.search && !url.hash) return url.origin;
  return url.href;
}

function validateBaseUrl(
  backend: LocalPackBackend,
  raw: string,
): { ok: true; baseUrl: string } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: "baseUrl must be an http or https URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "baseUrl must be an http or https URL." };
  }
  if (url.username || url.password) {
    return { ok: false, message: "baseUrl must not include a userinfo password or an API key." };
  }
  for (const key of url.searchParams.keys()) {
    if (SECRET_QUERY.test(key)) {
      return { ok: false, message: "baseUrl must not include a userinfo password or an API key." };
    }
  }
  if (backend !== "byok" && !LOOPBACK_HOSTS.has(url.hostname)) {
    return { ok: false, message: "Local backend baseUrl host must be 127.0.0.1 or localhost." };
  }
  return { ok: true, baseUrl: canonicalBaseUrl(url) };
}

function tryJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Spawn or timeout only. A non-zero `ollama show` is a finished probe with no context. */
function ollamaWasNotMeasured(err: NodeJS.ErrnoException & { killed?: boolean }): boolean {
  if (err.code === "ENOENT" || err.code === "ETIMEDOUT") return true;
  return err.killed === true;
}

function runOllama(execFile: ExecFileFn, model: string): Promise<{ ran: true; value: unknown } | { ran: false }> {
  return new Promise((resolve) => {
    try {
      execFile(
        "ollama",
        ["show", model, "--json"],
        { timeout: PROBE_TIMEOUT_MS, shell: false },
        (err, stdout) => {
          const text = stdout == null ? "" : String(stdout);
          const parsed = text.trim() ? tryJson(text) : undefined;
          if (parsed !== undefined) {
            resolve({ ran: true, value: parsed });
            return;
          }
          if (err && ollamaWasNotMeasured(err)) {
            resolve({ ran: false });
            return;
          }
          resolve({ ran: true, value: null });
        },
      );
    } catch {
      resolve({ ran: false });
    }
  });
}

async function probeHttp(
  fetchImpl: typeof fetch,
  baseUrl: string,
): Promise<{ ran: true; value: unknown } | { ran: false }> {
  const endpoint = new URL("/v1/models", baseUrl).href;
  try {
    const response = await fetchImpl(endpoint, {
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { ran: true, value: null };
    try {
      return { ran: true, value: await response.json() };
    } catch {
      return { ran: true, value: null };
    }
  } catch {
    return { ran: false };
  }
}

function declaredOrUnknown(profile: GateProfile): ContextGateResult {
  return judge(asNonNegativeInt(profile.advertisedContext), profile.model, "declared");
}

export async function evaluateContextGate(
  profile: GateProfile,
  deps: LocalPackDeps = {},
): Promise<ContextGateResult> {
  if (profile.backend === "byok") {
    return evaluateContextFromProbe({
      backend: "byok",
      probeValue: null,
      model: profile.model,
      advertisedContext: profile.advertisedContext,
    });
  }

  const rawUrl = resolveBaseUrl(profile.backend, profile.baseUrl);
  const validated = rawUrl ? validateBaseUrl(profile.backend, rawUrl) : { ok: false as const, message: "" };
  if (!validated.ok) return judge(null, profile.model, "probe");

  if (profile.backend === "ollama") {
    const outcome = await runOllama(deps.execFile ?? nodeExecFile, profile.model);
    if (!outcome.ran) return declaredOrUnknown(profile);
    return evaluateContextFromProbe({
      backend: "ollama",
      probeValue: outcome.value,
      model: profile.model,
    });
  }

  const outcome = await probeHttp(deps.fetch ?? globalThis.fetch, validated.baseUrl);
  if (!outcome.ran) return declaredOrUnknown(profile);
  return evaluateContextFromProbe({
    backend: profile.backend,
    probeValue: outcome.value,
    model: profile.model,
  });
}

function invalid(message: string): LocalPackResult {
  return { ok: false, code: "INVALID_INPUT", message };
}

function validateRequest(
  request: LocalPackRequest,
): { ok: true; request: LocalPackRequest; baseUrl: string } | { ok: false; code: "INVALID_INPUT"; message: string } {
  if (request.engineId !== "opencode" && request.engineId !== "crush") {
    return { ok: false, code: "INVALID_INPUT", message: "Local pack engineId must be opencode or crush." };
  }
  if (request.backend !== "ollama" && request.backend !== "lmstudio" && request.backend !== "vllm" && request.backend !== "byok") {
    return { ok: false, code: "INVALID_INPUT", message: "Local pack backend must be ollama, lmstudio, vllm, or byok." };
  }
  if (typeof request.model !== "string" || request.model.trim() === "") {
    return { ok: false, code: "INVALID_INPUT", message: "Local pack model is required." };
  }
  if (request.tiers) {
    const { economy, standard, frontier } = request.tiers;
    if (!economy || !standard || !frontier) {
      return { ok: false, code: "INVALID_INPUT", message: "tiers must name economy, standard, and frontier models." };
    }
  }
  const rawUrl = resolveBaseUrl(request.backend, request.baseUrl);
  if (!rawUrl) return { ok: false, code: "INVALID_INPUT", message: "BYOK baseUrl is required." };
  const validated = validateBaseUrl(request.backend, rawUrl);
  if (!validated.ok) return { ok: false, code: "INVALID_INPUT", message: validated.message };
  return {
    ok: true,
    baseUrl: validated.baseUrl,
    request: { ...request, model: request.model.trim(), baseUrl: validated.baseUrl },
  };
}

export async function setLocalPack(
  hiveRoot: string,
  request: LocalPackRequest,
  deps: LocalPackDeps = {},
): Promise<LocalPackResult> {
  if (!(await hiveInitialized(hiveRoot))) {
    return { ok: false, code: "HIVE_NOT_INITIALIZED", message: "Hive is not initialized." };
  }

  const validated = validateRequest(request);
  if (!validated.ok) return invalid(validated.message);

  const gate = await evaluateContextGate(validated.request, deps);
  if (!gate.ok) return { ok: false, code: gate.code, message: gate.message };

  const profile: LocalPackProfile = {
    engineId: validated.request.engineId,
    backend: validated.request.backend,
    baseUrl: validated.baseUrl,
    model: validated.request.model,
    advertisedContext: gate.advertisedContext,
    contextSource: gate.contextSource,
    ...(validated.request.tiers ? { tiers: validated.request.tiers } : {}),
  };
  const parsed = LocalPackProfileSchema.safeParse(profile);
  if (!parsed.success) return invalid("Local pack profile is invalid.");

  await mkdir(join(hiveRoot, "locks"), { recursive: true, mode: 0o700 });
  await mkdir(join(hiveRoot, "engines"), { recursive: true, mode: 0o700 });
  const locked = await withLock(enginesLockPath(hiveRoot), { waitMs: LEDGER_LOCK_WAIT_MS }, async () => {
    await writeJsonAtomic(join(hiveRoot, "engines", "local-pack.json"), parsed.data);
  });
  if (!locked.ok) return { ok: false, code: "LEDGER_BUSY", message: "Engines lock is busy." };
  return { ok: true, profile: parsed.data };
}
