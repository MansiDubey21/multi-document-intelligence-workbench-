import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredDocument } from '../src/types.js';

/**
 * Exercises the Claude code path without network access: global fetch is stubbed to return
 * tool_use blocks, so we test structured-output parsing, provenance verification and the
 * fact-vs-interpretation labelling exactly as production would run it.
 */

const doc = (id: string, filename: string): StoredDocument => ({
  id, workspaceId: 'w', filename, kind: 'text', mimeType: 'text/plain', sizeBytes: 1, sha256: id, status: 'ready',
  error: null, charCount: 1, pageCount: null, truncated: false, warnings: [], createdAt: '',
});

// The server only accepts a tool_use block whose name matches the tool it forced, so echo it back.
const toolResponse = (name: string, input: unknown) =>
  new Response(JSON.stringify({ content: [{ type: 'tool_use', name, input }] }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Claude analysis path (stubbed API)', () => {
  it('labels model findings as AI interpretation, verifies quotes, and drops citations to unknown documents', async () => {
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    vi.resetModules();

    const contentA = 'Borrower: Priya Sharma\nThe borrower must maintain insurance until 30/09/2027.';
    const contentB = 'Account Holder: Priya Sharma\nAverage Monthly Balance: INR 6,40,000';

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { tools: { name: string }[]; messages: { content: string }[] };
      const tool = body.tools[0]!.name;
      // Document boundaries: each per-document call contains exactly one <document> block.
      if (tool === 'record_document_analysis') {
        expect(body.messages[0]!.content.match(/<document /g)).toHaveLength(1);
        const isA = body.messages[0]!.content.includes('doc-a');
        return toolResponse(tool, {
          summary: isA ? 'Loan terms for Priya Sharma.' : 'Bank reference letter.',
          keyPoints: [],
          facts: isA
            ? [{ field: 'insurance_deadline', label: 'Insurance deadline', value: '30/09/2027', type: 'date', excerpt: 'maintain insurance until 30/09/2027' },
               { field: 'made_up', label: 'Made up', value: 'x', type: 'text', excerpt: 'this text is not in the document' }]
            : [],
        });
      }
      return toolResponse(tool, {
        summary: 'Both documents name Priya Sharma.',
        insights: [{ title: 'Insurance obligation runs to 2027', detail: '', severity: 'low', sources: [{ documentId: 'doc-a', excerpt: 'maintain insurance until 30/09/2027' }] }],
        discrepancies: [
          { field: 'fabricated', title: 'Claim with an invented quote', detail: '', severity: 'medium', sources: [{ documentId: 'doc-b', excerpt: 'Balance is negative' }] },
          { field: 'ghost', title: 'Claim citing a document that does not exist', detail: '', severity: 'high', sources: [{ documentId: 'doc-zzz', excerpt: 'x' }] },
        ],
        missingInformation: [],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { runAnalysis } = await import('../src/ai/analyze.js');
    const result = await runAnalysis('Extract obligations and compare names', [
      { doc: doc('doc-a', 'terms.txt'), content: contentA, chunks: [{ documentId: 'doc-a', index: 0, text: contentA, locator: 'lines 1-2' }], facts: [] },
      { doc: doc('doc-b', 'bank.txt'), content: contentB, chunks: [{ documentId: 'doc-b', index: 0, text: contentB, locator: 'lines 1-2' }], facts: [] },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3); // 2 per-document passes + 1 synthesis
    expect(result.meta.provider).toBe('anthropic');
    expect(result.summary.kind).toBe('ai_interpretation');
    expect(result.perDocument.every((d) => d.kind === 'ai_interpretation')).toBe(true);

    // Verified insight keeps its source
    const insight = result.summary.points.find((p) => p.category === 'insight')!;
    expect(insight.sources[0]).toMatchObject({ documentId: 'doc-a', filename: 'terms.txt', verified: true });

    // Invented quote is kept but visibly unverified; unknown-document claim is dropped with a warning
    const fabricated = result.discrepancies.find((d) => d.field === 'fabricated')!;
    expect(fabricated.kind).toBe('ai_interpretation');
    expect(fabricated.sources[0]!.verified).toBe(false);
    expect(result.discrepancies.some((d) => d.field === 'ghost')).toBe(false);
    expect(result.meta.warnings.some((w) => /no valid document reference/.test(w))).toBe(true);

    // LLM facts are admitted only when their excerpt is really in the document
    expect(result.keyValues.some((k) => k.label === 'Made up')).toBe(false);
  });

  it('falls back to the rule-based analyzer when the AI provider fails', async () => {
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 })));

    const { runAnalysis } = await import('../src/ai/analyze.js');
    const content = 'Name: A Person';
    const result = await runAnalysis('Compare names', [
      { doc: doc('d1', 'a.txt'), content, chunks: [{ documentId: 'd1', index: 0, text: content, locator: 'line 1' }], facts: [] },
    ]);
    expect(result.meta.provider).toBe('mock');
    expect(result.meta.warnings.join(' ')).toMatch(/fell back to rule-based analysis/);
  });
});
