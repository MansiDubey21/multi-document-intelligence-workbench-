/**
 * Builds the browser-only live preview (no server): the same React UI, with the API module
 * replaced by src/demo/previewApi.ts, which runs the shared server pipeline modules in the browser.
 *   npm run build:preview --workspace client   ->  client/dist-preview/
 */
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const shims = path.resolve(here, 'src/demo/shims.ts');

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: [
      { find: /^\.\/lib\/api$/, replacement: path.resolve(here, 'src/demo/previewApi.ts') },
      { find: /^\.\.\/config\.js$/, replacement: shims },
      { find: /^node:path$/, replacement: shims },
      { find: /^dotenv\/config$/, replacement: shims },
    ],
  },
  build: {
    outDir: 'dist-preview',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  server: { fs: { allow: [path.resolve(here, '..')] } },
});
