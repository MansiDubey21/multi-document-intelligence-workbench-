/**
 * Seed script: applies the schema and loads the synthetic sample documents into a
 * "Demo case file" workspace through the real ingestion pipeline.
 *
 *   npm run seed
 *
 * Prints the workspace id. Open the app, then in the browser console run
 *   localStorage.setItem('workbench.workspace', '<id>'); location.reload()
 * to view it (or simply use "Load sample documents" in the UI).
 */
import { config } from '../config.js';
import { ingestFile } from '../pipeline/ingest.js';
import { readSample, SAMPLE_FILES } from '../routes/workspaces.js';
import { openDatabase } from './index.js';
import { Repository } from './repository.js';

const db = openDatabase(config.databasePath);
const repo = new Repository(db);
const ws = repo.createWorkspace('Demo case file');

for (const name of SAMPLE_FILES) {
  const buffer = await readSample(name);
  if (!buffer) continue;
  const out = await ingestFile(repo, ws.id, { originalname: name, mimetype: '', size: buffer.length, buffer });
  console.log(`${out.status === 'accepted' ? 'loaded ' : 'skipped'}  ${name}${out.status === 'rejected' ? ` (${out.reason})` : ''}`);
}
console.log(`\nWorkspace id: ${ws.id}\nDatabase: ${config.databasePath}`);
db.close();
