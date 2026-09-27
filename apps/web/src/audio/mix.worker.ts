// Mixing the soundtrack takes about a second for a few minutes of film: it runs here, off the main thread, with the
// same code as the video render.
import { mixSoundtrack } from '@af/audio';
import type { Project } from '@af/schema';

self.onmessage = (e: MessageEvent<{ id: number; project: Project; voices: Record<string, Float32Array> }>) => {
  const { id, project, voices } = e.data;
  try {
    const m = mixSoundtrack({ project, voices: new Map(Object.entries(voices)) });
    (self as unknown as Worker).postMessage({ id, left: m.left, right: m.right, sampleRate: m.sampleRate, lufs: m.lufs, missing: m.missing }, [m.left.buffer, m.right.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
