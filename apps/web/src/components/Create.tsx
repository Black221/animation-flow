// Starting something: from an idea (the AI writes, draws, composes and animates it) or from a template. Both are
// offered wherever it helps (the home page, the sidebar, the projects page) through `useCreate()`.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Api } from '../api';
import { Icon, type IconName } from '@af/ui';
import { Pipeline, timecode } from './Motion';
import { StyleButton } from './StylePicker';
import { readTextFile, TEXT_ACCEPT } from '../textfile';
import { ProvideMedia } from './ProvideMedia';
import type { ProvidedMedia } from '../api';
import { Dialog, useUI } from '@af/ui';

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
const MARKS: [number, string][] = [[15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']];
/** where a length sits on the ruler: a log scale from 10 s to 5 min */
const rulerAt = (s: number) => Math.log(Math.min(300, Math.max(10, s)) / 10) / Math.log(30);

/** an option as a track of a timeline: its header (a colour, an icon, a name), its choices as clips on the lane */
function Track({ label, icon, color, children }: { label: string; icon: IconName; color: number; children: ReactNode }) {
  return (
    <div className="opt-group track" style={{ '--track': `var(--track-${color})` } as React.CSSProperties}>
      <span className="opt-label"><Icon name={icon} size={14} /> {label}</span>
      <div className="lane">{children}</div>
    </div>
  );
}
function Chips<T extends string | number>({ label, icon, color, options, value, onChange }: { label: string; icon: IconName; color: number; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <Track label={label} icon={icon} color={color}>
      <div className="chips" role="radiogroup" aria-label={label}>{options.map(([v, l]) => <button key={String(v)} type="button" className="chip clip" role="radio" aria-checked={value === v} aria-pressed={value === v} onClick={() => onChange(value === v && typeof v === 'string' ? ('' as T) : v)}>{l}</button>)}</div>
    </Track>
  );
}
/** the length as a ruler, like the editor's timeline: marks to click, the playhead on the one chosen */
function DurationRuler({ seconds, custom, onPick, onCustom }: { seconds: number; custom: string; onPick: (s: number) => void; onCustom: (v: string) => void }) {
  const target = +custom > 0 ? +custom : seconds;
  return (
    <Track label="Durée" icon="clock" color={1}>
      <div className="ruler-row" role="radiogroup" aria-label="durée">
        <button type="button" className="chip clip" role="radio" aria-checked={!custom && seconds === 0} aria-pressed={!custom && seconds === 0} onClick={() => { onPick(0); onCustom(''); }}>Auto</button>
        <div className="ruler">
          <span className="ticks" aria-hidden />
          {MARKS.map(([v, l]) => <button key={v} type="button" role="radio" className="mark" aria-checked={!custom && seconds === v} aria-pressed={!custom && seconds === v} style={{ left: `${rulerAt(v) * 100}%` }} onClick={() => { onPick(v); onCustom(''); }}><span>{l}</span></button>)}
          {target > 0 && <i className="playhead" aria-hidden style={{ left: `${rulerAt(target) * 100}%` }} />}
        </div>
        <input type="number" min={10} max={1800} value={custom} onChange={(e) => onCustom(e.target.value)} placeholder="autre (s)" aria-label="durée visée" className="chip-input" />
      </div>
    </Track>
  );
}

/** the idea box: the text, then as many options as wanted (language, style, length, tone, audience, voices, music,
 *  rhythm, instructions) laid out as the tracks of a timeline, then the generation page. The options the API has no
 *  field for go to the model as instructions, in words. Below, what happens next, as a timeline too. */
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
  // a document brought in: its text fills the box (the AI reads 20 000 characters at most)
  const [doc, setDoc] = useState<{ name: string; chars: number; cut: boolean } | null>(null), [reading, setReading] = useState(false), [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<(ProvidedMedia & { url: string })[]>([]);
  const importText = async (f: File) => {
    setError(''); setReading(true);
    try {
      const t = await readTextFile(f), cut = t.length > 20_000;
      setText(cut ? t.slice(0, 20_000) : t); setDoc({ name: f.name, chars: t.length, cut });
    } catch (e) { setError(`${f.name} : ${(e as Error).message}`); } finally { setReading(false); }
  };
  const target = +custom > 0 ? Math.round(+custom) : seconds;
  const instructions = [
    tone && `Ton : ${tone.toLowerCase()}.`, audience && `Public : ${audience.toLowerCase()}.`,
    voices && ({ narrator: 'Un narrateur dit le texte.', cast: 'Les personnages disent le texte, pas de narrateur.', both: 'Un narrateur et des personnages qui parlent.', none: 'Pas de voix : le texte apparaît à l’écran.' } as Record<string, string>)[voices],
    music && (music === 'Sans musique' ? 'Pas de musique.' : `Musique ${music.toLowerCase()}.`), pace && `Rythme : ${pace.toLowerCase()}.`, extra.trim(),
  ].filter(Boolean).join(' ');
  const chosen = [tone, audience, voices && VOICES.find((v) => v[0] === voices)?.[1], music, pace, extra.trim() && 'consignes'].filter(Boolean).length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0, ready = text.trim().length >= 10;
  const generate = async () => {
    setError(''); setBusy(true);
    try {
      const g = await Api.generate({ text: text.trim(), language, style, review, ...(target > 0 ? { targetSeconds: target } : {}), ...(instructions ? { instructions: instructions.slice(0, 2000) } : {}), ...(media.length ? { media: media.map(({ url: _u, ...m }) => m) } : {}) });
      onStarted?.(); nav(`/g/${g.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <div className={`ai-prompt${full ? ' full' : ''}`}>
      <div className="prompt">
        <div className="slate" aria-hidden>
          <span className="kf" /> <strong>SC 00</strong> · votre idée
          <span className="spacer" />
          <span className="tc">{words} mot{words > 1 ? 's' : ''} · {target > 0 ? timecode(target) : 'durée auto'}</span>
        </div>
        <div className={`safe-frame${over ? ' drop-over' : ''}`}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { const f = e.dataTransfer.files[0]; setOver(false); if (f) { e.preventDefault(); void importText(f); } }}>
          <textarea rows={full ? 7 : 4} value={text} onChange={(e) => setText(e.target.value)} autoFocus={autoFocus} aria-label="texte source"
            placeholder="Ex. : une pub de 30 secondes pour une boulangerie de quartier, chaleureuse et drôle… ou collez un script, un article, un cours — ou glissez-y un fichier (Word, PDF, texte)."
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && ready) void generate(); }} />
        </div>
        <div className="bar">
          <span className="opt">Langue <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="langue">{LANGS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></span>
          <span className="opt">Style <StyleButton value={style} onChange={setStyle} /></span>
          <button type="button" className="ghost small" onClick={() => fileInput.current?.click()} disabled={reading} title="un script, un article, un cours : TXT, Markdown, Word, OpenDocument, PDF, sous-titres ou page web"><Icon name="upload" size={15} /> {reading ? 'Lecture…' : 'Importer un texte'}</button>
          <input ref={fileInput} type="file" hidden accept={TEXT_ACCEPT} aria-label="fichier texte à importer" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importText(f); }} />
          <label className="switch opt" title="vous relisez et corrigez le storyboard avant que l'IA ne dessine et n'anime"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Relire le storyboard</label>
          {!full && <button type="button" className="ghost small" aria-expanded={more} onClick={() => setMore((m) => !m)}><Icon name="sliders" size={15} /> {more ? 'Moins d’options' : 'Plus d’options'}{chosen > 0 && !more ? ` (${chosen})` : ''}</button>}
          <span className="spacer" />
          <button className="cta" onClick={() => void generate()} disabled={busy || !ready} title="Ctrl + Entrée"><Icon name="sparkles" /> {busy ? 'Lancement…' : 'Générer'}</button>
        </div>
        {more && (
          <div className="options tracks" aria-label="options">
            <DurationRuler seconds={seconds} custom={custom} onPick={setSeconds} onCustom={setCustom} />
            <Chips label="Ton" icon="sparkles" color={2} options={TONES.map((t) => [t, t] as [string, string])} value={tone} onChange={setTone} />
            <Chips label="Public" icon="users" color={3} options={AUDIENCES.map((t) => [t, t] as [string, string])} value={audience} onChange={setAudience} />
            <Chips label="Voix" icon="mic" color={4} options={VOICES} value={voices} onChange={setVoices} />
            <Chips label="Musique" icon="music" color={5} options={MUSIC.map((t) => [t, t] as [string, string])} value={music} onChange={setMusic} />
            <Chips label="Rythme" icon="film" color={6} options={PACE.map((t) => [t, t] as [string, string])} value={pace} onChange={setPace} />
            <Track label="Consignes" icon="edit" color={7}>
              <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="« le héros est une girafe », « finir sur le logo », « couleurs pastel »…" aria-label="consignes supplémentaires" />
            </Track>
          </div>
        )}
      </div>
      <ProvideMedia media={media} onChange={setMedia} />
      {doc && text && <p className="muted small doc-note" data-testid="imported-text"><Icon name="file" size={14} /> {doc.name} · {doc.chars.toLocaleString('fr-FR')} caractères{doc.cut ? ' — l’IA en lit 20 000 : le début est gardé, coupez ce qui compte moins' : ''} <button type="button" className="ghost small" onClick={() => { setDoc(null); setText(''); }}>Retirer</button></p>}
      {!text && <div className="chips ideas" aria-label="idées"><span className="opt-label">Idées</span>{IDEAS.map((i) => <button key={i} type="button" className="chip" onClick={() => setText(i)}>{i.length > 58 ? `${i.slice(0, 56)}…` : i}</button>)}</div>}
      {error && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span>{/Fournisseurs/.test(error) && <Link to="/settings" onClick={onStarted}>Ouvrir les fournisseurs</Link>}</div>}
      <Pipeline ready={ready} running={busy} />
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
