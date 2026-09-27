// Starting something: from an idea (the AI writes, draws, composes and animates it) or from a template. Both are
// offered wherever it helps (the home page, the sidebar, the projects page) through `useCreate()`.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { stylePacks } from '@af/styles';
import { Api } from '../api';
import { Icon, type IconName } from './Icon';
import { Dialog, useUI } from './ui';

export const TEMPLATE_INFO: Record<string, { label: string; hint: string; icon: IconName }> = {
  blank: { label: 'Projet vide', hint: 'Une scène à remplir, à la main ou avec l’IA.', icon: 'plus' },
  example: { label: 'Awa et Jumo', hint: "Un court film d'exemple : personnages, décors, caméra, voix.", icon: 'film' },
  pizza: { label: 'Pub « Pizza Time »', hint: 'Tout y est dessiné pour elle : 15 dessins, une musique, 8 bruitages.', icon: 'sparkles' },
};
export const IDEAS = [
  'Une pub de 30 secondes pour une pizzeria qui s’appelle Pizza Time, fun et colorée.',
  'Expliquer en une minute comment une graine devient un arbre, pour des enfants de 8 ans.',
  'Présenter notre application de covoiturage : le problème, la solution, trois avantages.',
  'Une fable : le renard et le corbeau, racontée avec humour, trois scènes.',
];
const LANGS = [['fr', 'français'], ['en', 'anglais'], ['es', 'espagnol'], ['de', 'allemand'], ['pt', 'portugais'], ['wo', 'wolof']];

const TONES = ['Fun', 'Chaleureux', 'Sérieux', 'Épique', 'Poétique', 'Pédagogique', 'Mystérieux'];
const AUDIENCES = ['Tout public', 'Enfants', 'Adolescents', 'Professionnels'];
const VOICES: [string, string][] = [['narrator', 'Un narrateur'], ['cast', 'Les personnages parlent'], ['both', 'Narrateur et personnages'], ['none', 'Sans voix (texte à l’écran)']];
const MUSIC = ['Entraînante', 'Douce', 'Épique', 'Mystérieuse', 'Sans musique'];
const PACE = ['Posé', 'Dynamique', 'Très rythmé'];
const LENGTHS: [number, string][] = [[0, 'Auto'], [15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']];

function Chips<T extends string | number>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="opt-group" role="radiogroup" aria-label={label}>
      <span className="opt-label">{label}</span>
      <div className="chips">{options.map(([v, l]) => <button key={String(v)} type="button" className="chip" role="radio" aria-checked={value === v} aria-pressed={value === v} onClick={() => onChange(value === v && typeof v === 'string' ? ('' as T) : v)}>{l}</button>)}</div>
    </div>
  );
}

/** the idea box: the text, then as many options as wanted (language, style, length, tone, audience, voices, music,
 *  rhythm, instructions), then the generation page. The options the API has no field for go to the model as
 *  instructions, in words. */
export function AiPrompt({ autoFocus = false, full = false, onStarted }: { autoFocus?: boolean; full?: boolean; onStarted?: () => void }) {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('fr');
  const [style, setStyle] = useState('watercolor');
  const [seconds, setSeconds] = useState(0);
  const [custom, setCustom] = useState('');
  const [review, setReview] = useState(true);
  const [tone, setTone] = useState(''), [audience, setAudience] = useState(''), [voices, setVoices] = useState(''), [music, setMusic] = useState(''), [pace, setPace] = useState('');
  const [extra, setExtra] = useState('');
  const [more, setMore] = useState(full);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const target = +custom > 0 ? Math.round(+custom) : seconds;
  const instructions = [
    tone && `Ton : ${tone.toLowerCase()}.`, audience && `Public : ${audience.toLowerCase()}.`,
    voices && ({ narrator: 'Un narrateur dit le texte.', cast: 'Les personnages disent le texte, pas de narrateur.', both: 'Un narrateur et des personnages qui parlent.', none: 'Pas de voix : le texte apparaît à l’écran.' } as Record<string, string>)[voices],
    music && (music === 'Sans musique' ? 'Pas de musique.' : `Musique ${music.toLowerCase()}.`), pace && `Rythme : ${pace.toLowerCase()}.`, extra.trim(),
  ].filter(Boolean).join(' ');
  const chosen = [tone, audience, voices && VOICES.find((v) => v[0] === voices)?.[1], music, pace, extra.trim() && 'consignes'].filter(Boolean).length;
  const generate = async () => {
    setError(''); setBusy(true);
    try {
      const g = await Api.generate({ text: text.trim(), language, style, review, ...(target > 0 ? { targetSeconds: target } : {}), ...(instructions ? { instructions: instructions.slice(0, 2000) } : {}) });
      onStarted?.(); nav(`/g/${g.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <div className={`ai-prompt${full ? ' full' : ''}`}>
      <div className="prompt">
        <textarea rows={full ? 7 : 4} value={text} onChange={(e) => setText(e.target.value)} autoFocus={autoFocus} aria-label="texte source"
          placeholder="Ex. : une pub de 30 secondes pour une boulangerie de quartier, chaleureuse et drôle… ou collez un script, un article, un cours."
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim().length >= 10) void generate(); }} />
        <div className="bar">
          <span className="opt">Langue <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="langue">{LANGS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></span>
          <span className="opt">Style <select value={style} onChange={(e) => setStyle(e.target.value)} aria-label="style du film">{Object.values(stylePacks).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></span>
          <label className="switch opt" title="vous relisez et corrigez le storyboard avant que l'IA ne dessine et n'anime"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Relire le storyboard</label>
          {!full && <button type="button" className="ghost small" aria-expanded={more} onClick={() => setMore((m) => !m)}><Icon name="sliders" size={15} /> {more ? 'Moins d’options' : 'Plus d’options'}{chosen > 0 && !more ? ` (${chosen})` : ''}</button>}
          <span className="spacer" />
          <button className="cta" onClick={() => void generate()} disabled={busy || text.trim().length < 10} title="Ctrl + Entrée"><Icon name="sparkles" /> {busy ? 'Lancement…' : 'Générer'}</button>
        </div>
        {more && (
          <div className="options" aria-label="options">
            <div className="opt-group" role="radiogroup" aria-label="durée">
              <span className="opt-label">Durée</span>
              <div className="chips">
                {LENGTHS.map(([v, l]) => <button key={v} type="button" className="chip" role="radio" aria-checked={!custom && seconds === v} aria-pressed={!custom && seconds === v} onClick={() => { setSeconds(v); setCustom(''); }}>{l}</button>)}
                <input type="number" min={10} max={1800} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="autre (s)" aria-label="durée visée" className="chip-input" />
              </div>
            </div>
            <Chips label="Ton" options={TONES.map((t) => [t, t] as [string, string])} value={tone} onChange={setTone} />
            <Chips label="Public" options={AUDIENCES.map((t) => [t, t] as [string, string])} value={audience} onChange={setAudience} />
            <Chips label="Voix" options={VOICES} value={voices} onChange={setVoices} />
            <Chips label="Musique" options={MUSIC.map((t) => [t, t] as [string, string])} value={music} onChange={setMusic} />
            <Chips label="Rythme" options={PACE.map((t) => [t, t] as [string, string])} value={pace} onChange={setPace} />
            <label className="opt-group"><span className="opt-label">Consignes</span>
              <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="« le héros est une girafe », « finir sur le logo », « couleurs pastel »…" aria-label="consignes supplémentaires" />
            </label>
          </div>
        )}
      </div>
      {!text && <div className="chips" aria-label="idées"><span className="opt-label">Idées</span>{IDEAS.map((i) => <button key={i} type="button" className="chip" onClick={() => setText(i)}>{i.length > 58 ? `${i.slice(0, 56)}…` : i}</button>)}</div>}
      {error && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span>{/Fournisseurs/.test(error) && <Link to="/settings" onClick={onStarted}>Ouvrir les fournisseurs</Link>}</div>}
    </div>
  );
}

/** a new project from a template, with a title */
export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate(), ui = useUI();
  const [templates, setTemplates] = useState<string[]>(['blank', 'example']);
  const [template, setTemplate] = useState('blank');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTitle(''); Api.library().then((l) => setTemplates(['blank', ...l.templates.filter((t) => t !== 'blank')])).catch(() => undefined); } }, [open]);
  const create = async () => {
    setBusy(true);
    try { const d = await Api.createProject(template, title.trim() || undefined); onClose(); ui.toast(`« ${d.title} » créé`); nav(`/p/${d.id}`); }
    catch (e) { ui.toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Nouveau projet" description="Partez d'une page blanche ou d'un modèle : tout reste modifiable." icon="plus" size="lg"
      footer={<>
        <button type="button" className="ghost" onClick={onClose}>Annuler</button>
        <button type="button" className="primary" onClick={() => void create()} disabled={busy}><Icon name="plus" size={16} /> Créer</button>
      </>}>
      <div className="templates" role="radiogroup" aria-label="modèle">
        {templates.map((t) => {
          const info = TEMPLATE_INFO[t] ?? { label: t, hint: '', icon: 'film' as IconName };
          return (
            <button key={t} type="button" className="template" role="radio" aria-checked={template === t} onClick={() => setTemplate(t)} onDoubleClick={() => void create()}>
              <span className="tthumb"><img src={`/api/templates/${t}/thumbnail.png`} alt="" loading="lazy" /></span>
              <strong><span className="ico"><Icon name={info.icon} size={16} /></span> {info.label}</strong>
              <span className="muted">{info.hint}</span>
            </button>
          );
        })}
      </div>
      <label className="field">Titre <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`facultatif — sinon « ${TEMPLATE_INFO[template]?.label ?? template} »`} aria-label="titre" onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} /></label>
    </Dialog>
  );
}

const CreateCtx = createContext<{ newProject: () => void; withAI: () => void }>({ newProject: () => undefined, withAI: () => undefined });
export const useCreate = () => useContext(CreateCtx);
export function CreateProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false), nav = useNavigate();
  return (
    <CreateCtx.Provider value={{ newProject: () => setOpen(true), withAI: () => nav('/create') }}>
      {children}
      <NewProjectDialog open={open} onClose={() => setOpen(false)} />
    </CreateCtx.Provider>
  );
}
