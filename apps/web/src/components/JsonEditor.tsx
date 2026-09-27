// A JSON text area that applies its value as soon as it parses and passes `validate`; otherwise it shows why.
// The preview therefore follows the typing, and an invalid edit never reaches the project.
//
// When someone else changes the same part (`remoteKey` bumps and the value differs from what the text was
// written against), a valid text follows at once, keeping the caret; a text being typed (invalid for now) is
// left alone and marked out of date, and once it becomes valid only the user's own changes are applied on top of
// the current value, so theirs are not undone.
import { applyOps, diffJson } from '@af/schema';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface JsonIssue { path: string; message: string }

/** deep equality of JSON values, whatever the key order */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined), kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export function JsonEditor<T>({ value, resetKey, remoteKey = 0, onApply, validate, label, rows = 24, readOnly = false }: {
  value: T;
  /** when it changes, the text is reset from `value` (another scene selected, project reloaded) */
  resetKey: string;
  /** bumps when the project was changed by someone else */
  remoteKey?: number;
  onApply: (v: T) => void;
  validate: (v: unknown) => JsonIssue[];
  label: string;
  rows?: number;
  readOnly?: boolean;
}) {
  const [text, setText] = useState(() => pretty(value));
  const [issues, setIssues] = useState<JsonIssue[]>([]);
  const [stale, setStale] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<[number, number] | null>(null);
  /** the value the text was last in step with */
  const base = useRef<unknown>(value);
  const seenRemote = useRef(remoteKey);

  const show = (v: unknown, keepCaret: boolean) => {
    const el = area.current;
    caret.current = keepCaret && el && document.activeElement === el ? [el.selectionStart, el.selectionEnd] : null;
    setText(pretty(v)); setIssues([]); setStale(false); base.current = v;
  };
  useLayoutEffect(() => {
    const el = area.current, c = caret.current;
    if (el && c) { el.setSelectionRange(Math.min(c[0], el.value.length), Math.min(c[1], el.value.length)); caret.current = null; }
  }, [text]);
  useEffect(() => { show(value, false); }, [resetKey]);
  useEffect(() => {
    if (remoteKey === seenRemote.current) { base.current = value; return; } // our own change, as the project stored it
    seenRemote.current = remoteKey;
    if (sameJson(value, base.current)) return; // someone changed another part
    if (!issues.length) show(value, true);
    else setStale(true);
  }, [value, remoteKey]);

  const change = (t: string) => {
    setText(t);
    let v: unknown;
    try { v = JSON.parse(t); } catch (e) { setIssues([{ path: 'JSON', message: (e as Error).message }]); return; }
    if (stale) {
      // replay only what the user changed onto the current value
      let merged: unknown = v;
      try { merged = applyOps(value, diffJson(base.current, v)); } catch { /* their change removed what we edited: ours wins */ }
      if (!validate(merged).length) { onApply(merged as T); show(merged, true); return; }
    }
    const errs = validate(v);
    setIssues(errs);
    if (!errs.length) { setStale(false); onApply(v as T); }
  };
  return (
    <div className="json-editor">
      {stale && (
        <p className="banner warn small" role="status" data-testid="json-stale">
          Quelqu'un d'autre a modifié cette partie pendant que vous tapiez. <button type="button" onClick={() => show(value, false)}>Reprendre la version à jour</button>
        </p>
      )}
      <textarea ref={area} aria-label={label} spellCheck={false} rows={rows} readOnly={readOnly} value={text} onChange={(e) => change(e.target.value)} className={issues.length ? 'invalid' : ''} />
      {issues.length > 0 && (
        <ul className="issues" role="alert" data-testid="issues">
          {issues.slice(0, 8).map((i, k) => <li key={k}><code>{i.path}</code> {i.message}</li>)}
          {issues.length > 8 && <li>… et {issues.length - 8} autre(s)</li>}
        </ul>
      )}
    </div>
  );
}
