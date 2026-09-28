// « Modèles pour l'IA » in the idea box: the files brought with the prompt, each a MODEL the AI works after, never
// put in the film as it is. A picture of a character, an object or a place: the AI looks at it and draws it again,
// in the film's style, able to move. A picture of a look (« Ambiance »): its palette and mood. A music: listened to
// (tempo, key, energy), the AI composes in its spirit. A project exported from here: its outline to build on. A text
// (script, article, course): it fills the box, the brief itself.
import { Dialog, Icon, type IconName } from '@af/ui';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Api, type Reference } from '../api';
import { addPicture } from '../pictures';
import { TEXT_ACCEPT } from '../textfile';

type PictureKind = 'character' | 'prop' | 'decor' | 'style';
const PICTURE: Record<PictureKind, { label: string; hint: string; placeholder: string }> = {
  character: { label: 'Personnage', hint: 'l’IA le redessine d’après l’image, dans le style du film, et le fait jouer, parler, sauter, danser', placeholder: '« la mascotte officielle : un lion souriant, chapeau traditionnel, t-shirt Dakar 2026 »' },
  prop: { label: 'Objet', hint: 'un logo, un produit, un objet : l’IA le redessine fidèlement et le montre', placeholder: '« notre bouteille, étiquette verte, bouchon doré »' },
  decor: { label: 'Décor', hint: 'un lieu : l’IA en dessine un décor d’après la photo', placeholder: '« la place de l’Indépendance, au coucher du soleil »' },
  style: { label: 'Ambiance', hint: 'le rendu voulu : l’IA en prend les couleurs, la lumière et l’humeur', placeholder: '« couleurs vives, soleil, joyeux »' },
};
const ICON: Record<Reference['kind'], IconName> = { character: 'user', prop: 'tag', decor: 'globe', style: 'brush', music: 'music', project: 'film' };
const LABEL: Record<Reference['kind'], string> = { character: 'personnage', prop: 'objet', decor: 'décor', style: 'ambiance', music: 'musique', project: 'projet' };
export const MODELS_MAX = 10;
export const MODEL_ACCEPT = `image/png,image/jpeg,image/webp,image/gif,audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aif,.aiff,.json,${TEXT_ACCEPT}`;
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'modele';
const baseName = (f: File) => f.name.replace(/\.[^.]+$/, '').replace(/\.animation$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60) || 'modèle';
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|oga|flac|aiff?|opus)$/i.test(f.name);
const isImage = (f: File) => /^image\/(png|jpeg|webp|gif)$/.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name);
const isProject = (f: File) => /\.json$/i.test(f.name) || f.type === 'application/json';

interface Line { speaker?: string; text?: string }
interface SceneLike { title?: string; duration?: number; narration?: Line[] }
/** the outline of a project file (exported from here, or its bare JSON), in words: what the AI builds on */
export function outline(json: unknown): { title: string; summary: string } {
  const j = json as { format?: string; project?: unknown } | null, p = (j?.format === 'animation-flow' ? j.project : j) as { title?: string; style?: string; cast?: Record<string, { name?: string }>; scenes?: SceneLike[] } | null;
  if (!p || !Array.isArray(p.scenes) || !p.scenes.length) throw new Error('ce fichier n’est pas un projet');
  const cast = Object.entries(p.cast ?? {}).map(([id, c]) => c?.name ?? id);
  const head = [`Titre : ${p.title ?? 'sans titre'}`, p.style && `style ${p.style}`, cast.length && `personnages : ${cast.join(', ')}`, `${p.scenes.length} scène(s)`].filter(Boolean).join(' · ');
  const scenes = p.scenes.map((s, i) => {
    const said = (s.narration ?? []).map((l) => `${l.speaker && l.speaker !== 'narrator' ? `${p.cast?.[l.speaker]?.name ?? l.speaker} : ` : ''}${l.text ?? ''}`.trim()).filter(Boolean).join(' / ');
    return `${i + 1}. ${s.title || 'sans titre'}${s.duration ? ` (${s.duration} s)` : ''}${said ? ` — ${said}` : ''}`;
  });
  let summary = [head, ...scenes].join('\n');
  if (summary.length > 4000) summary = `${summary.slice(0, 3990)}…`;
  return { title: p.title ?? 'projet', summary };
}

export type ModelItem = Reference & { url?: string };
export interface ModelsHandle { take: (files: FileList | File[]) => void; pick: () => void }

/** the models joined to the prompt; `take` sorts what is dropped or picked (texts go to `onText`: they are the brief) */
export function ModelsForAI({ items, onChange, onText, onError, ref }: { items: ModelItem[]; onChange: (m: ModelItem[]) => void; onText: (f: File) => void; onError: (message: string) => void; ref?: Ref<ModelsHandle> }) {
  const input = useRef<HTMLInputElement>(null), latest = useRef(items);
  latest.current = items;
  const [picture, setPicture] = useState<{ file: File; url: string } | null>(null);
  const [kind, setKind] = useState<PictureKind>('character'), [name, setName] = useState(''), [description, setDescription] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture.url); }, [picture]);

  const idFor = (n: string, list: ModelItem[]) => { let id = slug(n), k = 2; while (list.some((m) => m.id === id)) id = `${slug(n)}-${k++}`; return id; };
  const push = (m: Omit<ModelItem, 'id'>) => { const list = latest.current; if (list.length >= MODELS_MAX) { onError(`${MODELS_MAX} modèles au plus`); return; } const next = [...list, { ...m, id: idFor(m.name, list) } as ModelItem]; latest.current = next; onChange(next); };

  const take = async (f: File) => {
    try {
      if (isImage(f)) { setName(baseName(f)); setDescription(''); setError(''); setKind('character'); setPicture({ file: f, url: URL.createObjectURL(f) }); return; }
      if (isAudio(f)) {
        setBusy(`Écoute de ${f.name}…`);
        const r = await Api.hearMusic(f);
        push({ kind: 'music', name: baseName(f), summary: `${r.summary}.` });
        return;
      }
      if (isProject(f)) { const o = outline(JSON.parse(await f.text())); push({ kind: 'project', name: o.title, summary: o.summary }); return; }
      onText(f);
    } catch (e) { onError(`${f.name} : ${(e as Error).message}`); } finally { setBusy(''); }
  };
  useImperativeHandle(ref, () => ({
    take: (files) => { void (async () => { for (const f of [...files]) await take(f); })(); },
    pick: () => input.current?.click(),
  }));

  const addPictureModel = async () => {
    if (!picture) return;
    setBusy('Envoi…'); setError('');
    try {
      const r = await Api.uploadImage(picture.file);
      addPicture(r.asset, r.url);
      push({ kind, name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), asset: r.asset, url: r.url });
      setPicture(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };

  return (
    <div className="provided models" aria-label="modèles pour l’IA">
      <span className="opt-label"><Icon name="wand" size={14} /> Modèles pour l’IA</span>
      {items.map((m) => (
        <span key={m.id} className="provided-chip" data-testid="model" title={m.summary ?? m.description ?? ''}>
          {m.url ? <img src={m.url} alt="" /> : <span className="chip-ico"><Icon name={ICON[m.kind]} size={14} /></span>}
          <span><strong>{m.name}</strong> <span className="muted small">{LABEL[m.kind]}{m.kind === 'music' && m.summary ? ` · ${m.summary.split(',')[0]}` : ''}</span></span>
          <button type="button" className="icon ghost" aria-label={`retirer ${m.name}`} onClick={() => onChange(items.filter((x) => x.id !== m.id))}>✕</button>
        </span>
      ))}
      {items.length < MODELS_MAX && <button type="button" className="ghost small" onClick={() => input.current?.click()} disabled={!!busy}
        title="une image (personnage, objet, lieu, ambiance), une musique, un texte ou un projet : l’IA s’en inspire, rien n’est collé tel quel"><Icon name="plus" size={14} /> {busy || (items.length ? 'Un autre' : 'Image, musique, texte, projet…')}</button>}
      {!items.length && !busy && <span className="muted small">l’IA s’en inspire pour écrire, dessiner et composer — rien n’est collé tel quel</span>}
      <input ref={input} type="file" hidden multiple accept={MODEL_ACCEPT} aria-label="modèle à joindre" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void (async () => { for (const f of fs) await take(f); })(); }} />
      <Dialog open={!!picture} onClose={() => setPicture(null)} title="Une image comme modèle" description="L’IA la regarde et dessine d’après elle, dans le style du film : l’image elle-même n’est pas mise dans la vidéo." icon="wand" size="lg"
        footer={<><button className="ghost" onClick={() => setPicture(null)}>Annuler</button><button className="primary" onClick={() => void addPictureModel()} disabled={!!busy || !name.trim()}>{busy || 'Joindre'}</button></>}>
        <div className="import-grid">
          <div className="import-preview checker">{picture && <img src={picture.url} alt="aperçu du modèle" data-testid="model-preview" />}</div>
          <div className="stack">
            <div className="seg wide" role="radiogroup" aria-label="ce que montre l’image">{(Object.keys(PICTURE) as PictureKind[]).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{PICTURE[k].label}</button>)}</div>
            <p className="muted small">{PICTURE[kind].hint}.</p>
            <label className="field">Nom<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="nom du modèle" /></label>
            <label className="field">Précisions <span className="muted small">(facultatif)</span><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} aria-label="précisions sur le modèle" placeholder={PICTURE[kind].placeholder} /></label>
            {error && <p className="error small" role="alert">{error}</p>}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
