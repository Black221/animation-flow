// « Dessins »: everything drawn for the film (characters, props, decors). Each one can be looked at (animated), renamed,
// drawn again by the model with a change, painted as a picture (decors, with an image model), edited as JSON or
// removed; new ones can be asked for. Nothing here comes from a fixed catalogue.
import { parseProject, type Asset, type Project } from '@af/schema';
import { useEffect, useMemo, useState } from 'react';
import { Api } from '../api';
import { usePlan } from '../plan';
import { addPicture } from '../pictures';
import { AssetView } from './AssetView';
import { JsonEditor, type JsonIssue } from './JsonEditor';
import { Icon } from '@af/ui';
import { Dialog, useUI } from '@af/ui';
import { Link } from 'react-router';

const KIND_LABEL: Record<Asset['kind'], string> = { character: 'personnage', prop: 'accessoire', decor: 'décor' };
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const issuesOf = (candidate: unknown): JsonIssue[] => { const r = parseProject(candidate); return r.ok ? [] : r.issues; };

/** where a drawing is used: the cast members drawn with it and the scenes that show it */
function usesOf(p: Project, id: string, a: Asset): string[] {
  const refs = new Set(Object.entries(p.cast).filter(([, c]) => c.kind === id).map(([ref]) => ref));
  return p.scenes.filter((s) => (a.kind === 'decor' ? s.decor.kind === id : s.elements.some((e) => (e.type === 'character' && !!e.ref && refs.has(e.ref)) || (e.type === 'prop' && e.ref === id)))).map((s) => s.id);
}

export function DrawingsPanel({ project, onChange, readOnly, resetKey, remoteKey }: { project: Project; onChange: (p: Project) => void; readOnly: boolean; resetKey: string; remoteKey: number }) {
  const { plan } = usePlan(), paintable = !plan || plan.limits.decorImages;
  const ids = Object.keys(project.assets);
  const [sel, setSel] = useState<string | null>(ids[0] ?? null);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const ui = useUI();
  const cur = sel && project.assets[sel] ? sel : ids[0] ?? null;
  const asset = cur ? project.assets[cur]! : null;
  useEffect(() => { setInstruction(''); setNote(''); }, [cur]);
  const uses = useMemo(() => (cur && asset ? usesOf(project, cur, asset) : []), [project, cur, asset]);

  const setAsset = (id: string, a: Asset | null, extra: Partial<Project> = {}) => {
    const assets = { ...project.assets };
    if (a) assets[id] = a; else delete assets[id];
    onChange({ ...project, ...extra, assets });
  };
  const run = async (what: string, f: () => Promise<string>) => {
    setBusy(what); setNote('');
    try { setNote(await f()); } catch (e) { setNote((e as Error).message); } finally { setBusy(''); }
  };
  const redraw = (id: string, a: Asset) => run('draw', async () => {
    const r = await Api.draw({ project, id, kind: a.kind, name: a.name, description: a.description, ...(instruction.trim() ? { instruction: instruction.trim() } : {}), current: a });
    setAsset(id, r.asset); setInstruction('');
    return `${r.model} · ${r.usage.inputTokens}+${r.usage.outputTokens} tokens${r.fallback ? ' · le modèle n\'a pas réussi : dessin simplifié' : ''}${r.review.length ? ` · relecture : ${r.review.slice(0, 3).join(' ; ')}` : ''}`;
  });
  const paint = (id: string, a: Asset) => run('paint', async () => {
    const palette = [...new Set(Object.values(project.assets).flatMap((x) => x.parts.flatMap((pt) => pt.shapes.flatMap((s) => ('fill' in s && typeof s.fill === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.fill) ? [s.fill] : [])))))].slice(0, 8);
    const r = await Api.paintDecor({ name: a.name, description: a.description, ...(instruction.trim() ? { instruction: instruction.trim() } : {}), style: project.style, palette });
    addPicture(r.image.asset, r.url);
    setAsset(id, { ...a, image: r.image }); setInstruction('');
    return `peint par ${r.model}`;
  });

  return (
    <div className="drawings">
      <ul className="drawing-list" aria-label="dessins du film">
        {ids.map((id) => {
          const a = project.assets[id]!;
          return (
            <li key={id}>
              <button className={id === cur ? 'active' : ''} onClick={() => setSel(id)} data-testid={`drawing-${id}`}>
                <strong>{a.name}</strong> <span className="muted small">{KIND_LABEL[a.kind]}{a.image ? ' · image' : ''}{a.made?.by === 'image importée' ? ' · importée' : ''}{a.made?.by === 'dessin de secours' ? ' · simplifié' : ''}</span>
              </button>
            </li>
          );
        })}
        {!ids.length && <li className="muted small">Aucun dessin : les générations en font pour chaque film.</li>}
      </ul>
      {!readOnly && <button onClick={() => setAdding(true)}><Icon name="plus" size={16} /> nouveau dessin</button>}
      {adding && <NewDrawing project={project} onCancel={() => setAdding(false)} onMade={(id, a, note) => {
        // a new character joins the cast under its own id
        setAsset(id, a, a.kind === 'character' && !project.cast[id] ? { cast: { ...project.cast, [id]: { kind: id, name: a.name, params: {} } } } : {});
        setSel(id); setAdding(false); setNote(note); ui.toast(`« ${a.name} » dessiné`);
      }} />}

      {cur && asset && (
        <div className="drawing">
          <AssetView id={cur} asset={asset} style={project.style} />
          <p className="muted small">
            {KIND_LABEL[asset.kind]} « {cur} »{asset.made ? ` · ${asset.made.by}${asset.made.rounds ? `, ${asset.made.rounds} relecture(s)` : ''}` : ''}
            {asset.image ? ` · image ${asset.image.width}×${asset.image.height}${asset.image.by ? ` (${asset.image.by})` : ''}` : ''}
            {' · '}{uses.length ? `dans ${uses.join(', ')}` : 'utilisé dans aucune scène'}
          </p>
          {!readOnly && (
            <div className="form">
              <label>Nom <input value={asset.name} onChange={(e) => e.target.value.trim() && setAsset(cur, { ...asset, name: e.target.value })} /></label>
              <label>Description <textarea rows={3} value={asset.description} onChange={(e) => setAsset(cur, { ...asset, description: e.target.value })} /></label>
              <label>Changement demandé (facultatif)
                <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="« une écharpe rouge », « plus de lumière », « la nuit »…" aria-label="changement du dessin" />
              </label>
              <div className="row">
                <button onClick={() => void redraw(cur, asset)} disabled={!!busy || asset.description.trim().length < 3}>{busy === 'draw' ? 'L\'IA dessine…' : 'Redessiner avec l\'IA'}</button>
                {asset.kind === 'decor' && (paintable
                  ? <button onClick={() => void paint(cur, asset)} disabled={!!busy || asset.description.trim().length < 3}>{busy === 'paint' ? 'Peinture…' : asset.image ? 'Repeindre l\'image' : 'Peindre en image'}</button>
                  : <Link to="/plans" className="button" title="les décors peints sont inclus à partir du plan Premium"><Icon name="lock" size={15} /> Peindre en image · Premium</Link>)}
                {asset.image && <button onClick={() => { const { image: _drop, ...rest } = asset; setAsset(cur, rest as Asset); }}>Retirer l'image</button>}
                <button className="danger" disabled={!!busy || uses.length > 0} title={uses.length ? 'utilisé dans des scènes' : ''} onClick={() => void ui.confirm({ title: `Supprimer le dessin « ${asset.name} » ?`, message: 'Il ne sert dans aucune scène. Vous pourrez le redemander à l’IA.', confirm: 'Supprimer', danger: true }).then((ok) => { if (ok) { setAsset(cur, null); ui.toast(`« ${asset.name} » supprimé`); } })}>Supprimer</button>
              </div>
              {note && <p className="muted small" data-testid="drawing-note">{note}</p>}
            </div>
          )}
          <details>
            <summary>Données du dessin (JSON)</summary>
            <JsonEditor label="dessin (JSON)" readOnly={readOnly} rows={16} value={asset} resetKey={`asset:${cur}:${resetKey}`} remoteKey={remoteKey}
              validate={(v) => issuesOf({ ...project, assets: { ...project.assets, [cur]: v } })} onApply={(v) => setAsset(cur, v as Asset)} />
          </details>
        </div>
      )}
    </div>
  );
}

function NewDrawing({ project, onMade, onCancel }: { project: Project; onMade: (id: string, a: Asset, note: string) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<Asset['kind']>('prop');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const taken = !!project.assets[id] || (kind === 'character' && !!project.cast[id]);
  const ok = ID_RE.test(id) && !taken && name.trim() && description.trim().length >= 3;
  return (
    <Dialog open onClose={onCancel} title="Nouveau dessin" icon="brush" size="md" description="Décrivez-le : l'IA le dessine pour ce film (avec ses poses et expressions si c'est un personnage), puis le relit en le regardant."
      footer={<>
        <button type="button" className="ghost" onClick={onCancel}>Annuler</button>
        <button type="submit" form="new-drawing" className="primary" disabled={!ok || busy}><Icon name="sparkles" size={16} /> {busy ? 'L\'IA dessine…' : 'Dessiner'}</button>
      </>}>
    <form id="new-drawing" className="form" onSubmit={(e) => { e.preventDefault(); void (async () => {
      setBusy(true); setError('');
      try {
        const r = await Api.draw({ project, id, kind, name: name.trim(), description: description.trim() });
        onMade(id, r.asset, `${r.model}${r.fallback ? ' · dessin simplifié' : ''}${r.review.length ? ` · ${r.review.slice(0, 2).join(' ; ')}` : ''}`);
      } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    })(); }}>
      <label>Type <select value={kind} onChange={(e) => setKind(e.target.value as Asset['kind'])}>{(Object.keys(KIND_LABEL) as Asset['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
      <label>Identifiant <input value={id} onChange={(e) => setId(e.target.value.trim())} placeholder="lanterne" aria-label="identifiant du dessin" /></label>
      {taken && <p className="error small">cet identifiant est déjà pris</p>}
      <label>Nom <input value={name} onChange={(e) => setName(e.target.value)} aria-label="nom du dessin" /></label>
      <label>Description <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="forme, couleurs, taille par rapport à une personne, ce qui bouge" aria-label="description du dessin" /></label>
      {error && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
    </form>
    </Dialog>
  );
}
