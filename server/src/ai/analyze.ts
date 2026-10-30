import { config } from '../config.js';
import type { Repository } from '../db/repository.js';
import { canonicalText, normalizeValue, resolveField } from '../pipeline/normalize.js';
import type { Chunk, ExtractedFact, StoredDocument } from '../types.js';
import { absentEverywhere, compareDocuments, groupsOf, sourceOf, type DocRef } from './compare.js';
import { detectFocus, relevantGroups, type Focus } from './focus.js';
import { analyzeDocument, synthesize, type DocDigest } from './llm.js';
import { AnalysisResultSchema, type AnalysisResult, type Finding, type SourceRef } from './schema.js';

export interface DocumentContext {
  doc: StoredDocument;
  content: string;
  chunks: Chunk[];
  facts: ExtractedFact[];
}

export function loadContexts(repo: Repository, docs: StoredDocument[]): DocumentContext[] {
  return docs.map((doc) => ({ doc, content: repo.getContent(doc.id), chunks: repo.getChunks(doc.id), facts: repo.getFacts(doc.id) }));
}

/* ---------------- provenance verification ---------------- */

/**
 * A source is "verified" only if its excerpt really occurs in the cited document's text
 * (compared after canonicalisation so whitespace/punctuation differences don't matter).
 * Sources pointing at unknown documents are dropped entirely.
 */
export function verifySources(sources: SourceRef[], contexts: Map<string, { canonical: string; filename: string }>): SourceRef[] {
  return sources
    .filter((s) => contexts.has(s.documentId))
    .map((s) => {
      const ctx = contexts.get(s.documentId)!;
      const ex = canonicalText(s.excerpt);
      return { ...s, filename: ctx.filename, verified: ex.length >= 3 && ctx.canonical.includes(ex) };
    });
}

/* ---------------- deterministic (mock) narrative ---------------- */

function describeDocument(c: DocumentContext): { summary: string; keyPoints: string[] } {
  const labelled = c.facts.filter((f) => !f.field.startsWith('mentioned_') && f.field !== 'obligation');
  const blanks = labelled.filter((f) => f.isBlank).length;
  const kindLabel = { pdf: 'PDF', text: 'Text', csv: 'CSV', image: 'Image (OCR)' }[c.doc.kind];
  const pages = c.doc.pageCount ? `, ${c.doc.pageCount} page(s)` : '';
  const obligations = c.facts.filter((f) => f.field === 'obligation').length;
  const summary =
    `${kindLabel} document${pages}, ${c.doc.charCount.toLocaleString()} characters. ` +
    `${labelled.length} labelled field(s) extracted${blanks ? `, ${blanks} blank` : ''}` +
    `${obligations ? `; ${obligations} obligation clause(s) detected` : ''}.` +
    (c.doc.truncated ? ' Content was truncated for length.' : '');
  const keyPoints = labelled
    .filter((f) => !f.isBlank)
    .slice(0, 8)
    .map((f) => `${f.label}${f.subject ? ` (${f.subject})` : ''}: ${f.value}`);
  return { summary, keyPoints };
}

/* ---------------- orchestrator ---------------- */

const EXPECTED_BY_FOCUS: Partial<Record<Focus, string[]>> = {
  identity: ['full_name', 'address', 'date_of_birth'],
  licence: ['licence_number', 'licence_expiry_date'],
  financial: ['annual_revenue', 'net_profit', 'total_assets', 'total_liabilities'],
  dates: ['application_date'],
};

export async function runAnalysis(instruction: string, contexts: DocumentContext[]): Promise<AnalysisResult> {
  const started = Date.now();
  const warnings: string[] = [];
  const focus = detectFocus(instruction);
  const groups = relevantGroups(focus);
  const docs: DocRef[] = contexts.map((c) => ({ id: c.doc.id, filename: c.doc.filename }));
  const docMap = new Map(docs.map((d) => [d.id, d]));
  const verifyIndex = new Map(contexts.map((c) => [c.doc.id, { canonical: canonicalText(c.content), filename: c.doc.filename }]));

  let facts = contexts.flatMap((c) => c.facts);
  let provider: string = config.ai.provider;
  const model = provider === 'anthropic' ? config.ai.anthropicModel : null;
  if (config.ai.requestedProvider === 'anthropic' && provider === 'mock') {
    warnings.push('AI_PROVIDER=anthropic but no API key is set; using the built-in rule-based analyzer.');
  }

  /* ---- Pass 1: each document independently ---- */
  const perDocument: AnalysisResult['perDocument'] = [];
  const digests: DocDigest[] = [];
  if (provider === 'anthropic') {
    try {
      const results = await mapLimit(contexts, 3, async (c) => ({ c, r: await analyzeDocument(c.doc, c.chunks, instruction) }));
      for (const { c, r } of results) {
        if (r.omitted) warnings.push(`${c.doc.filename}: ${r.omitted} low-relevance section(s) were not sent to the model due to length.`);
        perDocument.push({ documentId: c.doc.id, filename: c.doc.filename, summary: r.pass.summary, keyPoints: r.pass.keyPoints, kind: 'ai_interpretation' });
        // LLM facts are kept only if their excerpt is verifiably in the document and they add something new.
        const canonical = verifyIndex.get(c.doc.id)!.canonical;
        for (const lf of r.pass.facts) {
          const ex = canonicalText(lf.excerpt);
          if (ex.length < 3 || !canonical.includes(ex)) continue;
          const def = resolveField(lf.label) ?? resolveField(lf.field.replace(/_/g, ' '));
          const field = def?.field ?? lf.field;
          const type = def?.type ?? lf.type;
          const normalized = normalizeValue(lf.value, type);
          if (facts.some((f) => f.documentId === c.doc.id && f.field === field && f.normalized === normalized)) continue;
          facts.push({
            documentId: c.doc.id, field, label: lf.label, value: lf.value, normalized, type,
            subject: lf.subject ?? null, locator: lf.locator ?? 'located by AI', excerpt: lf.excerpt, isBlank: false, origin: 'llm',
          });
        }
        digests.push({
          documentId: c.doc.id,
          filename: c.doc.filename,
          summary: r.pass.summary,
          facts: facts.filter((f) => f.documentId === c.doc.id).map(({ field, label, value, subject, locator, excerpt }) => ({ field, label, value, subject, locator, excerpt })),
        });
      }
    } catch (e) {
      warnings.push(`AI provider error (${e instanceof Error ? e.message : 'unknown'}); fell back to rule-based analysis.`);
      provider = 'mock';
      facts = contexts.flatMap((c) => c.facts);
      perDocument.length = 0;
    }
  }
  if (provider === 'mock') {
    for (const c of contexts) {
      const d = describeDocument(c);
      perDocument.push({ documentId: c.doc.id, filename: c.doc.filename, ...d, kind: 'computed' });
    }
  }
  for (const c of contexts) {
    if (c.doc.truncated) warnings.push(`${c.doc.filename} was truncated at ingestion; later content was not analysed.`);
    for (const w of c.doc.warnings) if (/OCR/.test(w)) warnings.push(`${c.doc.filename}: ${w}`);
  }

  /* ---- Pass 2: collective, deterministic comparison ---- */
  const cmp = compareDocuments(docs, facts, { missingFocus: focus.includes('missing') });
  const expected = [...new Set(focus.flatMap((f) => EXPECTED_BY_FOCUS[f] ?? []))];
  cmp.missing.push(...absentEverywhere(expected, facts, docs));

  const inFocus = (field: string) => !groups || groupsOf(field).some((g) => groups.has(g));
  const generalCompare = !groups; // e.g. "compare all documents"
  let discrepancies = cmp.discrepancies.filter((d) => generalCompare || inFocus(d.field));
  let missing = cmp.missing.filter((m) => generalCompare || focus.includes('missing') || inFocus(m.field));
  const table = cmp.table.filter((r) => generalCompare || inFocus(r.field));

  /* ---- Pass 3: AI synthesis across documents (interpretation) ---- */
  let summaryText = '';
  let summaryKind: Finding['kind'] = 'computed';
  const points: Finding[] = [];
  if (provider === 'anthropic') {
    try {
      const s = await synthesize(instruction, digests, discrepancies);
      summaryText = s.summary;
      summaryKind = 'ai_interpretation';
      const toFinding = (category: Finding['category'], prefix: string) =>
        (x: { field?: string; title: string; detail: string; severity?: Finding['severity']; sources: { documentId: string; excerpt: string; locator?: string }[] }, i: number): Finding | null => {
          const sources = verifySources(
            x.sources.map((s2) => ({ documentId: s2.documentId, filename: '', locator: s2.locator ?? '', excerpt: s2.excerpt, verified: false })),
            verifyIndex,
          );
          if (sources.length === 0) {
            warnings.push(`Dropped an AI finding with no valid document reference: "${x.title.slice(0, 80)}"`);
            return null;
          }
          return { id: `${prefix}-${i + 1}`, category, field: x.field ?? '', title: x.title, detail: x.detail, severity: x.severity ?? 'medium', kind: 'ai_interpretation', sources };
        };
      const known = new Set(discrepancies.map((d) => d.field).filter(Boolean));
      const aiDisc = s.discrepancies.map(toFinding('discrepancy', 'ai-disc')).filter((f): f is Finding => !!f && !(f.field && known.has(f.field)));
      const aiMiss = s.missingInformation.map(toFinding('missing', 'ai-miss')).filter((f): f is Finding => !!f);
      points.push(...s.insights.map(toFinding('insight', 'ai-insight')).filter((f): f is Finding => !!f));
      discrepancies = [...discrepancies, ...aiDisc];
      missing = [...missing, ...aiMiss];
    } catch (e) {
      warnings.push(`AI synthesis failed (${e instanceof Error ? e.message : 'unknown'}); summary is rule-based.`);
    }
  }
  if (!summaryText) {
    const high = discrepancies.filter((d) => d.severity === 'high').length;
    summaryText =
      `Analysed ${docs.length} document(s) (${docs.map((d) => d.filename).join(', ')}) for: "${instruction}". ` +
      `Found ${discrepancies.length} discrepanc${discrepancies.length === 1 ? 'y' : 'ies'} (${high} high severity), ` +
      `${missing.length} missing-information item(s) and ${table.length} compared field(s).` +
      (discrepancies.length ? ` Most significant: ${discrepancies.slice(0, 3).map((d) => d.title).join('; ')}.` : ' No conflicting values were detected.');
  }
  points.push(...discrepancies.filter((d) => d.severity === 'high').slice(0, 5));

  /* ---- key values (extracted facts) ---- */
  const keyValues = facts
    .filter((f) => !f.isBlank && inFocus(f.field))
    .slice(0, 300)
    .map((f) => ({
      field: f.field,
      label: f.label,
      value: f.value,
      type: f.type,
      subject: f.subject,
      kind: 'extracted_fact' as const,
      source: sourceOf(f, docMap),
    }));

  /* ---- verify every source, then validate the whole result ---- */
  const vf = (f: Finding): Finding => ({ ...f, sources: verifySources(f.sources, verifyIndex) });
  const result: AnalysisResult = {
    instruction,
    summary: { text: summaryText, kind: summaryKind, points: points.map(vf) },
    documents: contexts.map((c) => ({ id: c.doc.id, filename: c.doc.filename, kind: c.doc.kind })),
    comparisonTable: table.map((r) => ({
      ...r,
      cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, { ...v, sources: verifySources(v.sources, verifyIndex) }])),
    })),
    discrepancies: discrepancies.map(vf),
    missingInformation: missing.map(vf),
    keyValues: keyValues.map((k) => ({ ...k, source: verifySources([k.source], verifyIndex)[0]! })),
    perDocument,
    meta: {
      provider,
      model: provider === 'anthropic' ? model : null,
      focus,
      warnings: [...new Set(warnings)],
      durationMs: Date.now() - started,
      generatedAt: new Date().toISOString(),
    },
  };
  return AnalysisResultSchema.parse(result);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
