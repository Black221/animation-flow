import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Api, type ProjectSummary } from '../api';

const TEMPLATE_LABELS: Record<string, string> = { example: 'Exemple (Awa et Jumo)', blank: 'Projet vide' };

export function Projects() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [templates, setTemplates] = useState<string[]>(['example', 'blank']);
  const [template, setTemplate] = useState('example');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const nav = useNavigate();

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
      <section className="card create">
        <h2>Nouveau projet</h2>
        <div className="row wrap">
          <select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="modèle">{templates.map((t) => <option key={t} value={t}>{TEMPLATE_LABELS[t] ?? t}</option>)}</select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="titre (facultatif)" aria-label="titre" />
          <button className="primary" onClick={create}>Créer</button>
        </div>
        <p className="muted small">Bientôt : coller un texte et laisser le modèle de votre choix écrire le storyboard et les scènes.</p>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <h2>Projets</h2>
      {list === null ? <p className="muted">Chargement…</p> : list.length === 0 ? <p className="muted">Aucun projet pour l'instant.</p> : (
        <ul className="project-list">
          {list.map((p) => (
            <li key={p.id} className="card">
              <Link to={`/p/${p.id}`} className="title">{p.title}</Link>
              <span className="muted small">version {p.version} · {new Date(p.updatedAt).toLocaleString('fr-FR')}</span>
              <button className="ghost" onClick={() => void remove(p)} aria-label={`supprimer ${p.title}`}>Supprimer</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
