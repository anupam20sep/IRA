import { z } from "zod";
import {
  ComplexitySchema,
  TaskKindSchema,
  featureIdSchema,
} from "../command-plane/schema.js";

const isoTimestamp = z.string().datetime({ offset: true });

const patternIdSchema = z
  .string()
  .regex(/^pat_[A-Za-z0-9._-]{1,127}$/, "invalid pattern id");

const evidenceRefSchema = z
  .string()
  .regex(/^(task|report):.+$/, "invalid evidenceRef");

export const PatternKindSchema = z.enum(["success", "failure", "routing"]);

export const PatternStatusSchema = z.enum(["active", "archived"]);

export const PatternSignalsSchema = z.object({
  frTags: z.array(z.string().min(1)),
  taskKind: TaskKindSchema,
  stack: z.array(z.string().min(1)).optional(),
  engine: z.string().min(1).optional(),
  errorClass: z.string().min(1).optional(),
  featureId: featureIdSchema.optional(),
});

export const PatternFrontmatterSchema = z.object({
  id: patternIdSchema,
  kind: PatternKindSchema,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  signals: PatternSignalsSchema,
  evidenceRefs: z.array(evidenceRefSchema),
  useCount: z.number().int().min(0),
  status: PatternStatusSchema,
  score: z.number().optional(),
});

export const PatternRecordSchema = z.object({
  frontmatter: PatternFrontmatterSchema,
  summary: z.string(),
});

export const PatternsListQuerySchema = z.object({
  projectRoot: z.string().min(1),
  featureId: featureIdSchema.optional(),
  frTag: z.string().min(1).optional(),
  kind: PatternKindSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().nullable().optional(),
});

const PatternListItemSchema = z.object({
  id: patternIdSchema,
  kind: PatternKindSchema,
  signals: PatternSignalsSchema.pick({ frTags: true, taskKind: true }).extend({
    featureId: featureIdSchema.optional(),
  }),
  summaryPreview: z.string(),
  evidenceRefs: z.array(evidenceRefSchema),
  useCount: z.number().int().min(0),
  updatedAt: isoTimestamp,
});

export const PatternsListResponseSchema = z.object({
  patterns: z.array(PatternListItemSchema),
  nextCursor: z.string().nullable(),
  warnings: z.array(z.string()).optional(),
});
