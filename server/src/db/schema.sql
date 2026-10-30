-- Multi-Document Intelligence Workbench — SQLite schema
-- Applied idempotently on server start (see src/db/index.ts).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per uploaded file. Raw bytes are NOT stored; only extracted text.
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('pdf', 'text', 'csv', 'image')),
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ready', 'failed')),
  error         TEXT,
  char_count    INTEGER NOT NULL DEFAULT 0,
  page_count    INTEGER,
  truncated     INTEGER NOT NULL DEFAULT 0,
  warnings      TEXT NOT NULL DEFAULT '[]',   -- JSON array
  content       TEXT NOT NULL DEFAULT '',     -- normalised extracted text
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_dedupe ON documents(workspace_id, sha256);

-- Document text split into located chunks (page / line range / CSV row).
CREATE TABLE IF NOT EXISTS document_chunks (
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx          INTEGER NOT NULL,
  locator      TEXT NOT NULL,
  text         TEXT NOT NULL,
  PRIMARY KEY (document_id, idx)
);

-- Deterministically extracted facts — the ground truth the AI layer builds on.
CREATE TABLE IF NOT EXISTS extracted_facts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field        TEXT NOT NULL,
  label        TEXT NOT NULL,
  value        TEXT NOT NULL,
  normalized   TEXT,
  type         TEXT NOT NULL,
  subject      TEXT,
  locator      TEXT NOT NULL,
  excerpt      TEXT NOT NULL,
  is_blank     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_facts_document ON extracted_facts(document_id);
CREATE INDEX IF NOT EXISTS idx_facts_field ON extracted_facts(field);

-- One row per analysis run; full structured result stored as validated JSON.
CREATE TABLE IF NOT EXISTS analyses (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  instruction   TEXT NOT NULL,
  document_ids  TEXT NOT NULL,                -- JSON array
  provider      TEXT NOT NULL,
  model         TEXT,
  status        TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  error         TEXT,
  result        TEXT,                         -- JSON (AnalysisResult)
  duration_ms   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_analyses_workspace ON analyses(workspace_id, created_at);

-- Normalised findings, one row per finding/source pair, for querying provenance.
CREATE TABLE IF NOT EXISTS finding_sources (
  analysis_id  TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  finding_id   TEXT NOT NULL,
  category     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  document_id  TEXT NOT NULL,
  locator      TEXT,
  excerpt      TEXT,
  verified     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_finding_sources_analysis ON finding_sources(analysis_id);
