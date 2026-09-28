// The interface's building blocks for talking to people: dialogs (to create, fill in, confirm, show details),
// confirmations and questions that can be awaited, and toasts (a short message that goes away by itself).
// Dialogs are native <dialog> elements opened as modals: focus stays inside, Escape closes, the page behind is inert.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { lastQuota } from '../api';

// ---------------------------------------------------------------- dialog
export function Dialog({ open, onClose, title, description, icon, tone = 'accent', size = 'md', children, footer, label }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; icon?: IconName; tone?: 'accent' | 'danger' | 'info';
  size?: 'sm' | 'md' | 'lg' | 'xl'; children?: ReactNode; footer?: ReactNode; label?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`dialog ${size}`} aria-labelledby={`${id}-t`} aria-label={label} onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onMouseDown={(e) => { if (e.target === ref.current) onClose(); } /* a click on the backdrop */}>
      {open && (
        <div className="dialog-body">
          <header className="dialog-head">
            {icon && <span className={`dialog-icon ${tone}`} aria-hidden><Icon name={icon} size={18} /></span>}
            <div className="grow"><h2 id={`${id}-t`}>{title}</h2>{description && <div className="muted small">{description}</div>}</div>
            <button type="button" className="icon ghost close" onClick={onClose} aria-label="fermer"><Icon name="x" size={18} /></button>
          </header>
          {children && <div className="dialog-content">{children}</div>}
          {footer && <footer className="dialog-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- confirmations, questions, toasts
interface ConfirmOptions { title: string; message?: ReactNode; confirm?: string; cancel?: string; danger?: boolean; icon?: IconName; /** the person types this to confirm (irreversible actions) */ typeToConfirm?: string }
interface PromptOptions { title: string; message?: ReactNode; label: string; value?: string; placeholder?: string; confirm?: string; type?: 'text' | 'password'; required?: boolean }
interface InfoOptions { title: string; icon?: IconName; size?: 'sm' | 'md' | 'lg' | 'xl'; body: ReactNode }
type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; text: string; action?: { label: string; run: () => void } }
interface UI {
  confirm(o: ConfirmOptions): Promise<boolean>;
  prompt(o: PromptOptions): Promise<string | null>;
  info(o: InfoOptions): void;
  toast(text: string, kind?: ToastKind, action?: Toast['action']): void;
}
const Ctx = createContext<UI | null>(null);
export const useUI = () => { const ui = useContext(Ctx); if (!ui) throw new Error('useUI outside UIProvider'); return ui; };

type Pending =
  | { kind: 'confirm'; o: ConfirmOptions; done: (v: boolean) => void }
  | { kind: 'prompt'; o: PromptOptions; done: (v: string | null) => void }
  | { kind: 'info'; o: InfoOptions; done: () => void };

export function UIProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [value, setValue] = useState('');
  const seq = useRef(0);
  const toast = useCallback((text: string, kind: ToastKind = 'success', action?: Toast['action']) => {
    if (kind === 'error' && text === lastQuota.text && Date.now() - lastQuota.at < 5000) return;
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text, ...(action ? { action } : {}) }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  const ui = useRef<UI>({
    confirm: (o) => new Promise((done) => { setValue(''); setPending({ kind: 'confirm', o, done }); }),
    prompt: (o) => new Promise((done) => { setValue(o.value ?? ''); setPending({ kind: 'prompt', o, done }); }),
    info: (o) => setPending({ kind: 'info', o, done: () => undefined }),
    toast: () => undefined,
  });
  ui.current.toast = toast;
  const close = (v?: unknown) => {
    const p = pending; setPending(null);
    if (!p) return;
    if (p.kind === 'confirm') p.done(v === true);
    else if (p.kind === 'prompt') p.done(typeof v === 'string' ? v : null);
    else p.done();
  };

  return (
    <Ctx.Provider value={ui.current}>
      {children}
      {pending?.kind === 'confirm' && (() => {
        const o = pending.o, blocked = !!o.typeToConfirm && value !== o.typeToConfirm;
        return (
          <Dialog open onClose={() => close(false)} title={o.title} icon={o.icon ?? (o.danger ? 'trash' : 'check')} tone={o.danger ? 'danger' : 'accent'} size="sm"
            footer={<>
              <button type="button" className="ghost" onClick={() => close(false)}>{o.cancel ?? 'Annuler'}</button>
              <button type="button" className={o.danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => close(true)} autoFocus={!o.typeToConfirm}>{o.confirm ?? 'Confirmer'}</button>
            </>}>
            {o.message && <div className="confirm-message">{o.message}</div>}
            {o.typeToConfirm && <label className="field">Tapez « {o.typeToConfirm} » pour confirmer<input value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="confirmation" /></label>}
          </Dialog>
        );
      })()}
      {pending?.kind === 'prompt' && (() => {
        const o = pending.o;
        return (
          <Dialog open onClose={() => close(null)} title={o.title} icon="sliders" size="sm">
            <form className="form" onSubmit={(e) => { e.preventDefault(); if (!o.required || value.trim()) close(value); }}>
              {o.message && <div className="muted small">{o.message}</div>}
              <label className="field">{o.label}<input type={o.type ?? 'text'} value={value} placeholder={o.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus /></label>
              <div className="dialog-foot inline">
                <button type="button" className="ghost" onClick={() => close(null)}>Annuler</button>
                <button type="submit" className="primary" disabled={o.required && !value.trim()}>{o.confirm ?? 'Valider'}</button>
              </div>
            </form>
          </Dialog>
        );
      })()}
      {pending?.kind === 'info' && (
        <Dialog open onClose={() => close()} title={pending.o.title} icon={pending.o.icon ?? 'eye'} tone="info" size={pending.o.size ?? 'md'}
          footer={<button type="button" className="primary" onClick={() => close()} autoFocus>Fermer</button>}>
          {pending.o.body}
        </Dialog>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === 'error' ? 'x' : t.kind === 'info' ? 'eye' : 'check'} size={16} />
            <span>{t.text}</span>
            {t.action && <button type="button" className="link" onClick={() => { t.action!.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button>}
            <button type="button" className="icon ghost" aria-label="fermer la notification" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><Icon name="x" size={14} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** a small menu under a button (a card's « … », the account), closed by a click outside or Escape */
export function Menu({ label, icon = 'more', children, align = 'right', trigger }: { label: string; icon?: IconName; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className={trigger ? 'menu-trigger' : 'icon ghost'} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>
        {trigger ?? <Icon name={icon} size={18} />}
      </button>
      {open && <div className={`menu ${align}`} role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}
