// My projects: every project of the workspace, as cards with a frame of each; search, and a menu per card
// (open, rename, duplicate, delete — each with a dialog).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Api, getWorkspace, type ProjectSummary } from '../api';
import { useCreate } from '../components/Create';
import { Icon } from '@af/ui';
import { Menu, useUI } from '@af/ui';
import { HoverPlay, SceneStrip, SkeletonGrid, useHover } from '../components/Motion';
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
      <HoverPlay active={hover.on} onTime={hover.setT} still={`/api/projects/${p.id}/thumbnail.png?v=${p.version}&ws=${ws}`} load={() => Api.project(p.id).then((d) => d.project)} />
      {p.scenes && p.scenes.length > 0 && <SceneStrip scenes={p.scenes} t={hover.t} />}
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
          <button role="menuitem" onClick={() => { close(); void Api.exportProject(p.id).catch((e) => ui.toast((e as Error).message, 'error')); }}><Icon name="download" /> Exporter (avec ses médias)</button>
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
  // a project file (.animation.json, exported from here, or a bare project JSON): a new project, its media with it
  const ui = useUI(), nav = useNavigate(), fileInput = useRef<HTMLInputElement>(null), [importing, setImporting] = useState(false), [over, setOver] = useState(false);
  const importFile = async (f: File) => {
    if (f.size > 200 * 1024 * 1024) { ui.toast('fichier trop gros (200 Mo au plus)', 'error'); return; }
    setImporting(true);
    try {
      let json: unknown;
      try { json = JSON.parse(await f.text()); } catch { throw new Error(`${f.name} n’est pas un fichier de projet (JSON)`); }
      const r = await Api.importProject(json), m = r.media;
      const media = [m.images && `${m.images} image(s)`, m.sounds && `${m.sounds} son(s)`].filter(Boolean).join(' et ');
      ui.toast(`« ${r.title} » importé${media ? ` avec ${media}` : ''}${m.missing ? ` · ${m.missing} média(s) absent(s) du fichier` : ''}`, m.missing ? 'info' : 'success', { label: 'Ouvrir', run: () => nav(`/p/${r.id}`) });
      void refresh();
    } catch (e) { ui.toast((e as Error).message, 'error'); } finally { setImporting(false); }
  };
  const shown = list?.filter((p) => !q.trim() || p.title.toLowerCase().includes(q.trim().toLowerCase())) ?? null;

  return (
    <div className={`page${over ? ' drop-over' : ''}`}
      onDragOver={(e) => { if (editable && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={(e) => { setOver(false); const f = e.dataTransfer.files[0]; if (editable && f) { e.preventDefault(); void importFile(f); } }}>
      <div className="page-head">
        <div><h2>Mes projets</h2><p className="muted">Les films de votre espace, à plusieurs si vous voulez.</p></div>
        <span className="spacer" />
        {list && list.length > 3 && <label className="search small-search"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer…" aria-label="filtrer les projets" /></label>}
        {editable && <>
          <button onClick={() => fileInput.current?.click()} disabled={importing} title="un projet exporté (.animation.json), avec ses images et ses sons — ou déposez-le sur la page"><Icon name="upload" size={16} /> {importing ? 'Import…' : 'Importer un projet'}</button>
          <input ref={fileInput} type="file" hidden accept=".json,application/json" aria-label="projet à importer" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
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
