import path from 'node:path';
import type { DocumentKind } from '../types.js';

/**
 * File validation is defence-in-depth:
 *  1. extension allow-list
 *  2. declared MIME type must be consistent with the extension (browsers vary, so we accept known aliases)
 *  3. magic-byte sniffing — the bytes must actually look like the claimed format
 *  4. size limits (also enforced earlier by multer)
 * Text formats must decode as UTF-8 without binary control characters.
 */

interface FormatRule {
  kind: DocumentKind;
  mimes: string[];
  sniff: (buf: Buffer) => boolean;
}

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);

const isPdf = (b: Buffer) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const isPng = (b: Buffer) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isJpeg = (b: Buffer) => startsWith(b, [0xff, 0xd8, 0xff]);

/** Heuristic "is this human-readable text?" check on the first 8KB. */
export function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false; // NUL never appears in real text files
    // allow tab, LF, CR, form feed; flag other C0 control chars
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) suspicious++;
  }
  if (suspicious / sample.length > 0.01) return false;
  // must be valid UTF-8 (TextDecoder in fatal mode throws on invalid sequences)
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, safeUtf8Cut(sample)));
    return true;
  } catch {
    return false;
  }
}

/** Avoid failing UTF-8 validation because the 8KB sample cut a multi-byte char in half. */
function safeUtf8Cut(buf: Buffer): number {
  let end = buf.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const b = buf[end - i]!;
    if ((b & 0xc0) === 0xc0) return end - i; // lead byte of a possibly truncated sequence
    if ((b & 0x80) === 0) break;
  }
  return end;
}

const RULES: Record<string, FormatRule> = {
  '.pdf': { kind: 'pdf', mimes: ['application/pdf', 'application/x-pdf'], sniff: isPdf },
  '.txt': { kind: 'text', mimes: ['text/plain'], sniff: looksLikeText },
  '.md': { kind: 'text', mimes: ['text/markdown', 'text/x-markdown', 'text/plain'], sniff: looksLikeText },
  '.csv': {
    kind: 'csv',
    mimes: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'text/x-csv'],
    sniff: looksLikeText,
  },
  '.png': { kind: 'image', mimes: ['image/png'], sniff: isPng },
  '.jpg': { kind: 'image', mimes: ['image/jpeg', 'image/pjpeg'], sniff: isJpeg },
  '.jpeg': { kind: 'image', mimes: ['image/jpeg', 'image/pjpeg'], sniff: isJpeg },
};

export const SUPPORTED_EXTENSIONS = Object.keys(RULES);

export type ValidationResult =
  | { ok: true; kind: DocumentKind; safeName: string; mimeType: string }
  | { ok: false; code: string; reason: string; safeName: string };

/** Strip paths, control chars and anything outside a conservative character set. Never used as a filesystem path. */
export function sanitizeFilename(original: string): string {
  const base = path.basename(original.replace(/\\/g, '/'));
  const cleaned = base
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N}._\- ()]/gu, '_')
    .replace(/^\.+/, '')
    .trim();
  const limited = cleaned.slice(-120);
  return limited.length > 0 ? limited : 'unnamed';
}

export function validateFile(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, maxBytes: number): ValidationResult {
  const safeName = sanitizeFilename(file.originalname);
  const ext = path.extname(safeName).toLowerCase();
  const rule = RULES[ext];

  if (!rule) {
    return {
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      reason: `Unsupported file type "${ext || 'none'}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      safeName,
    };
  }
  if (file.size === 0 || file.buffer.length === 0) {
    return { ok: false, code: 'EMPTY_FILE', reason: 'File is empty.', safeName };
  }
  if (file.size > maxBytes) {
    return { ok: false, code: 'FILE_TOO_LARGE', reason: `File exceeds ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit.`, safeName };
  }
  const declared = (file.mimetype || '').toLowerCase();
  if (declared && declared !== 'application/octet-stream' && !rule.mimes.includes(declared)) {
    return {
      ok: false,
      code: 'MIME_MISMATCH',
      reason: `Declared content type "${declared}" does not match extension ${ext}.`,
      safeName,
    };
  }
  if (!rule.sniff(file.buffer)) {
    return {
      ok: false,
      code: 'CONTENT_MISMATCH',
      reason: `File content does not look like a valid ${ext} file (it may be corrupted or renamed).`,
      safeName,
    };
  }
  return { ok: true, kind: rule.kind, safeName, mimeType: rule.mimes[0]! };
}
