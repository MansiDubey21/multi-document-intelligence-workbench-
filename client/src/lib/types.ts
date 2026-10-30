/**
 * API contract as seen by the client. Mirrors server/src/ai/schema.ts (the server validates
 * every response against its zod schema before sending it, so these shapes are guaranteed).
 */

export type FindingKind = 'extracted_fact' | 'computed' | 'ai_interpretation';
export type Severity = 'high' | 'medium' | 'low';

export interface DocumentInfo {
  id: string;
  filename: string;
  kind: 'pdf' | 'text' | 'csv' | 'image';
  mimeType: string;
  sizeBytes: number;
  status: 'ready' | 'failed';
  error: string | null;
  charCount: number;
  pageCount: number | null;
  truncated: boolean;
  warnings: string[];
  createdAt: string;
}

export interface SourceRef {
  documentId: string;
  filename: string;
  locator: string;
  excerpt: string;
  verified: boolean;
}

export interface Finding {
  id: string;
  category: 'discrepancy' | 'missing' | 'key_value' | 'insight';
  field: string;
  title: string;
  detail: string;
  severity: Severity;
  kind: FindingKind;
  sources: SourceRef[];
}

export interface ComparisonRow {
  field: string;
  label: string;
  subject: string | null;
  status: 'match' | 'mismatch' | 'partial' | 'single_source';
  cells: Record<string, { values: string[]; sources: SourceRef[] }>;
}

export interface KeyValue {
  field: string;
  label: string;
  value: string;
  type: string;
  subject: string | null;
  kind: FindingKind;
  source: SourceRef;
}

export interface AnalysisResult {
  instruction: string;
  summary: { text: string; kind: FindingKind; points: Finding[] };
  documents: { id: string; filename: string; kind: string }[];
  comparisonTable: ComparisonRow[];
  discrepancies: Finding[];
  missingInformation: Finding[];
  keyValues: KeyValue[];
  perDocument: { documentId: string; filename: string; summary: string; keyPoints: string[]; kind: FindingKind }[];
  meta: { provider: string; model: string | null; focus: string[]; warnings: string[]; durationMs: number; generatedAt: string };
}

export interface UploadResponse {
  accepted: { document: DocumentInfo; duplicate: boolean }[];
  rejected: { filename: string; code: string; reason: string }[];
  documents: DocumentInfo[];
}

export interface Health {
  status: string;
  provider: string;
  model: string | null;
  supportedExtensions: string[];
  limits: { maxFileSizeMb: number; maxFilesPerUpload: number; maxPromptChars: number };
}

export interface AnalysisListItem {
  id: string;
  instruction: string;
  provider: string;
  createdAt: string;
  status: string;
}
