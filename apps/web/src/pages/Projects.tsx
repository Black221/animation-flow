// Home: what do you want to animate? (the AI prompt first), then start from a template, then the team's projects,
// each with a frame of it.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { stylePacks } from '@af/styles';
import { Api, getWorkspace, type Generation, type ProjectSummary } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { useSession } from '../session';

const TEMPLATES: Record<string, { label: string; hint: string; icon: IconName }> = {
  example: { label: 'Awa et Jumo', hint: "Un court film d'exemple : personnages, décors, caméra, voix.", icon: 'film' },
  pizza: { label: 'Pub « Pizza Time »', hint: 'Tout y est dessiné pour elle : 15 dessins, une musique, 8 bruitages.', icon: 'sparkles' },
  blank: { label: 'Projet vide', hint: 'Une scène à remplir, à la main ou avec l’IA.', icon: 'plus' },
};
const IDEAS = [
  'Une pub de 30 secondes pour une pizzeria qui s’appelle Pizza Time, fun et colorée.',
  'Expliquer en une minute comment une graine devient un arbre, pour des enfants de 8 ans.',
  'Présenter notre application de covoiturage : le problème, la solution, trois avantages.',
  'Une fable : le renard et le corbeau, racontée avec humour, trois scènes.',
];
const GEN_STATUS = { storyboard: 'storyboard en cours', review: 'à relire', assets: 'dessins en cours', music: 'musique en cours', scenes: 'scènes en cours', done: 'terminée', failed: 'échec', canceled: 'annulée' } as const;
const ago = (d: string | Date) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};

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
  const [busy, setBusy] = useState(false);
  useEffect(() => { Api.generations().then(setGens).catch(() => undefined); }, []);
  const generate = async () => {
    setGenError(''); setBusy(true);
    try { const g = await Api.generate({ text: text.trim(), language, style, review, ...(+seconds > 0 ? { targetSeconds: Math.round(+seconds) } : {}) }); nav(`/g/${g.id}`); }
    catch (e) { setGenError((e as Error).message); setBusy(false); }
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
  const ws = encodeURIComponent(getWorkspace());

  return (
    <div className="page">
      {editable && (
        <section className="hero" aria-label="créer avec l'IA">
          <h2>Que voulez-vous <span className="grad">animer</span> ?</h2>
          <p className="lead">Décrivez votre idée, collez un script ou un texte. L'IA écrit le storyboard, dessine tout ce qu'il faut, compose la musique et anime chaque scène.</p>
          <div className="prompt">
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. : une pub de 30 secondes pour une boulangerie de quartier, chaleureuse et drôle…" aria-label="texte source"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim().length >= 10) void generate(); }} />
            <div className="bar">
              <span className="opt">Langue <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="langue">{[['fr', 'français'], ['en', 'anglais'], ['es', 'espagnol'], ['de', 'allemand'], ['pt', 'portugais'], ['wo', 'wolof']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></span>
              <span className="opt">Style <select value={style} onChange={(e) => setStyle(e.target.value)} aria-label="style du film">{Object.values(stylePacks).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></span>
              <span className="opt">Durée <input type="number" min={10} max={1800} value={seconds} onChange={(e) => setSeconds(e.target.value)} placeholder="auto" style={{ width: 76 }} aria-label="durée visée" /> s</span>
              <label className="switch opt"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Relire le storyboard</label>
              <span className="spacer" />
              <button className="cta" onClick={() => void generate()} disabled={busy || text.trim().length < 10} title="Ctrl + Entrée"><Icon name="sparkles" /> Générer</button>
            </div>
          </div>
          {!text && <div className="chips" aria-label="idées">{IDEAS.map((i) => <button key={i} className="chip" onClick={() => setText(i)}>{i.length > 58 ? `${i.slice(0, 56)}…` : i}</button>)}</div>}
          {genError && <p className="error small" role="alert">{genError} {/Fournisseurs/.test(genError) && <Link to="/settings">Ouvrir les réglages</Link>}</p>}
          {gens.length > 0 && (
            <ul className="gen-list" aria-label="générations récentes">
              {gens.slice(0, 5).map((g) => (
                <li key={g.id}><Link to={`/g/${g.id}`}><Icon name="sparkles" size={14} /> {g.storyboard?.title ?? `${g.input.text.slice(0, 40)}…`} <span className={`badge ${g.status === 'done' ? 'ok' : g.status === 'failed' ? 'warn' : g.status === 'canceled' ? '' : 'accent'}`}>{GEN_STATUS[g.status]}</span></Link></li>
              ))}
            </ul>
          )}
        </section>
      )}

      {editable && (
        <section aria-label="nouveau projet">
          <div className="section-title"><h2>Partir d'un modèle</h2></div>
          <div className="templates">
            {templates.map((t) => {
              const info = TEMPLATES[t] ?? { label: t, hint: '', icon: 'film' as IconName };
              return (
                <button key={t} className="template" aria-pressed={template === t} onClick={() => setTemplate(t)}>
                  <span className="tthumb"><img src={`/api/templates/${t}/thumbnail.png`} alt="" loading="lazy" /></span>
                  <strong><span className="ico"><Icon name={info.icon} size={16} /></span> {info.label}</strong>
                  <span className="muted">{info.hint}</span>
                </button>
              );
            })}
          </div>
          <div className="create-row">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Titre (facultatif) — ${TEMPLATES[template]?.label ?? template}`} aria-label="titre" onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
            <button className="primary" onClick={create}><Icon name="plus" /> Créer</button>
          </div>
        </section>
      )}
      {!editable && <p className="readonly-note">Rôle lecteur : vous consultez les projets de l'équipe sans les modifier.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="section-title"><h2>Projets</h2>{list && <span className="badge">{list.length}</span>}</div>
      {list === null ? <p className="muted">Chargement…</p> : list.length === 0 ? <p className="empty">Aucun projet pour l'instant. Décrivez une idée plus haut, ou partez d'un modèle.</p> : (
        <ul className="project-grid">
          {list.map((p) => (
            <li key={p.id} className="project-card">
              <span className="thumb"><img src={`/api/projects/${p.id}/thumbnail.png?v=${p.version}&ws=${ws}`} alt="" loading="lazy" /></span>
              <div className="body">
                <Link to={`/p/${p.id}`} className="title">{p.title}</Link>
                <span className="meta">v{p.version}{p.updatedBy ? ` · ${p.updatedBy}` : ''} · {ago(p.updatedAt)}</span>
              </div>
              {editable && <button className="icon del" onClick={() => void remove(p)} aria-label={`supprimer ${p.title}`} title="Supprimer"><Icon name="trash" size={16} /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
