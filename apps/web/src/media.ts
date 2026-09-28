// Screen sizes and input kinds, for what the app deliberately leaves out on small or touch screens (the API still
// allows it all: a bigger screen shows it again).
import { useEffect, useState } from 'react';

export const PHONE = '(max-width: 700px)';
export const TOUCH = '(hover: none) and (pointer: coarse)';

export function useMedia(query: string) {
  const q = typeof matchMedia === 'function' ? matchMedia(query) : null;
  const [on, setOn] = useState(!!q?.matches);
  useEffect(() => { if (!q) return; const f = () => setOn(q.matches); f(); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  return on;
}
