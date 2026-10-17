import type { DoctorFinding, DoctorSeverity } from "../command-plane/doctor.js";
import { loadIntegrationConfig } from "./config.js";
import { runAdapterSafe } from "./fail-closed.js";
import { probeHermesAdapter } from "./hermes.js";

function finding(code: string, severity: DoctorSeverity, message: string, remedy: string): DoctorFinding {
  return { code, severity, message, remedy };
}

/** Optional adapter health for doctor (FR-008); never emits error severity. */
export async function integrationDoctorFindings(hiveRoot: string): Promise<DoctorFinding[]> {
  return runAdapterSafe("integration-doctor", async () => collectIntegrationDoctorFindings(hiveRoot), []);
}

async function collectIntegrationDoctorFindings(hiveRoot: string): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  let config;
  try {
    config = await loadIntegrationConfig(hiveRoot);
  } catch {
    findings.push(
      finding(
        "INTEGRATION_CONFIG_UNREADABLE",
        "warning",
        "integrations/config.json is missing or invalid.",
        "Fix integrations/config.json or remove it to use default disabled adapters.",
      ),
    );
    return findings;
  }

  const hermes = config.adapters.hermes;
  const hermesProbe = await probeHermesAdapter({
    enabled: hermes.enabled,
    mcpEndpoint: hermes.mcpEndpoint,
  });
  if (hermes.enabled && !hermesProbe.ok) {
    findings.push(
      finding(
        "INTEGRATION_HERMES_DEGRADED",
        "warning",
        "Hermes adapter is enabled but not configured (missing MCP endpoint).",
        "Set adapters.hermes.mcpEndpoint or disable the Hermes adapter.",
      ),
    );
  }

  const openclaw = config.adapters.openclaw;
  if (openclaw.enabled && !openclaw.gatewayUrl?.trim()) {
    findings.push(
      finding(
        "INTEGRATION_OPENCLAW_MISCONFIGURED",
        "warning",
        "OpenClaw adapter is enabled but gatewayUrl is missing.",
        "Set adapters.openclaw.gatewayUrl or disable the OpenClaw adapter.",
      ),
    );
  }

  const channelApprove = config.adapters.channelApprove;
  if (channelApprove.enabled && !channelApprove.sharedSecretEnv?.trim()) {
    findings.push(
      finding(
        "INTEGRATION_CHANNEL_APPROVE_MISCONFIGURED",
        "warning",
        "Channel approve adapter is enabled but sharedSecretEnv is missing.",
        "Set adapters.channelApprove.sharedSecretEnv or disable channel approve.",
      ),
    );
  }

  return findings;
}
