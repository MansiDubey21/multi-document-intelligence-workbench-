import { useRef, useState } from 'react';
import { formatBytes } from '../lib/format';
import type { DocumentInfo, Health, UploadResponse } from '../lib/types';
import { DocChip } from './Provenance';

interface Props {
  documents: DocumentInfo[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onUpload: (files: File[]) => Promise<UploadResponse | null>;
  onDelete: (id: string) => void;
  uploading: boolean;
  health: Health | null;
  samples: string[];
  onLoadSamples: () => void;
}

const KIND_NAME = { pdf: 'PDF', text: 'Text', csv: 'CSV', image: 'Image · OCR' } as const;

export function DocumentPanel({ documents, selected, onToggle, onUpload, onDelete, uploading, health, samples, onLoadSamples }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejections, setRejections] = useState<UploadResponse['rejected']>([]);
  const accept = health?.supportedExtensions.join(',') ?? '.pdf,.txt,.md,.csv,.png,.jpg,.jpeg';
  const maxMb = health?.limits.maxFileSizeMb ?? 10;

  const handle = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const res = await onUpload(Array.from(list));
    setRejections(res?.rejected ?? []);
    if (input.current) input.current.value = '';
  };

  return (
    <aside className="docs" aria-label="Documents">
      <div className="docs__head">
        <h2>Documents</h2>
        <span className="muted small">{documents.filter((d) => d.status === 'ready').length} readable</span>
      </div>

      <label
        className={`drop${dragging ? ' is-drag' : ''}${uploading ? ' is-busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handle(e.dataTransfer.files);
        }}
      >
        <input ref={input} type="file" multiple accept={accept} onChange={(e) => void handle(e.target.files)} disabled={uploading} />
        <span className="drop__title">{uploading ? 'Reading documents…' : 'Drop files or browse'}</span>
        <span className="drop__hint">
          {health?.provider === 'preview'
            ? `PDF, TXT, MD or CSV, up to ${maxMb} MB each.`
            : `PDF, TXT, MD, CSV, PNG or JPG, up to ${maxMb} MB each. Images are read with OCR.`}
        </span>
      </label>

      {rejections.length > 0 && (
        <div className="notice notice--error" role="alert">
          <strong>{rejections.length === 1 ? 'One file was not added' : `${rejections.length} files were not added`}</strong>
          <ul>
            {rejections.map((r, i) => (
              <li key={i}>
                <span className="mono-ish">{r.filename}</span>: {r.reason}
              </li>
            ))}
          </ul>
          <button type="button" className="link" onClick={() => setRejections([])}>
            Dismiss
          </button>
        </div>
      )}

      {documents.length === 0 ? (
        <div className="empty">
          <p>Add two or more documents to compare them, or try the synthetic case file.</p>
          <button type="button" className="btn" onClick={onLoadSamples} disabled={uploading}>
            Load sample documents
          </button>
        </div>
      ) : (
        <ul className="doclist">
          {documents.map((d) => (
            <li key={d.id} className={`doc${d.status === 'failed' ? ' doc--failed' : ''}`}>
              <label className="doc__main">
                <input
                  type="checkbox"
                  checked={d.status === 'ready' && selected.has(d.id)}
                  disabled={d.status !== 'ready'}
                  onChange={() => onToggle(d.id)}
                  aria-label={`Include ${d.filename} in analysis`}
                />
                <span className="doc__body">
                  <DocChip id={d.id} name={d.filename} />
                  <span className="doc__meta">
                    {KIND_NAME[d.kind]} · {formatBytes(d.sizeBytes)}
                    {d.pageCount ? ` · ${d.pageCount} p.` : ''}
                    {d.status === 'ready' ? ` · ${d.charCount.toLocaleString()} chars` : ''}
                  </span>
                  {d.status === 'failed' && <span className="doc__error">{d.error}</span>}
                  {d.warnings.map((w, i) => (
                    <span key={i} className="doc__warn">
                      {w}
                    </span>
                  ))}
                </span>
              </label>
              <button type="button" className="icon-btn" onClick={() => onDelete(d.id)} aria-label={`Remove ${d.filename}`} title="Remove">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {samples.length > 0 && (
        <details className="samples">
          <summary>Download synthetic sample files</summary>
          <ul>
            {samples.map((s) => (
              <li key={s}>
                <a href={`/api/samples/${encodeURIComponent(s)}`} download>
                  {s}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
