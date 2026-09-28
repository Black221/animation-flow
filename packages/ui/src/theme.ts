// Light, dark, or as the system says. The choice is kept in this browser; index.html applies it before the first
// paint (no flash), this module changes it and tells the components that care.
import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'af-theme';
const listeners = new Set<() => void>();

export function themeChoice(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
}
const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
/** what is shown now: the choice, or the system's when the choice is « system » */
export const shownTheme = (c: ThemeChoice = themeChoice()): 'light' | 'dark' => (c === 'system' ? (systemDark() ? 'dark' : 'light') : c);

export function applyTheme(c: ThemeChoice = themeChoice()) {
  const root = document.documentElement;
  if (c === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', c);
  root.style.colorScheme = shownTheme(c);
}

export function setTheme(c: ThemeChoice) {
  try { if (c === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, c); } catch { /* private mode: for this page only */ }
  applyTheme(c);
  listeners.forEach((f) => f());
}

/** the choice and what it shows, following the system while the choice is « system » */
export function useTheme(): { choice: ThemeChoice; shown: 'light' | 'dark'; set: (c: ThemeChoice) => void } {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const onSystem = () => { if (themeChoice() === 'system') { applyTheme('system'); f(); } };
    mq?.addEventListener('change', onSystem);
    return () => { listeners.delete(f); mq?.removeEventListener('change', onSystem); };
  }, []);
  const choice = themeChoice();
  return { choice, shown: shownTheme(choice), set: setTheme };
}
