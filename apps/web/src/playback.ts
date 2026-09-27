// Playback state shared by the player, the timeline and the editor, outside React state so the canvas can run at
// display rate without re-rendering the whole editor. Components subscribe through usePlayback().
import { useSyncExternalStore } from 'react';

export class Playback {
  time = 0;
  playing = false;
  duration = 0;
  private listeners = new Set<() => void>();
  private snapshot = { time: 0, playing: false, duration: 0 };

  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getSnapshot = () => this.snapshot;
  private emit() { this.snapshot = { time: this.time, playing: this.playing, duration: this.duration }; this.listeners.forEach((f) => f()); }

  setDuration(d: number) { this.duration = d; if (this.time > d) this.time = d; this.emit(); }
  seek(t: number) { this.time = Math.max(0, Math.min(this.duration, t)); this.emit(); }
  play() { if (this.time >= this.duration - 1e-3) this.time = 0; this.playing = true; this.emit(); }
  pause() { this.playing = false; this.emit(); }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  /** advance by dt seconds while playing; stops at the end */
  advance(dt: number) {
    if (!this.playing) return;
    this.time = Math.min(this.duration, this.time + dt);
    if (this.time >= this.duration) this.playing = false;
    this.emit();
  }
}

export const usePlayback = (pb: Playback) => useSyncExternalStore(pb.subscribe, pb.getSnapshot);

export const fmtTime = (s: number) => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}`; };
