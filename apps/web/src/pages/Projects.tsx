// My projects: every project of the workspace, as cards with a frame of each; search, and a menu per card
// (open, rename, duplicate, delete — each with a dialog).
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Api, getWorkspace, type ProjectSummary } from '../api';
import { useCreate } from '../components/Create';
import { Icon } from '../components/Icon';
import { Menu, useUI } from '../components/ui';
import { HoverPlay, SkeletonGrid, useHover } from '../components/Motion';
import { useSession } from '../session';

export const ago = (d: string | Date) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function ProjectCard({ p, onChange }: { p: ProjectSummary; onChange: () => void }) {
  const ui = useUI(), nav = useNavigate(), editable = useSession().can('editor');
  const ws = encodeURIComponent(getWorkspace()), hover = useHover();
  const rename = async () => {
    const title = await ui.prompt({ title: 'Renommer le projet', label: 'Titre', value: p.title, confirm: 'Renommer', required: true });
    if (!title || title.trim() === p.title) return;
    try { const d = await Api.project(p.id); await Api.saveProject(p.id, { ...d.project, title: title.trim() }, d.version); ui.toast('Projet renommé'); onChange(); }
    catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  const duplicate = async () => {
    try { const d = await Api.project(p.id); const c = await Api.createProjectFrom({ ...d.project, title: `${d.project.title} (copie)` }); ui.toast('Copie créée', 'success', { label: 'Ouvrir', run: () => nav(`/p/${c.id}`) }); onChange(); }
    catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  const remove = async () => {
    const ok = await ui.confirm({ title: `Supprimer « ${p.title} » ?`, message: <>Le projet et toutes ses versions seront supprimés.{p.publicationId && <> Sa publication dans la communauté reste en ligne (retirez-la depuis sa page).</>}</>, confirm: 'Supprimer', danger: true });
    if (!ok) return;
    try { await Api.deleteProject(p.id); ui.toast(`« ${p.title} » supprimé`); onChange(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  return (
    <li className="project-card" {...hover.bind}>
      <HoverPlay active={hover.on} still={`/api/projects/${p.id}/thumbnail.png?v=${p.version}&ws=${ws}`} load={() => Api.project(p.id).then((d) => d.project)} />
      <div className="body">
        <Link to={`/p/${p.id}`} className="title">{p.title}</Link>
        <span className="meta">
          v{p.version}{p.updatedBy ? ` · ${p.updatedBy}` : ''} · {ago(p.updatedAt)}
        </span>
        {(p.publicationId || p.remixOf) && (
          <span className="badges">
            {p.publicationId && <span className="badge ok"><Icon name="globe" size={12} /> publié</span>}
            {p.remixOf && <span className="badge accent" title={`remix de « ${p.remixOf.title} »`}><Icon name="remix" size={12} /> remix</span>}
          </span>
        )}
      </div>
      <div className="card-menu">
        <Menu label={`actions sur ${p.title}`}>{(close) => <>
          <Link to={`/p/${p.id}`} role="menuitem" onClick={close}><Icon name="edit" /> Ouvrir</Link>
          {editable && <button role="menuitem" onClick={() => { close(); void rename(); }}><Icon name="sliders" /> Renommer</button>}
          {editable && <button role="menuitem" onClick={() => { close(); void duplicate(); }}><Icon name="copy" /> Dupliquer</button>}
          {p.publicationId && <Link to={`/c/${p.publicationId}`} role="menuitem" onClick={close}><Icon name="globe" /> Voir dans la communauté</Link>}
          {editable && <button role="menuitem" className="danger-item" onClick={() => { close(); void remove(); }}><Icon name="trash" /> Supprimer</button>}
        </>}</Menu>
      </div>
    </li>
  );
}

export function Projects() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const editable = useSession().can('editor'), create = useCreate();
  const refresh = () => Api.projects().then(setList).catch((e) => setError(e.message));
  useEffect(() => { void refresh(); }, []);
  const shown = list?.filter((p) => !q.trim() || p.title.toLowerCase().includes(q.trim().toLowerCase())) ?? null;

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>Mes projets</h2><p className="muted">Les films de votre espace, à plusieurs si vous voulez.</p></div>
        <span className="spacer" />
        {list && list.length > 3 && <label className="search small-search"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer…" aria-label="filtrer les projets" /></label>}
        {editable && <>
          <button onClick={create.withAI}><Icon name="sparkles" size={16} /> Avec l'IA</button>
          <button className="primary" onClick={create.newProject}><Icon name="plus" size={16} /> Nouveau projet</button>
        </>}
      </div>
      {!editable && <div className="alert info"><Icon name="info" size={16} /><span>Rôle lecteur : vous consultez les projets de l'équipe sans les modifier.</span></div>}
      {error && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
      {shown === null ? <SkeletonGrid n={6} /> : shown.length === 0
        ? <div className="empty"><p>{q ? 'Aucun projet ne correspond.' : "Aucun projet pour l'instant."}</p>{editable && !q && <button className="primary" onClick={create.newProject}><Icon name="plus" size={16} /> Nouveau projet</button>}</div>
        : <ul className="project-grid" aria-label="projets">{shown.map((p) => <ProjectCard key={p.id} p={p} onChange={refresh} />)}</ul>}
    </div>
  );
}
