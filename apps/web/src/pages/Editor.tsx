import { checkAgainstLibrary, timeProject } from '@af/engine';
import { catalog, registry } from '@af/library';
import { parseProject, type Project, type Scene } from '@af/schema';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Api, ApiError, getWorkspace, RANK, type ProjectDoc } from '../api';
import { JsonEditor, type JsonIssue } from '../components/JsonEditor';
import { Player } from '../components/Player';
import { RenderPanel } from '../components/RenderPanel';
import { VoicesPanel } from '../components/VoicesPanel';
import { useSoundtrack } from '../audio/useSoundtrack';
import { Timeline } from '../components/Timeline';
import { Playback } from '../playback';
import { useSession } from '../session';

type Tab = 'scene' | 'voices' | 'project' | 'cast';
// until the project is loaded, the soundtrack hook gets this (it mixes nothing while disabled)
const EMPTY = { schemaVersion: 1, title: '-', language: 'fr', fps: 24, width: 16, height: 16, style: 'flat', cast: {}, scenes: [] } as unknown as Project;

const withScene = (p: Project, i: number, s: unknown) => ({ ...p, scenes: p.scenes.map((x, k) => (k === i ? s : x)) });
const issuesOf = (candidate: unknown): JsonIssue[] => { const r = parseProject(candidate); return r.ok ? [] : r.issues; };

export function Editor() {
  const { id = '' } = useParams();
  const [doc, setDoc] = useState<ProjectDoc | null>(null);
  const [draft, setDraft] = useState<Project | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<ProjectDoc | null>(null);
  const [saving, setSaving] = useState(false);
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<Tab>('scene');
  const [resetN, setResetN] = useState(0);
  const [ask, setAsk] = useState('');
  const [asking, setAsking] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [undo, setUndo] = useState<{ index: number; scene: Scene } | null>(null);
  const pb = useMemo(() => new Playback(), []);
  const editable = useSession().can('editor');
  const [sound, setSound] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await Api.project(id), r = parseProject(d.project);
      setDoc(d); setDraft(r.ok ? r.project : d.project); setDirty(false); setConflict(null); setResetN((n) => n + 1); setError('');
    } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const update = (p: Project) => { const r = parseProject(p); if (r.ok) { setDraft(r.project); setDirty(true); } };

  const save = useCallback(async (baseVersion?: number): Promise<boolean> => {
    if (!doc || !draft) return false;
    setSaving(true);
    try {
      const d = await Api.saveProject(doc.id, draft, baseVersion ?? doc.version);
      setDoc(d); setDirty(false); setConflict(null); setError('');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(e.body.current);
      else setError((e as Error).message);
      return false;
    } finally { setSaving(false); }
  }, [doc, draft]);

  // keyboard: space plays, Ctrl/Cmd+S saves
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('textarea, input, select');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveRef.current(); }
      else if (e.key === ' ' && !typing) { e.preventDefault(); pb.toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pb]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const timeline = useMemo(() => (draft ? timeProject(draft) : null), [draft]);
  const soundtrack = useSoundtrack(draft ?? EMPTY, sound && !!draft);
  const warnings = useMemo(() => (draft ? checkAgainstLibrary(draft, registry, catalog) : []), [draft]);

  if (error && !draft) return <div className="page"><p className="error">{error}</p><Link to="/">← Projets</Link></div>;
  if (!draft || !doc || !timeline) return <div className="page muted">Chargement…</div>;
  const i = Math.min(sel, draft.scenes.length - 1), scene = draft.scenes[i]!;

  const select = (k: number) => { setSel(k); setTab('scene'); pb.pause(); pb.seek(timeline.scenes[k]!.start); };
  const addScene = () => {
    const n = draft.scenes.length + 1;
    let sid = `s${n}`; while (draft.scenes.some((s) => s.id === sid)) sid += 'b';
    const s: Scene = { id: sid, title: 'Nouvelle scène', duration: 5, decor: { kind: 'plain', params: {} }, narration: [], elements: [], camera: [], transition: 'cut', music: { mood: 'none', gain: 0 }, sfx: [] };
    update({ ...draft, scenes: [...draft.scenes.slice(0, i + 1), s, ...draft.scenes.slice(i + 1)] }); setSel(i + 1); setResetN((x) => x + 1);
  };
  const removeScene = () => { if (draft.scenes.length < 2 || !confirm(`Supprimer la scène « ${scene.title || scene.id} » ?`)) return; update({ ...draft, scenes: draft.scenes.filter((_, k) => k !== i) }); setSel(Math.max(0, i - 1)); setResetN((x) => x + 1); };
  const moveScene = (d: -1 | 1) => { const j = i + d; if (j < 0 || j >= draft.scenes.length) return; const s = draft.scenes.slice(); [s[i], s[j]] = [s[j]!, s[i]!]; update({ ...draft, scenes: s }); setSel(j); setResetN((x) => x + 1); };
  const downloadSrt = async () => {
    const r = await fetch(`/api/projects/${doc.id}/subtitles.srt`, { headers: { 'x-workspace-id': getWorkspace() } });
    if (!r.ok) return setError('export des sous-titres impossible');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `${draft.title}.srt`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="editor">
      <div className="editor-bar">
        <Link to="/" className="muted">← Projets</Link>
        <h1 title={draft.title}>{draft.title}</h1>
        <span className={`badge${dirty ? ' warn' : ''}`} data-testid="save-state">{dirty ? 'modifié' : `version ${doc.version}`}</span>
        {!dirty && doc.updatedBy && <span className="muted small" data-testid="author">par {doc.updatedBy}</span>}
        <button onClick={downloadSrt}>Sous-titres .srt</button>
        {editable ? <button className="primary" onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          : <span className="readonly-note" data-testid="read-only">Lecture seule (rôle lecteur)</span>}
      </div>
      {conflict && (
        <div className="banner warn" role="alert">
          Quelqu'un a enregistré la version {conflict.version} pendant que vous travailliez.
          <button onClick={() => void load()}>Recharger sa version</button>
          <button onClick={() => void save(conflict.version)}>Garder la mienne</button>
        </div>
      )}
      {error && <div className="banner error" role="alert">{error}</div>}

      <aside className="scenes">
        <h3>Scènes</h3>
        <ol>
          {draft.scenes.map((s, k) => (
            <li key={s.id + k}>
              <button className={k === i ? 'active' : ''} onClick={() => select(k)}>
                <span className="sid">{s.id}</span> {s.title || 'sans titre'}
                <span className="muted small">{timeline.scenes[k]!.duration.toFixed(1)} s</span>
              </button>
            </li>
          ))}
        </ol>
        {editable && <div className="row">
          <button onClick={addScene} title="ajouter une scène après celle-ci">+ scène</button>
          <button onClick={() => moveScene(-1)} disabled={i === 0} aria-label="monter la scène">↑</button>
          <button onClick={() => moveScene(1)} disabled={i === draft.scenes.length - 1} aria-label="descendre la scène">↓</button>
          <button onClick={removeScene} disabled={draft.scenes.length < 2} aria-label="supprimer la scène">✕</button>
        </div>}
        {warnings.length > 0 && (
          <div className="warnings">
            <h4>À vérifier</h4>
            <ul>{warnings.map((w, k) => <li key={k}><code>{w.path}</code> {w.message}</li>)}</ul>
          </div>
        )}
      </aside>

      <section className="center">
        <Player project={draft} pb={pb} style={draft.style} onStyle={(s) => update({ ...draft, style: s })}
          audio={soundtrack.buffer} sound={sound} onSound={setSound}
          soundInfo={!sound ? '' : soundtrack.error ? `son : ${soundtrack.error}` : soundtrack.mixing ? 'mixage du son…' : soundtrack.missing.length ? `${soundtrack.missing.length} réplique(s) sans voix` : soundtrack.buffer ? 'son prêt' : ''} />
        <Timeline project={draft} timeline={timeline} pb={pb} selected={i} onSelect={select} />
        <RenderPanel projectId={doc.id} project={draft} sceneId={scene.id} dirty={dirty} saveFirst={() => save()} readOnly={!editable} />
      </section>

      <aside className="inspector">
        <div className="tabs" role="tablist">
          {(['scene', 'voices', 'project', 'cast'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'scene' ? `Scène ${scene.id}` : t === 'voices' ? 'Voix' : t === 'project' ? 'Projet' : 'Distribution'}
            </button>
          ))}
        </div>
        {tab === 'scene' && editable && (
          <form className="ai-edit" onSubmit={(e) => { e.preventDefault(); void (async () => {
            setAsking(true); setAiNote('');
            try {
              const r = await Api.editScene(draft, i, ask.trim());
              setUndo({ index: i, scene }); update(withScene(draft, i, r.scene) as Project); setResetN((x) => x + 1); setAsk('');
              setAiNote(`${r.model} · ${r.usage.inputTokens}+${r.usage.outputTokens} tokens`);
            } catch (err) {
              const b = (err as { body?: { issues?: { path: string; message: string }[] } }).body;
              setAiNote(`${(err as Error).message}${b?.issues?.length ? ` : ${b.issues.slice(0, 2).map((x) => `${x.path} ${x.message}`).join(' ; ')}` : ''}`);
            } finally { setAsking(false); }
          })(); }}>
            <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Demander une modification à l'IA : « Jumo arrive par la gauche », « plus de mouvements de caméra »…" aria-label="modification demandée à l'IA" />
            <button type="submit" disabled={asking || ask.trim().length < 3}>{asking ? 'L\'IA travaille…' : 'Modifier'}</button>
            {undo && undo.index === i && <button type="button" onClick={() => { update(withScene(draft, undo.index, undo.scene) as Project); setUndo(null); setResetN((x) => x + 1); setAiNote('modification annulée'); }}>Annuler la modification</button>}
            {aiNote && <span className="muted small" data-testid="ai-note">{aiNote}</span>}
          </form>
        )}
        {tab === 'scene' && (
          <JsonEditor label="scène (JSON)" readOnly={!editable} value={scene} resetKey={`scene:${i}:${resetN}`} validate={(v) => issuesOf(withScene(draft, i, v))} onApply={(v) => update(withScene(draft, i, v) as Project)} />
        )}
        {tab === 'voices' && <VoicesPanel project={draft} onChange={update} readOnly={!editable} />}
        {tab === 'project' && (
          <div className="form">
            <label>Titre <input value={draft.title} onChange={(e) => e.target.value.trim() && update({ ...draft, title: e.target.value })} /></label>
            <label>Images par seconde
              <select value={draft.fps} onChange={(e) => update({ ...draft, fps: +e.target.value as Project['fps'] })}>{[24, 25, 30].map((f) => <option key={f}>{f}</option>)}</select>
            </label>
            <label>Langue <input value={draft.language} onChange={(e) => update({ ...draft, language: e.target.value || 'fr' })} /></label>
            <p className="muted small">{draft.width} × {draft.height} · {timeline.duration.toFixed(1)} s · {timeline.frames} images · {draft.scenes.length} scène(s)
              {timeline.scenes.some((s) => s.lines.some((l) => l.estimated)) && ' · durées des répliques estimées (pas encore de voix enregistrée)'}</p>
          </div>
        )}
        {tab === 'cast' && (
          <JsonEditor label="distribution (JSON)" readOnly={!editable} value={draft.cast} resetKey={`cast:${resetN}`} validate={(v) => issuesOf({ ...draft, cast: v })} onApply={(v) => update({ ...draft, cast: v as Project['cast'] })} />
        )}
      </aside>
    </div>
  );
}
