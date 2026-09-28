// The narration of the project, line by line: which lines have an up-to-date recording, record the missing ones with
// the voice chosen in the settings (a character's own voice when the cast gives one), listen to a line.
import { textHash, voiceIsCurrent, type Project } from '@af/schema';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Api } from '../api';

type Status = 'current' | 'stale' | 'none';
const statusOf = (l: Project['scenes'][number]['narration'][number]): Status => (voiceIsCurrent(l) ? 'current' : l.audio ? 'stale' : 'none');
const LABEL: Record<Status, string> = { current: 'enregistrée', stale: 'texte modifié', none: 'pas de voix' };

export function VoicesPanel({ project, onChange, readOnly = false }: { project: Project; onChange: (p: Project) => void; readOnly?: boolean }) {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const stop = useRef(false), latest = useRef(project);
  latest.current = project;
  const all = project.scenes.flatMap((s, si) => s.narration.map((l, li) => ({ s, si, l, li, status: statusOf(l) })));
  const todo = all.filter((x) => x.status !== 'current');

  const recordAll = async () => {
    setError(''); stop.current = false;
    const queue = todo.map((x) => [x.si, x.li] as const);
    setBusy({ done: 0, total: queue.length });
    let p = latest.current;
    for (const [k, [si, li]] of queue.entries()) {
      if (stop.current) break;
      const line = p.scenes[si]!.narration[li]!, voice = line.speaker !== 'narrator' ? p.cast[line.speaker]?.voice : undefined;
      try {
        const r = await Api.record(line.text, voice, p.language);
        // write into the latest draft: the user may keep editing while lines are recorded
        p = structuredClone(latest.current);
        const target = p.scenes[si]?.narration[li];
        if (target && textHash(target.text) === r.textHash) { target.audio = { asset: r.asset, textHash: r.textHash }; target.duration = r.duration; onChange(p); }
      } catch (e) { setError((e as Error).message); break; }
      setBusy({ done: k + 1, total: queue.length });
    }
    setBusy(null);
  };

  const play = async (asset: string) => {
    const links = await Api.voiceLinks([asset]).catch(() => ({} as Record<string, string>));
    if (links[asset]) void new Audio(links[asset]).play();
  };

  return (
    <div className="voices" data-testid="voices">
      {!readOnly && <div className="row wrap">
        <button className="primary" onClick={() => void recordAll()} disabled={!!busy || todo.length === 0}>
          {busy ? `Enregistrement ${busy.done}/${busy.total}…` : todo.length ? `Enregistrer les voix manquantes (${todo.length})` : 'Toutes les répliques ont leur voix'}
        </button>
        {busy && <button onClick={() => { stop.current = true; }}>Arrêter</button>}
      </div>}
      <p className="muted small">Voix et modèle : <Link to="/settings">Réglages → Fournisseurs → Narration</Link>. Une voix par personnage : champ <code>voice</code> dans la distribution. Chaque réplique n'est payée qu'une fois.</p>
      {error && <p className="error small" role="alert">{error}</p>}
      <ol className="voice-list">
        {all.map(({ s, l, status }) => (
          <li key={`${s.id}/${l.id}`} className={status} data-testid="voice-line">
            <span className="sid">{s.id}/{l.id}</span>
            <span className="text" title={l.text}>{l.speaker !== 'narrator' ? <strong>{project.cast[l.speaker]?.name ?? l.speaker} : </strong> : null}{l.text}</span>
            <span className={`badge ${status === 'current' ? 'ok' : status === 'stale' ? 'warn' : ''}`}>{LABEL[status]}{status === 'current' && l.duration ? ` · ${l.duration.toFixed(1)} s` : ''}</span>
            {l.audio && <button className="icon" onClick={() => void play(l.audio!.asset)} aria-label={`écouter ${l.id}`} title="écouter">▶</button>}
          </li>
        ))}
      </ol>
    </div>
  );
}
