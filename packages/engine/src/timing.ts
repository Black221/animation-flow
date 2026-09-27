// The clock. Narration sets the rhythm: each line lasts its measured duration (or an estimate from its length until
// the voice is recorded), lines follow each other with a short gap, and a scene lasts at least as long as its voice.
// Keys refer to lines ({ line, edge, offset }), so re-recording the voice re-times every scene by itself.
import type { Line, Project, Scene, TimeRef } from '@af/schema';

export const LEAD = 0.3;   // silence before the first line
export const GAP = 0.45;   // between two lines
export const TAIL = 0.6;   // after the last line
export const CHARS_PER_SECOND = 14.5;

export const estimateDuration = (text: string) => Math.max(0.6, text.length / CHARS_PER_SECOND + 0.15);

export interface TimedLine { id: string; speaker: string; text: string; start: number; end: number; estimated: boolean }
export interface TimedScene { id: string; index: number; start: number; duration: number; lines: TimedLine[]; at: (ref: TimeRef | undefined, fallback?: number) => number }
export interface Timeline { scenes: TimedScene[]; duration: number; fps: number; frames: number }

export function timeLines(lines: readonly Line[]): TimedLine[] {
  const out: TimedLine[] = [];
  let t = LEAD;
  for (const l of lines) {
    const start = l.start ?? t, dur = l.duration ?? estimateDuration(l.text);
    out.push({ id: l.id, speaker: l.speaker, text: l.text, start, end: start + dur, estimated: l.duration == null });
    t = start + dur + GAP + l.holdAfter;
  }
  return out;
}

export function refResolver(lines: readonly TimedLine[]) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return (ref: TimeRef | undefined, fallback = 0): number => {
    if (ref == null) return fallback;
    if (typeof ref === 'number') return ref;
    const l = byId.get(ref.line);
    if (!l) return fallback;
    return Math.max(0, (ref.edge === 'end' ? l.end : l.start) + ref.offset);
  };
}

export function timeScene(scene: Scene, index: number, start: number): TimedScene {
  const lines = timeLines(scene.narration), at = refResolver(lines);
  const voice = lines.length ? Math.max(...lines.map((l) => l.end)) + TAIL : 0;
  // with neither a set duration nor narration, the scene lasts until its last key (+ 1 s), at least 2 s
  let keys = 0;
  for (const e of scene.elements) for (const k of e.keys) keys = Math.max(keys, at(k.t));
  for (const k of scene.camera) keys = Math.max(keys, at(k.t));
  const duration = Math.max(scene.duration ?? 0, voice, scene.duration == null ? Math.max(2, keys + 1) : 0);
  return { id: scene.id, index, start, duration, lines, at };
}

export function timeProject(project: Project): Timeline {
  let t = 0;
  const scenes = project.scenes.map((s, i) => { const ts = timeScene(s, i, t); t += ts.duration; return ts; });
  const frames = Math.ceil(t * project.fps - 1e-9);
  return { scenes, duration: frames / project.fps, fps: project.fps, frames };
}

/** the scene playing at time t (the last one after the end) */
export function sceneAt(tl: Timeline, t: number): TimedScene {
  let i = 0;
  while (i + 1 < tl.scenes.length && t >= tl.scenes[i + 1]!.start) i++;
  return tl.scenes[i]!;
}
