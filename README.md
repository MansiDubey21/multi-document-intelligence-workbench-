# Multi-Document Intelligence Workbench

Upload several documents (PDF, TXT/MD, CSV, PNG/JPG), describe the analysis you want in plain language, and get back a
**structured, source-traceable** result: a consolidated summary, a side-by-side comparison table, a list of
discrepancies, a missing-information report and extracted key values. Every finding names the document, the
location (page/line/row) and the verbatim excerpt it came from, and says whether it is an **extracted fact**, a
**rule check** or an **AI interpretation**.

All sample data in this repository is synthetic. No real customer or banking data is used.

---

## Quick start

Requirements: Node.js 20+ (22 recommended), npm 10+.

```bash
git clone https://github.com/MansiDubey21/multi-document-intelligence-workbench-.git
cd multi-document-intelligence-workbench-
cp .env.example .env          # optional — sensible defaults are built in
npm install
npm run dev                   # API on :4000, React dev server on :5173
```

Open http://localhost:5173, click **Load sample documents** (or drag in files from `samples/`), choose an example
instruction and click **Analyse documents**.

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) + Vite dev server with `/api` proxy |
| `npm test` | Vitest suite (validation, comparison/provenance, LLM path with stubbed API, HTTP end-to-end) |
| `npm run typecheck` | Strict `tsc` for server and client |
| `npm run build` | Builds the React app and compiles the server to `server/dist` |
| `npm start` | Production server — serves API **and** the built React app on one port |
| `npm run seed` | Applies the schema and loads all samples into a "Demo case file" workspace |

### Using Claude instead of the rule-based analyzer

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...      # never commit this
ANTHROPIC_MODEL=claude-sonnet-4-5
```

Without a key the server automatically uses the built-in deterministic analyzer, so the app always works
(the header shows which engine is active). If the AI call fails at runtime, the analysis falls back to the
rule-based result and says so in the warnings.

### Deploying

* **Render (one click):** New → Blueprint → select this repo. `render.yaml` builds with
  `npm ci --include=dev && npm run build` and starts with `npm start`. Add `ANTHROPIC_API_KEY` in the dashboard if wanted.
* **Docker:** `docker build -t workbench . && docker run -p 4000:4000 workbench` → http://localhost:4000

---

## Architecture

```
client/  React + Vite + TypeScript        server/  Node + Express + TypeScript
─────────────────────────────────        ──────────────────────────────────────────────
DocumentPanel  ── multipart upload ──▶   routes/workspaces.ts   (zod-validated input)
Composer       ── instruction ──────▶        │
Results        ◀── AnalysisResult ───        ▼
 (tabs, provenance chips, copy)          pipeline/  (one document at a time)
                                           validate.ts   allow-list + MIME + magic bytes + size
                                           extractors.ts PDF (pdf-parse) · CSV (papaparse) · TXT · image OCR (tesseract.js)
                                           normalize.ts  clean text · field dictionary · date/money normalisation
                                           chunk.ts      located chunks ("page 2, lines 3-40", "rows 1-20")
                                           facts.ts      deterministic key/value + date/amount/obligation extraction
                                           ingest.ts     orchestrates the above, persists
                                                │
                                                ▼
                                         ai/
                                           compare.ts    cross-document comparison on per-document facts (rule checks)
                                           llm.ts        Claude: pass 1 per document, pass 2 synthesis over digests
                                           analyze.ts    orchestration · provenance verification · fallback
                                           schema.ts     zod contract every result must satisfy
                                                │
                                                ▼
                                         db/ (SQLite via better-sqlite3)
                                           workspaces · documents · document_chunks · extracted_facts
                                           analyses · finding_sources
```

### How an analysis runs

1. **Ingestion (per file).** Validate → extract text → clean → truncate if over budget → chunk with locators →
   extract labelled facts → store. Raw bytes are processed in memory and never written to disk.
2. **Per-document pass.** Each document is analysed on its own. With Claude, each call contains exactly one
   `<document>` block, and the model must return facts with verbatim excerpts. Excerpts are checked against that
   document's text, and unverifiable facts are discarded.
3. **Cross-document pass.**
   * *Rule checks* compare normalised values field by field across documents: money with currency and tolerance,
     names with initials treated as variants, addresses with postcode checks, ISO dates. They also apply date
     rules (expired licence, issue after expiry, implausible age) and find blank or absent fields.
   * *AI synthesis* (Claude) receives **per-document digests**, never one merged prompt. It returns insights,
     extra discrepancies and gaps, each citing `documentId` and an excerpt.
4. **Provenance verification.** Every source reference is re-checked on the server. `verified=true` only if the
   excerpt really occurs in the cited document. References to unknown documents are dropped with a warning.
5. **Schema validation.** The assembled result must pass `AnalysisResultSchema` (zod) before it is stored or returned.

### Fact vs interpretation

| Label | Meaning | Example |
|---|---|---|
| **Extracted fact** | Value read directly from one document, with a verified quote | `Annual Revenue: INR 4,20,00,000` (page 2, line 22) |
| **Rule check** | Deterministic rule over extracted facts | "Annual revenue does not match across documents" |
| **AI interpretation** | Judgement by the language model, with cited sources | "The revenue gap suggests the form uses an unaudited figure" |

### Large documents

* Extracted text is capped per document (`MAX_DOC_CHARS`, default 200k) and flagged as truncated.
* PDFs are capped at 200 pages and CSVs at 5,000 rows, with warnings.
* For the LLM, each document gets its own character budget (`MAX_LLM_CHARS_PER_DOC`). The opening sections are
  always kept, then the chunks most relevant to the instruction, and the model is told which sections were omitted.
* The synthesis step receives compact structured digests, not raw text, so its size grows with the number of facts
  rather than the length of the documents.

---

## Completed functionality

- [x] Upload multiple documents at once (drag and drop or file picker), up to 10 per request
- [x] Formats: **PDF**, **TXT/MD**, **CSV**, **PNG/JPG (OCR)**
- [x] Per-file ingestion results. Invalid files are rejected with a clear reason and never block valid ones:
  unsupported type, empty, too large, MIME mismatch, renamed file, corrupted PDF, PDF with no text layer, unreadable image
- [x] Free-text analysis instruction, plus the five example instructions as one-click chips
- [x] Instruction focus detection (identity, licence, financial, dates, obligations, missing, discrepancies)
- [x] Independent per-document analysis **and** collective comparison
- [x] Output: consolidated summary, comparison table, discrepancies (with severity), missing-information report,
      key-value extraction, per-document summaries
- [x] Every finding shows its source document(s), location and a verified excerpt
- [x] Copy as Markdown / Copy JSON
- [x] Analysis history per workspace (persisted in SQLite)
- [x] Claude integration with structured tool output, retry, timeout and automatic rule-based fallback
- [x] "Load sample documents" button and sample downloads for the hosted demo
- [x] 20 automated tests, GitHub Actions CI, Dockerfile, Render blueprint

## Assumptions

* Numeric dates are read as **DD/MM/YYYY**, because the synthetic data set is Indian/UK style.
* Currency amounts support Indian grouping (`4,20,00,000`) and the words lakh/crore/million/bn.
  Amounts within 0.5% are treated as equal.
* A "workspace" is an anonymous browser session (its id is kept in `localStorage`). There are no user accounts.
* Generic labels map to canonical fields through a dictionary in `normalize.ts`, for example
  *Applicant Name*, *Name* and *Account Holder* all map to `full_name`. Unknown labels are still extracted and
  compared under their own name.
* A name that differs only by initials ("Priya S. Sharma" vs "Priya Sharma") is reported as a **low-severity
  variant**, not a hard mismatch.

## Known limitations

* The rule-based analyzer understands labelled data (`Label: value`, two-column CSVs, tabular CSVs). Free prose is
  only mined for dates, amounts and obligation sentences. Deeper reading of prose needs the Claude provider.
* Scanned PDFs are not OCR'd directly. The user is asked to upload them as images.
* DOCX and XLSX are not supported yet; the extractor registry makes them a small addition.
* SQLite on a free Render instance is ephemeral: data resets on redeploy.
* Analyses run synchronously in the request. Very large batches with OCR and LLM calls can take tens of seconds.
* There is no authentication. Anyone holding a workspace id (a random UUID) can read that workspace.

## Security considerations

* **Upload validation:** extension allow-list, declared MIME consistency, magic-byte sniffing, UTF-8 and binary
  checks for text, per-file and per-request limits (multer), sanitised filenames that are never used as paths.
* **No raw files on disk:** files are processed in memory and only extracted text is stored. Duplicates are
  detected by SHA-256.
* **Prompt-injection posture:** document text is wrapped in `<document>` tags and treated as data; the system
  prompt forbids following instructions inside documents; the model is given no tools that act; all model output
  is schema-validated, and citations are verified on the server.
* **HTTP hardening:** Helmet with a strict Content-Security-Policy (`script-src 'self'`, `frame-ancestors 'none'`),
  rate limits (120 req/min overall, 15 analyses/min), 100 KB JSON body limit, CORS only in development (production
  is same-origin), and centralised error handling that never leaks stack traces.
* **SQL:** every query uses bound parameters.
* **Secrets:** read from the environment only. `.env` is git-ignored, and `.env.example` contains no real values.
* **Sample endpoints** serve a fixed allow-list of filenames, so path traversal returns 404.

## How this would be productionised

1. **Auth and tenancy:** SSO/OIDC, per-user and per-team workspaces, row-level authorisation on every query, audit log.
2. **Storage:** PostgreSQL (the schema is portable) with migrations (e.g. Drizzle or Prisma); encrypted object storage
   for originals if retention is required, with retention and deletion policies.
3. **Async processing:** move ingestion, OCR and analysis to a job queue (BullMQ/SQS) with workers, progress via SSE,
   and idempotent retries.
4. **Document coverage:** DOCX/XLSX extractors, OCR for scanned PDFs (rasterise, then OCR), and layout-aware table
   extraction.
5. **AI quality:** evaluation set of synthetic case files with expected findings; regression tests on prompts;
   prompt caching; cost and latency tracking per analysis; model choice by document size.
6. **Security:** malware scanning of uploads (ClamAV), stricter rate limits per user, secrets in a vault, dependency
   and container scanning in CI, data-residency controls.
7. **Observability:** structured logs with request ids, metrics (ingest failures by code, analysis latency, LLM
   fallbacks), tracing, alerting.

---

## Repository layout

```
client/               React app (Vite)
server/src/           Express API, pipeline, AI layer, SQLite
server/src/db/schema.sql   Database schema (applied automatically on start)
server/src/db/seed.ts      Seed script (npm run seed)
server/test/          Vitest tests
samples/              Synthetic sample documents + generator script + invalid files
Dockerfile, render.yaml, .github/workflows/ci.yml
```

### Sample documents (all fictional)

| File | Format | Planted issues |
|---|---|---|
| `loan_application_form.pdf` | PDF, 2 pages | Revenue ₹4.2 Cr; blank guarantor fields |
| `driving_licence.txt` | Text | Name variant "Priya S. Sharma"; PIN 411002; licence expired 31/03/2026 |
| `financial_statements_fy2026.csv` | CSV (field/value) | Revenue ₹3.85 Cr; audit date "TBD" |
| `bank_reference_letter.png` | Image (OCR) | Matches the form; adds account details |
| `loan_sanction_terms.txt` | Text | Obligations and deadlines; sanctioned ₹70 L vs ₹75 L requested |
| `peer_company_financials.csv` | CSV (one row per company) | Three companies for financial comparison |
| `invalid/*` | — | Renamed file, corrupted PDF, empty file, `.exe` (all rejected gracefully) |

Regenerate with `python3 samples/generate_samples.py` (needs `reportlab` and `Pillow`).

---

## AI tools used and decisions

**AI development tool used:** Claude (Anthropic), working as an agentic coding assistant. It wrote the code,
tests, sample generator and documentation, and ran and debugged them, from the brief and the project owner's
direction.

**Decisions I made and directed** (to be confirmed or edited by the candidate before submission):

* Monorepo with separate `client` and `server` workspaces, and one production process serving both (no CORS in prod).
* SQLite for zero-setup local use, with a schema written to be portable to PostgreSQL.
* A two-layer analysis: deterministic, verifiable rule checks as the backbone, and the LLM as an optional
  interpretation layer that cannot invent sources (server-side quote verification).
* Per-document LLM passes plus a synthesis over structured digests, instead of one merged prompt.
* Storing extracted text only, not uploaded files.
* A three-way labelling of findings: extracted fact, rule check, AI interpretation.
* Bundling the OCR language data so production never depends on a CDN at runtime.

Bugs found during testing and fixed (see the commit history): the pdf.js first-parse cold-start failure (retry
plus warm-up), page-offset drift in PDF locators, company names in "Borrower Name" fields, and tesseract.js
crashing or hanging the server when language data was unavailable.
