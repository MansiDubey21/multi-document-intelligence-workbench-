import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config } from './config.js';
import type { DB } from './db/index.js';
import { Repository } from './db/repository.js';
import { readSample, SAMPLE_FILES, workspaceRouter } from './routes/workspaces.js';
import { SUPPORTED_EXTENSIONS } from './pipeline/validate.js';
import { AppError } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db: DB) {
  const repo = new Repository(db);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render/Fly/Nginx
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  if (!config.isProd) app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api/workspaces/:id/analyses', rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      provider: config.ai.provider,
      model: config.ai.provider === 'anthropic' ? config.ai.anthropicModel : null,
      supportedExtensions: SUPPORTED_EXTENSIONS,
      limits: {
        maxFileSizeMb: config.limits.maxFileSizeBytes / 1024 / 1024,
        maxFilesPerUpload: config.limits.maxFilesPerUpload,
        maxPromptChars: config.limits.maxPromptChars,
      },
    });
  });
  app.get('/api/samples', (_req, res) => res.json({ files: SAMPLE_FILES }));
  app.get('/api/samples/:name', async (req, res, next) => {
    const buf = await readSample(req.params.name);
    if (!buf) return next(new AppError(404, 'SAMPLE_NOT_FOUND', 'Sample not found.'));
    res.attachment(req.params.name).send(buf);
  });
  app.use('/api/workspaces', workspaceRouter(repo));
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found.')));

  // Serve the built React app (production: single origin, no CORS needed).
  const clientDist = path.resolve(here, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // Central error handler: consistent JSON shape, no stack traces leaked to clients.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError)
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message ?? 'Invalid request', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      });
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body.' } });
    console.error('[unhandled]', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
  });

  return app;
}
