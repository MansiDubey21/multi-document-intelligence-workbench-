import { randomUUID } from 'node:crypto';
import type { DB } from './index.js';
import type { AnalysisResult, Chunk, DocumentKind, ExtractedFact, StoredDocument } from '../types.js';

interface DocumentRow {
  id: string;
  workspace_id: string;
  filename: string;
  kind: DocumentKind;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: 'ready' | 'failed';
  error: string | null;
  char_count: number;
  page_count: number | null;
  truncated: number;
  warnings: string;
  created_at: string;
}

interface FactRow {
  document_id: string;
  field: string;
  label: string;
  value: string;
  normalized: string | null;
  type: ExtractedFact['type'];
  subject: string | null;
  locator: string;
  excerpt: string;
  is_blank: number;
}

const toDocument = (r: DocumentRow): StoredDocument => ({
  id: r.id,
  workspaceId: r.workspace_id,
  filename: r.filename,
  kind: r.kind,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  sha256: r.sha256,
  status: r.status,
  error: r.error,
  charCount: r.char_count,
  pageCount: r.page_count,
  truncated: r.truncated === 1,
  warnings: JSON.parse(r.warnings) as string[],
  createdAt: r.created_at,
});

export interface NewDocument {
  workspaceId: string;
  filename: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: 'ready' | 'failed';
  error?: string | null;
  content?: string;
  pageCount?: number | null;
  truncated?: boolean;
  warnings?: string[];
  chunks?: Omit<Chunk, 'documentId'>[];
  facts?: Omit<ExtractedFact, 'documentId'>[];
}

export interface AnalysisSummaryRow {
  id: string;
  instruction: string;
  provider: string;
  model: string | null;
  status: string;
  createdAt: string;
  documentIds: string[];
}

/** Thin data-access layer. All SQL uses bound parameters (no string interpolation of user input). */
export class Repository {
  constructor(private readonly db: DB) {}

  createWorkspace(name: string): { id: string; name: string } {
    const id = randomUUID();
    this.db.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)').run(id, name);
    return { id, name };
  }

  workspaceExists(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(id);
  }

  countDocuments(workspaceId: string): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM documents WHERE workspace_id = ?').get(workspaceId) as { n: number };
    return r.n;
  }

  findDocumentByHash(workspaceId: string, sha256: string): StoredDocument | null {
    const r = this.db
      .prepare('SELECT * FROM documents WHERE workspace_id = ? AND sha256 = ?')
      .get(workspaceId, sha256) as DocumentRow | undefined;
    return r ? toDocument(r) : null;
  }

  insertDocument(d: NewDocument): StoredDocument {
    const id = randomUUID();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO documents (id, workspace_id, filename, kind, mime_type, size_bytes, sha256, status, error,
             char_count, page_count, truncated, warnings, content)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          d.workspaceId,
          d.filename,
          d.kind,
          d.mimeType,
          d.sizeBytes,
          d.sha256,
          d.status,
          d.error ?? null,
          d.content?.length ?? 0,
          d.pageCount ?? null,
          d.truncated ? 1 : 0,
          JSON.stringify(d.warnings ?? []),
          d.content ?? '',
        );
      const insChunk = this.db.prepare('INSERT INTO document_chunks (document_id, idx, locator, text) VALUES (?, ?, ?, ?)');
      for (const c of d.chunks ?? []) insChunk.run(id, c.index, c.locator, c.text);
      const insFact = this.db.prepare(
        `INSERT INTO extracted_facts (document_id, field, label, value, normalized, type, subject, locator, excerpt, is_blank)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const f of d.facts ?? [])
        insFact.run(id, f.field, f.label, f.value, f.normalized, f.type, f.subject, f.locator, f.excerpt, f.isBlank ? 1 : 0);
    });
    tx();
    return this.getDocument(d.workspaceId, id)!;
  }

  getDocument(workspaceId: string, id: string): StoredDocument | null {
    const r = this.db
      .prepare('SELECT * FROM documents WHERE workspace_id = ? AND id = ?')
      .get(workspaceId, id) as DocumentRow | undefined;
    return r ? toDocument(r) : null;
  }

  listDocuments(workspaceId: string): StoredDocument[] {
    const rows = this.db
      .prepare('SELECT * FROM documents WHERE workspace_id = ? ORDER BY created_at ASC')
      .all(workspaceId) as DocumentRow[];
    return rows.map(toDocument);
  }

  deleteDocument(workspaceId: string, id: string): boolean {
    return this.db.prepare('DELETE FROM documents WHERE workspace_id = ? AND id = ?').run(workspaceId, id).changes > 0;
  }

  getContent(documentId: string): string {
    const r = this.db.prepare('SELECT content FROM documents WHERE id = ?').get(documentId) as { content: string } | undefined;
    return r?.content ?? '';
  }

  getChunks(documentId: string): Chunk[] {
    const rows = this.db
      .prepare('SELECT idx, locator, text FROM document_chunks WHERE document_id = ? ORDER BY idx')
      .all(documentId) as { idx: number; locator: string; text: string }[];
    return rows.map((r) => ({ documentId, index: r.idx, locator: r.locator, text: r.text }));
  }

  getFacts(documentId: string): ExtractedFact[] {
    const rows = this.db.prepare('SELECT * FROM extracted_facts WHERE document_id = ? ORDER BY id').all(documentId) as FactRow[];
    return rows.map((r) => ({
      documentId: r.document_id,
      field: r.field,
      label: r.label,
      value: r.value,
      normalized: r.normalized,
      type: r.type,
      subject: r.subject,
      locator: r.locator,
      excerpt: r.excerpt,
      isBlank: r.is_blank === 1,
      origin: 'parser',
    }));
  }

  saveAnalysis(args: {
    workspaceId: string;
    instruction: string;
    documentIds: string[];
    provider: string;
    model: string | null;
    status: 'completed' | 'failed';
    error?: string;
    result?: AnalysisResult;
    durationMs: number;
  }): string {
    const id = randomUUID();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO analyses (id, workspace_id, instruction, document_ids, provider, model, status, error, result, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          args.workspaceId,
          args.instruction,
          JSON.stringify(args.documentIds),
          args.provider,
          args.model,
          args.status,
          args.error ?? null,
          args.result ? JSON.stringify(args.result) : null,
          args.durationMs,
        );
      if (args.result) {
        const ins = this.db.prepare(
          `INSERT INTO finding_sources (analysis_id, finding_id, category, kind, document_id, locator, excerpt, verified)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const all = [...args.result.discrepancies, ...args.result.missingInformation, ...args.result.summary.points];
        for (const f of all)
          for (const s of f.sources) ins.run(id, f.id, f.category, f.kind, s.documentId, s.locator, s.excerpt, s.verified ? 1 : 0);
      }
    });
    tx();
    return id;
  }

  listAnalyses(workspaceId: string): AnalysisSummaryRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, instruction, provider, model, status, created_at, document_ids
         FROM analyses WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .all(workspaceId) as {
      id: string;
      instruction: string;
      provider: string;
      model: string | null;
      status: string;
      created_at: string;
      document_ids: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      instruction: r.instruction,
      provider: r.provider,
      model: r.model,
      status: r.status,
      createdAt: r.created_at,
      documentIds: JSON.parse(r.document_ids) as string[],
    }));
  }

  getAnalysis(workspaceId: string, id: string): (AnalysisSummaryRow & { result: AnalysisResult | null; error: string | null }) | null {
    const r = this.db.prepare('SELECT * FROM analyses WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as
      | {
          id: string;
          instruction: string;
          provider: string;
          model: string | null;
          status: string;
          created_at: string;
          document_ids: string;
          result: string | null;
          error: string | null;
        }
      | undefined;
    if (!r) return null;
    return {
      id: r.id,
      instruction: r.instruction,
      provider: r.provider,
      model: r.model,
      status: r.status,
      createdAt: r.created_at,
      documentIds: JSON.parse(r.document_ids) as string[],
      result: r.result ? (JSON.parse(r.result) as AnalysisResult) : null,
      error: r.error,
    };
  }
}
