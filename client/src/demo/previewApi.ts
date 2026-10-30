/**
 * Browser-only implementation of the API used by the live preview build.
 * It runs the SAME pipeline modules as the server (validation, cleaning, chunking, fact
 * extraction, comparison, provenance verification, zod schema) but keeps data in memory
 * instead of SQLite and parses PDFs with pdf.js in the browser. Image OCR is server-only.
 */
import Papa from 'papaparse';
import * as pdfjs from 'pdfjs-dist';
import workerSource from 'pdfjs-dist/build/pdf.worker.min.js?raw';
import { runAnalysis, type DocumentContext } from '../../../server/src/ai/analyze';
import { chunkDocument } from '../../../server/src/pipeline/chunk';
import { extractFactsFromRows, extractFactsFromText } from '../../../server/src/pipeline/facts';
import { cleanText } from '../../../server/src/pipeline/normalize';
import { validateFile } from '../../../server/src/pipeline/validate';
import type { StoredDocument } from '../../../server/src/types';
import { ApiError } from '../lib/apiError';
import type { AnalysisListItem, AnalysisResult, DocumentInfo, Health, UploadResponse } from '../lib/types';
import sampleDriving from '../../../samples/driving_licence.txt?raw';
import sampleFinancials from '../../../samples/financial_statements_fy2026.csv?raw';
import samplePeers from '../../../samples/peer_company_financials.csv?raw';
import sampleSanction from '../../../samples/loan_sanction_terms.txt?raw';
import sampleFormPdf from '../../../samples/loan_application_form.pdf?inline';

export { ApiError };

pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));

const MAX_BYTES = 10 * 1024 * 1024;
const PREVIEW_EXTENSIONS = ['.pdf', '.txt', '.md', '.csv'];

const docs: DocumentContext[] = [];
const analyses: { id: string; instruction: string; createdAt: string; result: AnalysisResult }[] = [];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

class PreviewExtractionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function extractPdf(bytes: Uint8Array) {
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password/i.test(msg)) throw new PreviewExtractionError('ENCRYPTED_PDF', 'PDF is password-protected and cannot be read.');
    throw new PreviewExtractionError('UNREADABLE_PDF', `PDF could not be parsed (${msg.slice(0, 120)}).`);
  }
  const pages: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 200); p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    let lastY: number | undefined;
    let text = '';
    for (const item of content.items as { str?: string; transform?: number[] }[]) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5];
      text += lastY === undefined || lastY === y ? item.str : `\n${item.str}`;
      lastY = y;
    }
    pages.push(cleanText(text));
  }
  const pageOffsets: number[] = [];
  let text = '';
  pages.forEach((pg, i) => {
    pageOffsets.push(text.length);
    text += pg + (i < pages.length - 1 ? '\n\n' : '');
  });
  if (text.replace(/\s/g, '').length < 20)
    throw new PreviewExtractionError('NO_TEXT_LAYER', 'PDF contains no extractable text (it may be a scanned image).');
  return { text, pageCount: doc.numPages, pageOffsets, warnings: [] as string[] };
}

function extractCsv(raw: string) {
  const result = Papa.parse<Record<string, string>>(raw.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  const headers = (result.meta.fields ?? []).filter(Boolean);
  if (headers.length === 0 || result.data.length === 0) throw new PreviewExtractionError('EMPTY_CSV', 'CSV has no header row or no data rows.');
  const rows = result.data.slice(0, 5000).map((r) => Object.fromEntries(headers.map((h) => [h, String(r[h] ?? '').trim()])));
  const text = [`Columns: ${headers.join(' | ')}`, ...rows.map((r, i) => `Row ${i + 1}: ${headers.map((h) => `${h}: ${r[h]}`).join(' | ')}`)].join('\n');
  return { text, rows, pageCount: null, warnings: result.errors.slice(0, 5).map((e) => `CSV row ${(e.row ?? 0) + 2}: ${e.message}`) };
}

const toInfo = (d: StoredDocument): DocumentInfo => ({ ...d });

async function ingest(name: string, mimetype: string, bytes: Uint8Array): Promise<
  { ok: true; doc: StoredDocument; duplicate: boolean } | { ok: false; filename: string; code: string; reason: string }
> {
  const v = validateFile({ originalname: name, mimetype, size: bytes.length, buffer: bytes as unknown as Buffer }, MAX_BYTES);
  if (!v.ok) return { ok: false, filename: v.safeName, code: v.code, reason: v.reason };
  if (v.kind === 'image')
    return { ok: false, filename: v.safeName, code: 'OCR_SERVER_ONLY', reason: 'Image OCR runs in the full server deployment. This browser preview reads PDF, TXT, MD and CSV.' };

  const hash = await sha256(bytes);
  const dup = docs.find((d) => d.doc.sha256 === hash);
  if (dup) return { ok: true, doc: dup.doc, duplicate: true };

  const base = { id: uid(), workspaceId: 'preview', filename: v.safeName, kind: v.kind, mimeType: v.mimeType, sizeBytes: bytes.length, sha256: hash, createdAt: new Date().toISOString() };
  try {
    const extracted =
      v.kind === 'pdf' ? await extractPdf(bytes) : v.kind === 'csv' ? extractCsv(new TextDecoder().decode(bytes)) : { text: new TextDecoder().decode(bytes).replace(/^﻿/, ''), pageCount: null, warnings: [] as string[] };
    const warnings = [...extracted.warnings];
    let text = cleanText(extracted.text);
    if (!text.trim()) throw new PreviewExtractionError('EMPTY_TEXT', 'The document contains no readable text.');
    let truncated = false;
    if (text.length > 200_000) {
      text = text.slice(0, 200_000);
      truncated = true;
      warnings.push('Document text truncated to 200,000 characters.');
    }
    const pageOffsets = 'pageOffsets' in extracted ? extracted.pageOffsets : undefined;
    const chunks = chunkDocument(base.id, text, { pageOffsets, isTabular: v.kind === 'csv' });
    const rawFacts = 'rows' in extracted && extracted.rows ? extractFactsFromRows(extracted.rows) : extractFactsFromText(text, pageOffsets);
    const doc: StoredDocument = { ...base, status: 'ready', error: null, charCount: text.length, pageCount: extracted.pageCount, truncated, warnings };
    docs.push({ doc, content: text, chunks, facts: rawFacts.map((f) => ({ ...f, documentId: doc.id })) });
    return { ok: true, doc, duplicate: false };
  } catch (e) {
    const code = e instanceof PreviewExtractionError ? e.code : 'EXTRACTION_FAILED';
    const reason = e instanceof PreviewExtractionError ? e.message : 'The document could not be read.';
    const doc: StoredDocument = { ...base, status: 'failed', error: reason, charCount: 0, pageCount: null, truncated: false, warnings: [] };
    docs.push({ doc, content: '', chunks: [], facts: [] });
    return { ok: false, filename: v.safeName, code, reason };
  }
}

const list = () => docs.map((d) => toInfo(d.doc));

function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const SAMPLES: [string, () => Uint8Array][] = [
  ['loan_application_form.pdf', () => dataUrlToBytes(sampleFormPdf)],
  ['driving_licence.txt', () => new TextEncoder().encode(sampleDriving)],
  ['financial_statements_fy2026.csv', () => new TextEncoder().encode(sampleFinancials)],
  ['loan_sanction_terms.txt', () => new TextEncoder().encode(sampleSanction)],
  ['peer_company_financials.csv', () => new TextEncoder().encode(samplePeers)],
];

export const api = {
  health: async (): Promise<Health> => ({
    status: 'ok',
    provider: 'preview',
    model: null,
    supportedExtensions: PREVIEW_EXTENSIONS,
    limits: { maxFileSizeMb: 10, maxFilesPerUpload: 10, maxPromptChars: 2000 },
  }),
  createWorkspace: async () => ({ id: 'preview' }),
  listDocuments: async (_ws: string) => ({ documents: list() }),
  upload: async (_ws: string, files: File[]): Promise<UploadResponse> => {
    if (files.length > 10) throw new ApiError(400, 'LIMIT_FILE_COUNT', 'At most 10 files can be uploaded at once.');
    const accepted: UploadResponse['accepted'] = [];
    const rejected: UploadResponse['rejected'] = [];
    for (const f of files) {
      const r = await ingest(f.name, f.type, new Uint8Array(await f.arrayBuffer()));
      if (r.ok) accepted.push({ document: toInfo(r.doc), duplicate: r.duplicate });
      else rejected.push({ filename: r.filename, code: r.code, reason: r.reason });
    }
    return { accepted, rejected, documents: list() };
  },
  loadSamples: async (_ws: string) => {
    let loaded = 0;
    for (const [name, bytes] of SAMPLES) if ((await ingest(name, '', bytes())).ok) loaded++;
    return { loaded, documents: list() };
  },
  listSamples: async () => ({ files: [] as string[] }),
  deleteDocument: async (_ws: string, id: string) => {
    const i = docs.findIndex((d) => d.doc.id === id);
    if (i < 0) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    docs.splice(i, 1);
  },
  analyze: async (_ws: string, instruction: string, documentIds: string[]) => {
    const text = instruction.trim();
    if (text.length < 5) throw new ApiError(400, 'VALIDATION_ERROR', 'Instruction must be at least 5 characters');
    const selected = docs.filter((d) => d.doc.status === 'ready' && documentIds.includes(d.doc.id));
    if (selected.length === 0) throw new ApiError(400, 'NO_DOCUMENTS', 'Upload at least one readable document before analysing.');
    const result = (await runAnalysis(text, selected)) as unknown as AnalysisResult;
    result.meta.provider = 'preview';
    const id = uid();
    analyses.unshift({ id, instruction: text, createdAt: new Date().toISOString(), result });
    return { id, result };
  },
  listAnalyses: async (_ws: string) => ({
    analyses: analyses.map<AnalysisListItem>((a) => ({ id: a.id, instruction: a.instruction, provider: 'preview', createdAt: a.createdAt, status: 'completed' })),
  }),
  getAnalysis: async (_ws: string, id: string) => ({ id, result: analyses.find((a) => a.id === id)?.result ?? null }),
};
