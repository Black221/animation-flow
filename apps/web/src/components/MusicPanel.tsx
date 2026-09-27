// « Musique » : the film's score (pieces composed for it, played by the synthesizer) and its sound effects (each
// designed for it). Listen to them, compose the music again with a direction, design a sound again or a new one,
// or edit them as JSON.
import { pieceFor, recipeSound, renderMusic, SR } from '@af/audio';
import { parseProject, type Project } from '@af/schema';
import { useState } from 'react';
import { Api } from '../api';
import { JsonEditor, type JsonIssue } from './JsonEditor';

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
  const pieces = Object.entries(project.score);
  const usedBy = (mood: string) => project.scenes.filter((s) => s.music.mood === mood).map((s) => s.id);
  const run = async (what: string, f: () => Promise<string>) => {
    setBusy(what); setNote('');
    try { setNote(await f()); } catch (e) { setNote((e as Error).message); } finally { setBusy(''); }
  };
  const listen = (mood: string) => { const p = pieceFor(mood, project.score); if (p) play(renderMusic([{ start: 0, duration: 12, piece: p, gainDb: 0 }], 12)); };
  const design = (id: string, name: string, description: string) => run(`sound:${id}`, async () => {
    const r = await Api.designSound(project, id, name, description);
    onChange({ ...project, sounds: { ...project.sounds, [id]: r.sound } });
    return `${r.model}${r.fallback ? ' · le modèle n\'a pas réussi : son simple' : ''}`;
  });
  const soundTaken = !!project.sounds[newSound.id];

  return (
    <div className="music">
      <h4>Musique</h4>
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
      {!readOnly && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); void design(newSound.id, newSound.name.trim(), newSound.description.trim()).then(() => setNewSound({ id: '', name: '', description: '' })); }}>
          <div className="row">
            <input value={newSound.id} onChange={(e) => setNewSound({ ...newSound, id: e.target.value.trim() })} placeholder="identifiant" aria-label="identifiant du bruitage" />
            <input value={newSound.name} onChange={(e) => setNewSound({ ...newSound, name: e.target.value })} placeholder="nom" aria-label="nom du bruitage" />
          </div>
          <input value={newSound.description} onChange={(e) => setNewSound({ ...newSound, description: e.target.value })} placeholder="ce qui fait le son, comment il sonne : « un double bip joyeux de robot »" aria-label="description du bruitage" />
          {soundTaken && <p className="error small">ce bruitage existe déjà</p>}
          <button type="submit" disabled={!!busy || soundTaken || !ID_RE.test(newSound.id) || !newSound.name.trim() || newSound.description.trim().length < 3}>Concevoir un bruitage</button>
        </form>
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
