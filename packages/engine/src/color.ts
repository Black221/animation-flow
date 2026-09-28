// Colour helpers shared by components and styles. Colours are CSS hex strings throughout the format.
export type RGBA = [number, number, number, number];

export function parseHex(hex: string): RGBA {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16), a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, Number.isFinite(a) ? a : 1];
}
const hx = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
export const toHex = ([r, g, b]: RGBA | [number, number, number]) => `#${hx(r)}${hx(g)}${hx(b)}`;
export function mix(a: string, b: string, k: number): string {
  const A = parseHex(a), B = parseHex(b);
  return toHex([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]);
}
export const lighten = (c: string, k: number) => mix(c, '#ffffff', k);
export const darken = (c: string, k: number) => mix(c, '#000000', k);
export function rgba(c: string, alpha = 1): string {
  const [r, g, b, a] = parseHex(c);
  return `rgba(${r},${g},${b},${+(a * alpha).toFixed(4)})`;
}
/** push a colour away from (k > 0) or towards (k < 0) its grey: `saturate(c, 0.5)` is half again as vivid */
export function saturate(c: string, k: number): string {
  const [r, g, b] = parseHex(c), l = 0.299 * r + 0.587 * g + 0.114 * b;
  return toHex([l + (r - l) * (1 + k), l + (g - l) * (1 + k), l + (b - l) * (1 + k)]);
}
/** perceived lightness, 0 (black) … 1 (white) */
export const luma = (c: string) => { const [r, g, b] = parseHex(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
/** the colour at `t` (0 … 1) along gradient stops */
export function colorAt(stops: readonly (readonly [number, string])[], t: number): string {
  if (!stops.length) return '#000000';
  const s = [...stops].sort((a, b) => a[0] - b[0]);
  if (t <= s[0]![0]) return s[0]![1];
  for (let i = 1; i < s.length; i++) if (t <= s[i]![0]) { const [a, ca] = s[i - 1]!, [b, cb] = s[i]!; return mix(ca, cb, b > a ? (t - a) / (b - a) : 0); }
  return s[s.length - 1]![1];
}
