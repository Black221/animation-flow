// The film at a glance: one block per scene (width = duration), its narration lines as bars, the playhead.
// Click anywhere to jump there; click a scene's title to select it for editing.
import type { Timeline as TL } from '@af/engine';
import type { Project } from '@af/schema';
import { useRef } from 'react';
import { usePlayback, type Playback } from '../playback';

export function Timeline({ project, timeline, pb, selected, onSelect }: { project: Project; timeline: TL; pb: Playback; selected: number; onSelect: (i: number) => void }) {
  const snap = usePlayback(pb), bar = useRef<HTMLDivElement>(null), total = Math.max(0.001, timeline.duration);
  const seekAt = (clientX: number) => { const r = bar.current!.getBoundingClientRect(); pb.seek(((clientX - r.left) / r.width) * total); };
  return (
    <div className="timeline" ref={bar} onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; pb.pause(); seekAt(e.clientX); }} data-testid="timeline">
      {timeline.scenes.map((s, i) => (
        <div key={s.id} className={`tl-scene${i === selected ? ' selected' : ''}`} style={{ left: `${(s.start / total) * 100}%`, width: `${(s.duration / total) * 100}%` }}>
          <button className="tl-title" onClick={() => onSelect(i)} title={project.scenes[i]!.title}>{s.id} · {project.scenes[i]!.title || 'sans titre'}</button>
          {s.lines.map((l) => (
            <div key={l.id} className={`tl-line${l.estimated ? ' estimated' : ''}`} title={`${l.id} · ${l.text}${l.estimated ? ' (durée estimée)' : ''}`}
              style={{ left: `${(l.start / s.duration) * 100}%`, width: `${((l.end - l.start) / s.duration) * 100}%` }} />
          ))}
        </div>
      ))}
      <div className="tl-head" style={{ left: `${(snap.time / total) * 100}%` }} />
    </div>
  );
}
