export * from "./types.js";
export { parseSpec } from "./spec-parser.js";
export {
  parsePlan,
  extractFrRefs,
  extractTaskDeps,
  findMalformedFrRefs,
  normalizeTaskId,
} from "./plan-parser.js";
export { buildMatrix, matrixGaps } from "./matrix.js";
export { lintPlan, type LintFinding } from "./plan-lint.js";
export { lintDesign, lintDesignText } from "./design-lint.js";
export { lintSpec } from "./spec-lint.js";
export { routeModel, routeModelClass, type ModelClass, type ModelTier, type RouteRole, type RouteModelInput, type RouteModelResult } from "./model-router.js";
export {
  mapHarnessModel,
  listHarnessModels,
  type HarnessId,
  type ThinkingHint,
  type HarnessModelRecommendation,
} from "./harness-model-map.js";
export {
  loadModelsConfig,
  parseModelsConfig,
  resolveDispatchModel,
  pickHarnessOverride,
  type ModelRef,
  type ModelsConfig,
  type ResolveDispatchModelInput,
  type ResolvedDispatchModel,
} from "./models-config.js";
export { scaffold } from "./scaffold.js";
export * from "./forge-loop.js";
export { initProject, defaultTemplatesDir, type InitMode, type InitOptions, type InitResult } from "./init.js";
export { formatInitReport, formatInitError } from "./init.js";
export { emitInitSuccess, emitInitFailure } from "./cli-output.js";
export { isDirectRun, bootstrapEngineHooksFromCwd } from "./cli-entry.js";
export { registerEngineHooks, registerEngineHooksIfHive } from "./engines/register.js";
export {
  discoverPersonas,
  findProjectRoot,
  defaultPersonaDirs,
  type Persona,
  type PersonaSource,
  type DiscoverPersonasOptions,
} from "./persona-discovery.js";
export {
  appendCoordinatorLog,
  buildCoordinatorBrief,
  coordinatorPaths,
  readCoordinatorBriefText,
  reportFilePath,
  writeCoordinatorBrief,
  type CoordinatorBriefPaths,
  type CoordinatorLogEntry,
} from "./coordinator-ledger.js";
export * from "./command-plane/index.js";
export {
  installLearningMemory,
  createLearningHooks,
  listPatterns,
  reindexFromMarkdown,
  type LearningMemoryInstallOpts,
} from "./learning-memory/index.js";
export {
  bootstrapTokenGovernor,
  isTokenGovernorRegistered,
  registerTokenGovernor,
  registerTokenGovernorIfHive,
  tokenHooksImpl,
} from "./token-governor/index.js";
export type * from "./token-governor/types.js";
export {
  bootstrapHire,
  getHireAskMeAnswerDelegate,
  hireHooksImpl,
} from "./hire/index.js";
export type {
  HireAskMeAnswerDelegateInput,
  HireAskMeAnswerDelegateResult,
} from "./hire/index.js";
export { hireImport } from "./hire/import.js";
export type {
  HireImportRequest,
  HireImportResponse,
} from "./hire/import.js";
export {
  loadIntegrationConfig,
  saveIntegrationConfig,
  createShareToken,
  verifyShareToken,
  assertShareCannotMutate,
  integrationDoctorFindings,
} from "./integrations/index.js";
export type { IntegrationConfig } from "./integrations/index.js";
