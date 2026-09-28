// Home: an idea to animate, what you were working on, what the community is watching.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Api, type Generation, type ProjectSummary, type Publication } from '../api';
import { AiPrompt, useCreate } from '../components/Create';
import { Icon } from '../components/Icon';
import { useSession } from '../session';
import { SkeletonGrid } from '../components/Motion';
import { PubCard } from './Community';
import { ProjectCard } from './Projects';

const GEN_STATUS = { storyboard: 'storyboard en cours', review: 'à relire', assets: 'dessins en cours', music: 'musique en cours', scenes: 'scènes en cours', done: 'terminée', failed: 'échec', canceled: 'annulée' } as const;
const hello = () => { const h = new Date().getHours(); return h < 5 || h >= 18 ? 'Bonsoir' : 'Bonjour'; };

export function Home() {
  const { me, can } = useSession(), create = useCreate(), editable = can('editor');
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [trending, setTrending] = useState<Publication[] | null>(null);
  const [gens, setGens] = useState<Generation[]>([]);
  const refresh = () => Api.projects().then(setProjects).catch(() => setProjects([]));
  useEffect(() => {
    void refresh();
    Api.community({ sort: 'popular', limit: 8 }).then((r) => setTrending(r.items)).catch(() => setTrending([]));
    if (editable) Api.generations().then(setGens).catch(() => undefined);
  }, [editable]);
  const running = gens.filter((g) => !['done', 'failed', 'canceled'].includes(g.status));

  return (
    <div className="page home">
      {editable ? (
        <section className="hero" aria-label="créer avec l'IA">
          <div className="hero-text">
          <h2>{hello()} {me?.user?.name.split(' ')[0]}, que voulez-vous <span className="grad">animer</span> ?</h2>
          <p className="lead">Décrivez votre idée, collez un script ou un texte. L'IA écrit le storyboard, dessine tout ce qu'il faut, compose la musique et anime chaque scène.</p>
          <AiPrompt />
          </div>
          {running.length > 0 && (
            <ul className="gen-list" aria-label="générations en cours">
              {running.map((g) => <li key={g.id}><Link to={`/g/${g.id}`}><Icon name="sparkles" size={14} /> {g.storyboard?.title ?? `${g.input.text.slice(0, 40)}…`} <span className="badge accent">{GEN_STATUS[g.status]}</span></Link></li>)}
            </ul>
          )}
        </section>
      ) : <div className="alert info"><Icon name="info" size={16} /><span>Rôle lecteur : vous consultez les projets de l'équipe sans les modifier.</span></div>}

      <div className="section-title">
        <h2>Reprendre</h2>
        <span className="spacer" />
        {editable && <button className="ghost small" onClick={create.newProject}><Icon name="plus" size={15} /> Nouveau projet</button>}
        <Link to="/projects" className="more-link">Tous mes projets <Icon name="chevron" size={15} /></Link>
      </div>
      {projects === null ? <SkeletonGrid n={4} /> : projects.length === 0
        ? <div className="empty"><p>Aucun projet pour l'instant : décrivez une idée plus haut, ou partez d'un modèle.</p>{editable && <button className="primary" onClick={create.newProject}><Icon name="plus" size={16} /> Nouveau projet</button>}</div>
        : <ul className="project-grid">{projects.slice(0, 4).map((p) => <ProjectCard key={p.id} p={p} onChange={refresh} />)}</ul>}

      <div className="section-title">
        <h2>Tendances de la communauté</h2>
        <span className="spacer" />
        <Link to="/c?sort=popular" className="more-link">Explorer <Icon name="chevron" size={15} /></Link>
      </div>
      {trending === null ? <SkeletonGrid n={4} /> : trending.length === 0
        ? <div className="empty"><p>Personne n'a encore publié de film. Ouvrez un projet et cliquez sur « Publier » : le vôtre sera le premier.</p></div>
        : <ul className="project-grid">{trending.map((p) => <PubCard key={p.id} p={p} />)}</ul>}
    </div>
  );
}
