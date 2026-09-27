// A scene without JSON: its title, length, decor, transition and lines, and what is in it. Everything else (elements,
// keys, camera) is changed by the AI box above, or in the scene's code (advanced).
import { catalog } from '@af/library';
import type { Project, Scene } from '@af/schema';
import { Icon } from './Icon';

const KIND: Record<string, string> = { character: 'personnage', prop: 'accessoire', text: 'texte' };

export function SceneForm({ project, scene, onChange, readOnly, duration }: { project: Project; scene: Scene; onChange: (s: Scene) => void; readOnly: boolean; duration: number }) {
  const decors = [
    ...Object.entries(project.assets).filter(([, a]) => a.kind === 'decor').map(([id, a]) => ({ id, label: a.name })),
    ...catalog.decors.map((d) => ({ id: d.kind, label: `${d.label} (bibliothèque)` })),
  ];
  if (!decors.some((d) => d.id === scene.decor.kind)) decors.unshift({ id: scene.decor.kind, label: scene.decor.kind });
  const speaker = (s: string) => (s === 'narrator' ? 'Narrateur' : project.cast[s]?.name ?? s);
  const name = (e: Scene['elements'][number]) => {
    if (e.type === 'character') { const c = e.ref ? project.cast[e.ref] : undefined; return c?.name ?? e.ref ?? e.id; }
    if (e.type === 'prop') return (e.ref && project.assets[e.ref]?.name) || e.ref || e.id;
    if (e.type === 'text') return `« ${String((e.params as { text?: unknown }).text ?? '').slice(0, 24)} »`;
    return e.id;
  };
  return (
    <fieldset className="plain scene-form" disabled={readOnly}>
      <div className="grid2">
        <label className="field">Titre de la scène <input value={scene.title} onChange={(e) => onChange({ ...scene, title: e.target.value })} /></label>
        <label className="field">Durée (s)
          <input type="number" min={1} max={600} step={0.5} value={scene.duration ?? ''} placeholder={duration.toFixed(1)} title="durée minimale : la scène s'allonge si la voix est plus longue"
            onChange={(e) => { const v = +e.target.value; onChange(v > 0 ? { ...scene, duration: v } : (({ duration: _d, ...rest }) => rest as Scene)(scene)); }} />
        </label>
      </div>
      <div className="grid2">
        <label className="field">Décor
          <select value={scene.decor.kind} onChange={(e) => onChange({ ...scene, decor: { kind: e.target.value, params: {} } })}>{decors.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
        </label>
        <label className="field">Transition
          <select value={scene.transition} onChange={(e) => onChange({ ...scene, transition: e.target.value as Scene['transition'] })}><option value="cut">coupe</option><option value="fade">fondu</option></select>
        </label>
      </div>
      {scene.narration.length > 0 && (
        <div className="field">Répliques
          <ol className="line-list">
            {scene.narration.map((l, k) => (
              <li key={l.id}>
                <span className="who"><Icon name={l.speaker === 'narrator' ? 'mic' : 'user'} size={13} /> {speaker(l.speaker)} <span className="muted">· {l.id}</span></span>
                <textarea rows={2} value={l.text} aria-label={`texte de ${l.id}`} onChange={(e) => e.target.value.trim() && onChange({ ...scene, narration: scene.narration.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} />
              </li>
            ))}
          </ol>
        </div>
      )}
      {scene.elements.length > 0 && (
        <div className="field">Dans la scène
          <div className="elements">{scene.elements.map((e) => <span key={e.id} className="badge" title={e.id}>{name(e)} <span className="muted">· {KIND[e.type] ?? e.type}</span></span>)}</div>
        </div>
      )}
    </fieldset>
  );
}
