// An AI generation, step by step: storyboard → review (edit it here) → scenes → the new project.
import { catalog } from '@af/library';
import { MOOD_NAMES } from '@af/audio';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Api, type Generation, type StoryboardT, type StorySceneT } from '../api';

const STAGES: { id: Generation['status'][]; label: string }[] = [
  { id: ['storyboard'], label: 'Storyboard' },
  { id: ['review'], label: 'Relecture' },
  { id: ['scenes'], label: 'Scènes' },
  { id: ['done'], label: 'Projet' },
];
const order = (g: Generation) => (g.status === 'storyboard' ? 0 : g.status === 'review' ? 1 : g.status === 'scenes' ? 2 : g.status === 'done' ? 3 : g.storyboard ? 1 : 0);
const MOODS: Record<string, string> = { none: 'aucune', calm: 'calme', curious: 'curieuse', playful: 'enjouée', epic: 'épique', night: 'nuit', tense: 'tendue' };
const tokens = (u: { inputTokens: number; outputTokens: number }) => `${(u.inputTokens / 1000).toFixed(1)} k tokens envoyés · ${(u.outputTokens / 1000).toFixed(1)} k reçus`;

function SceneCard({ s, speakers, onChange, onRemove }: { s: StorySceneT; speakers: { id: string; name: string }[]; onChange: (s: StorySceneT) => void; onRemove: () => void }) {
  const set = <K extends keyof StorySceneT>(k: K, v: StorySceneT[K]) => onChange({ ...s, [k]: v });
  return (
    <li className="card story-scene" data-testid="story-scene">
      <div className="row wrap">
        <span className="sid">{s.id}</span>
        <input className="grow" value={s.title} onChange={(e) => set('title', e.target.value)} aria-label={`titre ${s.id}`} />
        <label>Durée <input type="number" min={2} max={180} value={s.duration} onChange={(e) => set('duration', Math.max(2, +e.target.value || 2))} style={{ width: 70 }} /> s</label>
        <label>Décor <select value={s.decor.kind} onChange={(e) => set('decor', { kind: e.target.value, params: {} })}>{catalog.decors.map((d) => <option key={d.kind} value={d.kind}>{d.label}</option>)}</select></label>
        <label>Musique <select value={s.music.mood} onChange={(e) => set('music', { ...s.music, mood: e.target.value })}>{['none', ...MOOD_NAMES].map((m) => <option key={m} value={m}>{MOODS[m] ?? m}</option>)}</select></label>
        <button className="ghost" onClick={onRemove} aria-label={`supprimer ${s.id}`}>✕</button>
      </div>
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

  const refresh = useCallback(async () => {
    try { const x = await Api.generation(id); setG(x); setSb((cur) => (dirty && cur ? cur : x.storyboard)); } catch (e) { setError((e as Error).message); }
  }, [id, dirty]);
  useEffect(() => { void refresh(); }, [refresh]);
  const busy = g?.status === 'storyboard' || g?.status === 'scenes';
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
        {STAGES.map((s, i) => <li key={s.label} className={i < k || g.status === 'done' ? 'done' : i === k ? (g.status === 'failed' || g.status === 'canceled' ? 'failed' : 'current') : ''}>{s.label}{i === 2 && g.scenesTotal ? ` ${g.scenesDone}/${g.scenesTotal}` : ''}</li>)}
      </ol>
      <p className="muted small" data-testid="gen-status">
        {g.status === 'storyboard' && 'Le modèle écrit le storyboard…'}
        {g.status === 'review' && 'Relisez et corrigez le storyboard, puis faites écrire les scènes.'}
        {g.status === 'scenes' && `Le modèle écrit les scènes (${g.scenesDone}/${g.scenesTotal})…`}
        {g.status === 'done' && 'Terminé.'}
        {g.status === 'canceled' && 'Annulée.'}
        {' '}{Object.values(g.models).join(' · ')} · {tokens(g.usage)}
      </p>
      {g.status === 'failed' && <p className="error" role="alert">Échec : {g.error}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row wrap">
        {busy && <button onClick={() => void act(() => Api.cancelGeneration(g.id))}>Annuler</button>}
        {g.status === 'review' && <button className="primary" onClick={() => void writeScenes()}>Écrire les scènes</button>}
        {g.status === 'failed' && g.storyboard && !g.projectId && <button className="primary" onClick={() => void writeScenes()}>Réessayer les scènes</button>}
        {g.status === 'done' && g.projectId && <button className="primary" onClick={() => nav(`/p/${g.projectId}`)}>Ouvrir le projet</button>}
      </div>
      {g.status === 'done' && g.fallbacks.length > 0 && <p className="warn small">Scènes simplifiées (le modèle n'a pas produit de scène valide) : {g.fallbacks.join(', ')}. Retouchez-les dans l'éditeur.</p>}

      {sb && (g.status === 'review' || g.status === 'failed') && (
        <section className="storyboard" aria-label="storyboard">
          <div className="row wrap">
            <input className="grow title" value={sb.title} onChange={(e) => edit({ ...sb, title: e.target.value })} aria-label="titre du film" />
            <span className="muted small">{sb.scenes.length} scène(s) · {Math.round(total)} s visés · {sb.cast.length} personnage(s)</span>
          </div>
          <div className="cast-list">
            {sb.cast.map((c, i) => (
              <div key={c.id} className="card row wrap">
                <strong>{c.name}</strong><span className="muted small">{c.id} · {catalog.characters.find((x) => x.kind === c.kind)?.label ?? c.kind}</span>
                <input className="grow" value={c.description} placeholder="description" onChange={(e) => edit({ ...sb, cast: sb.cast.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} aria-label={`description de ${c.name}`} />
                <input value={c.voice ?? ''} placeholder="voix (facultatif)" onChange={(e) => edit({ ...sb, cast: sb.cast.map((x, j) => (j === i ? { ...x, voice: e.target.value || undefined } : x)) })} aria-label={`voix de ${c.name}`} />
              </div>
            ))}
          </div>
          <ol className="story-scenes">
            {sb.scenes.map((s, i) => <SceneCard key={s.id} s={s} speakers={sb.cast} onChange={(n) => edit({ ...sb, scenes: sb.scenes.map((x, j) => (j === i ? n : x)) })} onRemove={() => sb.scenes.length > 1 && edit({ ...sb, scenes: sb.scenes.filter((_, j) => j !== i) })} />)}
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
