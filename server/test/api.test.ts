import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AnalysisResultSchema } from '../src/ai/schema.js';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';

const SAMPLES = path.resolve(__dirname, '../../samples');
const sample = (name: string) => fs.readFileSync(path.join(SAMPLES, name));

describe('API end-to-end (mock analyzer, in-memory SQLite)', () => {
  const app = createApp(openDatabase(':memory:'));
  let ws = '';

  beforeAll(async () => {
    const res = await request(app).post('/api/workspaces').send({ name: 'test' });
    expect(res.status).toBe(201);
    ws = res.body.id;
  });

  it('accepts valid documents and gracefully rejects invalid ones in the same batch', async () => {
    const res = await request(app)
      .post(`/api/workspaces/${ws}/documents`)
      .attach('files', sample('loan_application_form.pdf'), 'loan_application_form.pdf')
      .attach('files', sample('driving_licence.txt'), 'driving_licence.txt')
      .attach('files', sample('financial_statements_fy2026.csv'), 'financial_statements_fy2026.csv')
      .attach('files', sample('invalid/renamed_text_file.pdf'), 'renamed_text_file.pdf')
      .attach('files', sample('invalid/corrupted.pdf'), 'corrupted.pdf')
      .attach('files', Buffer.from('MZ\x90'), 'program.exe');

    expect(res.status).toBe(207);
    expect(res.body.accepted.map((a: { document: { filename: string } }) => a.document.filename).sort()).toEqual([
      'driving_licence.txt',
      'financial_statements_fy2026.csv',
      'loan_application_form.pdf',
    ]);
    const codes = Object.fromEntries(res.body.rejected.map((r: { filename: string; code: string }) => [r.filename, r.code]));
    expect(codes).toEqual({ 'renamed_text_file.pdf': 'CONTENT_MISMATCH', 'corrupted.pdf': 'UNREADABLE_PDF', 'program.exe': 'UNSUPPORTED_TYPE' });
    const pdf = res.body.accepted.find((a: { document: { kind: string } }) => a.document.kind === 'pdf').document;
    expect(pdf.pageCount).toBe(2);
  });

  it('produces a schema-valid analysis whose findings trace back to verified source documents', async () => {
    const res = await request(app)
      .post(`/api/workspaces/${ws}/analyses`)
      .send({ instruction: 'Identify inconsistencies between the application form and supporting documents' });
    expect(res.status).toBe(201);
    const result = AnalysisResultSchema.parse(res.body.result);
    const docIds = new Set(result.documents.map((d) => d.id));

    const revenue = result.discrepancies.find((d) => d.field === 'annual_revenue')!;
    expect(revenue).toBeDefined();
    expect(revenue.sources.map((s) => s.filename).sort()).toEqual(['financial_statements_fy2026.csv', 'loan_application_form.pdf']);
    expect(revenue.sources.find((s) => s.filename === 'loan_application_form.pdf')!.locator).toMatch(/^page 2, line \d+$/);

    expect(result.discrepancies.some((d) => d.field === 'address' && d.severity === 'high')).toBe(true);
    expect(result.discrepancies.some((d) => /licence expired/i.test(d.title))).toBe(true);

    // Every finding cites only documents in this analysis, and every rule-based citation is verified in the source text.
    for (const f of [...result.discrepancies, ...result.missingInformation])
      for (const s of f.sources) {
        expect(docIds.has(s.documentId)).toBe(true);
        if (f.kind !== 'ai_interpretation') expect(s.verified).toBe(true);
      }
    expect(result.keyValues.every((k) => k.kind === 'extracted_fact' && k.source.verified)).toBe(true);
  });

  it('persists analyses and lists them', async () => {
    const list = await request(app).get(`/api/workspaces/${ws}/analyses`);
    expect(list.body.analyses).toHaveLength(1);
    const one = await request(app).get(`/api/workspaces/${ws}/analyses/${list.body.analyses[0].id}`);
    expect(one.body.result.instruction).toMatch(/inconsistencies/);
  });

  it('validates input: short prompt, unknown workspace, malformed ids', async () => {
    expect((await request(app).post(`/api/workspaces/${ws}/analyses`).send({ instruction: 'hi' })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await request(app).get('/api/workspaces/not-a-uuid/documents')).status).toBe(404);
    expect(
      (await request(app).post(`/api/workspaces/${ws}/analyses`).send({ instruction: 'compare all', documentIds: ['x'] })).status,
    ).toBe(400);
  });
});
