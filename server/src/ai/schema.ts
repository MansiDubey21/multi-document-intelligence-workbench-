import { z } from 'zod';

/**
 * The structured analysis contract. Every analyzer (mock or LLM) must produce
 * data that validates against AnalysisResultSchema before it is stored or returned.
 *
 * Provenance rules:
 *  - every finding carries >= 1 SourceRef pointing at exactly one document
 *  - SourceRef.verified is set by the server (never trusted from the model):
 *    true only if the excerpt is actually found in that document's extracted text
 *
 * Fact vs interpretation:
 *  - "extracted_fact"     value read directly from a document (verbatim excerpt)
 *  - "computed"           deterministic rule applied to extracted facts (e.g. two values differ)
 *  - "ai_interpretation"  judgement / inference produced by the language model
 */

export const FindingKindSchema = z.enum(['extracted_fact', 'computed', 'ai_interpretation']);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const SourceRefSchema = z.object({
  documentId: z.string().min(1),
  filename: z.string().default(''),
  locator: z.string().max(200).default(''),
  excerpt: z.string().max(600).default(''),
  verified: z.boolean().default(false),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const SeveritySchema = z.enum(['high', 'medium', 'low']);

export const FindingSchema = z.object({
  id: z.string(),
  category: z.enum(['discrepancy', 'missing', 'key_value', 'insight']),
  field: z.string().max(120).default(''),
  title: z.string().max(300),
  detail: z.string().max(2000).default(''),
  severity: SeveritySchema.default('low'),
  kind: FindingKindSchema,
  /** empty only for "absent from every document" missing-information findings */
  sources: z.array(SourceRefSchema).default([]),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ComparisonCellSchema = z.object({
  values: z.array(z.string()),
  sources: z.array(SourceRefSchema),
});

export const ComparisonRowSchema = z.object({
  field: z.string(),
  label: z.string(),
  subject: z.string().nullable().default(null),
  status: z.enum(['match', 'mismatch', 'partial', 'single_source']),
  /** keyed by documentId; a missing key means "not present in that document" */
  cells: z.record(z.string(), ComparisonCellSchema),
});
export type ComparisonRow = z.infer<typeof ComparisonRowSchema>;

export const KeyValueSchema = z.object({
  field: z.string(),
  label: z.string(),
  value: z.string(),
  type: z.string(),
  subject: z.string().nullable().default(null),
  kind: FindingKindSchema,
  source: SourceRefSchema,
});

export const DocumentInsightSchema = z.object({
  documentId: z.string(),
  filename: z.string(),
  summary: z.string().max(2000),
  keyPoints: z.array(z.string().max(500)).max(15).default([]),
  kind: FindingKindSchema,
});

export const AnalysisResultSchema = z.object({
  instruction: z.string(),
  summary: z.object({
    text: z.string().max(4000),
    kind: FindingKindSchema,
    points: z.array(FindingSchema).default([]),
  }),
  documents: z.array(
    z.object({ id: z.string(), filename: z.string(), kind: z.string() }),
  ),
  comparisonTable: z.array(ComparisonRowSchema),
  discrepancies: z.array(FindingSchema),
  missingInformation: z.array(FindingSchema),
  keyValues: z.array(KeyValueSchema),
  perDocument: z.array(DocumentInsightSchema),
  meta: z.object({
    provider: z.string(),
    model: z.string().nullable(),
    focus: z.array(z.string()),
    warnings: z.array(z.string()),
    durationMs: z.number(),
    generatedAt: z.string(),
  }),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

/* ---------- Schemas the LLM must follow (subset; server fills ids/verification) ---------- */

export const LlmDocumentPassSchema = z.object({
  summary: z.string().max(2000),
  keyPoints: z.array(z.string().max(500)).max(15).default([]),
  facts: z
    .array(
      z.object({
        field: z.string().max(80),
        label: z.string().max(120),
        value: z.string().max(500),
        type: z.enum(['text', 'name', 'address', 'date', 'money', 'number', 'id', 'email', 'phone']).catch('text'),
        subject: z.string().max(200).nullable().optional(),
        excerpt: z.string().max(400),
        locator: z.string().max(100).optional(),
      }),
    )
    .max(80)
    .default([]),
});
export type LlmDocumentPass = z.infer<typeof LlmDocumentPassSchema>;

const LlmSourceSchema = z.object({
  documentId: z.string(),
  excerpt: z.string().max(400).default(''),
  locator: z.string().max(100).optional(),
});

export const LlmSynthesisSchema = z.object({
  summary: z.string().max(4000),
  insights: z
    .array(
      z.object({
        title: z.string().max(300),
        detail: z.string().max(2000).default(''),
        severity: SeveritySchema.catch('low'),
        sources: z.array(LlmSourceSchema).min(1),
      }),
    )
    .max(25)
    .default([]),
  discrepancies: z
    .array(
      z.object({
        field: z.string().max(120).default(''),
        title: z.string().max(300),
        detail: z.string().max(2000).default(''),
        severity: SeveritySchema.catch('medium'),
        sources: z.array(LlmSourceSchema).min(1),
      }),
    )
    .max(40)
    .default([]),
  missingInformation: z
    .array(
      z.object({
        field: z.string().max(120).default(''),
        title: z.string().max(300),
        detail: z.string().max(2000).default(''),
        sources: z.array(LlmSourceSchema).min(1),
      }),
    )
    .max(40)
    .default([]),
});
export type LlmSynthesis = z.infer<typeof LlmSynthesisSchema>;
