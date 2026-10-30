import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db/index.js';
import { warmUpPdfEngine } from './pipeline/extractors.js';

const db = openDatabase(config.databasePath);
void warmUpPdfEngine();
const app = createApp(db);

const server = app.listen(config.port, () => {
  console.log(`[workbench] API listening on :${config.port} (env=${config.env}, ai=${config.ai.provider})`);
});
server.requestTimeout = 180_000; // OCR + LLM calls can be slow

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
