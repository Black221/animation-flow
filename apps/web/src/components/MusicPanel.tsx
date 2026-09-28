// « Musique » : the film's score (pieces composed for it, played by the synthesizer) and its sound effects (each
// designed for it). Listen to them, compose the music again with a direction, design a sound again or a new one,
// or edit them as JSON.
import { pieceFor, recipeSound, renderMusic, SR } from '@af/audio';
import { parseProject, type Project } from '@af/schema';
import { useState } from 'react';
import { Api } from '../api';
import { JsonEditor, type JsonIssue } from './JsonEditor';
import { Icon } from '@af/ui';
import { Dialog, useUI } from '@af/ui';

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const issuesOf = (candidate: unknown): JsonIssue[] => { const r = parseProject(candidate); return r.ok ? [] : r.issues; };

// one audio context for the page; a new sound stops the one playing
let ctx: AudioContext | null = null, playing: AudioBufferSourceNode | null = null;
function play(channels: Float32Array[]) {
  ctx ??= new AudioContext({ sampleRate: SR });
  void ctx.resume();
  try { playing?.stop(); } catch { /* already over */ }
  const n = Math.max(1, channels[0]!.length), b = ctx.createBuffer(channels.length, n, SR);
  channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(); playing = s;
}
const stop = () => { try { playing?.stop(); } catch { /* already over */ } playing = null; };

export function MusicPanel({ project, onChange, readOnly, resetKey, remoteKey }: { project: Project; onChange: (p: Project) => void; readOnly: boolean; resetKey: string; remoteKey: number }) {
  const [direction, setDirection] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [newSound, setNewSound] = useState({ id: '', name: '', description: '' });
  const [adding, setAdding] = useState(false);
  const ui = useUI();
  const pieces = Object.entries(project.score);
  const usedBy = (mood: string) => project.scenes.filter((s) => s.music.mood === mood).map((s) => s.id);
  /** runs an AI call; says whether it worked (its outcome goes to the note, a failure to a toast too) */
  const run = async (what: string, f: () => Promise<string>): Promise<boolean> => {
    setBusy(what); setNote('');
    try { setNote(await f()); return true; } catch (e) { setNote((e as Error).message); ui.toast((e as Error).message, 'error'); return false; } finally { setBusy(''); }
  };
  const listen = (mood: string) => { const p = pieceFor(mood, project.score); if (p) play(renderMusic([{ start: 0, duration: 12, piece: p, gainDb: 0 }], 12)); };
  const design = (id: string, name: string, description: string) => run(`sound:${id}`, async () => {
    const r = await Api.designSound(project, id, name, description);
    onChange({ ...project, sounds: { ...project.sounds, [id]: r.sound } });
    return `${r.model}${r.fallback ? ' · le modèle n\'a pas réussi : son simple' : ''}`;
  });
  const soundTaken = !!project.sounds[newSound.id];

  // a music file an older project plays under the whole film (music is now composed, after a model at most)
  const [trackUrl, setTrackUrl] = useState('');
  const track = project.soundtrack;
  const listenTrack = async () => {
    if (!track) return;
    const url = trackUrl || (await Api.voiceLinks([track.asset]).catch(() => ({} as Record<string, string>)))[track.asset];
    if (url) { setTrackUrl(url); stop(); void new Audio(url).play(); }
  };
  return (
    <div className="music">
      {track && <>
      <h4>Musique du fichier</h4>
        <div className="card soundtrack" data-testid="soundtrack">
          <div className="row wrap"><Icon name="music" size={16} /><strong title={track.name}>{track.name}</strong><span className="muted small">{Math.floor(track.duration / 60)}:{String(Math.round(track.duration % 60)).padStart(2, '0')} · joue tout le film, sous les voix</span></div>
          {!readOnly && <div className="row wrap">
            <button type="button" onClick={() => void listenTrack()}><Icon name="play" size={14} /> Écouter</button>
            <label>Niveau <input type="range" min={-24} max={6} step={1} value={track.gain} onChange={(e) => onChange({ ...project, soundtrack: { ...track, gain: +e.target.value } })} aria-label="niveau de la musique du fichier" /> <span className="muted small">{track.gain > 0 ? '+' : ''}{track.gain} dB</span></label>
            <label className="check"><input type="checkbox" checked={track.loop} onChange={(e) => onChange({ ...project, soundtrack: { ...track, loop: e.target.checked } })} /> en boucle</label>
            <button type="button" className="ghost" onClick={() => { const { soundtrack: _drop, ...rest } = project; onChange(rest as Project); }}>Retirer</button>
          </div>}
          <p className="muted small">Elle remplace la musique composée ci-dessous, qui revient si vous la retirez.</p>
        </div>
      </>}
      <h4>{track ? 'Musique composée (remplacée)' : 'Musique'}</h4>
      <ul className="piece-list">
        {project.scenes.filter((s) => s.music.mood !== 'none' && !project.score[s.music.mood]).length > 0 && <li className="muted small">Des scènes jouent une ambiance intégrée : {[...new Set(project.scenes.map((s) => s.music.mood).filter((m) => m !== 'none' && !project.score[m]))].join(', ')}</li>}
        {pieces.map(([id, p]) => (
          <li key={id} className="card">
            <div className="row">
              <strong>{p.name}</strong>
              <span className="muted small">{p.bpm} bpm · {p.key} {p.mode === 'minor' ? 'mineur' : 'majeur'} · {p.parts.map((x) => x.instrument).join(', ')}</span>
              <button onClick={() => listen(id)} aria-label={`écouter ${p.name}`}>▶</button>
              <button onClick={stop} aria-label="arrêter">■</button>
            </div>
            <p className="muted small">{p.description} · {usedBy(id).length ? `scènes ${usedBy(id).join(', ')}` : 'jouée dans aucune scène'}</p>
          </li>
        ))}
        {!pieces.length && <li className="muted small">Pas encore de partition composée pour ce film.</li>}
      </ul>
      {!readOnly && (
        <div className="form">
          <label>Direction (facultatif)
            <input value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="« plus joyeux », « piano seul », « tension montante à la fin »" aria-label="direction musicale" />
          </label>
          <button disabled={!!busy} onClick={() => void run('compose', async () => {
            const r = await Api.compose(project, direction.trim() || undefined);
            onChange({ ...project, score: r.score, scenes: project.scenes.map((s) => ({ ...s, music: { ...s.music, mood: r.music[s.id] ?? s.music.mood } })) });
            setDirection('');
            return `${r.model} · ${Object.keys(r.score).length} morceau(x)${r.fallback ? ' · le modèle n\'a pas réussi : musique simple' : ''}`;
          })}>{busy === 'compose' ? 'Composition…' : 'Recomposer la musique'}</button>
        </div>
      )}

      <h4>Bruitages</h4>
      <ul className="sound-list">
        {Object.entries(project.sounds).map(([id, s]) => (
          <li key={id} className="card">
            <div className="row">
              <strong>{s.name}</strong> <span className="muted small">« {id} »</span>
              <button onClick={() => play([recipeSound(s)])} aria-label={`écouter ${s.name}`}>▶</button>
              {!readOnly && <button disabled={!!busy} onClick={() => void design(id, s.name, s.description)}>{busy === `sound:${id}` ? '…' : 'Reconcevoir'}</button>}
            </div>
            <p className="muted small">{s.description}</p>
          </li>
        ))}
        {!Object.keys(project.sounds).length && <li className="muted small">Aucun bruitage conçu pour ce film.</li>}
      </ul>
      {!readOnly && <button onClick={() => { setNewSound({ id: '', name: '', description: '' }); setAdding(true); }}><Icon name="plus" size={16} /> Nouveau bruitage</button>}
      {adding && (
        <Dialog open onClose={() => setAdding(false)} title="Nouveau bruitage" icon="music" size="sm" description="Décrivez ce qui fait le son et comment il sonne : l'IA le conçoit (synthétisé, sans fichier ni licence)."
          footer={<>
            <button type="button" className="ghost" onClick={() => setAdding(false)}>Annuler</button>
            <button type="submit" form="new-sound" className="primary" disabled={!!busy || soundTaken || !ID_RE.test(newSound.id) || !newSound.name.trim() || newSound.description.trim().length < 3}><Icon name="sparkles" size={16} /> {busy ? 'Conception…' : 'Concevoir'}</button>
          </>}>
          <form id="new-sound" className="form" onSubmit={(e) => { e.preventDefault(); void design(newSound.id, newSound.name.trim(), newSound.description.trim()).then((ok) => { if (ok) { setAdding(false); ui.toast(`Bruitage « ${newSound.name.trim()} » conçu`); } }); }}>
            <label className="field">Identifiant (utilisé dans les scènes) <input value={newSound.id} onChange={(e) => setNewSound({ ...newSound, id: e.target.value.trim() })} placeholder="porte" aria-label="identifiant du bruitage" autoFocus /></label>
            <label className="field">Nom <input value={newSound.name} onChange={(e) => setNewSound({ ...newSound, name: e.target.value })} placeholder="Porte qui grince" aria-label="nom du bruitage" /></label>
            <label className="field">Description <textarea rows={2} value={newSound.description} onChange={(e) => setNewSound({ ...newSound, description: e.target.value })} placeholder="« une vieille porte en bois qui grince lentement »" aria-label="description du bruitage" /></label>
            {soundTaken && <div className="alert warn"><Icon name="alert" size={16} /><span>Ce bruitage existe déjà.</span></div>}
          </form>
        </Dialog>
      )}
      {note && <p className="muted small" data-testid="music-note">{note}</p>}

      <details>
        <summary>Partition (JSON)</summary>
        <JsonEditor label="partition (JSON)" readOnly={readOnly} rows={16} value={project.score} resetKey={`score:${resetKey}`} remoteKey={remoteKey} validate={(v) => issuesOf({ ...project, score: v })} onApply={(v) => onChange({ ...project, score: v as Project['score'] })} />
      </details>
      <details>
        <summary>Bruitages (JSON)</summary>
        <JsonEditor label="bruitages (JSON)" readOnly={readOnly} rows={16} value={project.sounds} resetKey={`sounds:${resetKey}`} remoteKey={remoteKey} validate={(v) => issuesOf({ ...project, sounds: v })} onApply={(v) => onChange({ ...project, sounds: v as Project['sounds'] })} />
      </details>
    </div>
  );
}
