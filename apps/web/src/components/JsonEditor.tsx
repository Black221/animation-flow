// A JSON text area that applies its value as soon as it parses and passes `validate`; otherwise it shows why.
// The preview therefore follows the typing, and an invalid edit never reaches the project.
import { useEffect, useState } from 'react';

export interface JsonIssue { path: string; message: string }

export function JsonEditor<T>({ value, resetKey, onApply, validate, label, rows = 24, readOnly = false }: {
  value: T;
  /** when it changes, the text is reset from `value` (another scene selected, project reloaded) */
  resetKey: string;
  onApply: (v: T) => void;
  validate: (v: unknown) => JsonIssue[];
  label: string;
  rows?: number;
  readOnly?: boolean;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [issues, setIssues] = useState<JsonIssue[]>([]);
  useEffect(() => { setText(JSON.stringify(value, null, 2)); setIssues([]); }, [resetKey]);

  const change = (t: string) => {
    setText(t);
    let v: unknown;
    try { v = JSON.parse(t); } catch (e) { setIssues([{ path: 'JSON', message: (e as Error).message }]); return; }
    const errs = validate(v);
    setIssues(errs);
    if (!errs.length) onApply(v as T);
  };
  return (
    <div className="json-editor">
      <textarea aria-label={label} spellCheck={false} rows={rows} readOnly={readOnly} value={text} onChange={(e) => change(e.target.value)} className={issues.length ? 'invalid' : ''} />
      {issues.length > 0 && (
        <ul className="issues" role="alert" data-testid="issues">
          {issues.slice(0, 8).map((i, k) => <li key={k}><code>{i.path}</code> {i.message}</li>)}
          {issues.length > 8 && <li>… et {issues.length - 8} autre(s)</li>}
        </ul>
      )}
    </div>
  );
}
