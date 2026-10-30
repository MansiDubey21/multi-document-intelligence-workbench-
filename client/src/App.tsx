import { useCallback, useEffect, useMemo, useState } from 'react';
import { Composer } from './components/Composer';
import { DocumentPanel } from './components/DocumentPanel';
import { DocColors } from './components/Provenance';
import { Results } from './components/Results';
import { api, ApiError } from './lib/api';
import { DOC_COLORS } from './lib/format';
import type { AnalysisListItem, AnalysisResult, DocumentInfo, Health } from './lib/types';

const WS_KEY = 'workbench.workspace';

function readStoredWorkspace(): string | null {
  try {
    return localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
}
function storeWorkspace(id: string) {
  try {
    localStorage.setItem(WS_KEY, id);
  } catch {
    /* private mode: session works without persistence */
  }
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [ws, setWs] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<AnalysisListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<string[]>([]);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

  // Restore (or create) the workspace that holds this browser's documents.
  useEffect(() => {
    (async () => {
      try {
        setHealth(await api.health());
        api.listSamples().then((s) => setSamples(s.files), () => undefined);
        let id = readStoredWorkspace();
        let docs: DocumentInfo[] = [];
        if (id) {
          try {
            docs = (await api.listDocuments(id)).documents;
          } catch (e) {
            if (e instanceof ApiError && e.status === 404) id = null;
            else throw e;
          }
        }
        if (!id) {
          id = (await api.createWorkspace()).id;
          storeWorkspace(id);
        }
        setWs(id);
        setDocuments(docs);
        setSelected(new Set(docs.filter((d) => d.status === 'ready').map((d) => d.id)));
        setHistory((await api.listAnalyses(id)).analyses);
      } catch (e) {
        fail(e);
      }
    })();
  }, []);

  const colors = useMemo(() => Object.fromEntries(documents.map((d, i) => [d.id, DOC_COLORS[i % DOC_COLORS.length]!])), [documents]);

  const upload = useCallback(
    async (files: File[]) => {
      if (!ws) return null;
      setError(null);
      setUploading(true);
      try {
        const res = await api.upload(ws, files);
        setDocuments(res.documents);
        setSelected((prev) => {
          const next = new Set(prev);
          res.accepted.forEach((a) => a.document.status === 'ready' && next.add(a.document.id));
          return next;
        });
        return res;
      } catch (e) {
        fail(e);
        return null;
      } finally {
        setUploading(false);
      }
    },
    [ws],
  );

  const loadSamples = async () => {
    if (!ws) return;
    setError(null);
    setUploading(true);
    try {
      const res = await api.loadSamples(ws);
      setDocuments(res.documents);
      setSelected(new Set(res.documents.filter((d) => d.status === 'ready').map((d) => d.id)));
    } catch (e) {
      fail(e);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!ws) return;
    try {
      await api.deleteDocument(ws, id);
      setDocuments((d) => d.filter((x) => x.id !== id));
      setSelected((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    } catch (e) {
      fail(e);
    }
  };

  const run = async (instruction: string) => {
    if (!ws) return;
    setError(null);
    setRunning(true);
    try {
      const ids = documents.filter((d) => d.status === 'ready' && selected.has(d.id)).map((d) => d.id);
      const res = await api.analyze(ws, instruction, ids);
      setResult(res.result);
      setHistory((await api.listAnalyses(ws)).analyses);
    } catch (e) {
      fail(e);
    } finally {
      setRunning(false);
    }
  };

  const openPast = async (id: string) => {
    if (!ws) return;
    try {
      const a = await api.getAnalysis(ws, id);
      if (a.result) setResult(a.result);
    } catch (e) {
      fail(e);
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const readyCount = documents.filter((d) => d.status === 'ready' && selected.has(d.id)).length;

  return (
    <DocColors.Provider value={colors}>
      <div className="app">
        <header className="masthead">
          <div className="brand">
            <span className="brand__mark" aria-hidden>
              <span />
              <span />
            </span>
            <div>
              <h1>Document workbench</h1>
              <p>Compare a case file across documents. Every finding cites the document and line it came from.</p>
            </div>
          </div>
          {health && (
            <span className={`engine engine--${health.provider}`} title="Analysis engine in use">
              {health.provider === 'anthropic'
                ? `Claude · ${health.model}`
                : health.provider === 'preview'
                  ? 'Browser preview · rule-based analyzer'
                  : 'Rule-based analyzer (no AI key set)'}
            </span>
          )}
        </header>

        {health?.provider === 'preview' && (
          <p className="notice notice--info preview-note">
            This is a browser-only preview: documents are read and analysed on your device and disappear when you close the
            tab. Image OCR, saved history and Claude analysis need the full server deployment.
          </p>
        )}

        {error && (
          <div className="notice notice--error page-error" role="alert">
            {error}
            <button type="button" className="link" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <main className="layout">
          <DocumentPanel
            documents={documents}
            selected={selected}
            onToggle={toggle}
            onUpload={upload}
            onDelete={(id) => void remove(id)}
            uploading={uploading}
            health={health}
            samples={samples}
            onLoadSamples={() => void loadSamples()}
          />
          <div className="work">
            <Composer onRun={(i) => void run(i)} running={running} selectedCount={readyCount} maxChars={health?.limits.maxPromptChars ?? 2000} />
            {running && <div className="progress" role="status">Reading each document separately, then comparing them…</div>}
            {result ? (
              <Results result={result} />
            ) : (
              !running && (
                <div className="placeholder">
                  <p>Results appear here as a summary, a side-by-side comparison, discrepancies, missing information and extracted values.</p>
                </div>
              )
            )}
            {history.length > 0 && (
              <details className="history">
                <summary>Earlier analyses ({history.length})</summary>
                <ul>
                  {history.map((h) => (
                    <li key={h.id}>
                      <button type="button" className="link" onClick={() => void openPast(h.id)} disabled={h.status !== 'completed'}>
                        {h.instruction}
                      </button>
                      <span className="muted small"> {new Date(h.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </main>
        <footer className="foot muted small">Use synthetic or permitted data only. Uploaded files are parsed in memory; only extracted text is stored.</footer>
      </div>
    </DocColors.Provider>
  );
}
