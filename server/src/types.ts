/**
 * Domain types shared across the pipeline, persistence and API layers.
 * The AI output contract lives in ./ai/schema.ts (zod) and is re-exported here.
 */

export type DocumentKind = 'pdf' | 'text' | 'csv' | 'image';
export type DocumentStatus = 'ready' | 'failed';

export interface StoredDocument {
  id: string;
  workspaceId: string;
  filename: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: DocumentStatus;
  error: string | null;
  charCount: number;
  pageCount: number | null;
  truncated: boolean;
  warnings: string[];
  createdAt: string;
}

/** A contiguous slice of a document's text with a human-readable location. */
export interface Chunk {
  documentId: string;
  index: number;
  text: string;
  /** e.g. "page 2", "lines 10-34", "row 4" */
  locator: string;
}

export type FactType = 'text' | 'name' | 'address' | 'date' | 'money' | 'number' | 'id' | 'email' | 'phone';

/**
 * A fact extracted deterministically (or by the LLM, then verified) from ONE document.
 * Facts never span documents: provenance is always a single documentId + locator + verbatim excerpt.
 */
export interface ExtractedFact {
  documentId: string;
  /** canonical field key, e.g. "full_name", "annual_revenue" */
  field: string;
  /** label exactly as written in the source document */
  label: string;
  value: string;
  /** comparable form: ISO date, plain number, lower-cased text … */
  normalized: string | null;
  type: FactType;
  /** entity the fact is about when a document describes several (e.g. a CSV row per company) */
  subject: string | null;
  locator: string;
  excerpt: string;
  /** true when the value is blank / N/A / TBD in the source */
  isBlank: boolean;
  origin: 'parser' | 'llm';
}

/** Output of a document extractor, before chunking and fact extraction. */
export interface ExtractionResult {
  text: string;
  pageCount: number | null;
  /** optional page boundaries (char offsets) so chunks can carry page locators */
  pageOffsets?: number[];
  /** structured rows for tabular sources (CSV) */
  rows?: Record<string, string>[];
  warnings: string[];
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export type { AnalysisResult, Finding, SourceRef, FindingKind } from './ai/schema.js';
