import type { ExtractedFact, StoredDocument } from '../types.js';
import { canonicalText, fieldDef, formatMoney, parseMoney } from '../pipeline/normalize.js';
import type { ComparisonRow, Finding, SourceRef } from './schema.js';

/**
 * Deterministic cross-document engine. Operates on per-document facts (never on merged text),
 * so every cell, discrepancy and gap is traceable to a specific document + location.
 * Findings produced here are kind = "computed" (rule-based) or "extracted_fact".
 */

export type DocRef = Pick<StoredDocument, 'id' | 'filename'>;

// Extracted and shown as key values, but expected to differ between documents, so not compared.
const EXCLUDED_FROM_COMPARISON = new Set(['mentioned_date', 'mentioned_amount', 'obligation', 'document_date']);

/** Groups a field belongs to (for focus filtering). Licence dates count as both "dates" and "licence". */
export function groupsOf(field: string): string[] {
  if (field === 'obligation') return ['obligations'];
  if (field === 'mentioned_date') return ['dates'];
  if (field === 'mentioned_amount') return ['financial'];
  const def = fieldDef(field);
  const g = def ? [def.group] : ['other'];
  if (field.startsWith('licence_')) g.push('licence');
  return g;
}

export const sourceOf = (f: ExtractedFact, docs: Map<string, DocRef>): SourceRef => ({
  documentId: f.documentId,
  filename: docs.get(f.documentId)?.filename ?? '',
  locator: f.locator,
  excerpt: f.excerpt,
  verified: false, // set by verify step
});

/* ---------------- value comparison ---------------- */

type Cmp = 'match' | 'partial' | 'mismatch';

const NAME_NOISE = new Set(['mr', 'mrs', 'ms', 'dr', 'shri', 'smt', 'm/s', 'ms.']);
const COMPANY_SUFFIXES: [RegExp, string][] = [
  [/\bprivate limited\b/g, 'pvt ltd'],
  [/\bprivate ltd\b/g, 'pvt ltd'],
  [/\bpvt limited\b/g, 'pvt ltd'],
  [/\blimited\b/g, 'ltd'],
  [/\bincorporated\b/g, 'inc'],
];

function nameTokens(v: string, keepInitials = false): string[] {
  let s = canonicalText(v);
  for (const [re, rep] of COMPANY_SUFFIXES) s = s.replace(re, rep);
  return s.split(' ').filter((t) => t && (keepInitials || t.length > 1) && !NAME_NOISE.has(t));
}

const postcodes = (v: string) => (v.match(/\b\d{6}\b|\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi) ?? []).map((p) => p.replace(/\s/g, '').toUpperCase());

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / (A.size + B.size - inter || 1);
}

export function compareValues(type: ExtractedFact['type'], a: ExtractedFact, b: ExtractedFact): Cmp {
  if (a.normalized === null || b.normalized === null) return 'mismatch';
  switch (type) {
    case 'money': {
      const ma = parseMoney(a.value);
      const mb = parseMoney(b.value);
      if (!ma || !mb) return a.normalized === b.normalized ? 'match' : 'mismatch';
      if (ma.currency && mb.currency && ma.currency !== mb.currency) return 'mismatch';
      const diff = Math.abs(ma.amount - mb.amount) / Math.max(Math.abs(ma.amount), Math.abs(mb.amount), 1);
      return diff <= 0.005 ? 'match' : 'mismatch';
    }
    case 'name': {
      // exact (incl. initials) = match; equal once initials are ignored, or one is a subset = partial
      if (nameTokens(a.value, true).join(' ') === nameTokens(b.value, true).join(' ')) return 'match';
      const ta = nameTokens(a.value);
      const tb = nameTokens(b.value);
      if (ta.join(' ') === tb.join(' ')) return 'partial';
      const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
      if (small.length > 0 && small.every((t) => big.includes(t))) return 'partial';
      return 'mismatch';
    }
    case 'address': {
      if (a.normalized === b.normalized) return 'match';
      const pa = postcodes(a.value);
      const pb = postcodes(b.value);
      if (pa.length && pb.length && !pa.some((p) => pb.includes(p))) return 'mismatch';
      return jaccard(a.normalized.split(' '), b.normalized.split(' ')) >= 0.75 ? 'partial' : 'mismatch';
    }
    default:
      return a.normalized === b.normalized ? 'match' : 'mismatch';
  }
}

/* ---------------- subject resolution ---------------- */

/**
 * Multi-row sources (e.g. a CSV with one row per company) attach a subject to each fact.
 * If that subject is the same entity the other documents describe (matches a name found
 * elsewhere), it is compared as the "primary" entity; otherwise it is kept separate.
 */
function primaryEntityTokens(facts: ExtractedFact[]): string[][] {
  return facts
    .filter((f) => (f.field === 'full_name' || f.field === 'company_name') && !f.subject && f.value)
    .map((f) => nameTokens(f.value));
}

function subjectKey(f: ExtractedFact, primaries: string[][]): string | null {
  if (!f.subject) return null;
  const t = nameTokens(f.subject);
  const isPrimary = primaries.some((p) => {
    const [s, b] = p.length <= t.length ? [p, t] : [t, p];
    return s.length > 0 && s.every((x) => b.includes(x));
  });
  return isPrimary ? null : canonicalText(f.subject);
}

/* ---------------- main ---------------- */

export interface ComparisonOutput {
  table: ComparisonRow[];
  discrepancies: Finding[];
  missing: Finding[];
}

const HIGH_RISK_FIELDS = new Set([
  'full_name', 'company_name', 'date_of_birth', 'id_number', 'licence_number', 'registration_number',
  'annual_revenue', 'net_profit', 'loan_amount', 'account_number', 'total_assets', 'total_liabilities',
]);

export function compareDocuments(docs: DocRef[], facts: ExtractedFact[], opts: { missingFocus: boolean; today?: string }): ComparisonOutput {
  const docMap = new Map(docs.map((d) => [d.id, d]));
  const primaries = primaryEntityTokens(facts);
  const comparable = facts.filter((f) => !EXCLUDED_FROM_COMPARISON.has(f.field) && !f.isBlank && f.value);

  // group facts by field + subject
  const groups = new Map<string, ExtractedFact[]>();
  for (const f of comparable) {
    const key = `${f.field}␟${subjectKey(f, primaries) ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const table: ComparisonRow[] = [];
  const discrepancies: Finding[] = [];
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;

  for (const [key, list] of groups) {
    const [field, subj] = key.split('␟') as [string, string];
    const first = list[0]!;
    const def = fieldDef(field);
    const label = def?.label ?? first.label;
    const type = def?.type ?? first.type;
    const docIds = [...new Set(list.map((f) => f.documentId))];

    const cells: ComparisonRow['cells'] = {};
    for (const f of list) {
      const cell = (cells[f.documentId] ??= { values: [], sources: [] });
      if (!cell.values.includes(f.value)) cell.values.push(f.value);
      cell.sources.push(sourceOf(f, docMap));
    }

    // pairwise comparison of one representative value per document (first occurrence)
    const reps = docIds.map((d) => list.find((f) => f.documentId === d)!);
    let status: ComparisonRow['status'] = docIds.length < 2 ? 'single_source' : 'match';
    for (let i = 0; i < reps.length; i++)
      for (let j = i + 1; j < reps.length; j++) {
        const c = compareValues(type, reps[i]!, reps[j]!);
        if (c === 'mismatch') status = 'mismatch';
        else if (c === 'partial' && status === 'match') status = 'partial';
      }

    const subject = subj ? (list.find((f) => f.subject)?.subject ?? subj) : null;
    table.push({ field, label, subject, status, cells });

    const subjText = subject ? ` for ${subject}` : '';
    const describe = (fs: ExtractedFact[]) =>
      fs
        .map((f) => {
          // show the normalised amount only when it adds information (e.g. "3.85 crore" -> "INR 38,500,000")
          const m = f.type === 'money' ? parseMoney(f.value) : null;
          const formatted = m ? formatMoney(m) : '';
          const shown = m && canonicalText(formatted) !== canonicalText(f.value) ? `${f.value} (= ${formatted})` : f.value;
          return `• ${docMap.get(f.documentId)?.filename}: "${shown}" (${f.locator})`;
        })
        .join('\n');

    if (status === 'mismatch' || status === 'partial') {
      const addressPostcodeDiffers =
        type === 'address' && reps.some((a) => reps.some((b) => postcodes(a.value).join() !== postcodes(b.value).join()));
      const severity: Finding['severity'] =
        status === 'partial' ? 'low' : HIGH_RISK_FIELDS.has(field) || addressPostcodeDiffers ? 'high' : 'medium';
      discrepancies.push({
        id: id('disc'),
        category: 'discrepancy',
        field,
        title:
          status === 'partial'
            ? `${label}${subjText} is written differently across documents (possible variant)`
            : `${label}${subjText} does not match across documents`,
        detail: `Values found:\n${describe(reps)}`,
        severity,
        kind: 'computed',
        sources: reps.map((f) => sourceOf(f, docMap)),
      });
    }

    // conflicting values for the same field inside ONE document
    for (const d of docIds) {
      const inDoc = list.filter((f) => f.documentId === d);
      const distinct = inDoc.filter((f, i) => inDoc.findIndex((g) => compareValues(type, f, g) === 'match') === i);
      if (distinct.length > 1) {
        discrepancies.push({
          id: id('disc'),
          category: 'discrepancy',
          field,
          title: `${label}${subjText} has conflicting values inside ${docMap.get(d)?.filename}`,
          detail: `Values found in the same document:\n${describe(distinct)}`,
          severity: HIGH_RISK_FIELDS.has(field) ? 'high' : 'medium',
          kind: 'computed',
          sources: distinct.map((f) => sourceOf(f, docMap)),
        });
      }
    }
  }

  discrepancies.push(...dateRules(facts, docMap, opts.today ?? new Date().toISOString().slice(0, 10), id));
  const missing = missingInformation(docs, facts, table, docMap, opts.missingFocus, id);

  const order = { high: 0, medium: 1, low: 2 } as const;
  discrepancies.sort((a, b) => order[a.severity] - order[b.severity]);
  table.sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.label.localeCompare(b.label));
  return { table, discrepancies, missing };
}

const statusRank = (s: ComparisonRow['status']) => ({ mismatch: 0, partial: 1, match: 2, single_source: 3 })[s];

/* ---------------- date validity rules ---------------- */

function dateRules(facts: ExtractedFact[], docs: Map<string, DocRef>, today: string, id: (p: string) => string): Finding[] {
  const out: Finding[] = [];
  const dated = (field: string) => facts.filter((f) => f.field === field && f.normalized && !f.subject);
  const applicationDates = dated('application_date');
  const reference = applicationDates[0];
  const refDate = reference?.normalized ?? today;
  const refLabel = reference ? `the application date (${reference.value})` : `today (${today})`;

  for (const exp of dated('licence_expiry_date')) {
    if (exp.normalized! < refDate) {
      out.push({
        id: id('disc'),
        category: 'discrepancy',
        field: 'licence_expiry_date',
        title: `Licence expired before ${reference ? 'the application date' : 'today'}`,
        detail: `${docs.get(exp.documentId)?.filename} shows expiry ${exp.value}, which is before ${refLabel}.`,
        severity: 'high',
        kind: 'computed',
        sources: [sourceOf(exp, docs), ...(reference ? [sourceOf(reference, docs)] : [])],
      });
    }
  }
  for (const iss of dated('licence_issue_date')) {
    for (const exp of dated('licence_expiry_date').filter((e) => e.documentId === iss.documentId)) {
      if (iss.normalized! > exp.normalized!) {
        out.push({
          id: id('disc'),
          category: 'discrepancy',
          field: 'licence_issue_date',
          title: 'Licence issue date is after its expiry date',
          detail: `Issued ${iss.value}, expires ${exp.value}.`,
          severity: 'high',
          kind: 'computed',
          sources: [sourceOf(iss, docs), sourceOf(exp, docs)],
        });
      }
    }
  }
  for (const dob of dated('date_of_birth')) {
    const age = (Date.parse(refDate) - Date.parse(dob.normalized!)) / (365.25 * 864e5);
    if (age < 18 || age > 100) {
      out.push({
        id: id('disc'),
        category: 'discrepancy',
        field: 'date_of_birth',
        title: age < 18 ? 'Applicant appears to be under 18' : 'Date of birth looks implausible',
        detail: `Date of birth ${dob.value} gives an age of ${age.toFixed(1)} at ${refLabel}.`,
        severity: 'medium',
        kind: 'computed',
        sources: [sourceOf(dob, docs)],
      });
    }
  }
  return out;
}

/* ---------------- missing information ---------------- */

const CROSS_CHECK_FIELDS = new Set([
  'full_name', 'address', 'date_of_birth', 'company_name', 'licence_number', 'annual_revenue', 'registration_number', 'id_number',
]);

function missingInformation(
  docs: DocRef[],
  facts: ExtractedFact[],
  table: ComparisonRow[],
  docMap: Map<string, DocRef>,
  missingFocus: boolean,
  id: (p: string) => string,
): Finding[] {
  const out: Finding[] = [];

  // 1. explicit blanks / N/A / TBD in a document (an extracted fact: the field is literally empty)
  for (const f of facts.filter((x) => x.isBlank)) {
    out.push({
      id: id('miss'),
      category: 'missing',
      field: f.field,
      title: `"${f.label}" is blank or marked as not provided in ${docMap.get(f.documentId)?.filename}`,
      detail: `The field is present but has no usable value${f.excerpt ? ` ("${f.excerpt.slice(0, 120)}")` : ''}.`,
      severity: CROSS_CHECK_FIELDS.has(f.field) ? 'high' : 'medium',
      kind: 'extracted_fact',
      sources: [sourceOf(f, docMap)],
    });
  }

  // 2. a key field present in most documents but absent from another (rule-based)
  if (docs.length >= 2) {
    // Flag only when most documents carry the field (strict majority), unless the user asked about gaps.
    const threshold = missingFocus ? 1 : Math.max(2, Math.floor(docs.length / 2) + 1);
    for (const row of table.filter((r) => !r.subject && CROSS_CHECK_FIELDS.has(r.field))) {
      const present = Object.keys(row.cells);
      const absent = docs.filter((d) => !present.includes(d.id) && !facts.some((f) => f.documentId === d.id && f.field === row.field));
      if (present.length >= threshold && absent.length > 0 && absent.length < docs.length) {
        out.push({
          id: id('miss'),
          category: 'missing',
          field: row.field,
          title: `${row.label} is not stated in ${absent.map((d) => d.filename).join(', ')}`,
          detail: `It appears in ${present.map((p) => docMap.get(p)?.filename).join(', ')}, so it cannot be cross-checked against the other document(s).`,
          severity: 'low',
          kind: 'computed',
          sources: present.flatMap((p) => row.cells[p]!.sources.slice(0, 1)),
        });
      }
    }
  }
  return out;
}

/** Expected fields that are absent from every document, given the user's focus. */
export function absentEverywhere(expected: string[], facts: ExtractedFact[], docs: DocRef[]): Finding[] {
  return expected
    .filter((field) => !facts.some((f) => f.field === field && !f.isBlank))
    .map((field, i) => ({
      id: `absent-${i + 1}`,
      category: 'missing' as const,
      field,
      title: `${fieldDef(field)?.label ?? field} was not found in any document`,
      detail: `Searched: ${docs.map((d) => d.filename).join(', ')}.`,
      severity: 'medium' as const,
      kind: 'computed' as const,
      sources: [],
    }));
}
