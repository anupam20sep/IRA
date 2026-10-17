import type { z } from "zod";
import type { IntegrationConfigSchema } from "./schema.js";

export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;

export type OpenClawAdapterConfig = IntegrationConfig["adapters"]["openclaw"];
export type HermesAdapterConfig = IntegrationConfig["adapters"]["hermes"];
export type ChannelApproveAdapterConfig = IntegrationConfig["adapters"]["channelApprove"];
export type BoardShareAdapterConfig = IntegrationConfig["adapters"]["boardShare"];
