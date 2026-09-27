// The preview's soundtrack: fetch the recorded lines (once each), mix in a worker, hand back an AudioBuffer.
// Only what changes the sound triggers a new mix (timing of lines, recordings, music, effects), not every edit.
import { decodeWav } from '@af/audio';
import { timeProject } from '@af/engine';
import { voiceIsCurrent, type Project } from '@af/schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Api } from '../api';

const decoded = new Map<string, Float32Array>();

/** what the soundtrack depends on */
function soundKey(p: Project): string {
  const tl = timeProject(p);
  return JSON.stringify(p.scenes.map((s, i) => [tl.scenes[i]!.start, tl.scenes[i]!.duration, s.music, s.sfx, tl.scenes[i]!.lines.map((l, k) => [l.start, voiceIsCurrent(s.narration[k]!) ? s.narration[k]!.audio!.asset : null])]));
}

export interface Soundtrack { buffer: AudioBuffer | null; mixing: boolean; missing: string[]; lufs: number | null; error: string }

export function useSoundtrack(project: Project, enabled: boolean): Soundtrack {
  const key = useMemo(() => soundKey(project), [project]);
  const [state, setState] = useState<Soundtrack>({ buffer: null, mixing: false, missing: [], lufs: null, error: '' });
  const worker = useRef<Worker | null>(null), seq = useRef(0), latest = useRef(project);
  latest.current = project;

  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const p = latest.current;
      setState((s) => ({ ...s, mixing: true, error: '' }));
      try {
        const need = [...new Set(p.scenes.flatMap((s) => s.narration.filter(voiceIsCurrent).map((l) => l.audio!.asset)))].filter((a) => !decoded.has(a));
        if (need.length) {
          const links = await Api.voiceLinks(need);
          await Promise.all(Object.entries(links).map(async ([asset, url]) => {
            const r = await fetch(url);
            if (r.ok) decoded.set(asset, decodeWav(new Uint8Array(await r.arrayBuffer())).channels[0]!);
          }));
        }
        if (id !== seq.current) return;
        const voices: Record<string, Float32Array> = {};
        for (const s of p.scenes) for (const l of s.narration) if (voiceIsCurrent(l) && decoded.has(l.audio!.asset)) voices[l.audio!.asset] = decoded.get(l.audio!.asset)!.slice();
        worker.current ??= new Worker(new URL('./mix.worker.ts', import.meta.url), { type: 'module' });
        const w = worker.current;
        const res = await new Promise<{ id: number; left?: Float32Array; right?: Float32Array; sampleRate?: number; lufs?: number; missing?: string[]; error?: string }>((ok) => {
          const on = (e: MessageEvent) => { if (e.data.id === id) { w.removeEventListener('message', on); ok(e.data); } };
          w.addEventListener('message', on);
          w.postMessage({ id, project: p, voices }, Object.values(voices).map((v) => v.buffer));
        });
        if (id !== seq.current) return;
        if (res.error) throw new Error(res.error);
        const buf = new AudioBuffer({ length: res.left!.length, numberOfChannels: 2, sampleRate: res.sampleRate! });
        buf.copyToChannel(res.left! as Float32Array<ArrayBuffer>, 0); buf.copyToChannel(res.right! as Float32Array<ArrayBuffer>, 1);
        setState({ buffer: buf, mixing: false, missing: res.missing ?? [], lufs: res.lufs ?? null, error: '' });
      } catch (e) {
        if (id === seq.current) setState((s) => ({ ...s, mixing: false, error: (e as Error).message }));
      }
    }, 350);
    return () => clearTimeout(t);
  }, [key, enabled]);
  return state;
}
