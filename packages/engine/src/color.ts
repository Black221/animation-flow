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
