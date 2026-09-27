// Publishing a project to the community: a copy of its saved version, with a title, a description, tags and a
// licence (all of them allow remixing). Published again, the copy is replaced; withdrawn, it is gone.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Api, LICENSE_LABEL, type License, type Publication } from '../api';
import { Icon } from './Icon';
import { Dialog, useUI } from './ui';

export function PublishDialog({ projectId, title, unsaved, save, publication, onDone, onClose }: {
  projectId: string; title: string; unsaved: boolean; save: () => Promise<boolean>; publication: Publication | null;
  onDone: (p: Publication | null) => void; onClose: () => void;
}) {
  const ui = useUI(), nav = useNavigate();
  const [name, setName] = useState(publication?.title ?? title);
  const [description, setDescription] = useState(publication?.description ?? '');
  const [tags, setTags] = useState((publication?.tags ?? []).join(', '));
  const [license, setLicense] = useState<License>(publication?.license ?? 'cc-by');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const publish = async () => {
    setBusy(true); setError('');
    try {
      if (unsaved && !(await save())) throw new Error("le projet n'a pas pu être enregistré");
      const p = await Api.publish(projectId, { title: name.trim(), description: description.trim(), tags: tags.split(',').map((t) => t.trim()).filter(Boolean), license });
      onDone(p);
      ui.toast(publication ? 'Publication mise à jour' : 'Publié dans la communauté', 'success', { label: 'Voir', run: () => nav(`/c/${p.id}`) });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const withdraw = async () => {
    if (!publication) return;
    const ok = await ui.confirm({ title: 'Retirer ce film de la communauté ?', message: 'Il ne sera plus visible ni remixable. Les remix déjà faits restent chez leurs auteurs, et votre projet n’est pas touché.', confirm: 'Retirer', danger: true });
    if (!ok) return;
    setBusy(true);
    try { await Api.unpublish(publication.id); onDone(null); ui.toast('Publication retirée'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={onClose} icon="globe" size="md" label="publier dans la communauté"
      title={publication ? 'Mettre à jour la publication' : 'Publier dans la communauté'}
      description={<>Tout le monde pourra regarder ce film et le remixer. C'est une copie de la version {unsaved ? 'que vous allez enregistrer' : 'enregistrée'} : vous continuez à modifier la vôtre, et vous republiez quand vous voulez.</>}
      footer={<>
        {publication && <Link to={`/c/${publication.id}`} className="button"><Icon name="eye" size={16} /> Voir</Link>}
        {publication && <button type="button" className="ghost danger-ghost" onClick={() => void withdraw()} disabled={busy}>Retirer</button>}
        <span className="spacer" />
        <button type="button" className="ghost" onClick={onClose}>Annuler</button>
        <button type="submit" form="publish-form" className="cta" disabled={busy || !name.trim()}><Icon name="globe" size={16} /> {busy ? 'Publication…' : publication ? 'Republier' : 'Publier'}</button>
      </>}>
      <form id="publish-form" className="form" onSubmit={(e) => { e.preventDefault(); void publish(); }}>
        <label className="field">Titre <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus /></label>
        <label className="field">Description <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="De quoi parle ce film ? Comment l'avez-vous fait ?" /></label>
        <label className="field">Étiquettes <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="pub, pizza, humour (séparées par des virgules, 6 au plus)" /></label>
        <label className="field">Licence
          <select value={license} onChange={(e) => setLicense(e.target.value as License)}>{(Object.keys(LICENSE_LABEL) as License[]).map((l) => <option key={l} value={l}>{LICENSE_LABEL[l]}</option>)}</select>
        </label>
        <div className="alert info"><Icon name="info" size={16} /><span>Les voix enregistrées et les décors peints sont publiés avec le film. Vos clés d'API, vos commentaires et votre adresse e-mail ne le sont jamais.</span></div>
        {error && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
      </form>
    </Dialog>
  );
}
