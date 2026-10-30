import { describe, expect, it } from 'vitest';
import { compareDocuments } from '../src/ai/compare.js';
import { verifySources } from '../src/ai/analyze.js';
import { selectChunks } from '../src/ai/llm.js';
import { chunkDocument } from '../src/pipeline/chunk.js';
import { extractFactsFromRows, extractFactsFromText } from '../src/pipeline/facts.js';
import { canonicalText, normalizeDate, parseMoney } from '../src/pipeline/normalize.js';
import type { ExtractedFact } from '../src/types.js';

const withDoc = (documentId: string, facts: Omit<ExtractedFact, 'documentId'>[]): ExtractedFact[] =>
  facts.map((f) => ({ ...f, documentId }));

describe('normalisation', () => {
  it('parses Indian-format and suffixed money values', () => {
    expect(parseMoney('INR 4,20,00,000')).toEqual({ amount: 42_000_000, currency: 'INR' });
    expect(parseMoney('₹ 3.85 crore')).toEqual({ amount: 38_500_000, currency: 'INR' });
    expect(parseMoney('$1.2m')).toEqual({ amount: 1_200_000, currency: 'USD' });
  });
  it('normalises dates to ISO (DD/MM assumption)', () => {
    expect(normalizeDate('31/03/2026')).toBe('2026-03-31');
    expect(normalizeDate('15 September 2026')).toBe('2026-09-15');
    expect(normalizeDate('31/02/2026')).toBeNull();
  });
});

describe('cross-document comparison keeps document boundaries and provenance', () => {
  const form = withDoc(
    'doc-form',
    extractFactsFromText(
      ['Application Date: 15/09/2026', 'Applicant Name: Priya Sharma', 'Address: 14 Lotus Lane, Pune 411001', 'Annual Revenue: INR 4,20,00,000', 'Guarantor Name: N/A'].join('\n'),
    ),
  );
  const licence = withDoc(
    'doc-licence',
    extractFactsFromText(['Name: Priya S. Sharma', 'Address: 14 Lotus Lane, Pune 411002', 'Expiry Date: 31/03/2026'].join('\n')),
  );
  const financials = withDoc(
    'doc-fin',
    extractFactsFromRows([
      { Field: 'Company Name', Value: 'Sharma Textiles Pvt Ltd' },
      { Field: 'Revenue from Operations', Value: 'INR 3,85,00,000' },
    ]),
  );
  const docs = [
    { id: 'doc-form', filename: 'form.pdf' },
    { id: 'doc-licence', filename: 'licence.txt' },
    { id: 'doc-fin', filename: 'fin.csv' },
  ];
  const out = compareDocuments(docs, [...form, ...licence, ...financials], { missingFocus: false, today: '2026-10-30' });
  const byField = (f: string) => out.discrepancies.filter((d) => d.field === f);

  it('detects a revenue mismatch and cites both documents with locators and excerpts', () => {
    const [rev] = byField('annual_revenue');
    expect(rev).toBeDefined();
    expect(rev!.severity).toBe('high');
    expect(rev!.kind).toBe('computed');
    expect(rev!.sources.map((s) => s.documentId).sort()).toEqual(['doc-fin', 'doc-form']);
    const csvSource = rev!.sources.find((s) => s.documentId === 'doc-fin')!;
    expect(csvSource.locator).toBe('row 2');
    expect(csvSource.excerpt).toContain('3,85,00,000');
  });

  it('flags an address mismatch on postcode and a name variant as low severity', () => {
    expect(byField('address')[0]?.severity).toBe('high');
    expect(byField('full_name')[0]).toMatchObject({ severity: 'low' });
  });

  it('applies date rules (licence expired before application date)', () => {
    const expired = byField('licence_expiry_date')[0]!;
    expect(expired.title).toMatch(/expired before the application date/i);
    expect(expired.sources.map((s) => s.documentId)).toEqual(['doc-licence', 'doc-form']);
  });

  it('reports blank fields as missing information traceable to the source line', () => {
    const blank = out.missing.find((m) => m.field === 'guarantor_name');
    expect(blank?.kind).toBe('extracted_fact');
    expect(blank?.sources[0]).toMatchObject({ documentId: 'doc-form', locator: 'line 5' });
  });

  it('never puts values from two documents into one table cell', () => {
    for (const row of out.table)
      for (const [docId, cell] of Object.entries(row.cells)) expect(cell.sources.every((s) => s.documentId === docId)).toBe(true);
  });
});

describe('provenance verification', () => {
  const index = new Map([['d1', { canonical: canonicalText('Annual Revenue: INR 4,20,00,000'), filename: 'a.pdf' }]]);
  it('marks a real excerpt verified, a fabricated one unverified, and drops unknown documents', () => {
    const out = verifySources(
      [
        { documentId: 'd1', filename: '', locator: '', excerpt: 'annual revenue:   INR 4,20,00,000', verified: false },
        { documentId: 'd1', filename: '', locator: '', excerpt: 'Revenue is INR 9 crore', verified: true },
        { documentId: 'ghost', filename: '', locator: '', excerpt: 'x', verified: true },
      ],
      index,
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.verified).toBe(true);
    expect(out[1]!.verified).toBe(false);
  });
});

describe('large document handling', () => {
  it('fits a long document into the LLM budget, keeps the opening and the relevant sections, and marks omissions', () => {
    const filler = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} about general terms and boilerplate conditions.`).join('\n');
    const text = `Agreement header: parties listed here\n${filler}\nAnnual revenue declared: INR 5 crore\n${filler}`;
    const chunks = chunkDocument('d', text, { maxChars: 800 });
    const { text: selected, omitted } = selectChunks(chunks, 'compare annual revenue', 3000);
    expect(selected.length).toBeLessThanOrEqual(3500);
    expect(omitted).toBeGreaterThan(0);
    expect(selected).toContain('Agreement header');
    expect(selected).toContain('Annual revenue declared');
    expect(selected).toMatch(/section\(s\) omitted for length/);
    expect(selected).toMatch(/\[lines \d+-\d+\]/);
  });
});
