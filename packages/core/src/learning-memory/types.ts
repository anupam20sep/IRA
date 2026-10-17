import type { z } from "zod";
import type {
  PatternKindSchema,
  PatternStatusSchema,
} from "./schema.js";
import type { ComplexitySchema, TaskKindSchema } from "../command-plane/schema.js";

export type PatternKind = z.infer<typeof PatternKindSchema>;
export type PatternStatus = z.infer<typeof PatternStatusSchema>;

export type TaskKind = z.infer<typeof TaskKindSchema>;
export type Complexity = z.infer<typeof ComplexitySchema>;

/** P-001 injection payload (bounded markdown + trace ids). */
export interface InjectionSummary {
  text: string;
  patternIds: string[];
}

/** Context for RETRIEVE / JUDGE (extends P-001 base fields). */
export interface RetrieveContext {
  featureId: string;
  taskId: string;
  implementsFr: string[];
  kind: TaskKind;
  complexity: Complexity;
  capabilityTags: string[];
  stack?: string[];
  engine?: string | null;
  errorClass?: string | null;
}

/** Context for DISTILL after record-result (extends P-001 base fields). */
export interface DistillContext {
  featureId: string;
  taskId: string;
  passed: boolean;
  reviewFailures: number;
  kind: TaskKind;
  implementsFr: string[];
  implementerReport?: string | null;
  reviewerReport?: string | null;
  engine?: string | null;
}
