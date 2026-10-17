import { z } from "zod";

const OpenClawAdapterSchema = z.object({
  enabled: z.boolean().default(false),
  gatewayUrl: z.string().min(1).optional(),
});

const HermesAdapterSchema = z.object({
  enabled: z.boolean().default(false),
  mcpEndpoint: z.string().min(1).optional(),
});

const ChannelApproveAdapterSchema = z.object({
  enabled: z.boolean().default(false),
  sharedSecretEnv: z.string().min(1).optional(),
});

const BoardShareAdapterSchema = z.object({
  enabled: z.boolean().default(false),
});

const defaultAdapters = {
  openclaw: { enabled: false as const },
  hermes: { enabled: false as const },
  channelApprove: { enabled: false as const },
  boardShare: { enabled: false as const },
};

const AdaptersSchema = z.object({
  openclaw: OpenClawAdapterSchema.default(defaultAdapters.openclaw),
  hermes: HermesAdapterSchema.default(defaultAdapters.hermes),
  channelApprove: ChannelApproveAdapterSchema.default(defaultAdapters.channelApprove),
  boardShare: BoardShareAdapterSchema.default(defaultAdapters.boardShare),
});

export const IntegrationConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  adapters: AdaptersSchema.default(defaultAdapters),
});

export function parseIntegrationConfig(input: unknown) {
  return IntegrationConfigSchema.parse(input);
}
