// Video renders of the project: choose the options, start a render of the saved version, follow it live, watch it.
import type { Project } from '@af/schema';
import { stylePacks } from '@af/styles';
import { useCallback, useEffect, useState } from 'react';
import { Api, type RenderJob, type RenderRequest } from '../api';

const STATUS: Record<RenderJob['status'], string> = { queued: 'en attente', running: 'en cours', done: 'terminé', failed: 'échec', canceled: 'annulé' };
const QUALITY: Record<RenderRequest['quality'], string> = { draft: 'brouillon', standard: 'standard', high: 'haute' };
const mb = (b: number | null) => (b == null ? '' : `${(b / 1e6).toFixed(1)} Mo`);
// renders are H.264 MP4 (plays in Chrome, Edge, Firefox, Safari); open-source Chromium builds lack the codec
const canPlayH264 = () => typeof document !== 'undefined' && document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"') !== '';

export function RenderPanel({ projectId, project, sceneId, dirty, saveFirst }: {
  projectId: string; project: Project; sceneId: string; dirty: boolean;
  /** saves the draft; resolves false if it could not */
  saveFirst: () => Promise<boolean>;
}) {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [style, setStyle] = useState(project.style);
  const [width, setWidth] = useState(1280);
  const [quality, setQuality] = useState<RenderRequest['quality']>('standard');
  const [scope, setScope] = useState<'film' | 'scene'>('film');
  const [subtitles, setSubtitles] = useState(true);
  const [audio, setAudio] = useState(true);
  const [watching, setWatching] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setStyle(project.style); }, [project.style]);
  const refresh = useCallback(() => Api.renders(projectId).then(setJobs).catch((e) => setError((e as Error).message)), [projectId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => { if (!active) return; const t = setInterval(() => void refresh(), 1000); return () => clearInterval(t); }, [active, refresh]);

  const start = async () => {
    setBusy(true); setError('');
    try {
      if (dirty && !(await saveFirst())) return;
      const j = await Api.startRender(projectId, { style, width, quality, subtitles, audio, ...(scope === 'scene' ? { sceneId } : {}) });
      setJobs((all) => [j, ...all]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const act = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { setError((e as Error).message); } void refresh(); };
  const shown = jobs.find((j) => j.id === watching && j.videoUrl) ?? jobs.find((j) => j.videoUrl);

  return (
    <section className="card render-panel" aria-label="rendu vidéo">
      <h3>Vidéo</h3>
      <div className="row wrap">
        <label>Style <select value={style} onChange={(e) => setStyle(e.target.value)}>{Object.values(stylePacks).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label>Largeur <select value={width} onChange={(e) => setWidth(+e.target.value)} aria-label="largeur">{[640, 960, 1280, 1920].map((w) => <option key={w} value={w}>{w} px</option>)}</select></label>
        <label>Qualité <select value={quality} onChange={(e) => setQuality(e.target.value as RenderRequest['quality'])}>{Object.entries(QUALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Portée <select value={scope} onChange={(e) => setScope(e.target.value as 'film' | 'scene')} aria-label="portée"><option value="film">film entier</option><option value="scene">scène {sceneId}</option></select></label>
        <label className="check"><input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} /> sous-titres</label>
        <label className="check"><input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} aria-label="son du rendu" /> son</label>
        <button className="primary" onClick={() => void start()} disabled={busy}>{dirty ? 'Enregistrer et rendre' : 'Rendre la vidéo'}</button>
      </div>
      {error && <p className="error small" role="alert">{error}</p>}
      {shown?.videoUrl && (canPlayH264()
        ? <video key={shown.id} className="video" controls src={shown.videoUrl} data-testid="video" />
        : <p className="muted small">Ce navigateur ne lit pas les vidéos H.264 : téléchargez le fichier pour le voir.</p>)}
      {jobs.length > 0 && (
        <ul className="render-list">
          {jobs.map((j) => {
            const pct = j.framesTotal ? Math.round((100 * j.framesDone) / j.framesTotal) : 0;
            return (
              <li key={j.id} className={j.id === shown?.id ? 'current' : ''} data-testid="render">
                <span className={`badge ${j.status === 'done' ? 'ok' : j.status === 'failed' ? 'warn' : ''}`}>{STATUS[j.status]}</span>
                <span className="small">v{j.projectVersion} · {j.options.sceneId ? `scène ${j.options.sceneId}` : 'film'} · {j.options.width} px · {stylePacks[j.options.style]?.label ?? j.options.style}</span>
                {j.status === 'running' && <progress max={100} value={pct} aria-label="progression">{pct} %</progress>}
                {j.status === 'running' && <span className="muted small">{pct} %{j.fps ? ` · ${j.fps.toFixed(0)} i/s` : ''}</span>}
                {j.status === 'done' && <span className="muted small">{mb(j.bytes)}</span>}
                {j.status === 'failed' && <span className="error small" title={j.error ?? ''}>{j.error}</span>}
                {j.status === 'done' && j.warnings.length > 0 && <span className="warn small" title={j.warnings.join('\n')}>⚠ {j.warnings[0]}</span>}
                <span className="spacer" />
                {(j.status === 'queued' || j.status === 'running') && <button onClick={() => void act(() => Api.cancelRender(j.id))}>Annuler</button>}
                {j.videoUrl && j.id !== shown?.id && <button onClick={() => setWatching(j.id)}>Voir</button>}
                {j.videoUrl && <a className="button" href={`${j.videoUrl}&download=1`}>Télécharger</a>}
                {j.status !== 'queued' && j.status !== 'running' && <button className="ghost" onClick={() => void act(() => Api.deleteRender(j.id))} aria-label="supprimer le rendu">✕</button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
