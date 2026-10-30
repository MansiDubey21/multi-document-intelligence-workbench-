import Papa from 'papaparse';
// Import the library entry directly: pdf-parse's index.js runs a debug self-test when not required as a child module.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import { config } from '../config.js';
import type { DocumentKind, ExtractionResult } from '../types.js';
import { cleanText } from './normalize.js';

/**
 * Extractors turn validated bytes into plain text (+ page/row structure where available).
 * Each one is independent and registered by DocumentKind, so new formats (DOCX, XLSX…)
 * can be added without touching the rest of the pipeline.
 */
export type Extractor = (buf: Buffer) => Promise<ExtractionResult>;

export class ExtractionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

/* ---------------- PDF ---------------- */

interface PdfTextItem {
  str: string;
  transform: number[];
}

// pdf-parse bundles several pdf.js builds. v2.0.550 is preferred, v1.10.100 is the fallback.
// Each is attempted twice: the bundled pdf.js fails the FIRST parse in a fresh process with a
// spurious "bad XRef entry" (cold-start quirk, reproducible), and succeeds on retry.
const PDFJS_VERSIONS = ['v2.0.550', 'v2.0.550', 'v1.10.100', 'v1.10.100'] as const;

async function parsePages(buf: Buffer, version: string): Promise<{ numpages: number; pages: string[] }> {
  const pages: string[] = [];
  const parsed = await pdfParse(buf, {
    version,
    max: 200, // hard cap on pages processed
    pagerender: async (pageData: { getTextContent: (o: object) => Promise<{ items: PdfTextItem[] }> }) => {
      const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      let lastY: number | undefined;
      let text = '';
      for (const item of content.items) {
        const y = item.transform[5];
        text += lastY === undefined || lastY === y ? item.str : `\n${item.str}`;
        lastY = y;
      }
      pages.push(text);
      return text;
    },
  });
  return { numpages: parsed.numpages, pages };
}

const extractPdf: Extractor = async (buf) => {
  let pages: string[] = [];
  let parsed: { numpages: number } | null = null;
  let lastErr: unknown;
  for (const version of PDFJS_VERSIONS) {
    try {
      const r = await parsePages(buf, version);
      parsed = r;
      pages = r.pages;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!parsed) {
    const e = lastErr;
    const msg = e instanceof Error ? e.message : String(e);
    if (/password/i.test(msg)) throw new ExtractionError('ENCRYPTED_PDF', 'PDF is password-protected and cannot be read.');
    throw new ExtractionError('UNREADABLE_PDF', `PDF could not be parsed (${msg.slice(0, 120)}).`);
  }

  const warnings: string[] = [];
  const pageOffsets: number[] = [];
  let text = '';
  // Clean each page before joining so page offsets stay aligned with the final text.
  pages.map(cleanText).forEach((p, i) => {
    pageOffsets.push(text.length);
    text += p + (i < pages.length - 1 ? '\n\n' : '');
  });
  if (parsed.numpages > pages.length) warnings.push(`Only the first ${pages.length} of ${parsed.numpages} pages were processed.`);
  if (text.replace(/\s/g, '').length < 20) {
    throw new ExtractionError(
      'NO_TEXT_LAYER',
      'PDF contains no extractable text (it may be a scanned image). Upload it as PNG/JPG to use OCR.',
    );
  }
  return { text, pageCount: parsed.numpages, pageOffsets, warnings };
};

/** Parse a tiny in-memory PDF at boot so the pdf.js cold-start quirk never reaches a user upload. */
export async function warmUpPdfEngine(): Promise<void> {
  const minimal = Buffer.from(
    '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
  );
  for (const v of ['v2.0.550', 'v1.10.100']) await pdfParse(minimal, { version: v }).catch(() => undefined);
}

/* ---------------- Plain text / Markdown ---------------- */

const extractText: Extractor = async (buf) => {
  const text = buf.toString('utf8').replace(/^﻿/, '');
  if (text.trim().length === 0) throw new ExtractionError('EMPTY_TEXT', 'Text file contains no readable content.');
  return { text, pageCount: null, warnings: [] };
};

/* ---------------- CSV ---------------- */

const extractCsv: Extractor = async (buf) => {
  const raw = buf.toString('utf8').replace(/^﻿/, '');
  const result = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const headers = (result.meta.fields ?? []).filter(Boolean);
  if (headers.length === 0 || result.data.length === 0) {
    throw new ExtractionError('EMPTY_CSV', 'CSV has no header row or no data rows.');
  }
  const warnings = result.errors.slice(0, 5).map((e) => `CSV row ${(e.row ?? 0) + 2}: ${e.message}`);
  const rows = result.data.slice(0, 5000).map((r) => {
    const clean: Record<string, string> = {};
    for (const h of headers) clean[h] = String(r[h] ?? '').trim();
    return clean;
  });
  if (result.data.length > 5000) warnings.push(`Only the first 5000 of ${result.data.length} rows were processed.`);

  // A readable text rendering that keeps row numbers (row 1 = first data row) for provenance.
  const text = [
    `Columns: ${headers.join(' | ')}`,
    ...rows.map((r, i) => `Row ${i + 1}: ${headers.map((h) => `${h}: ${r[h]}`).join(' | ')}`),
  ].join('\n');
  return { text, rows, pageCount: null, warnings };
};

/* ---------------- Images (OCR) ---------------- */

function bundledLangOptions(): { langPath: string; gzip: boolean } | Record<string, never> {
  try {
    const pkg = createRequire(import.meta.url).resolve('@tesseract.js-data/eng/package.json');
    return { langPath: path.join(path.dirname(pkg), '4.0.0_best_int'), gzip: true };
  } catch {
    return {}; // fall back to tesseract.js default (CDN download)
  }
}

const extractImage: Extractor = async (buf) => {
  if (!config.ocr.enabled) throw new ExtractionError('OCR_DISABLED', 'Image OCR is disabled on this server.');
  const { createWorker } = await import('tesseract.js');
  // Language data ships with the app (npm @tesseract.js-data/eng) so OCR never depends on a CDN at
  // runtime. OCR_LANG_PATH can point at an uncompressed eng.traineddata directory instead.
  const langOptions = config.ocr.langPath ? { langPath: config.ocr.langPath, gzip: false } : bundledLangOptions();
  // Worker errors are delivered asynchronously; without an errorHandler tesseract.js rethrows them
  // on the event loop and crashes the process. Capture them and fail this one document instead.
  // If the language data cannot be loaded, tesseract.js may report via errorHandler and never settle
  // its startup promise, so startup races the error callback and a timeout and always fails fast.
  let failStartup: (err: unknown) => void = () => undefined;
  const startupFailed = new Promise<never>((_, rej) => (failStartup = rej));
  const startupTimeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('startup timed out')), 30_000).unref());
  const pending = createWorker('eng', 1, {
    ...langOptions,
    cacheMethod: 'none',
    errorHandler: (err: unknown) => failStartup(err),
  });
  let worker: Awaited<typeof pending>;
  try {
    worker = await Promise.race([pending, startupFailed, startupTimeout]);
  } catch (e) {
    // If the worker comes up later anyway, shut it down so no thread is leaked.
    pending.then((w) => w.terminate()).catch(() => undefined);
    throw new ExtractionError('OCR_UNAVAILABLE', `Image text recognition is unavailable on this server (${String(e instanceof Error ? e.message : e).slice(0, 100)}).`);
  }
  try {
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new ExtractionError('OCR_TIMEOUT', 'OCR took too long on this image.')), 90_000),
    );
    const { data } = await Promise.race([worker.recognize(buf), timeout]);
    const text = data.text ?? '';
    const warnings: string[] = [];
    if (data.confidence < 60) warnings.push(`Low OCR confidence (${Math.round(data.confidence)}%). Values may be misread.`);
    if (text.replace(/\s/g, '').length < 10) throw new ExtractionError('NO_TEXT_FOUND', 'No readable text was found in the image.');
    return { text, pageCount: 1, warnings };
  } catch (e) {
    if (e instanceof ExtractionError) throw e;
    throw new ExtractionError('OCR_FAILED', `Image could not be processed (${e instanceof Error ? e.message.slice(0, 100) : 'unknown error'}).`);
  } finally {
    await worker.terminate().catch(() => undefined);
  }
};

export const EXTRACTORS: Record<DocumentKind, Extractor> = {
  pdf: extractPdf,
  text: extractText,
  csv: extractCsv,
  image: extractImage,
};
