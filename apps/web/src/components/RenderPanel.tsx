// Video renders of the project: pick where the film goes (a preset sets everything), or set the file, the shape,
// the framing, the size and the subtitles one by one; start a render of the saved version, follow it live, watch it.
import { Icon } from '@af/ui';
import type { Project } from '@af/schema';
import { stylePacks } from '@af/styles';
import { useCallback, useEffect, useState } from 'react';
import { Api, type Framing, type OutputAspect, type OutputFormat, type RenderJob, type RenderRequest } from '../api';
import { usePlan, widthText } from '../plan';

const STATUS: Record<RenderJob['status'], string> = { queued: 'en attente', running: 'en cours', done: 'terminé', failed: 'échec', canceled: 'annulé' };
const QUALITY: Record<RenderRequest['quality'], string> = { draft: 'brouillon', standard: 'standard', high: 'haute' };
const FORMATS: Record<OutputFormat, { label: string; hint: string }> = {
  mp4: { label: 'MP4', hint: 'H.264 et AAC : se lit partout, sur tous les réseaux' },
  webm: { label: 'WebM', hint: 'VP9 et Opus : plus léger, pour un site web' },
  gif: { label: 'GIF', hint: 'animé, sans son, 15 images par seconde : 60 s et 540 lignes au plus' },
};
const ASPECT: Record<OutputAspect, { label: string; w: number; h: number }> = {
  '16:9': { label: 'Paysage', w: 16, h: 9 }, '9:16': { label: 'Vertical', w: 9, h: 16 }, '1:1': { label: 'Carré', w: 1, h: 1 }, '4:5': { label: 'Portrait', w: 4, h: 5 },
};
const FRAMING: Record<Framing, { label: string; hint: string }> = {
  follow: { label: 'Suivre l’action', hint: 'le cadre suit les personnages, surtout celui qui parle ; les titres sont replacés en entier' },
  center: { label: 'Centre', hint: 'le cadre reste au milieu de l’image' },
  fit: { label: 'Image entière', hint: 'tout le film, sur un fond flou ; les sous-titres vont dessous' },
};
const SUBS: Record<RenderRequest['subtitles'], string> = { track: 'piste (activable)', burned: 'incrustés dans l’image', off: 'aucun' };
const SIZES = [360, 540, 720, 1080] as const;
type Settings = Pick<RenderRequest, 'format' | 'aspect' | 'framing' | 'size' | 'subtitles'>;
/** where the film goes: each sets the file, the shape, the framing and the subtitles */
const PRESETS: { id: string; label: string; icon: 'film' | 'globe' | 'heart' | 'sparkles'; s: Partial<Settings> }[] = [
  { id: 'youtube', label: 'YouTube · 16:9', icon: 'film', s: { format: 'mp4', aspect: '16:9', subtitles: 'track' } },
  { id: 'short', label: 'TikTok · Reels · Shorts', icon: 'sparkles', s: { format: 'mp4', aspect: '9:16', framing: 'follow', subtitles: 'burned' } },
  { id: 'square', label: 'Instagram carré', icon: 'heart', s: { format: 'mp4', aspect: '1:1', framing: 'follow', subtitles: 'burned' } },
  { id: 'portrait', label: 'Instagram portrait 4:5', icon: 'heart', s: { format: 'mp4', aspect: '4:5', framing: 'follow', subtitles: 'burned' } },
  { id: 'web', label: 'Site web · WebM', icon: 'globe', s: { format: 'webm', aspect: '16:9', subtitles: 'track' } },
  { id: 'gif', label: 'GIF animé', icon: 'sparkles', s: { format: 'gif', size: 360, subtitles: 'burned' } },
];
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const outputSize = (size: number, a: OutputAspect) => { const r = ASPECT[a].w / ASPECT[a].h; return r >= 1 ? [even(size * r), even(size)] : [even(size), even(size / r)]; };
const mb = (b: number | null) => (b == null ? '' : `${(b / 1e6).toFixed(1)} Mo`);
// open-source Chromium builds lack H.264: say so rather than show a broken player
const canPlay = (f: OutputFormat) => f === 'gif' || (typeof document !== 'undefined' && document.createElement('video').canPlayType(f === 'webm' ? 'video/webm; codecs="vp9"' : 'video/mp4; codecs="avc1.42E01E"') !== '');

function AspectIcon({ a }: { a: OutputAspect }) {
  const { w, h } = ASPECT[a], k = 14 / Math.max(w, h);
  return <span className="aspect-icon" aria-hidden style={{ width: Math.round(w * k), height: Math.round(h * k) }} />;
}

export function RenderPanel({ projectId, project, sceneId, dirty, saveFirst, readOnly = false }: {
  projectId: string; project: Project; sceneId: string; dirty: boolean; readOnly?: boolean;
  /** saves the draft; resolves false if it could not */
  saveFirst: () => Promise<boolean>;
}) {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [style, setStyle] = useState(project.style);
  const [set, setSet] = useState<Settings>({ format: 'mp4', aspect: '16:9', framing: 'follow', size: 720, subtitles: 'track' });
  const change = (p: Partial<Settings>) => setSet((s) => {
    const n = { ...s, ...p };
    // a GIF: small, no subtitle track
    if (n.format === 'gif') { if (n.size > 540) n.size = 540; if (n.subtitles === 'track') n.subtitles = 'burned'; }
    return n;
  });
  // the plan's sharpest video: sharper ones are shown, not offered
  const { plan, refresh: refreshPlan } = usePlan(), maxWidth = plan?.limits.maxWidth ?? 1920, maxSize = Math.round((maxWidth * 9) / 16);
  useEffect(() => { if (set.size > maxSize) change({ size: SIZES.filter((s) => s <= maxSize).at(-1) ?? 360 }); }, [maxSize]); // eslint-disable-line react-hooks/exhaustive-deps
  const [quality, setQuality] = useState<RenderRequest['quality']>('standard');
  const [scope, setScope] = useState<'film' | 'scene'>('film');
  const [audio, setAudio] = useState(true);
  const [watching, setWatching] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const gif = set.format === 'gif', reshaped = set.aspect !== '16:9', [ow, oh] = outputSize(set.size, set.aspect);
  const preset = PRESETS.find((p) => Object.entries(p.s).every(([k, v]) => set[k as keyof Settings] === v))?.id;

  useEffect(() => { setStyle(project.style); }, [project.style]);
  const refresh = useCallback(() => Api.renders(projectId).then(setJobs).catch((e) => setError((e as Error).message)), [projectId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => { if (!active) return; const t = setInterval(() => void refresh(), 1000); return () => clearInterval(t); }, [active, refresh]);

  const start = async () => {
    setBusy(true); setError('');
    try {
      if (dirty && !(await saveFirst())) return;
      const j = await Api.startRender(projectId, { style, ...set, quality, audio: audio && !gif, ...(scope === 'scene' ? { sceneId } : {}) });
      setJobs((all) => [j, ...all]); void refreshPlan();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const act = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { setError((e as Error).message); } void refresh(); };
  const shown = jobs.find((j) => j.id === watching && j.videoUrl) ?? jobs.find((j) => j.videoUrl);
  const shownFormat = shown?.options.format ?? 'mp4';

  return (
    <section className="card render-panel" aria-label="rendu vidéo">
      <h3><Icon name="film" size={18} /> Vidéo</h3>
      {!readOnly && <>
        <div className="presets" role="group" aria-label="destinations">
          {PRESETS.map((p) => <button key={p.id} type="button" className={`chip${preset === p.id ? ' on' : ''}`} aria-pressed={preset === p.id} onClick={() => change(p.s)}><Icon name={p.icon} size={14} /> {p.label}</button>)}
        </div>
        <div className="render-grid">
          <div className="field-row"><span className="opt-label">Cadre</span>
            <div className="seg" role="radiogroup" aria-label="cadre">{(Object.keys(ASPECT) as OutputAspect[]).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={set.aspect === a} className={set.aspect === a ? 'on' : ''} onClick={() => change({ aspect: a })} title={`${ASPECT[a].label} ${a}`}><AspectIcon a={a} /> {ASPECT[a].label} <span className="muted small">{a}</span></button>
            ))}</div>
          </div>
          {reshaped && <div className="field-row"><span className="opt-label">Recadrage</span>
            <div className="seg" role="radiogroup" aria-label="recadrage">{(Object.keys(FRAMING) as Framing[]).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={set.framing === f} className={set.framing === f ? 'on' : ''} onClick={() => change({ framing: f })} title={FRAMING[f].hint}>{FRAMING[f].label}</button>
            ))}</div>
          </div>}
          <div className="field-row"><span className="opt-label">Fichier</span>
            <div className="seg" role="radiogroup" aria-label="format du fichier">{(Object.keys(FORMATS) as OutputFormat[]).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={set.format === f} className={set.format === f ? 'on' : ''} onClick={() => change({ format: f })} title={FORMATS[f].hint}>{FORMATS[f].label}</button>
            ))}</div>
            <span className="muted small hide-phone">{FORMATS[set.format].hint}</span>
          </div>
          <div className="row wrap">
            <label>Taille <select value={set.size} onChange={(e) => change({ size: +e.target.value as Settings['size'] })} aria-label="taille">{SIZES.map((s) => { const [w, h] = outputSize(s, set.aspect), off = s > maxSize ? 'plan supérieur' : gif && s > 540 ? 'trop grand pour un GIF' : ''; return <option key={s} value={s} disabled={!!off}>{s}p · {w}×{h}{off ? ` · ${off}` : ''}</option>; })}</select></label>
            <label>Style <select value={style} onChange={(e) => setStyle(e.target.value)} aria-label="style du rendu">{Object.values(stylePacks).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
            {!gif && <label>Qualité <select value={quality} onChange={(e) => setQuality(e.target.value as RenderRequest['quality'])}>{Object.entries(QUALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
            <label>Portée <select value={scope} onChange={(e) => setScope(e.target.value as 'film' | 'scene')} aria-label="portée"><option value="film">film entier</option><option value="scene">scène {sceneId}</option></select></label>
            <label>Sous-titres <select value={set.subtitles} onChange={(e) => change({ subtitles: e.target.value as Settings['subtitles'] })} aria-label="sous-titres">{(Object.keys(SUBS) as Settings['subtitles'][]).filter((k) => !(gif && k === 'track')).map((k) => <option key={k} value={k}>{SUBS[k]}</option>)}</select></label>
            {!gif && <label className="check"><input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} aria-label="son du rendu" /> son</label>}
            <span className="spacer" />
            <button className="primary" onClick={() => void start()} disabled={busy}><Icon name="film" size={16} />{dirty ? 'Enregistrer et rendre' : `Rendre en ${FORMATS[set.format].label}`}</button>
          </div>
          <p className="muted small render-summary" data-testid="render-summary"><AspectIcon a={set.aspect} /> {FORMATS[set.format].label} · {ow}×{oh} · {ASPECT[set.aspect].label.toLowerCase()} {set.aspect}{reshaped ? ` · ${FRAMING[set.framing].label.toLowerCase()}` : ''} · sous-titres {SUBS[set.subtitles]}{reshaped ? ' — le cadre se voit dans l’aperçu (Cadre, sous le lecteur)' : ''}</p>
        </div>
      </>}
      {!readOnly && plan?.enabled && plan.limits.renderMinutes != null && <p className="muted small">Rendu ce mois : {Math.round(plan.usage.renderMinutes * 10) / 10} / {plan.limits.renderMinutes} min · jusqu'en {widthText(maxWidth)}</p>}
      {error && <p className="error small" role="alert">{error}</p>}
      {shown?.videoUrl && (!canPlay(shownFormat)
        ? <p className="muted small">Ce navigateur ne lit pas ce format : téléchargez le fichier pour le voir.</p>
        : shownFormat === 'gif'
          ? <img key={shown.id} className="video gif" src={shown.videoUrl} alt="le GIF rendu" data-testid="video" />
          : <video key={shown.id} className={`video${(shown.options.aspect ?? '16:9') !== '16:9' ? ' tall' : ''}`} controls src={shown.videoUrl} data-testid="video" />)}
      {jobs.length > 0 && (
        <ul className="render-list">
          {jobs.map((j) => {
            const pct = j.framesTotal ? Math.round((100 * j.framesDone) / j.framesTotal) : 0, f = j.options.format ?? 'mp4', a = j.options.aspect ?? '16:9';
            return (
              <li key={j.id} className={j.id === shown?.id ? 'current' : ''} data-testid="render">
                <span className={`badge ${j.status === 'done' ? 'ok' : j.status === 'failed' ? 'warn' : ''}`}>{STATUS[j.status]}</span>
                <span className="small"><AspectIcon a={a} /> v{j.projectVersion} · {j.options.sceneId ? `scène ${j.options.sceneId}` : 'film'} · {FORMATS[f].label} {j.options.width}×{j.options.height ?? Math.round((j.options.width * 9) / 16)} · {stylePacks[j.options.style]?.label ?? j.options.style}</span>
                {j.status === 'running' && <progress max={100} value={pct} aria-label="progression">{pct} %</progress>}
                {j.status === 'running' && <span className="muted small">{pct} %{j.fps ? ` · ${j.fps.toFixed(0)} i/s` : ''}</span>}
                {j.status === 'done' && <span className="muted small">{mb(j.bytes)}</span>}
                {j.status === 'failed' && <span className="error small" title={j.error ?? ''}>{j.error}</span>}
                {j.status === 'done' && j.warnings.length > 0 && <span className="warn small" title={j.warnings.join('\n')}>⚠ {j.warnings[0]}</span>}
                <span className="spacer" />
                {!readOnly && (j.status === 'queued' || j.status === 'running') && <button onClick={() => void act(() => Api.cancelRender(j.id))}>Annuler</button>}
                {j.videoUrl && j.id !== shown?.id && <button onClick={() => setWatching(j.id)}>Voir</button>}
                {j.videoUrl && <a className="button" href={`${j.videoUrl}&download=1`}><Icon name="download" size={16} /> Télécharger</a>}
                {!readOnly && j.status !== 'queued' && j.status !== 'running' && <button className="ghost" onClick={() => void act(() => Api.deleteRender(j.id))} aria-label="supprimer le rendu">✕</button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
