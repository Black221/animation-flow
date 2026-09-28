import { checkAgainstLibrary, createEvaluator, timeProject } from '@af/engine';
import { catalog, registry } from '@af/library';
import { parseProject, type Project, type Scene } from '@af/schema';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Api, ApiError, getWorkspace, RANK, type ProjectDoc, type Publication } from '../api';
import { JsonEditor, type JsonIssue } from '../components/JsonEditor';
import { Player } from '../components/Player';
import { RenderPanel } from '../components/RenderPanel';
import { VoicesPanel } from '../components/VoicesPanel';
import { DrawingsPanel } from '../components/DrawingsPanel';
import { MusicPanel } from '../components/MusicPanel';
import { Icon, type IconName } from '@af/ui';
import { Loading } from '../components/Motion';
import { PHONE, TOUCH, useMedia } from '../media';
import { SceneForm } from '../components/SceneForm';
import { SceneThumb } from '../components/SceneThumb';
import { PublishDialog } from '../components/PublishDialog';
import { useUI } from '@af/ui';
import { useSoundtrack } from '../audio/useSoundtrack';
import { Timeline } from '../components/Timeline';
import { Playback } from '../playback';
import { useSession } from '../session';
import { useLive } from '../live';
import { CommentsPanel, openThreads, useComments, type CommentEvent } from '../components/Comments';

type Tab = 'scene' | 'voices' | 'drawings' | 'music' | 'project' | 'comments';
/** on a phone, the inspector keeps what works with a finger on a small screen: the scene, its voices, the comments */
const DESK_ONLY: Tab[] = ['drawings', 'music', 'project'];
const TABS: [Tab, IconName, string][] = [['scene', 'scene', 'Scène'], ['voices', 'mic', 'Voix'], ['drawings', 'brush', 'Dessins'], ['music', 'music', 'Musique'], ['project', 'sliders', 'Projet'], ['comments', 'message', 'Commentaires']];
/** the scene's code stays open once opened (this browser) */
const ADV = 'af-scene-code';
const advOpen = () => { try { return localStorage.getItem(ADV) === '1'; } catch { return false; } };
const setAdv = (v: boolean) => { try { localStorage.setItem(ADV, v ? '1' : '0'); } catch { /* private mode */ } };
// until the project is loaded, the soundtrack hook gets this (it mixes nothing while disabled)
const EMPTY = { schemaVersion: 1, title: '-', language: 'fr', fps: 24, width: 16, height: 16, style: 'flat', cast: {}, scenes: [] } as unknown as Project;

const withScene = (p: Project, i: number, s: unknown) => ({ ...p, scenes: p.scenes.map((x, k) => (k === i ? s : x)) });
const TAB_LABEL: Record<string, string> = { scene: 'scène', voices: 'voix', drawings: 'dessins', music: 'musique', project: 'projet', comments: 'commentaires' };
const issuesOf = (candidate: unknown): JsonIssue[] => { const r = parseProject(candidate); return r.ok ? [] : r.issues; };

export function Editor() {
  const { id = '' } = useParams();
  const [doc, setDoc] = useState<ProjectDoc | null>(null);
  const [restDraft, setRestDraft] = useState<Project | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<ProjectDoc | null>(null);
  const [saving, setSaving] = useState(false);
  // the selected scene, by id: it stays selected when someone else inserts, moves or removes scenes
  const [selId, setSelId] = useState<string | null>(null);
  const lastIndex = useRef(0);
  const [tab, setTab] = useState<Tab>('scene');
  const phone = useMedia(PHONE), touch = useMedia(TOUCH);
  // turned to a phone on a tab it does not show: back to the scene
  useEffect(() => { if (phone && DESK_ONLY.includes(tab)) setTab('scene'); }, [phone, tab]);
  const [resetN, setResetN] = useState(0);
  const [ask, setAsk] = useState('');
  const [asking, setAsking] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [undo, setUndo] = useState<{ id: string; scene: Scene } | null>(null);
  const pb = useMemo(() => new Playback(), []);
  const session = useSession();
  const [sound, setSound] = useState(true);
  const [liveSaving, setLiveSaving] = useState(false);
  const ui = useUI();
  const showKeys = useCallback(() => ui.info({ title: 'Raccourcis clavier', icon: 'keyboard', size: 'sm', body: (
    <dl className="keys">
      <dt><kbd>Espace</kbd></dt><dd>lecture / pause</dd>
      <dt><kbd>Ctrl</kbd> + <kbd>S</kbd></dt><dd>enregistrer une version</dd>
      <dt><kbd>?</kbd></dt><dd>cette aide</dd>
      <dt>clic sur l'aperçu</dt><dd>lecture / pause</dd>
      <dt>clic sur la frise</dt><dd>aller à ce moment ; sur un titre : choisir la scène</dd>
    </dl>) }), [ui]);
  const [publication, setPublication] = useState<Publication | null>(null);
  const [publishing, setPublishing] = useState(false);
  useEffect(() => { Api.projectPublication(id).then((r) => setPublication(r.publication)).catch(() => undefined); }, [id]);

  // live co-editing when the WebSocket is there; otherwise (fallback) the project is saved by hand below
  const comments = useComments(id, session.epoch);
  const live = useLive(id, session.epoch, (name, data) => { if (name === 'comments') comments.apply(data as CommentEvent); });
  const liveOn = live.status !== 'offline' && live.status !== 'connecting' ? !!live.project : false;
  const fellBack = useRef(false);
  useEffect(() => {
    // the live connection ended for good after working: carry on by hand from what it had
    if (live.status === 'offline' && live.project && !fellBack.current) {
      fellBack.current = true;
      setRestDraft(live.project); setDirty(live.unsaved); setDoc((d) => (d ? { ...d, version: live.version || d.version } : d));
    }
  }, [live.status, live.project, live.unsaved, live.version]);
  const project = liveOn ? live.project : restDraft;
  const editable = session.can('editor') && (!liveOn || live.canEdit);
  const unsaved = liveOn ? live.unsaved : dirty;
  const version = liveOn ? live.version : doc?.version ?? 0;

  const load = useCallback(async () => {
    try {
      const d = await Api.project(id), r = parseProject(d.project);
      setDoc(d); setRestDraft(r.ok ? r.project : d.project); setDirty(false); setConflict(null); setResetN((n) => n + 1); setError('');
    } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const update = (p: Project) => {
    const r = parseProject(p);
    if (!r.ok) return;
    if (liveOn) live.edit(r.project);
    else { setRestDraft(r.project); setDirty(true); }
  };

  const save = useCallback(async (baseVersion?: number): Promise<boolean> => {
    if (liveOn) { setLiveSaving(true); try { const ok = await live.save(); if (ok) ui.toast('Version enregistrée'); return ok; } finally { setLiveSaving(false); } }
    if (!doc || !restDraft) return false;
    setSaving(true);
    try {
      const d = await Api.saveProject(doc.id, restDraft, baseVersion ?? doc.version);
      setDoc(d); setDirty(false); setConflict(null); setError(''); ui.toast(`Version ${d.version} enregistrée`);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(e.body.current);
      else setError((e as Error).message);
      return false;
    } finally { setSaving(false); }
  }, [doc, restDraft, liveOn, live.save]);

  // keyboard: space plays, Ctrl/Cmd+S saves
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('textarea, input, select');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveRef.current(); }
      else if (e.key === ' ' && !typing) { e.preventDefault(); pb.toggle(); }
      else if (e.key === '?' && !typing) { e.preventDefault(); showKeys(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pb]);
  useEffect(() => {
    // live: the server saves what it received; only what has not reached it yet would be lost
    const pending = liveOn ? live.unconfirmed > 0 : dirty;
    const warn = (e: BeforeUnloadEvent) => { if (pending) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, liveOn, live.unconfirmed]);

  const timeline = useMemo(() => (project ? timeProject(project) : null), [project]);
  const thumbs = useMemo(() => (project ? createEvaluator(project, registry) : null), [project]);
  const soundtrack = useSoundtrack(project ?? EMPTY, sound && !!project);
  const warnings = useMemo(() => (project ? checkAgainstLibrary(project, registry, catalog) : []), [project]);
  const found = project ? project.scenes.findIndex((s) => s.id === selId) : -1;
  const i = project ? (found >= 0 ? found : Math.min(lastIndex.current, project.scenes.length - 1)) : 0;
  lastIndex.current = i;
  const sceneId = project?.scenes[i]?.id ?? null;
  useEffect(() => { if (liveOn) live.presence(sceneId, tab); }, [liveOn, sceneId, tab, live.presence]);

  if (error && !project) return <div className="page"><p className="error">{error}</p><Link to="/">← Projets</Link></div>;
  if (!project || !doc || !timeline || !thumbs) return <Loading />;
  const draft = project; // what the editor shows and edits, live or not
  const scene = draft.scenes[i]!;
  const open = openThreads(comments.list);
  const others = live.peers.filter((p, k, all) => p.userId !== live.you?.userId && all.findIndex((q) => q.userId === p.userId) === k);
  const where = (p: { sceneId: string | null; tab: string | null }) => [p.sceneId && `scène ${p.sceneId}`, p.tab && p.tab !== 'scene' && TAB_LABEL[p.tab]].filter(Boolean).join(', ');

  const setSel = (k: number) => setSelId(draft.scenes[k]?.id ?? null);
  const select = (k: number) => { setSel(k); setTab('scene'); pb.pause(); pb.seek(timeline.scenes[k]!.start); };
  const addScene = () => {
    const n = draft.scenes.length + 1;
    let sid = `s${n}`; while (draft.scenes.some((s) => s.id === sid)) sid += 'b';
    const s: Scene = { id: sid, title: 'Nouvelle scène', duration: 5, decor: { kind: 'plain', params: {} }, narration: [], elements: [], camera: [], transition: 'cut', music: { mood: 'none', gain: 0 }, sfx: [] };
    update({ ...draft, scenes: [...draft.scenes.slice(0, i + 1), s, ...draft.scenes.slice(i + 1)] }); setSelId(sid); lastIndex.current = i + 1; setResetN((x) => x + 1);
  };
  const removeScene = async () => { if (draft.scenes.length < 2 || !(await ui.confirm({ title: `Supprimer la scène « ${scene.title || scene.id} » ?`, message: 'Ses répliques, ses éléments et ses mouvements de caméra seront supprimés. Vous pouvez encore revenir en arrière en rechargeant la version enregistrée.', confirm: 'Supprimer', danger: true }))) return; update({ ...draft, scenes: draft.scenes.filter((_, k) => k !== i) }); setSelId(draft.scenes[i > 0 ? i - 1 : 1]!.id); setResetN((x) => x + 1); };
  const moveScene = (d: -1 | 1) => { const j = i + d; if (j < 0 || j >= draft.scenes.length) return; const s = draft.scenes.slice(); [s[i], s[j]] = [s[j]!, s[i]!]; update({ ...draft, scenes: s }); setResetN((x) => x + 1); };
  const downloadSrt = async () => {
    const r = await fetch(`/api/projects/${doc.id}/subtitles.srt`, { headers: { 'x-workspace-id': getWorkspace() } });
    if (!r.ok) return setError('export des sous-titres impossible');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `${draft.title}.srt`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="editor">
      <div className="editor-bar">
        <Link to="/projects" className="back" title="Mes projets"><span className="logo small" aria-hidden><Icon name="play" /></span><Icon name="back" size={16} /> Projets</Link>
        <h1 title={draft.title}>{draft.title}{doc.remixOf && <Link to={`/c/${doc.remixOf.id}`} className="origin" title="le film d'origine, dans la communauté"><Icon name="remix" size={13} /> remix de « {doc.remixOf.title} »</Link>}</h1>
        <span className={`badge${unsaved ? ' warn' : ''}`} data-testid="save-state" title={liveOn ? 'enregistrement automatique' : undefined}>{unsaved ? 'modifié' : `version ${version}`}</span>
        {!unsaved && (liveOn ? live.savedBy ?? doc.updatedBy : doc.updatedBy) && <span className="muted small" data-testid="author">par {liveOn ? live.savedBy ?? doc.updatedBy : doc.updatedBy}</span>}
        {live.status === 'reconnecting' && <span className="badge warn" data-testid="live-state">reconnexion…</span>}
        {live.status === 'offline' && <span className="badge" data-testid="live-state" title="la connexion en direct n'a pas pu être établie : enregistrez à la main">hors direct</span>}
        {liveOn && (
          <ul className="peers" aria-label="personnes présentes" data-testid="peers">
            {others.map((p) => <li key={p.userId} style={{ background: p.color }} title={`${p.name}${where(p) ? ` · ${where(p)}` : ''}`}>{p.name.slice(0, 1).toUpperCase()}<span className="sr-only"> {p.name}</span></li>)}
          </ul>
        )}
        {editable ? <button onClick={() => setPublishing(true)} className={publication ? 'published' : ''} title={publication ? 'publié dans la communauté : republier, voir ou retirer' : 'partager ce film avec la communauté'}><Icon name="globe" size={16} /> {publication ? 'Publié' : 'Publier'}</button>
          : publication && <Link to={`/c/${publication.id}`} className="button"><Icon name="globe" size={16} /> Voir dans la communauté</Link>}
        {!touch && <button className="icon ghost" onClick={showKeys} aria-label="raccourcis clavier" title="raccourcis clavier (?)"><Icon name="keyboard" size={17} /></button>}
        {!phone && <button onClick={downloadSrt} title="télécharger les sous-titres"><Icon name="subtitles" size={16} /> Sous-titres .srt</button>}
        {editable ? (liveOn
          ? <button className="primary" onClick={() => void save()} disabled={liveSaving} title="enregistré automatiquement ; ceci clôt la version en cours (Ctrl+S)"><Icon name="save" size={16} />{liveSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
          : <button className="primary" onClick={() => void save()} disabled={!dirty || saving}><Icon name="save" size={16} />{saving ? 'Enregistrement…' : 'Enregistrer'}</button>)
          : <span className="readonly-note" data-testid="read-only">Lecture seule (rôle lecteur)</span>}
      </div>
      {publishing && <PublishDialog projectId={doc.id} title={draft.title} unsaved={unsaved} save={() => save()} publication={publication} onClose={() => setPublishing(false)} onDone={(p) => { setPublication(p); setPublishing(false); }} />}
      {live.note && (
        <div className={`banner ${live.note.kind === 'error' ? 'error' : 'warn'}`} role="status" data-testid="live-note">
          {live.note.text} <button onClick={live.clearNote} aria-label="fermer">✕</button>
        </div>
      )}
      {conflict && !liveOn && (
        <div className="banner warn" role="alert">
          Quelqu'un a enregistré la version {conflict.version} pendant que vous travailliez.
          <button onClick={() => void load()}>Recharger sa version</button>
          <button onClick={() => void save(conflict.version)}>Garder la mienne</button>
        </div>
      )}
      {error && <div className="banner error" role="alert">{error}</div>}

      <aside className="scenes">
        <h3>Scènes · {timeline.duration.toFixed(0)} s</h3>
        <ol>
          {draft.scenes.map((s, k) => (
            <li key={s.id + k}>
              <button className={k === i ? 'active' : ''} onClick={() => select(k)}>
                <SceneThumb ev={thumbs} t={timeline.scenes[k]!.start + Math.min(timeline.scenes[k]!.duration * 0.6, 2.5)} />
                <span className="scene-name">{s.title || 'sans titre'}</span>
                <span className="scene-meta">
                  <span className="sid">{s.id}</span> {timeline.scenes[k]!.duration.toFixed(1)} s
                  {open[s.id] ? <span className="comment-count" title={`${open[s.id]} commentaire(s) ouvert(s)`} aria-label={`${open[s.id]} commentaire(s) ouvert(s)`}>{open[s.id]}</span> : null}
                  {others.filter((p) => p.sceneId === s.id).map((p) => <span key={p.userId} className="peer-dot" style={{ background: p.color }} title={`${p.name} est ici`} aria-label={`${p.name} est ici`} />)}
                </span>
              </button>
            </li>
          ))}
        </ol>
        {editable && <div className="row">
          <button onClick={addScene} title="ajouter une scène après celle-ci" className="grow"><Icon name="plus" size={16} /> scène</button>
          <button className="icon" onClick={() => moveScene(-1)} disabled={i === 0} aria-label="monter la scène" title="monter"><Icon name="up" size={16} /></button>
          <button className="icon" onClick={() => moveScene(1)} disabled={i === draft.scenes.length - 1} aria-label="descendre la scène" title="descendre"><Icon name="down" size={16} /></button>
          <button className="icon danger-ghost" onClick={removeScene} disabled={draft.scenes.length < 2} aria-label="supprimer la scène" title="supprimer"><Icon name="trash" size={16} /></button>
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
        <RenderPanel projectId={doc.id} project={draft} sceneId={scene.id} dirty={unsaved} saveFirst={() => save()} readOnly={!editable} />
      </section>

      <aside className="inspector">
        <div className="tabs" role="tablist">
          {TABS.filter(([t]) => !phone || !DESK_ONLY.includes(t)).map(([t, icon, label]) => {
            const n = t === 'comments' ? Object.values(open).reduce((a, b) => a + b, 0) : 0;
            return (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)} title={t === 'scene' ? `Scène ${scene.id}` : label}>
                <Icon name={icon} size={17} /> {label}{t === 'scene' && <span className="sr-only"> {scene.id}</span>}
                {n > 0 && <><span className="count" aria-hidden>{n}</span><span className="sr-only">{` (${n})`}</span></>}
              </button>
            );
          })}
        </div>
        {phone && <p className="muted small desk-note"><Icon name="monitor" size={13} /> Dessins, musique et réglages du projet : sur une tablette ou un ordinateur.</p>}
        {tab === 'scene' && editable && (
          <form className="ai-edit" aria-label="modifier avec l'IA" onSubmit={(e) => { e.preventDefault(); void (async () => {
            setAsking(true); setAiNote('');
            try {
              const r = await Api.editScene(draft, i, ask.trim());
              // the scene, with what it needed drawn for it (new props, characters, decors)
              setUndo({ id: scene.id, scene }); update({ ...withScene(draft, i, r.scene), assets: { ...draft.assets, ...r.assets }, cast: { ...draft.cast, ...r.cast }, sounds: { ...draft.sounds, ...r.sounds } } as Project); setResetN((x) => x + 1); setAsk('');
              const made = r.drawn.map((d) => `${r.assets[d.id]?.name ?? d.id}${d.fallback ? ' (simplifié)' : ''}`);
              setAiNote(`${r.model} · ${r.usage.inputTokens}+${r.usage.outputTokens} tokens${made.length ? ` · dessiné pour l'occasion : ${made.join(', ')}` : ''}`);
            } catch (err) {
              const b = (err as { body?: { issues?: { path: string; message: string }[] } }).body;
              setAiNote(`${(err as Error).message}${b?.issues?.length ? ` : ${b.issues.slice(0, 2).map((x) => `${x.path} ${x.message}`).join(' ; ')}` : ''}`);
            } finally { setAsking(false); }
          })(); }}>
            <span className="head"><Icon name="wand" size={17} /> Modifier la scène {scene.id} avec l'IA</span>
            <div className="row">
              <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="« Jumo arrive par la gauche », « plus de mouvements de caméra »…" aria-label="modification demandée à l'IA" />
              <button type="submit" className="primary" disabled={asking || ask.trim().length < 3}>{asking ? 'L\'IA travaille…' : 'Modifier'}</button>
            </div>
            {undo && undo.id === scene.id && <button type="button" onClick={() => { update(withScene(draft, i, undo.scene) as Project); setUndo(null); setResetN((x) => x + 1); setAiNote('modification annulée'); }}>Annuler la modification</button>}
            {aiNote && <span className="muted small" data-testid="ai-note">{aiNote}</span>}
          </form>
        )}
        {tab === 'scene' && <SceneForm project={draft} scene={scene} readOnly={!editable} duration={timeline.scenes[i]!.duration} onChange={(s) => update(withScene(draft, i, s) as Project)} />}
        {tab === 'scene' && (
          <details className="advanced" open={advOpen()} onToggle={(e) => setAdv((e.target as HTMLDetailsElement).open)}>
            <summary><Icon name="code" size={15} /> Code de la scène (JSON)</summary>
            <JsonEditor label="scène (JSON)" readOnly={!editable} value={scene} resetKey={`scene:${scene.id}:${resetN}`} remoteKey={live.remoteN} validate={(v) => issuesOf(withScene(draft, i, v))} onApply={(v) => update(withScene(draft, i, v) as Project)} />
          </details>
        )}
        {tab === 'voices' && <VoicesPanel project={draft} onChange={update} readOnly={!editable} />}
        {tab === 'drawings' && <DrawingsPanel project={draft} onChange={update} readOnly={!editable} resetKey={String(resetN)} remoteKey={live.remoteN} />}
        {tab === 'music' && <MusicPanel project={draft} onChange={update} readOnly={!editable} resetKey={String(resetN)} remoteKey={live.remoteN} />}
        {tab === 'project' && (
          <div className="form">
            <label>Titre <input value={draft.title} onChange={(e) => e.target.value.trim() && update({ ...draft, title: e.target.value })} /></label>
            <label>Images par seconde
              <select value={draft.fps} onChange={(e) => update({ ...draft, fps: +e.target.value as Project['fps'] })}>{[24, 25, 30].map((f) => <option key={f}>{f}</option>)}</select>
            </label>
            <label>Langue <input value={draft.language} onChange={(e) => update({ ...draft, language: e.target.value || 'fr' })} /></label>
            <p className="muted small">{draft.width} × {draft.height} · {timeline.duration.toFixed(1)} s · {timeline.frames} images · {draft.scenes.length} scène(s)
              {timeline.scenes.some((s) => s.lines.some((l) => l.estimated)) && ' · durées des répliques estimées (pas encore de voix enregistrée)'}</p>
            <div className="row wrap">
              <button type="button" onClick={() => void Api.exportProject(doc.id).catch((e) => ui.toast((e as Error).message, 'error'))} title="le projet enregistré, avec ses images et ses sons : à garder, ou à joindre comme modèle au prompt d’une nouvelle génération"><Icon name="download" size={16} /> Exporter le projet</button>
              <button type="button" className="ghost" onClick={() => void Api.exportProject(doc.id, false).catch((e) => ui.toast((e as Error).message, 'error'))} title="le projet seul (JSON), sans ses médias : léger">JSON seul</button>
            </div>
          </div>
        )}
        {tab === 'comments' && (
          <CommentsPanel state={comments} project={draft} sceneId={scene.id} sceneStart={timeline.scenes[i]!.start} sceneDuration={timeline.scenes[i]!.duration} pb={pb}
            me={session.me?.user?.id ?? null} canResolve={session.can('editor')} canModerate={session.can('admin')}
            onSeek={(sid, t) => { const k = draft.scenes.findIndex((s) => s.id === sid); if (k < 0) return; setSelId(sid); pb.pause(); pb.seek(timeline.scenes[k]!.start + t); }} />
        )}
        {tab === 'project' && (
          <details className="advanced">
            <summary><Icon name="cast" size={15} /> Distribution (JSON) : {Object.values(draft.cast).map((c) => c.name).join(', ') || 'personne'}</summary>
            <JsonEditor label="distribution (JSON)" readOnly={!editable} value={draft.cast} resetKey={`cast:${resetN}`} remoteKey={live.remoteN} validate={(v) => issuesOf({ ...draft, cast: v })} onApply={(v) => update({ ...draft, cast: v as Project['cast'] })} />
          </details>
        )}
      </aside>
    </div>
  );
}
