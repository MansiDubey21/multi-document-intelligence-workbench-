import type { AnalysisResult, Finding, FindingKind, SourceRef } from './types';

/** Stable colour per document (order of upload) — the visual thread for provenance. */
export const DOC_COLORS = ['#2C63C9', '#7446BD', '#0F7F68', '#B4561A', '#AE2F78', '#4B6274', '#5C7A12', '#1F7FA6'];

export const KIND_LABEL: Record<FindingKind, string> = {
  extracted_fact: 'Extracted fact',
  computed: 'Rule check',
  ai_interpretation: 'AI interpretation',
};

export const KIND_HELP: Record<FindingKind, string> = {
  extracted_fact: 'Read directly from the document. The quoted excerpt was found in the source text.',
  computed: 'A deterministic rule applied to extracted facts (for example, two values differ).',
  ai_interpretation: 'A judgement produced by the language model. Check the cited sources.',
};

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

const src = (s: SourceRef) => `${s.filename} (${s.locator || 'location not given'})${s.verified ? '' : ' [unverified]'}`;
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function findingsMd(title: string, list: Finding[]): string {
  if (list.length === 0) return `## ${title}\n\nNone found.\n`;
  return (
    `## ${title}\n\n` +
    list
      .map(
        (f) =>
          `- **[${f.severity}] ${f.title}** _(${KIND_LABEL[f.kind]})_\n` +
          (f.detail ? f.detail.split('\n').map((l) => `  ${l}`).join('\n') + '\n' : '') +
          (f.sources.length ? `  Sources: ${f.sources.map(src).join('; ')}\n` : ''),
      )
      .join('')
  );
}

/** Markdown export of the full result (what "Copy as Markdown" puts on the clipboard). */
export function toMarkdown(r: AnalysisResult): string {
  const docs = r.documents;
  const table =
    r.comparisonTable.length === 0
      ? 'No comparable fields.\n'
      : `| Field | Status | ${docs.map((d) => esc(d.filename)).join(' | ')} |\n|---|---|${docs.map(() => '---').join('|')}|\n` +
        r.comparisonTable
          .map(
            (row) =>
              `| ${esc(row.label + (row.subject ? ` (${row.subject})` : ''))} | ${row.status.replace('_', ' ')} | ${docs
                .map((d) => esc(row.cells[d.id]?.values.join('; ') ?? '—'))
                .join(' | ')} |`,
          )
          .join('\n') +
        '\n';
  return [
    `# Document analysis\n`,
    `**Instruction:** ${r.instruction}  `,
    `**Documents:** ${docs.map((d) => d.filename).join(', ')}  `,
    `**Analyzer:** ${r.meta.provider}${r.meta.model ? ` (${r.meta.model})` : ''} · ${new Date(r.meta.generatedAt).toLocaleString()}\n`,
    `## Summary _(${KIND_LABEL[r.summary.kind]})_\n\n${r.summary.text}\n`,
    findingsMd('Discrepancies', r.discrepancies),
    findingsMd('Missing information', r.missingInformation),
    `## Comparison table\n\n${table}`,
    `## Key values\n\n| Document | Field | Value | Location |\n|---|---|---|---|\n` +
      r.keyValues.map((k) => `| ${esc(k.source.filename)} | ${esc(k.label)}${k.subject ? ` (${esc(k.subject)})` : ''} | ${esc(k.value)} | ${esc(k.source.locator)} |`).join('\n') +
      '\n',
    r.meta.warnings.length ? `## Warnings\n\n${r.meta.warnings.map((w) => `- ${w}`).join('\n')}\n` : '',
  ].join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
