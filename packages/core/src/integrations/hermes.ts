export type HermesProbeInput = {
  enabled: boolean;
  mcpEndpoint?: string;
};

export type HermesProbeResult = {
  ok: boolean;
  detail?: string;
};

/** Health probe for optional Hermes MCP front-door (FR-005); failures degrade standalone. */
export async function probeHermesAdapter(input: HermesProbeInput): Promise<HermesProbeResult> {
  if (!input.enabled) {
    return { ok: true, detail: "disabled" };
  }

  const endpoint = input.mcpEndpoint?.trim();
  if (!endpoint) {
    return { ok: false, detail: "mcp_endpoint_missing" };
  }

  return { ok: true, detail: "configured" };
}
