import { createHash } from 'node:crypto';
import { config } from '../config.js';
import type { Repository } from '../db/repository.js';
import type { DocumentKind, StoredDocument } from '../types.js';
import { chunkDocument } from './chunk.js';
import { EXTRACTORS, ExtractionError } from './extractors.js';
import { extractFactsFromRows, extractFactsFromText } from './facts.js';
import { cleanText } from './normalize.js';
import { validateFile } from './validate.js';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export type IngestOutcome =
  | { status: 'accepted'; document: StoredDocument; duplicate?: boolean }
  | { status: 'rejected'; filename: string; code: string; reason: string; document?: StoredDocument };

/**
 * Pipeline per file:  validate -> extract -> clean -> truncate -> chunk -> extract facts -> persist
 * Each file is processed independently; one bad file never fails the batch.
 * Raw bytes are only held in memory for the duration of this call and are never written to disk.
 */
export async function ingestFile(repo: Repository, workspaceId: string, file: UploadedFile): Promise<IngestOutcome> {
  const validation = validateFile(file, config.limits.maxFileSizeBytes);
  if (!validation.ok) {
    return { status: 'rejected', filename: validation.safeName, code: validation.code, reason: validation.reason };
  }

  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const existing = repo.findDocumentByHash(workspaceId, sha256);
  if (existing) return { status: 'accepted', document: existing, duplicate: true };

  const base = {
    workspaceId,
    filename: validation.safeName,
    kind: validation.kind as DocumentKind,
    mimeType: validation.mimeType,
    sizeBytes: file.size,
    sha256,
  };

  try {
    const extracted = await EXTRACTORS[validation.kind](file.buffer);
    const warnings = [...extracted.warnings];
    let text = cleanText(extracted.text);
    let truncated = false;
    if (text.length > config.limits.maxDocChars) {
      text = text.slice(0, config.limits.maxDocChars);
      truncated = true;
      warnings.push(`Document text truncated to ${config.limits.maxDocChars.toLocaleString()} characters.`);
    }

    // cleanText only trims ends / collapses blank runs, so page offsets stay approximately aligned;
    // recompute them conservatively by clamping to the cleaned text length.
    const pageOffsets = extracted.pageOffsets?.map((o) => Math.min(o, text.length));
    const chunks = chunkDocument('pending', text, { pageOffsets, isTabular: validation.kind === 'csv' });
    const facts = extracted.rows ? extractFactsFromRows(extracted.rows) : extractFactsFromText(text, pageOffsets);
    if (facts.filter((f) => !f.field.startsWith('mentioned_')).length === 0) {
      warnings.push('No labelled fields were detected; analysis will rely on free text.');
    }

    const document = repo.insertDocument({
      ...base,
      status: 'ready',
      content: text,
      pageCount: extracted.pageCount,
      truncated,
      warnings,
      chunks: chunks.map(({ index, text: t, locator }) => ({ index, text: t, locator })),
      facts,
    });
    return { status: 'accepted', document };
  } catch (e) {
    const code = e instanceof ExtractionError ? e.code : 'EXTRACTION_FAILED';
    const reason = e instanceof ExtractionError ? e.message : 'The document could not be read.';
    if (!(e instanceof ExtractionError)) console.error('[ingest] unexpected extraction error', e);
    // Persist the failure so the user sees it in the document list with a reason.
    const document = repo.insertDocument({ ...base, status: 'failed', error: reason });
    return { status: 'rejected', filename: validation.safeName, code, reason, document };
  }
}
