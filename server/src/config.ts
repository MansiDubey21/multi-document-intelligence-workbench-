import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_PATH: z.string().default('./data/workbench.db'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().max(50).default(10),
  MAX_FILES_PER_UPLOAD: z.coerce.number().int().positive().max(25).default(10),
  MAX_DOC_CHARS: z.coerce.number().int().positive().default(200_000),
  MAX_LLM_CHARS_PER_DOC: z.coerce.number().int().positive().default(24_000),
  OCR_ENABLED: bool.default('true'),
  OCR_LANG_PATH: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast on misconfiguration rather than running with surprising defaults.
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  port: env.PORT,
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  databasePath: env.DATABASE_PATH,
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  ai: {
    // Fall back to the mock analyzer when no key is configured so the app always works.
    provider: env.AI_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock',
    requestedProvider: env.AI_PROVIDER,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    timeoutMs: env.AI_TIMEOUT_MS,
    maxCharsPerDoc: env.MAX_LLM_CHARS_PER_DOC,
  },
  limits: {
    maxFileSizeBytes: Math.round(env.MAX_FILE_SIZE_MB * 1024 * 1024),
    maxFilesPerUpload: env.MAX_FILES_PER_UPLOAD,
    maxDocChars: env.MAX_DOC_CHARS,
    maxPromptChars: 2_000,
    maxDocsPerWorkspace: 20,
  },
  ocr: {
    enabled: env.OCR_ENABLED ?? true,
    langPath: env.OCR_LANG_PATH,
  },
} as const;

export type AppConfig = typeof config;
