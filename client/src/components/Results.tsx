import { useContext, useMemo, useState } from 'react';
import { copyText, toMarkdown } from '../lib/format';
import type { AnalysisResult, ComparisonRow, Finding } from '../lib/types';
import { DocChip, DocColors, KindBadge, SeverityMark, SourceList } from './Provenance';

type Tab = 'overview' | 'discrepancies' | 'table' | 'missing' | 'values';

export function Results({ result }: { result: AnalysisResult }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (what: 'md' | 'json') => {
    const ok = await copyText(what === 'md' ? toMarkdown(result) : JSON.stringify(result, null, 2));
    setCopied(ok ? (what === 'md' ? 'Markdown copied' : 'JSON copied') : 'Copy failed. Select the text manually.');
    window.setTimeout(() => setCopied(null), 2500);
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'discrepancies', label: 'Discrepancies', count: result.discrepancies.length },
    { id: 'table', label: 'Comparison', count: result.comparisonTable.length },
    { id: 'missing', label: 'Missing information', count: result.missingInformation.length },
    { id: 'values', label: 'Key values', count: result.keyValues.length },
  ];

  return (
    <section className="results" aria-label="Analysis results">
      <header className="results__head">
        <div>
          <p className="results__instruction">“{result.instruction}”</p>
          <p className="muted small">
            {result.documents.length} documents · {result.meta.provider === 'anthropic' ? `Claude (${result.meta.model})` : 'Rule-based analyzer'} ·{' '}
            {result.meta.durationMs < 1000 ? `${result.meta.durationMs} ms` : `${(result.meta.durationMs / 1000).toFixed(1)} s`}
          </p>
        </div>
        <div className="results__actions">
          <button type="button" className="btn" onClick={() => void copy('md')}>
            Copy as Markdown
          </button>
          <button type="button" className="btn" onClick={() => void copy('json')}>
            Copy JSON
          </button>
          <span className="toast" role="status" aria-live="polite">
            {copied}
          </span>
        </div>
      </header>

      {result.meta.warnings.length > 0 && (
        <div className="notice notice--warn">
          <ul>
            {result.meta.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
            {t.label}
            {t.count !== undefined && <span className="tab__count">{t.count}</span>}
          </button>
        ))}
      </nav>

      <div className="tabpanel" role="tabpanel">
        {tab === 'overview' && <Overview result={result} />}
        {tab === 'discrepancies' && (
          <FindingList findings={result.discrepancies} empty="No conflicting values were found across the selected documents." />
        )}
        {tab === 'table' && <ComparisonTable result={result} />}
        {tab === 'missing' && <FindingList findings={result.missingInformation} empty="No missing or blank information was detected." />}
        {tab === 'values' && <KeyValues result={result} />}
      </div>
    </section>
  );
}

/* ---------------- Overview ---------------- */

function Overview({ result }: { result: AnalysisResult }) {
  const high = result.discrepancies.filter((d) => d.severity === 'high').length;
  return (
    <div className="overview">
      <div className="summary">
        <div className="summary__head">
          <h3>Consolidated summary</h3>
          <KindBadge kind={result.summary.kind} />
        </div>
        <p className="summary__text">{result.summary.text}</p>
        <dl className="tally">
          <div className={high ? 'tally--alert' : ''}>
            <dt>High-severity discrepancies</dt>
            <dd>{high}</dd>
          </div>
          <div>
            <dt>All discrepancies</dt>
            <dd>{result.discrepancies.length}</dd>
          </div>
          <div>
            <dt>Missing items</dt>
            <dd>{result.missingInformation.length}</dd>
          </div>
          <div>
            <dt>Fields compared</dt>
            <dd>{result.comparisonTable.filter((r) => r.status !== 'single_source').length}</dd>
          </div>
        </dl>
      </div>

      {result.summary.points.length > 0 && (
        <>
          <h3 className="section-title">Key points</h3>
          <FindingList findings={result.summary.points} empty="" compact />
        </>
      )}

      <h3 className="section-title">Each document on its own</h3>
      <div className="perdoc">
        {result.perDocument.map((d) => (
          <article key={d.documentId} className="perdoc__item">
            <div className="perdoc__head">
              <DocChip id={d.documentId} name={d.filename} />
              <KindBadge kind={d.kind} />
            </div>
            <p>{d.summary}</p>
            {d.keyPoints.length > 0 && (
              <ul className="perdoc__points">
                {d.keyPoints.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Findings ---------------- */

function FindingList({ findings, empty, compact }: { findings: Finding[]; empty: string; compact?: boolean }) {
  if (findings.length === 0) return <p className="empty">{empty}</p>;
  return (
    <ol className={`findings${compact ? ' findings--compact' : ''}`}>
      {findings.map((f) => (
        <li key={f.id} className={`finding finding--${f.severity}`}>
          <div className="finding__top">
            <SeverityMark severity={f.severity} />
            <KindBadge kind={f.kind} />
          </div>
          <h4 className="finding__title">{f.title}</h4>
          {f.detail && !compact && <p className="finding__detail">{f.detail}</p>}
          <SourceList sources={f.sources} />
        </li>
      ))}
    </ol>
  );
}

/* ---------------- Comparison table ---------------- */

const STATUS_LABEL: Record<ComparisonRow['status'], string> = {
  mismatch: 'Differs',
  partial: 'Variant',
  match: 'Agrees',
  single_source: 'One source',
};

function ComparisonTable({ result }: { result: AnalysisResult }) {
  const colors = useContext(DocColors);
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [showSingle, setShowSingle] = useState(true);
  const rows = result.comparisonTable.filter(
    (r) => (!onlyConflicts || r.status === 'mismatch' || r.status === 'partial') && (showSingle || r.status !== 'single_source'),
  );
  if (result.comparisonTable.length === 0) return <p className="empty">No comparable fields were found for this instruction.</p>;

  return (
    <div>
      <div className="table-tools">
        <label className="check">
          <input type="checkbox" checked={onlyConflicts} onChange={(e) => setOnlyConflicts(e.target.checked)} /> Only rows that differ
        </label>
        <label className="check">
          <input type="checkbox" checked={showSingle} onChange={(e) => setShowSingle(e.target.checked)} /> Include fields found in one document
        </label>
      </div>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Comparison table (scrolls horizontally)">
        <table className="cmp">
          <thead>
            <tr>
              <th scope="col" className="cmp__field">
                Field
              </th>
              {result.documents.map((d) => (
                <th key={d.id} scope="col" style={{ '--doc': colors[d.id] } as React.CSSProperties} className="cmp__doc" title={d.filename}>
                  <span className="cmp__docname">{d.filename}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.field}-${r.subject ?? ''}`} className={`cmp__row cmp__row--${r.status}`}>
                <th scope="row" className="cmp__field">
                  <span className="cmp__label">{r.label}</span>
                  {r.subject && <span className="cmp__subject">{r.subject}</span>}
                  <span className={`status status--${r.status}`}>{STATUS_LABEL[r.status]}</span>
                </th>
                {result.documents.map((d) => {
                  const cell = r.cells[d.id];
                  return (
                    <td key={d.id} className={cell ? '' : 'cmp__absent'}>
                      {cell ? (
                        <>
                          {cell.values.map((v, i) => (
                            <span key={i} className="cmp__value">
                              {v}
                            </span>
                          ))}
                          <span className="cmp__loc" title={cell.sources[0]?.excerpt}>
                            {cell.sources[0]?.locator}
                          </span>
                        </>
                      ) : (
                        <span aria-label="Not present">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small table-note">Every value is read from its own document; hover a location to see the source line.</p>
    </div>
  );
}

/* ---------------- Key values ---------------- */

function KeyValues({ result }: { result: AnalysisResult }) {
  const [q, setQ] = useState('');
  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = result.keyValues.filter((k) => !needle || `${k.label} ${k.value} ${k.subject ?? ''}`.toLowerCase().includes(needle));
    return result.documents
      .map((d) => ({ doc: d, items: list.filter((k) => k.source.documentId === d.id) }))
      .filter((g) => g.items.length > 0);
  }, [q, result]);

  if (result.keyValues.length === 0) return <p className="empty">No values matched this instruction.</p>;
  return (
    <div>
      <div className="table-tools">
        <input className="search" type="search" placeholder="Filter values" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter key values" />
        <span className="muted small">
          <KindBadge kind="extracted_fact" /> All values below are read directly from the documents.
        </span>
      </div>
      {grouped.map(({ doc, items }) => (
        <section key={doc.id} className="kv-group">
          <DocChip id={doc.id} name={doc.filename} />
          <table className="kv">
            <tbody>
              {items.map((k, i) => (
                <tr key={i}>
                  <th scope="row">
                    {k.label}
                    {k.subject && <span className="cmp__subject">{k.subject}</span>}
                  </th>
                  <td className={k.type === 'money' || k.type === 'number' ? 'num' : ''}>{k.value}</td>
                  <td className="kv__loc" title={k.source.excerpt}>
                    {k.source.locator}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
