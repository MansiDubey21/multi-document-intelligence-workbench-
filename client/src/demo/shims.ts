/**
 * Browser stand-ins for the two Node-only imports the shared server pipeline modules use.
 * Only wired in by vite.preview.config.ts; the normal app talks to the real server.
 */

// --- replaces server/src/config.ts ---
export const config = {
  port: 0,
  env: 'production',
  isProd: true,
  databasePath: ':memory:',
  corsOrigins: [] as string[],
  ai: {
    provider: 'mock' as const,
    requestedProvider: 'mock' as const,
    anthropicApiKey: undefined as string | undefined,
    anthropicModel: '',
    timeoutMs: 60_000,
    maxCharsPerDoc: 24_000,
  },
  limits: {
    maxFileSizeBytes: 10 * 1024 * 1024,
    maxFilesPerUpload: 10,
    maxDocChars: 200_000,
    maxPromptChars: 2_000,
    maxDocsPerWorkspace: 20,
  },
  ocr: { enabled: false, langPath: undefined as string | undefined },
};

// --- replaces node:path (only basename/extname are used by validate.ts) ---
const pathShim = {
  basename: (p: string) => p.split('/').pop() ?? p,
  extname: (p: string) => {
    const base = p.split('/').pop() ?? p;
    const i = base.lastIndexOf('.');
    return i > 0 ? base.slice(i) : '';
  },
};
export default pathShim;
export const { basename, extname } = pathShim;
