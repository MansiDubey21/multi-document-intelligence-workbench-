import { createContext, useContext, useState } from 'react';
import { KIND_HELP, KIND_LABEL } from '../lib/format';
import type { FindingKind, Severity, SourceRef } from '../lib/types';

/** documentId -> colour, assigned in upload order so a document keeps its colour everywhere. */
export const DocColors = createContext<Record<string, string>>({});

export function DocChip({ id, name, small }: { id: string; name: string; small?: boolean }) {
  const colors = useContext(DocColors);
  return (
    <span className={`doc-chip${small ? ' doc-chip--small' : ''}`} style={{ '--doc': colors[id] ?? '#5b6573' } as React.CSSProperties} title={name}>
      <span className="doc-chip__swatch" aria-hidden />
      <span className="doc-chip__name">{name}</span>
    </span>
  );
}

export function KindBadge({ kind }: { kind: FindingKind }) {
  return (
    <span className={`kind kind--${kind}`} title={KIND_HELP[kind]}>
      {KIND_LABEL[kind]}
    </span>
  );
}

export function SeverityMark({ severity }: { severity: Severity }) {
  return (
    <span className={`sev sev--${severity}`}>
      <span aria-hidden className="sev__dot" />
      {severity === 'high' ? 'High' : severity === 'medium' ? 'Medium' : 'Low'}
    </span>
  );
}

/** One citation: which document, where in it, the verbatim excerpt, and whether the excerpt was verified. */
export function SourceLine({ source }: { source: SourceRef }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="source">
      <button type="button" className="source__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <DocChip id={source.documentId} name={source.filename} small />
        <span className="source__loc">{source.locator || 'location not given'}</span>
        <span className={`source__check ${source.verified ? 'is-ok' : 'is-warn'}`} title={source.verified ? 'Excerpt found in the document text' : 'Excerpt could not be matched in the document text'}>
          {source.verified ? 'Quote verified' : 'Quote not verified'}
        </span>
      </button>
      {open && source.excerpt && <blockquote className="source__excerpt">{source.excerpt}</blockquote>}
    </li>
  );
}

export function SourceList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) return <p className="muted small">Not present in any analysed document.</p>;
  return (
    <ul className="sources" aria-label="Sources">
      {sources.map((s, i) => (
        <SourceLine key={`${s.documentId}-${i}`} source={s} />
      ))}
    </ul>
  );
}
