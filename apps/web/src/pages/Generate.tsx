// An AI generation, step by step: storyboard → review (edit it here, including what will be drawn) → drawings →
// scenes → the new project.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Api, type Generation, type StoryboardT, type StorySceneT, type StoryThing } from '../api';
import { useSession } from '../session';

const STAGES: { id: Generation['status'][]; label: string }[] = [
  { id: ['storyboard'], label: 'Storyboard' },
  { id: ['review'], label: 'Relecture' },
  { id: ['assets'], label: 'Dessins' },
  { id: ['music'], label: 'Musique' },
  { id: ['scenes'], label: 'Scènes' },
  { id: ['done'], label: 'Projet' },
];
const order = (g: Generation) => ({ storyboard: 0, review: 1, assets: 2, music: 3, scenes: 4, done: 5 } as Record<string, number>)[g.status] ?? (g.storyboard ? 1 : 0);
const tokens = (u: { inputTokens: number; outputTokens: number }) => `${(u.inputTokens / 1000).toFixed(1)} k tokens envoyés · ${(u.outputTokens / 1000).toFixed(1)} k reçus`;

/** the things to draw, editable: their description is what the drawing model gets */
function Things({ label, what, items, onChange, idPrefix, withVoice = false }: { label: string; what: string; items: (StoryThing & { voice?: string })[]; onChange: (items: (StoryThing & { voice?: string })[]) => void; idPrefix: string; withVoice?: boolean }) {
  const set = (i: number, patch: Partial<StoryThing & { voice?: string }>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <section className="things" aria-label={label}>
      <h3>{label} <span className="muted small">— dessinés pour le film d'après leur description</span></h3>
      {items.map((c, i) => (
        <div key={c.id + i} className="card row wrap" data-testid="thing">
          <input value={c.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`nom de ${c.id}`} style={{ width: 160 }} />
          <span className="sid">{c.id}</span>
          <textarea className="grow" rows={2} value={c.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={`description de ${c.name}`} placeholder={`à quoi ressemble ${what}`} />
          {withVoice && <input value={c.voice ?? ''} placeholder="voix (facultatif)" onChange={(e) => set(i, { voice: e.target.value || undefined })} aria-label={`voix de ${c.name}`} />}
          <button className="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`retirer ${c.name}`}>✕</button>
        </div>
      ))}
      <button onClick={() => { let n = items.length + 1; while (items.some((x) => x.id === `${idPrefix}${n}`)) n++; onChange([...items, { id: `${idPrefix}${n}`, name: '', description: '' }]); }}>+ {what}</button>
    </section>
  );
}

function SceneCard({ s, speakers, decors, props, onChange, onRemove }: { s: StorySceneT; speakers: { id: string; name: string }[]; decors: StoryThing[]; props: StoryThing[]; onChange: (s: StorySceneT) => void; onRemove: () => void }) {
  const set = <K extends keyof StorySceneT>(k: K, v: StorySceneT[K]) => onChange({ ...s, [k]: v });
  return (
    <li className="card story-scene" data-testid="story-scene">
      <div className="row wrap">
        <span className="sid">{s.id}</span>
        <input className="grow" value={s.title} onChange={(e) => set('title', e.target.value)} aria-label={`titre ${s.id}`} />
        <label>Durée <input type="number" min={2} max={180} value={s.duration} onChange={(e) => set('duration', Math.max(2, +e.target.value || 2))} style={{ width: 70 }} /> s</label>
        <label>Décor <select value={s.decor} onChange={(e) => set('decor', e.target.value)}>{decors.map((d) => <option key={d.id} value={d.id}>{d.name || d.id}</option>)}</select></label>
        <label className="grow">Musique <input value={s.music} onChange={(e) => set('music', e.target.value)} placeholder="ambiance, énergie, instruments… (none : silence)" aria-label={`musique de ${s.id}`} /></label>
        <button className="ghost" onClick={onRemove} aria-label={`supprimer ${s.id}`}>✕</button>
      </div>
      {props.length > 0 && (
        <div className="row wrap small" aria-label={`accessoires de ${s.id}`}>
          Accessoires : {props.map((p) => <label key={p.id}><input type="checkbox" checked={s.props.includes(p.id)} onChange={(e) => set('props', e.target.checked ? [...s.props, p.id] : s.props.filter((x) => x !== p.id))} /> {p.name || p.id}</label>)}
        </div>
      )}
      <ol className="story-lines">
        {s.narration.map((l, i) => (
          <li key={i} className="row">
            <select value={l.speaker} onChange={(e) => set('narration', s.narration.map((x, k) => (k === i ? { ...x, speaker: e.target.value } : x)))} aria-label="qui parle">
              <option value="narrator">narrateur</option>
              {speakers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <textarea rows={2} value={l.text} onChange={(e) => set('narration', s.narration.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} aria-label={`réplique ${s.id}/${l.id}`} />
            <button className="ghost" onClick={() => set('narration', s.narration.filter((_, k) => k !== i))} aria-label="supprimer la réplique">✕</button>
          </li>
        ))}
      </ol>
      <button onClick={() => { let n = s.narration.length + 1; while (s.narration.some((l) => l.id === `l${n}`)) n++; set('narration', [...s.narration, { id: `l${n}`, speaker: 'narrator', text: '' }]); }}>+ réplique</button>
      <label className="shots">Plans (un par ligne)
        <textarea rows={Math.max(2, s.shots.length)} value={s.shots.join('\n')} onChange={(e) => set('shots', e.target.value.split('\n'))} />
      </label>
    </li>
  );
}

export function Generate() {
  const { id = '' } = useParams();
  const [g, setG] = useState<Generation | null>(null);
  const [sb, setSb] = useState<StoryboardT | null>(null);
  const [dirty, setDirty] = useState(false);
  const [redo, setRedo] = useState('');
  const [error, setError] = useState('');
  const [showLog, setShowLog] = useState(false);
  const nav = useNavigate();
  const editable = useSession().can('editor');

  const refresh = useCallback(async () => {
    try { const x = await Api.generation(id); setG(x); setSb((cur) => (dirty && cur ? cur : x.storyboard)); } catch (e) { setError((e as Error).message); }
  }, [id, dirty]);
  useEffect(() => { void refresh(); }, [refresh]);
  const busy = g?.status === 'storyboard' || g?.status === 'assets' || g?.status === 'music' || g?.status === 'scenes';
  useEffect(() => { if (!busy) return; const t = setInterval(() => void refresh(), 1000); return () => clearInterval(t); }, [busy, refresh]);

  if (!g) return <div className="page muted">{error || 'Chargement…'}</div>;
  const edit = (next: StoryboardT) => { setSb(next); setDirty(true); };
  const act = async (f: () => Promise<Generation>) => { setError(''); try { const x = await f(); setG(x); if (!dirty) setSb(x.storyboard); } catch (e) { const b = (e as { body?: { issues?: { path: string; message: string }[] } }).body; setError(`${(e as Error).message}${b?.issues?.length ? ` : ${b.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join(' ; ')}` : ''}`); } };
  const writeScenes = () => act(async () => { if (dirty && sb) { await Api.saveStoryboard(g.id, { ...sb, scenes: sb.scenes.map((s) => ({ ...s, shots: s.shots.filter((x) => x.trim()), narration: s.narration.filter((l) => l.text.trim()) })) }); setDirty(false); } return Api.writeScenes(g.id); });
  const k = order(g), total = sb?.scenes.reduce((a, s) => a + s.duration, 0) ?? 0;

  return (
    <div className="page generate">
      <Link to="/" className="muted">← Projets</Link>
      <h2>Génération : {sb?.title ?? 'en cours'}</h2>
      <ol className="stages" aria-label="étapes">
        {STAGES.map((s, i) => <li key={s.label} className={i < k || g.status === 'done' ? 'done' : i === k ? (g.status === 'failed' || g.status === 'canceled' ? 'failed' : 'current') : ''}>{s.label}{i === 2 && g.assetsTotal ? ` ${g.assetsDone}/${g.assetsTotal}` : ''}{i === 4 && g.scenesTotal ? ` ${g.scenesDone}/${g.scenesTotal}` : ''}</li>)}
      </ol>
      <p className="muted small" data-testid="gen-status">
        {g.status === 'storyboard' && 'Le modèle écrit le storyboard…'}
        {g.status === 'review' && 'Relisez et corrigez le storyboard, puis faites écrire les scènes.'}
        {g.status === 'assets' && `Le modèle dessine les personnages, accessoires et décors, et relit chaque dessin (${g.assetsDone}/${g.assetsTotal})…`}
        {g.status === 'music' && 'Le modèle compose la musique du film et conçoit les bruitages…'}
        {g.status === 'scenes' && `Le modèle écrit les scènes (${g.scenesDone}/${g.scenesTotal})…`}
        {g.status === 'done' && 'Terminé.'}
        {g.status === 'canceled' && 'Annulée.'}
        {' '}{Object.values(g.models).join(' · ')} · {tokens(g.usage)}
      </p>
      {g.status === 'failed' && <p className="error" role="alert">Échec : {g.error}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row wrap">
        {busy && editable && <button onClick={() => void act(() => Api.cancelGeneration(g.id))}>Annuler</button>}
        {editable && g.status === 'review' && <button className="primary" onClick={() => void writeScenes()}>Dessiner, composer et écrire les scènes</button>}
        {editable && g.status === 'failed' && g.storyboard && !g.projectId && <button className="primary" onClick={() => void writeScenes()}>{g.drawings.length ? 'Réessayer les scènes' : 'Réessayer'}</button>}
        {g.status === 'done' && g.projectId && <button className="primary" onClick={() => nav(`/p/${g.projectId}`)}>Ouvrir le projet</button>}
      </div>
      {g.status === 'done' && g.fallbacks.length > 0 && <p className="warn small">Simplifiés (le modèle n'a pas produit de résultat valide) : {g.fallbacks.join(', ')}. Retouchez-les dans l'éditeur (onglet Dessins pour les dessins).</p>}

      {sb && editable && (g.status === 'review' || g.status === 'failed') && (
        <section className="storyboard" aria-label="storyboard">
          <div className="row wrap">
            <input className="grow title" value={sb.title} onChange={(e) => edit({ ...sb, title: e.target.value })} aria-label="titre du film" />
            <span className="muted small">{sb.scenes.length} scène(s) · {Math.round(total)} s visés · {sb.cast.length + sb.props.length + sb.decors.length} dessin(s) à faire</span>
          </div>
          {sb.palette.length > 0 && <div className="palette row" aria-label="palette du film">{sb.palette.map((c, i) => <span key={i} className="swatch" style={{ background: c }} title={c} />)}<span className="muted small">palette du film</span></div>}
          <Things label="Personnages" what="un personnage" idPrefix="c" withVoice items={sb.cast} onChange={(cast) => edit({ ...sb, cast })} />
          <Things label="Accessoires" what="un accessoire" idPrefix="p" items={sb.props} onChange={(props) => edit({ ...sb, props, scenes: sb.scenes.map((s) => ({ ...s, props: s.props.filter((x) => props.some((p) => p.id === x)) })) })} />
          <Things label="Bruitages" what="un bruitage" idPrefix="snd" items={sb.sounds ?? []} onChange={(sounds) => edit({ ...sb, sounds })} />
          <Things label="Décors" what="un décor" idPrefix="d" items={sb.decors} onChange={(decors) => decors.length && edit({ ...sb, decors, scenes: sb.scenes.map((s) => (decors.some((d) => d.id === s.decor) ? s : { ...s, decor: decors[0]!.id })) })} />
          <ol className="story-scenes">
            {sb.scenes.map((s, i) => <SceneCard key={s.id} s={s} speakers={sb.cast} decors={sb.decors} props={sb.props} onChange={(n) => edit({ ...sb, scenes: sb.scenes.map((x, j) => (j === i ? n : x)) })} onRemove={() => sb.scenes.length > 1 && edit({ ...sb, scenes: sb.scenes.filter((_, j) => j !== i) })} />)}
          </ol>
          <div className="card form">
            <label>Refaire le storyboard avec une consigne
              <textarea rows={2} value={redo} onChange={(e) => setRedo(e.target.value)} placeholder="plus court, trois scènes, un ton plus léger…" />
            </label>
            <button onClick={() => { setDirty(false); void act(() => Api.retryStoryboard(g.id, redo.trim() || undefined)); }}>Refaire le storyboard</button>
          </div>
        </section>
      )}

      <button className="ghost small" onClick={() => setShowLog((x) => !x)}>{showLog ? 'Masquer' : 'Voir'} le journal ({g.steps.length} appel(s) au modèle)</button>
      {showLog && (
        <ol className="gen-log">
          {g.steps.map((s, i) => (
            <li key={i} className={s.ok ? 'ok' : 'warn'}>
              {s.stage} {s.target !== s.stage ? s.target : ''} · essai {s.attempt + 1} · {s.ok ? 'valide' : 'à corriger'} · {(s.ms / 1000).toFixed(1)} s · {s.usage.inputTokens}+{s.usage.outputTokens} tokens
              {s.issues.length > 0 && <ul>{s.issues.map((x, j) => <li key={j}><code>{x.path}</code> {x.message}</li>)}</ul>}
            </li>
          ))}
        </ol>
      )}
      <details className="source"><summary>Texte d'origine</summary><p>{g.input.text}</p></details>
    </div>
  );
}
