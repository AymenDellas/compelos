import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, FileText, Link2, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import {
  fieldLabels,
  type Brief,
  type BriefKey,
  type ImportResult,
} from '@/lib/copy-studio/shared/contracts';
import { importSource } from './api';

export function ImportDialog({
  current,
  initial,
  onClose,
  onApply,
}: {
  current: Brief;
  initial: ImportResult | null;
  onClose: () => void;
  onApply: (result: ImportResult, keys: BriefKey[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<'url' | 'text'>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(initial);
  const [selected, setSelected] = useState<BriefKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      controller.current?.abort();
    };
  }, []);
  const runImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(
      () => request.abort(new DOMException('Timed out', 'TimeoutError')),
      220000,
    );
    try {
      const extracted = await importSource(mode === 'url' ? { url } : { text }, request.signal);
      setResult(extracted);
      setSelected(
        (Object.keys(extracted.extraction.fields) as BriefKey[]).filter(
          (key) => !current[key].trim(),
        ),
      );
    } catch (err) {
      if (!request.signal.aborted)
        setError(err instanceof Error ? err.message : 'Could not import this page.');
      else if (request.signal.reason?.name === 'TimeoutError')
        setError('The import timed out. Try a shorter excerpt or retry.');
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="import-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="import-heading"
    >
      <div className="dialog-header">
        <div>
          <span className="eyebrow">A HEAD START, GROUNDED IN FACTS</span>
          <h2 id="import-heading">
            {result ? 'Review what we found' : 'Bring your offer into focus'}
          </h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close import">
          <X size={20} />
        </button>
      </div>
      {!result ? (
        <form onSubmit={runImport}>
          <p className="muted">
            Start with a public landing page or paste its copy. You’ll review every extracted fact
            before it reaches your brief.
          </p>
          <div className="segmented import-tabs">
            <button
              type="button"
              className={mode === 'url' ? 'active' : ''}
              onClick={() => setMode('url')}
              disabled={busy}
            >
              <Link2 size={16} />
              Website URL
            </button>
            <button
              type="button"
              className={mode === 'text' ? 'active' : ''}
              onClick={() => setMode('text')}
              disabled={busy}
            >
              <FileText size={16} />
              Paste text
            </button>
          </div>
          <div className="field">
            {mode === 'url' ? (
              <>
                <label htmlFor="source-url">Page URL</label>
                <input
                  id="source-url"
                  type="url"
                  value={url}
                  placeholder="https://yourwebsite.com/offer"
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={busy}
                  required
                  maxLength={2000}
                />
                <small className="field-hint">
                  For pages behind a login or rendered with JavaScript, use Paste text.
                </small>
              </>
            ) : (
              <>
                <label htmlFor="source-text">Visible page copy</label>
                <textarea
                  id="source-text"
                  rows={10}
                  value={text}
                  minLength={100}
                  maxLength={24000}
                  placeholder="Paste the headings, offer details, testimonials, and calls to action…"
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy}
                  required
                />
                <small className="field-hint">
                  {text.length.toLocaleString()} / 24,000 characters · Minimum 100
                </small>
              </>
            )}
          </div>
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          <div className="dialog-footer">
            <span>
              <ShieldCheck size={15} />
              Exact source quotes included
            </span>
            <button className="button primary" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  Reading the offer…
                </>
              ) : (
                <>
                  Extract offer facts
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
          {busy && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                controller.current?.abort();
              }}
            >
              Cancel import
            </button>
          )}
        </form>
      ) : (
        <div>
          <p className="muted">
            Choose the fields to apply. Existing values are preserved unless you select their
            replacements.
          </p>
          <div className="extraction-source">
            <FileText size={16} />
            <span>{result.source.title}</span>
            {result.source.url && (
              <a href={result.source.url} target="_blank" rel="noreferrer">
                View source ↗
              </a>
            )}
          </div>
          <div className="selection-actions">
            <button
              onClick={() => setSelected(Object.keys(result.extraction.fields) as BriefKey[])}
            >
              Select all
            </button>
            <button onClick={() => setSelected([])}>Clear selection</button>
            <span>{selected.length} selected</span>
          </div>
          <div className="extracted-fields">
            {(Object.entries(result.extraction.fields) as [BriefKey, string][]).map(
              ([key, value]) => (
                <div
                  className={`extracted-field ${selected.includes(key) ? 'is-selected' : ''}`}
                  key={key}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(key)}
                      onChange={() =>
                        setSelected((old) =>
                          old.includes(key) ? old.filter((k) => k !== key) : [...old, key],
                        )
                      }
                    />
                    <span>
                      <strong>{fieldLabels[key]}</strong>
                      {current[key] && <small>Replaces your existing value</small>}
                      <p>{value}</p>
                    </span>
                  </label>
                  <details>
                    <summary>Source evidence</summary>
                    {result.extraction.evidence
                      .filter((e) => e.field === key)
                      .map((e, i) => (
                        <blockquote key={i}>{e.quote}</blockquote>
                      ))}
                  </details>
                </div>
              ),
            )}
          </div>
          {!Object.keys(result.extraction.fields).length && (
            <p className="notice warning">
              No facts could be supported by exact source quotes. Try a more detailed source or fill
              in your brief manually.
            </p>
          )}
          {result.extraction.warnings.length > 0 && (
            <details className="import-warnings">
              <summary>Information to check ({result.extraction.warnings.length})</summary>
              <ul>
                {result.extraction.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="dialog-footer">
            <button
              className="button subtle"
              onClick={() => {
                setResult(null);
                setError('');
              }}
            >
              Try another source
            </button>
            <button
              className="button primary"
              disabled={!selected.length}
              onClick={() => onApply(result, selected)}
            >
              <Check size={16} />
              Apply {selected.length} field{selected.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
