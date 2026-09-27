// Subtitles from the timeline: at most two lines of 42 characters per cue; a long line is split into several cues,
// timed by their share of the characters, breaking after punctuation when possible.
import type { Project } from '@af/schema';
import type { Timeline } from './timing';

const pad = (n: number, k = 2) => String(n).padStart(k, '0');
export const srtStamp = (s: number) => {
  const ms = Math.round(s * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

export function splitCue(text: string, max = 84): string[] {
  if (text.length <= max) return [text];
  const words = text.split(/\s+/), out: string[] = [], target = text.length / Math.ceil(text.length / max);
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length > max || (cur.length >= target * 0.8 && /[,;:.!?…]$/.test(cur))) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

export function wrapTwoLines(s: string, max = 42): string {
  if (s.length <= max) return s;
  let best = -1, cost = Infinity;
  for (let i = 1; i < s.length - 1; i++) {
    if (s[i] !== ' ') continue;
    const c = Math.abs(i - (s.length - i - 1)) - (/[,;:.!?…]/.test(s[i - 1]!) ? 8 : 0);
    if (c < cost) { cost = c; best = i; }
  }
  return best > 0 ? s.slice(0, best) + '\n' + s.slice(best + 1) : s;
}

/** SRT of the whole film, or of [range.from, range.to) with times shifted so the excerpt starts at 0 */
export function toSrt(project: Project, tl: Timeline, range?: { from: number; to: number }): string {
  const out: string[] = [], from = range?.from ?? 0, to = range?.to ?? Infinity;
  let n = 0;
  for (const ts of tl.scenes) for (const l of ts.lines) {
    const a0 = ts.start + l.start, b0 = ts.start + l.end;
    if (b0 <= from || a0 >= to) continue;
    const who = l.speaker === 'narrator' ? '' : `${(project.cast[l.speaker]?.name ?? l.speaker).toUpperCase()} — `;
    const parts = splitCue(who + l.text), total = parts.reduce((a, p) => a + p.length, 0);
    let a = a0;
    for (const p of parts) {
      const b = a + ((b0 - a0) * p.length) / total;
      if (b > from && a < to) {
        const s = Math.max(a, from) - from, e = Math.min(Math.max(b, a + 0.8), to) - from;
        out.push(`${++n}\n${srtStamp(s)} --> ${srtStamp(e)}\n${wrapTwoLines(p)}\n`);
      }
      a = b;
    }
  }
  return out.join('\n');
}
