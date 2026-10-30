import type { ExtractedFact, FactType } from '../types.js';
import { pageForOffset } from './chunk.js';
import {
  BLANK_VALUE,
  DATE_PATTERN,
  EMAIL_PATTERN,
  MONEY_PATTERN,
  inferType,
  normalizeValue,
  resolveField,
  slugField,
} from './normalize.js';

type NewFact = Omit<ExtractedFact, 'documentId'>;

/**
 * Deterministic fact extraction. Works on ONE document at a time and records, for every
 * fact, the exact source line (excerpt) and its location. No AI involved — these are the
 * "extracted facts" side of the fact-vs-interpretation distinction.
 */

const KV_LINE = /^\s*(?:[-*•]\s*)?([A-Za-z][A-Za-z0-9 /&().,'#-]{0,58}?)\s*[:=]\s*(.*?)\s*$/;
// "Label   Value" with 2+ spaces or a tab (common in PDF forms) — only accepted for known labels.
const SPACED_LINE = /^\s*([A-Za-z][A-Za-z0-9 /&().'#-]{1,40}?)(?:\t+| {2,})(\S.*?)\s*$/;
const OBLIGATION = /\b(shall|must|is required to|are required to|undertakes? to|agrees? to|is obliged to|covenants?)\b/i;

const COMPANY_VALUE = /\b(pvt|private|ltd|limited|llp|inc|corp|corporation|plc|gmbh|company|co\.)\b/i;

function makeFact(label: string, rawValue: string, locator: string, excerpt: string, subject: string | null): NewFact {
  let def = resolveField(label);
  const value = rawValue.trim().replace(/\s+/g, ' ');
  // "Borrower Name: Acme Pvt Ltd" names a company, not a person.
  if (def?.field === 'full_name' && COMPANY_VALUE.test(value)) def = resolveField('company name');
  const isBlank = BLANK_VALUE.test(value);
  const type: FactType = def?.type ?? (isBlank ? 'text' : inferType(value));
  return {
    field: def?.field ?? slugField(label),
    label: label.trim(),
    value: isBlank ? '' : value,
    normalized: isBlank ? null : normalizeValue(value, type),
    type,
    subject,
    locator,
    excerpt: excerpt.trim().slice(0, 300),
    isBlank,
    origin: 'parser',
  };
}

export function extractFactsFromText(text: string, pageOffsets?: number[]): NewFact[] {
  const facts: NewFact[] = [];
  const lines = text.split('\n');
  let offset = 0;

  lines.forEach((line, i) => {
    const page = pageForOffset(offset, pageOffsets);
    const locator = page ? `page ${page}, line ${i + 1}` : `line ${i + 1}`;
    offset += line.length + 1;
    if (!line.trim()) return;

    // A line may contain several "Label: value" pairs separated by " | " or ";  "
    const segments = line.split(/\s+\|\s+|;\s{2,}/);
    let matchedKv = false;
    for (const seg of segments) {
      const kv = seg.match(KV_LINE);
      if (kv && kv[1] && !/^https?$/i.test(kv[1]) && kv[1].split(' ').length <= 7) {
        facts.push(makeFact(kv[1], kv[2] ?? '', locator, line, null));
        matchedKv = true;
        continue;
      }
      const sp = seg.match(SPACED_LINE);
      if (sp && sp[1] && resolveField(sp[1])) {
        facts.push(makeFact(sp[1], sp[2] ?? '', locator, line, null));
        matchedKv = true;
      }
    }
    if (matchedKv) return;

    // Free-text mentions (kept for key-value extraction; excluded from cross-document comparison).
    const date = line.match(DATE_PATTERN);
    if (date) facts.push({ ...makeFact('Date mentioned', date[0], locator, line, null), field: 'mentioned_date', type: 'date', normalized: normalizeValue(date[0], 'date') });
    const money = line.match(MONEY_PATTERN);
    if (money) facts.push({ ...makeFact('Amount mentioned', money[0], locator, line, null), field: 'mentioned_amount', type: 'money', normalized: normalizeValue(money[0], 'money') });
    const email = line.match(EMAIL_PATTERN);
    if (email) facts.push(makeFact('Email', email[0], locator, line, null));
    if (OBLIGATION.test(line) && line.trim().length > 25) {
      facts.push({ ...makeFact('Obligation', line.trim().slice(0, 300), locator, line, null), field: 'obligation', type: 'text' });
    }
  });
  return facts;
}

/**
 * CSV fact extraction understands three common shapes:
 *  - two-column "Field,Value" sheets        -> one fact per row
 *  - a single data row                      -> one fact per column
 *  - many rows (e.g. one row per company)   -> one fact per cell, subject = first column
 */
export function extractFactsFromRows(rows: Record<string, string>[]): NewFact[] {
  const headers = Object.keys(rows[0] ?? {});
  const facts: NewFact[] = [];
  if (headers.length === 0) return facts;
  const excerptOf = (r: Record<string, string>) => headers.map((h) => `${h}: ${r[h]}`).join(' | ');

  const looksLikeFieldValue =
    headers.length === 2 && /^(field|item|attribute|key|particulars?|metric|description|label)$/i.test(headers[0]!);

  if (looksLikeFieldValue) {
    rows.forEach((r, i) => {
      const label = r[headers[0]!] ?? '';
      if (label) facts.push(makeFact(label, r[headers[1]!] ?? '', `row ${i + 1}`, excerptOf(r), null));
    });
    return facts;
  }
  if (rows.length === 1) {
    const r = rows[0]!;
    for (const h of headers) facts.push(makeFact(h, r[h] ?? '', `row 1, column "${h}"`, excerptOf(r), null));
    return facts;
  }
  rows.forEach((r, i) => {
    const subject = (r[headers[0]!] ?? '').trim() || null;
    for (const h of headers.slice(1)) facts.push(makeFact(h, r[h] ?? '', `row ${i + 1}, column "${h}"`, excerptOf(r), subject));
  });
  return facts;
}
