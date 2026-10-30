import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export type DB = Database.Database;

function readSchema(): string {
  // schema.sql sits next to this file in src/ and is copied next to it in dist/ by the build.
  const candidates = [path.join(here, 'schema.sql'), path.join(here, '../../src/db/schema.sql')];
  for (const p of candidates) if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  throw new Error('schema.sql not found');
}

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readSchema());
  return db;
}
