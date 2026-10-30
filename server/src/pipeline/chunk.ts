import type { Chunk } from '../types.js';

/**
 * Split a document into located chunks. Locators are human-readable
 * ("page 2, lines 1-38", "rows 1-20") and are what findings cite back to.
 * Chunks never cross page boundaries and never mix documents.
 */
export interface ChunkOptions {
  maxChars?: number;
  pageOffsets?: number[];
  isTabular?: boolean;
}

export function pageForOffset(offset: number, pageOffsets?: number[]): number | null {
  if (!pageOffsets || pageOffsets.length === 0) return null;
  let page = 1;
  for (let i = 0; i < pageOffsets.length; i++) if (offset >= pageOffsets[i]!) page = i + 1;
  return page;
}

export function chunkDocument(documentId: string, text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 1500;
  const lines = text.split('\n');
  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let startLine = 1;
  let startPage: number | null = null;
  let offset = 0;
  let size = 0;

  const label = (from: number, to: number, page: number | null) => {
    if (opts.isTabular) {
      // CSV text rendering: line 1 is the column header, line n+1 is data row n
      const a = Math.max(1, from - 1);
      const b = Math.max(1, to - 1);
      return a === b ? `row ${a}` : `rows ${a}-${b}`;
    }
    const range = from === to ? `line ${from}` : `lines ${from}-${to}`;
    return page ? `page ${page}, ${range}` : range;
  };

  const flush = (endLine: number) => {
    if (buf.length === 0) return;
    const t = buf.join('\n');
    if (t.trim()) chunks.push({ documentId, index: chunks.length, text: t, locator: label(startLine, endLine, startPage) });
    buf = [];
    size = 0;
  };

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const page = pageForOffset(offset, opts.pageOffsets);
    if (buf.length === 0) {
      startLine = lineNo;
      startPage = page;
    } else if (page !== startPage || size + line.length > maxChars) {
      flush(lineNo - 1);
      startLine = lineNo;
      startPage = page;
    }
    // A single very long line is hard-split so no chunk exceeds the budget.
    if (line.length > maxChars) {
      for (let p = 0; p < line.length; p += maxChars) {
        buf.push(line.slice(p, p + maxChars));
        flush(lineNo);
        startLine = lineNo;
        startPage = page;
      }
    } else {
      buf.push(line);
      size += line.length + 1;
    }
    offset += line.length + 1;
  });
  flush(lines.length);
  return chunks;
}
