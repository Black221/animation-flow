import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { stylePacks } from '@af/styles';
import { Api, type Generation, type ProjectSummary } from '../api';
import { useSession } from '../session';

const TEMPLATE_LABELS: Record<string, string> = { example: 'Exemple (Awa et Jumo)', blank: 'Projet vide' };

export function Projects() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [templates, setTemplates] = useState<string[]>(['example', 'blank']);
  const [template, setTemplate] = useState('example');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const nav = useNavigate();
  const editable = useSession().can('editor');
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('fr');
  const [style, setStyle] = useState('watercolor');
  const [seconds, setSeconds] = useState('');
  const [review, setReview] = useState(true);
  const [gens, setGens] = useState<Generation[]>([]);
  const [genError, setGenError] = useState('');
  useEffect(() => { Api.generations().then(setGens).catch(() => undefined); }, []);
  const generate = async () => {
    setGenError('');
    try { const g = await Api.generate({ text: text.trim(), language, style, review, ...(+seconds > 0 ? { targetSeconds: Math.round(+seconds) } : {}) }); nav(`/g/${g.id}`); }
    catch (e) { setGenError((e as Error).message); }
  };

  const refresh = () => Api.projects().then(setList).catch((e) => setError(e.message));
  useEffect(() => { void refresh(); Api.library().then((l) => setTemplates(l.templates)).catch(() => undefined); }, []);

  const create = async () => {
    try { const d = await Api.createProject(template, title.trim() || undefined); nav(`/p/${d.id}`); }
    catch (e) { setError((e as Error).message); }
  };
  const remove = async (p: ProjectSummary) => {
    if (!confirm(`Supprimer « ${p.title} » et toutes ses versions ?`)) return;
    await Api.deleteProject(p.id).catch((e) => setError(e.message));
    void refresh();
  };

  return (
    <div className="page">
      {editable && <><section className="card create">
        <h2>Nouveau projet</h2>
        <div className="row wrap">
          <select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="modèle">{templates.map((t) => <option key={t} value={t}>{TEMPLATE_LABELS[t] ?? t}</option>)}</select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="titre (facultatif)" aria-label="titre" />
          <button className="primary" onClick={create}>Créer</button>
        </div>
      </section>
      <section className="card create ai" aria-label="créer avec l'IA">
        <h2>Créer avec l'IA</h2>
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Collez un script, un résumé, une idée : le modèle choisi dans Fournisseurs en fait un storyboard, puis les scènes." aria-label="texte source" />
        <div className="row wrap">
          <label>Langue <select value={language} onChange={(e) => setLanguage(e.target.value)}>{[['fr', 'français'], ['en', 'anglais'], ['es', 'espagnol'], ['de', 'allemand'], ['pt', 'portugais'], ['wo', 'wolof']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Style <select value={style} onChange={(e) => setStyle(e.target.value)} aria-label="style du film">{Object.values(stylePacks).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label>Durée visée <input type="number" min={10} max={1800} value={seconds} onChange={(e) => setSeconds(e.target.value)} placeholder="auto" style={{ width: 80 }} aria-label="durée visée" /> s</label>
          <label className="check"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> relire le storyboard avant les scènes</label>
          <button className="primary" onClick={() => void generate()} disabled={text.trim().length < 10}>Générer</button>
        </div>
        {genError && <p className="error small" role="alert">{genError} {/Fournisseurs/.test(genError) && <Link to="/settings">Ouvrir les réglages</Link>}</p>}
        {gens.length > 0 && (
          <ul className="gen-list">
            {gens.slice(0, 5).map((g) => (
              <li key={g.id}><Link to={`/g/${g.id}`}>{g.storyboard?.title ?? g.input.text.slice(0, 60) + '…'}</Link> <span className="muted small">{({ storyboard: 'storyboard en cours', review: 'à relire', scenes: 'scènes en cours', done: 'terminée', failed: 'échec', canceled: 'annulée' } as const)[g.status]}</span></li>
            ))}
          </ul>
        )}
      </section></>}
      {!editable && <p className="readonly-note">Rôle lecteur : vous consultez les projets de l'équipe sans les modifier.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <h2>Projets</h2>
      {list === null ? <p className="muted">Chargement…</p> : list.length === 0 ? <p className="muted">Aucun projet pour l'instant.</p> : (
        <ul className="project-list">
          {list.map((p) => (
            <li key={p.id} className="card">
              <Link to={`/p/${p.id}`} className="title">{p.title}</Link>
              <span className="muted small">version {p.version}{p.updatedBy ? ` · ${p.updatedBy}` : ''} · {new Date(p.updatedAt).toLocaleString('fr-FR')}</span>
              {editable && <button className="ghost" onClick={() => void remove(p)} aria-label={`supprimer ${p.title}`}>Supprimer</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
