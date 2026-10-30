import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config } from '../config.js';
import type { Repository } from '../db/repository.js';
import { loadContexts, runAnalysis } from '../ai/analyze.js';
import { ingestFile } from '../pipeline/ingest.js';
import { SUPPORTED_EXTENSIONS } from '../pipeline/validate.js';
import { AppError } from '../types.js';

const uuid = z.string().uuid();

/* ---------- bundled synthetic samples (fixed allow-list; user input never becomes a path) ---------- */
const SAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../samples');
export const SAMPLE_FILES = [
  'loan_application_form.pdf',
  'driving_licence.txt',
  'financial_statements_fy2026.csv',
  'bank_reference_letter.png',
  'loan_sanction_terms.txt',
  'peer_company_financials.csv',
] as const;
const DEMO_SET = SAMPLE_FILES.slice(0, 4);

export async function readSample(name: string): Promise<Buffer | null> {
  if (!(SAMPLE_FILES as readonly string[]).includes(name)) return null;
  return fs.readFile(path.join(SAMPLES_DIR, name)).catch(() => null);
}

const CreateWorkspaceBody = z.object({ name: z.string().trim().min(1).max(100).optional() });
const AnalyzeBody = z.object({
  instruction: z
    .string()
    .trim()
    .min(5, 'Instruction must be at least 5 characters')
    .max(config.limits.maxPromptChars, `Instruction must be at most ${config.limits.maxPromptChars} characters`),
  documentIds: z.array(uuid).min(1).max(config.limits.maxDocsPerWorkspace).optional(),
});

// Memory storage: uploads never touch the filesystem; only extracted text is persisted.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.maxFileSizeBytes, files: config.limits.maxFilesPerUpload, fields: 5, parts: config.limits.maxFilesPerUpload + 5 },
});

const asyncH = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

export function workspaceRouter(repo: Repository): Router {
  const r = Router();

  const requireWorkspace = (req: Request): string => {
    const id = uuid.safeParse(req.params.workspaceId);
    if (!id.success || !repo.workspaceExists(id.data)) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    return id.data;
  };

  r.post('/', (req, res) => {
    const body = CreateWorkspaceBody.parse(req.body ?? {});
    res.status(201).json(repo.createWorkspace(body.name ?? 'Untitled workspace'));
  });

  r.get('/:workspaceId/documents', (req, res) => {
    const ws = requireWorkspace(req);
    res.json({ documents: repo.listDocuments(ws) });
  });

  r.post(
    '/:workspaceId/documents',
    (req, res, next) => {
      upload.array('files', config.limits.maxFilesPerUpload)(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          const messages: Partial<Record<string, string>> = {
            LIMIT_FILE_SIZE: `A file exceeds the ${config.limits.maxFileSizeBytes / 1024 / 1024} MB limit.`,
            LIMIT_FILE_COUNT: `At most ${config.limits.maxFilesPerUpload} files can be uploaded at once.`,
            LIMIT_UNEXPECTED_FILE: 'Files must be sent in the "files" field.',
          };
          return next(new AppError(400, err.code, messages[err.code] ?? err.message));
        }
        next(err as Error | undefined);
      });
    },
    asyncH(async (req, res) => {
      const ws = requireWorkspace(req);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) throw new AppError(400, 'NO_FILES', `No files received. Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}`);
      if (repo.countDocuments(ws) + files.length > config.limits.maxDocsPerWorkspace)
        throw new AppError(400, 'TOO_MANY_DOCUMENTS', `A workspace can hold at most ${config.limits.maxDocsPerWorkspace} documents.`);

      // Sequential on purpose: bounds memory/CPU (OCR, PDF parsing) per request.
      const results = [];
      for (const f of files) results.push(await ingestFile(repo, ws, f));
      const accepted = [];
      const rejected = [];
      for (const x of results) {
        if (x.status === 'accepted') accepted.push({ document: x.document, duplicate: x.duplicate ?? false });
        else rejected.push({ filename: x.filename, code: x.code, reason: x.reason });
      }
      // 207 Multi-Status: each file has its own outcome
      res.status(207).json({ accepted, rejected, documents: repo.listDocuments(ws) });
    }),
  );

  // Demo helper: ingest the bundled synthetic samples through the normal pipeline.
  r.post(
    '/:workspaceId/samples',
    asyncH(async (req, res) => {
      const ws = requireWorkspace(req);
      const results = [];
      for (const name of DEMO_SET) {
        const buffer = await readSample(name);
        if (buffer) results.push(await ingestFile(repo, ws, { originalname: name, mimetype: '', size: buffer.length, buffer }));
      }
      res.status(201).json({ loaded: results.filter((x) => x.status === 'accepted').length, documents: repo.listDocuments(ws) });
    }),
  );

  r.delete('/:workspaceId/documents/:documentId', (req, res) => {
    const ws = requireWorkspace(req);
    const id = uuid.safeParse(req.params.documentId);
    if (!id.success || !repo.deleteDocument(ws, id.data)) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    res.status(204).end();
  });

  r.get('/:workspaceId/documents/:documentId/content', (req, res) => {
    const ws = requireWorkspace(req);
    const id = uuid.safeParse(req.params.documentId);
    const doc = id.success ? repo.getDocument(ws, id.data) : null;
    if (!doc) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    res.json({ document: doc, chunks: repo.getChunks(doc.id), facts: repo.getFacts(doc.id) });
  });

  r.post(
    '/:workspaceId/analyses',
    asyncH(async (req, res) => {
      const ws = requireWorkspace(req);
      const body = AnalyzeBody.parse(req.body);
      const all = repo.listDocuments(ws).filter((d) => d.status === 'ready');
      const selected = body.documentIds ? all.filter((d) => body.documentIds!.includes(d.id)) : all;
      if (body.documentIds && selected.length !== body.documentIds.length)
        throw new AppError(400, 'INVALID_DOCUMENTS', 'Some selected documents do not exist or could not be read.');
      if (selected.length === 0) throw new AppError(400, 'NO_DOCUMENTS', 'Upload at least one readable document before analysing.');

      const started = Date.now();
      try {
        const result = await runAnalysis(body.instruction, loadContexts(repo, selected));
        const id = repo.saveAnalysis({
          workspaceId: ws,
          instruction: body.instruction,
          documentIds: selected.map((d) => d.id),
          provider: result.meta.provider,
          model: result.meta.model,
          status: 'completed',
          result,
          durationMs: Date.now() - started,
        });
        res.status(201).json({ id, result });
      } catch (e) {
        repo.saveAnalysis({
          workspaceId: ws,
          instruction: body.instruction,
          documentIds: selected.map((d) => d.id),
          provider: 'unknown',
          model: null,
          status: 'failed',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - started,
        });
        throw e;
      }
    }),
  );

  r.get('/:workspaceId/analyses', (req, res) => {
    res.json({ analyses: repo.listAnalyses(requireWorkspace(req)) });
  });

  r.get('/:workspaceId/analyses/:analysisId', (req, res) => {
    const ws = requireWorkspace(req);
    const id = uuid.safeParse(req.params.analysisId);
    const a = id.success ? repo.getAnalysis(ws, id.data) : null;
    if (!a) throw new AppError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found.');
    res.json(a);
  });

  return r;
}
