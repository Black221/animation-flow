// Bringing a file into the project: a picture becomes an object (a logo, a product), a scene's decor or a character;
// a sound becomes the film's music or the voice of a line. The file goes to the workspace (decoded and stored again
// by the server), then the project names it: an asset with the picture in its drawing, the scene's element or decor,
// the soundtrack, the line's recording. Opened from the « Importer » button or by dropping a file on the editor.
import { catalog } from '@af/library';
import { textHash, voiceIsCurrent, type Asset, type Project } from '@af/schema';
import { Dialog, Icon } from '@af/ui';
import { useEffect, useMemo, useState } from 'react';
import { Api } from '../api';
import { addPicture } from '../pictures';

export const MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.aif,.aiff,.webm';
export type MediaKind = 'image' | 'audio';
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'aif', 'aiff', 'weba', 'webm'];
export function kindOf(f: File): MediaKind | null {
  const e = f.name.toLowerCase().split('.').pop() ?? '';
  if (f.type.startsWith('image/') && f.type !== 'image/svg+xml') return 'image';
  if (f.type.startsWith('audio/') || AUDIO_EXT.includes(e)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(e)) return 'image';
  return null;
}

type ImageUse = 'prop' | 'decor' | 'character';
type AudioUse = 'music' | 'voice';
const IMAGE_USE: Record<ImageUse, { label: string; hint: string }> = {
  prop: { label: 'Objet', hint: 'un logo, un produit, un dessin : posé dans la scène, il se déplace, grandit, tourne' },
  decor: { label: 'Décor', hint: 'l’arrière-plan d’une scène : la caméra s’y promène, les personnages jouent devant' },
  character: { label: 'Personnage', hint: 'une image fixe qui entre, se déplace et parle ; sans poses ni expressions' },
};
const AUDIO_USE: Record<AudioUse, { label: string; hint: string }> = {
  music: { label: 'Musique du film', hint: 'du début à la fin, sous les voix (baissée quand quelqu’un parle) ; remplace la musique composée' },
  voice: { label: 'Voix d’une réplique', hint: 'votre propre enregistrement : ses silences sont coupés, son volume égalisé, et la scène suit sa durée' },
};

const baseName = (f: File) => f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 60) || 'image';
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'import';
function freeId(base: string, taken: (id: string) => boolean) { let id = base, k = 2; while (taken(id)) id = `${base}-${k++}`; return id; }
const imageSize = (f: File) => new Promise<{ w: number; h: number }>((ok) => { const u = URL.createObjectURL(f), i = new Image(); i.onload = () => { ok({ w: i.naturalWidth, h: i.naturalHeight }); URL.revokeObjectURL(u); }; i.onerror = () => { ok({ w: 1, h: 1 }); URL.revokeObjectURL(u); }; i.src = u; });

export function ImportDialog({ file, project, sceneIndex, onClose, onDone }: {
  file: File | null; project: Project; sceneIndex: number; onClose: () => void;
  /** the project with the file in it, and what was done (for a toast) */
  onDone: (p: Project, note: string) => void;
}) {
  const kind = file ? kindOf(file) : null, scene = project.scenes[sceneIndex]!;
  const [imageUse, setImageUse] = useState<ImageUse>('prop'), [audioUse, setAudioUse] = useState<AudioUse>('music');
  const [name, setName] = useState(''), [place, setPlace] = useState(true), [loop, setLoop] = useState(true), [line, setLine] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const lines = project.scenes.flatMap((s, si) => s.narration.map((l, li) => ({ key: `${si}/${li}`, s, l, si, li })));
  // sensible first choices: a transparent or small picture is an object, a wide opaque one a decor; the first line
  // of this scene without its voice
  useEffect(() => {
    if (!file) return;
    setError(''); setBusy(false); setName(baseName(file)); setPlace(true); setLoop(true);
    const here = lines.filter((x) => x.si === sceneIndex), next = here.find((x) => !voiceIsCurrent(x.l)) ?? here[0] ?? lines[0];
    setLine(next?.key ?? ''); setAudioUse(project.soundtrack || !/voix|voice|replique|line/i.test(file.name) ? 'music' : 'voice');
    if (kindOf(file) === 'image') void imageSize(file).then(({ w, h }) => setImageUse(file.type === 'image/png' || file.type === 'image/gif' || w / h < 1.2 || w < 900 ? 'prop' : 'decor'));
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  const importImage = async (f: File) => {
    const r = await Api.uploadImage(f), label = name.trim() || baseName(f), made = { by: 'image importée', rounds: 0 };
    addPicture(r.asset, r.url);
    const taken = (id: string) => id in project.assets || id in project.cast || catalog.props.some((p) => p.kind === id) || catalog.characters.some((c) => c.kind === id) || catalog.decors.some((d) => d.kind === id);
    const id = freeId(slug(label), taken), p = structuredClone(project), s = p.scenes[sceneIndex]!;
    const eid = () => freeId(id, (x) => s.elements.some((e) => e.id === x));
    const layer = Math.max(0, ...s.elements.map((e) => e.layer)) + 1;
    if (imageUse === 'decor') {
      // the picture covers the frame and a little around it (the camera may move); the ground colour beyond
      const asset: Asset = { kind: 'decor', name: label, description: `image importée : ${f.name}`, background: r.color, parts: [{ id: 'photo', pivot: [0, 0], shapes: [{ type: 'image', asset: r.asset, x: -120, y: -67.5, w: 2160, h: 1215 }] }], poses: {}, expressions: {}, made };
      p.assets[id] = asset;
      if (place) s.decor = { kind: id, params: {} };
      return { p, note: place ? `« ${label} » est le décor de la scène ${s.id}` : `décor « ${label} » ajouté aux dessins` };
    }
    // an object stands on its base (about the size of a person's upper body), a character is as tall as a person
    const k = imageUse === 'character' ? 340 / r.height : 320 / Math.max(r.width, r.height), w = Math.round(r.width * k), h = Math.round(r.height * k);
    const asset: Asset = { kind: imageUse, name: label, description: `image importée : ${f.name}`, parts: [{ id: 'image', pivot: [0, 0], shapes: [{ type: 'image', asset: r.asset, x: -w / 2, y: -h, w, h }] }], poses: {}, expressions: {}, made };
    p.assets[id] = asset;
    if (imageUse === 'character') {
      p.cast[id] = { kind: id, name: label, params: {} };
      if (place) s.elements.push({ id: eid(), type: 'character', ref: id, params: {}, layer, space: 'world', keys: [{ t: 0, x: 960, y: 900, opacity: 0 }, { t: 0.4, opacity: 1 }] });
    // an object in the upper right, clear of the characters (who stand in the middle, on the ground)
    } else if (place) s.elements.push({ id: eid(), type: 'prop', ref: id, params: {}, layer, space: 'world', keys: [{ t: 0, x: 1500, y: Math.round(380 + h / 2), opacity: 0 }, { t: 0.4, opacity: 1 }] });
    return { p, note: place ? `« ${label} » ajouté à la scène ${s.id}` : `« ${label} » ajouté aux dessins` };
  };

  const importAudio = async (f: File) => {
    const r = await Api.uploadAudio(f, audioUse), p = structuredClone(project);
    const cut = r.truncated ? ` (coupé à ${Math.round(r.maxSeconds / 60)} min)` : '';
    if (audioUse === 'music') {
      p.soundtrack = { asset: r.asset, name: f.name.slice(0, 120), duration: r.duration, gain: project.soundtrack?.gain ?? 0, loop };
      return { p, note: `musique « ${f.name} » : ${Math.round(r.duration)} s${cut}` };
    }
    const [si, li] = line.split('/').map(Number), target = p.scenes[si!]?.narration[li!];
    if (!target) throw new Error('choisissez une réplique');
    target.audio = { asset: r.asset, textHash: textHash(target.text) }; target.duration = r.duration;
    return { p, note: `voix de ${p.scenes[si!]!.id}/${target.id} : ${r.duration.toFixed(1)} s${cut}` };
  };

  const go = async () => {
    if (!file || !kind) return;
    setBusy(true); setError('');
    try { const r = kind === 'image' ? await importImage(file) : await importAudio(file); onDone(r.p, r.note); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!file} onClose={onClose} title="Importer un fichier" icon="upload" size="lg"
      description={file ? <>{file.name} · {file.size < 1e6 ? `${Math.max(1, Math.round(file.size / 1e3))} Ko` : `${(file.size / 1e6).toFixed(1)} Mo`}</> : undefined}
      footer={<><button className="ghost" onClick={onClose}>Annuler</button><button className="primary" onClick={() => void go()} disabled={busy || !kind || (kind === 'audio' && audioUse === 'voice' && !line)}><Icon name="upload" size={16} /> {busy ? 'Import…' : 'Importer'}</button></>}>
      {file && !kind && <p className="error" role="alert">Ce fichier n’est ni une image (PNG, JPEG, WebP, GIF) ni un son (MP3, WAV, M4A, OGG, FLAC). Un projet (.json) s’importe depuis « Mes projets », un texte depuis « Créer avec l’IA ».</p>}
      {kind === 'image' && <div className="import-grid">
        <div className="import-preview checker"><img src={url} alt="aperçu de l’image" /></div>
        <div className="stack">
          <div className="seg wide" role="radiogroup" aria-label="usage de l’image">{(Object.keys(IMAGE_USE) as ImageUse[]).map((u) => <button key={u} type="button" role="radio" aria-checked={imageUse === u} className={imageUse === u ? 'on' : ''} onClick={() => setImageUse(u)}>{IMAGE_USE[u].label}</button>)}</div>
          <p className="muted small">{IMAGE_USE[imageUse].hint}.</p>
          <label className="field">Nom<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="nom du dessin" /></label>
          <label className="check"><input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} /> {imageUse === 'decor' ? `Décor de la scène ${scene.id}` : `Ajouter à la scène ${scene.id}`}</label>
          <p className="muted small">L’image est enregistrée dans l’espace (PNG si elle a de la transparence, sinon JPEG, 2560 px au plus) et se dessine telle quelle dans tous les styles.</p>
        </div>
      </div>}
      {kind === 'audio' && <div className="stack">
        <audio src={url} controls className="import-audio" />
        <div className="seg wide" role="radiogroup" aria-label="usage du son">{(Object.keys(AUDIO_USE) as AudioUse[]).map((u) => <button key={u} type="button" role="radio" aria-checked={audioUse === u} className={audioUse === u ? 'on' : ''} onClick={() => setAudioUse(u)}>{AUDIO_USE[u].label}</button>)}</div>
        <p className="muted small">{AUDIO_USE[audioUse].hint}.{audioUse === 'music' && project.soundtrack ? ` Elle remplace « ${project.soundtrack.name} ».` : ''}</p>
        {audioUse === 'music' && <label className="check"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Recommencer au début si le film est plus long</label>}
        {audioUse === 'voice' && <label className="field">Réplique<select value={line} onChange={(e) => setLine(e.target.value)} aria-label="réplique">{lines.map((x) => <option key={x.key} value={x.key}>{x.s.id}/{x.l.id} · {x.l.text.slice(0, 70)}{x.l.text.length > 70 ? '…' : ''}{voiceIsCurrent(x.l) ? ' (a déjà sa voix)' : ''}</option>)}</select></label>}
        <p className="muted small">{audioUse === 'music' ? '10 minutes au plus' : '3 minutes au plus'} ; MP3, WAV, M4A, OGG, FLAC, AIFF ou WebM.</p>
      </div>}
      {error && <p className="error small" role="alert">{error}</p>}
    </Dialog>
  );
}
