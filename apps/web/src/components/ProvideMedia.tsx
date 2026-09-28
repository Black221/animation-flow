// « Images à utiliser » in the idea box: pictures the AI puts in the film as they are (a mascot, a logo, the photo of
// a place), each with its role and a few words on what it is. A picture on a plain background is offered cut out.
import { Dialog, Icon } from '@af/ui';
import { useEffect, useRef, useState } from 'react';
import { Api, type ProvidedMedia } from '../api';
import { pointOn, usePictureEdit } from '../usePictureEdit';
import { addPicture } from '../pictures';

const KIND: Record<ProvidedMedia['kind'], { label: string; hint: string }> = {
  character: { label: 'Personnage', hint: 'une mascotte, un personnage : il joue, parle, saute, danse' },
  prop: { label: 'Objet', hint: 'un logo, un produit, un objet montré dans le film' },
  decor: { label: 'Décor', hint: 'la photo ou l’illustration d’un lieu où se passe une scène' },
};
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'image';

export function ProvideMedia({ media, onChange }: { media: (ProvidedMedia & { url: string })[]; onChange: (m: (ProvidedMedia & { url: string })[]) => void }) {
  const input = useRef<HTMLInputElement>(null), [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<ProvidedMedia['kind']>('character'), [name, setName] = useState(''), [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), edit = usePictureEdit(file);
  useEffect(() => {
    if (!file) return;
    setName(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 60)); setDescription(''); setError('');
  }, [file]);
  useEffect(() => { edit.setCut(kind !== 'decor'); }, [kind, file]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const r = await Api.uploadImage(await edit.blob());
      addPicture(r.asset, r.url);
      let id = slug(name), k = 2; while (media.some((m) => m.id === id)) id = `${slug(name)}-${k++}`;
      onChange([...media, { id, kind, name: name.trim(), description: description.trim(), asset: r.asset, width: r.width, height: r.height, color: r.color, url: r.url }]);
      setFile(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="provided" aria-label="images à utiliser">
      <span className="opt-label"><Icon name="brush" size={14} /> Images à utiliser</span>
      {media.map((m) => (
        <span key={m.id} className="provided-chip" data-testid="provided">
          <img src={m.url} alt="" /><span><strong>{m.name}</strong> <span className="muted small">{KIND[m.kind].label.toLowerCase()}</span></span>
          <button type="button" className="icon ghost" aria-label={`retirer ${m.name}`} onClick={() => onChange(media.filter((x) => x.id !== m.id))}>✕</button>
        </span>
      ))}
      {media.length < 8 && <button type="button" className="ghost small" onClick={() => input.current?.click()} title="une mascotte, un logo, un produit, la photo d'un lieu : l'IA les met dans le film tels quels"><Icon name="plus" size={14} /> {media.length ? 'Une autre' : 'Mascotte, logo, produit…'}</button>}
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" aria-label="image à fournir à l'IA" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setFile(f); }} />
      <Dialog open={!!file} onClose={() => setFile(null)} title="Une image pour le film" description="L’IA la met dans le film telle quelle : elle ne la redessine pas." icon="brush" size="lg"
        footer={<><button className="ghost" onClick={() => setFile(null)}>Annuler</button><button className="primary" onClick={() => void add()} disabled={busy || !name.trim() || description.trim().length < 3}>{busy ? 'Envoi…' : 'Ajouter'}</button></>}>
        <div className="import-grid">
          <div className="stack">
            <div className="import-preview checker">{file && edit.url && <img src={edit.url} alt="aperçu de l’image" data-testid="provide-preview" className={kind !== 'decor' ? 'erasable' : ''} onClick={(e) => { if (kind === 'decor') return; const at = pointOn(e); if (at) edit.erase(at[0], at[1]); }} title={kind !== 'decor' ? 'touchez une zone pour l’effacer' : undefined} />}</div>
            {kind !== 'decor' && <p className="muted small row wrap">Touchez une zone pour l’effacer (un reste de fond, une ombre).{edit.erased > 0 && <button type="button" className="ghost small" onClick={edit.undo}>Annuler l’effacement ({edit.erased})</button>}</p>}
          </div>
          <div className="stack">
            <div className="seg wide" role="radiogroup" aria-label="rôle de l’image">{(Object.keys(KIND) as ProvidedMedia['kind'][]).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KIND[k].label}</button>)}</div>
            <p className="muted small">{KIND[kind].hint}.</p>
            <label className="field">Nom<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="nom de l’image" /></label>
            <label className="field">Ce que c’est<textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} aria-label="description de l’image" placeholder="« la mascotte officielle : un lion souriant, chapeau traditionnel, t-shirt Dakar 2026 »" /></label>
            {edit.plain && kind !== 'decor' && <label className="check"><input type="checkbox" checked={edit.cut} onChange={(e) => edit.setCut(e.target.checked)} /> Retirer le fond uni (détourer)</label>}
            {error && <p className="error small" role="alert">{error}</p>}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
