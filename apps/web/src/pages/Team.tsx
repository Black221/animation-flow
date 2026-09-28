// The team of the current workspace: members and roles, invitations (in a dialog), the workspace itself. Every change
// of who may do what is confirmed in a dialog; deleting the workspace asks for its name.
import { useCallback, useEffect, useState } from 'react';
import { Api, RANK, ROLE_LABEL, type Role, type WorkspaceInfo } from '../api';
import { Icon } from '@af/ui';
import { Loading } from '../components/Motion';
import { Dialog, useUI } from '@af/ui';
import { useSession } from '../session';

const ROLES: Role[] = ['viewer', 'editor', 'admin'];
const DESCRIBE: Record<Role, string> = {
  viewer: 'consulte les projets et regarde les rendus',
  editor: 'édite, enregistre les voix, rend les vidéos, génère avec l\'IA',
  admin: 'gère aussi les clés d\'API, les modèles, les membres et les invitations',
  owner: 'peut aussi transmettre la propriété et supprimer l\'espace',
};
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { me } = useSession(), ui = useUI();
  const [invRole, setInvRole] = useState<Role>('editor'), [invEmail, setInvEmail] = useState(''), [send, setSend] = useState(true);
  const [link, setLink] = useState(''), [sentNote, setSentNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const mail = !!me?.mail, sending = send && !!invEmail.trim() && mail;
  const invite = async () => {
    setBusy(true); setError('');
    try {
      const to = invEmail.trim(), r = await Api.invite(invRole, to || undefined, { send: sending });
      setLink(location.origin + r.path); setInvEmail('');
      setSentNote(r.sent ? `Invitation envoyée à ${r.email}.` : r.sendError ?? '');
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Inviter dans l'espace" icon="users" size="md" label="inviter"
      description="Un lien personnel, valable 7 jours, pour une seule personne. Il n'est affiché qu'une fois."
      footer={link ? <button className="primary" onClick={onClose}>Terminé</button> : <>
        <button type="button" className="ghost" onClick={onClose}>Annuler</button>
        <button type="button" className="primary" onClick={() => void invite()} disabled={busy}><Icon name={sending ? 'message' : 'link'} size={16} /> {sending ? 'Envoyer l\'invitation' : 'Créer un lien'}</button>
      </>}>
      <section className="form" aria-label="inviter">
        {!link && <>
          <label className="field">Rôle <select value={invRole} onChange={(e) => setInvRole(e.target.value as Role)} aria-label="rôle invité">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          <p className="muted small">{ROLE_LABEL[invRole]} : {DESCRIBE[invRole]}.</p>
          <label className="field">E-mail <span className="muted small">(facultatif : réserve le lien à cette adresse)</span>
            <input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="prenom@exemple.org" aria-label="e-mail invité" />
          </label>
          {mail && <label className="switch small"><input type="checkbox" checked={send && !!invEmail.trim()} disabled={!invEmail.trim()} onChange={(e) => setSend(e.target.checked)} /> envoyer par e-mail</label>}
        </>}
        {sentNote && <div className="alert success" role="status" data-testid="invite-sent">{sentNote}</div>}
        {link && (
          <div className="field">Lien d'invitation
            <div className="row invite-link">
              <input readOnly value={link} aria-label="lien d'invitation" onFocus={(e) => e.target.select()} />
              <button onClick={() => { void navigator.clipboard?.writeText(link).then(() => ui.toast('Lien copié')); }}><Icon name="copy" size={16} /> Copier</button>
            </div>
          </div>
        )}
        {error && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
      </section>
    </Dialog>
  );
}

export function Team() {
  const { me, can, role, refresh, switchTo, epoch } = useSession(), ui = useUI();
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [error, setError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState('');
  const load = useCallback(() => Api.workspace().then((w) => { setInfo(w); setName(w.name); }).catch((e) => setError((e as Error).message)), []);
  useEffect(() => { void load(); }, [load, epoch]);
  const act = async (f: () => Promise<unknown>, done?: string, after?: () => void) => {
    setError('');
    try { await f(); if (done) ui.toast(done); after?.(); await load(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  if (!info) return error ? <div className="page"><div className="alert error" role="alert">{error}</div></div> : <Loading />;
  const admin = can('admin'), myId = me?.user?.id;
  const ask = (title: string, message: string, confirm: string, danger = false) => ui.confirm({ title, message, confirm, danger });

  return (
    <div className="page team">
      <div className="page-head">
        <div><h2>Équipe · {info.name}</h2><p className="muted small">Votre rôle : {ROLE_LABEL[info.role]} — {DESCRIBE[info.role]}.</p></div>
        <span className="spacer" />
        {admin && <button className="primary" onClick={() => setInviting(true)}><Icon name="plus" size={16} /> Inviter</button>}
      </div>
      {error && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}

      <section className="card">
        <h3>Membres <span className="badge">{info.members.length}</span></h3>
        <table className="members">
          <tbody>
            {info.members.map((m) => (
              <tr key={m.userId} data-testid="member">
                <td className="who"><span className="avatar" aria-hidden>{initials(m.name)}</span><span><strong>{m.name}</strong>{m.userId === myId && <span className="muted small"> (vous)</span>}<br /><span className="muted small">{m.email}</span></span></td>
                <td>
                  {admin && m.role !== 'owner' && m.userId !== myId
                    ? <select value={m.role} onChange={(e) => void act(() => Api.setRole(m.userId, e.target.value as Role), `${m.name} est maintenant ${ROLE_LABEL[e.target.value as Role]}`)} aria-label={`rôle de ${m.name}`}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                    : <span className="badge">{ROLE_LABEL[m.role]}</span>}
                </td>
                <td className="actions">
                  {role === 'owner' && m.role !== 'owner' && <button className="ghost small" onClick={() => void ask(`Transmettre la propriété à ${m.name} ?`, 'Vous deviendrez administrateur : vous ne pourrez plus supprimer l’espace ni en transmettre la propriété.', 'Transmettre').then((ok) => { if (ok) void act(() => Api.setRole(m.userId, 'owner'), 'Propriété transmise', () => void refresh()); })}>Transmettre la propriété</button>}
                  {m.userId !== myId && admin && m.role !== 'owner' && <button className="ghost small danger-ghost" onClick={() => void ask(`Retirer ${m.name} de l'espace ?`, "Cette personne n'aura plus accès aux projets de l'espace. Vous pourrez l'inviter de nouveau.", 'Retirer', true).then((ok) => { if (ok) void act(() => Api.removeMember(m.userId), `${m.name} a été retiré(e)`); })}>Retirer</button>}
                  {m.userId === myId && m.role !== 'owner' && <button className="ghost small" onClick={() => void ask('Quitter cet espace ?', "Vous n'aurez plus accès à ses projets, sauf nouvelle invitation.", 'Quitter', true).then((ok) => { if (ok) void act(() => Api.removeMember(m.userId), 'Vous avez quitté l’espace', () => void refresh()); })}>Quitter</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {admin && info.invitations.length > 0 && (
        <section className="card">
          <h3>Invitations en attente <span className="badge">{info.invitations.length}</span></h3>
          <ul className="pending">
            {info.invitations.map((i) => (
              <li key={i.id} className="row">
                <span className="badge">{ROLE_LABEL[i.role]}</span>
                <span className="small grow">{i.email ?? 'lien ouvert'} · par {i.by ?? '?'} · expire le {new Date(i.expiresAt).toLocaleDateString('fr-FR')}</span>
                <button className="ghost small" onClick={() => void ask('Révoquer cette invitation ?', 'Le lien ne fonctionnera plus.', 'Révoquer', true).then((ok) => { if (ok) void act(() => Api.revokeInvitation(i.id), 'Invitation révoquée'); })}>Révoquer</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card form">
        <h3>Espaces de travail</h3>
        {admin && (
          <div className="row wrap">
            <input className="grow" value={name} onChange={(e) => setName(e.target.value)} aria-label="nom de l'espace" />
            <button onClick={() => void act(() => Api.renameWorkspace(name.trim()), 'Espace renommé', () => void refresh())} disabled={!name.trim() || name === info.name}>Renommer</button>
          </div>
        )}
        <div><button onClick={() => void ui.prompt({ title: 'Nouvel espace de travail', message: 'Un espace séparé, avec ses propres projets, clés et membres. Vous en serez propriétaire.', label: 'Nom', placeholder: 'Mon studio', confirm: 'Créer', required: true })
          .then((n) => { if (n) void act(async () => { const w = await Api.createWorkspace(n.trim()); await refresh(); switchTo(w.id); }, `Espace « ${n.trim()} » créé`); })}><Icon name="plus" size={16} /> Nouvel espace</button></div>
      </section>

      {role === 'owner' && (
        <section className="card danger" aria-label="supprimer l'espace">
          <h3><Icon name="alert" size={17} /> Zone sensible</h3>
          <div className="row wrap">
            <p className="small grow">Supprimer l'espace efface définitivement ses projets, clés d'API, voix enregistrées, rendus, générations et publications.</p>
            <button className="danger" onClick={() => void ui.confirm({ title: `Supprimer « ${info.name} » ?`, message: 'Cette action est définitive : rien ne pourra être récupéré.', confirm: 'Supprimer définitivement', danger: true, typeToConfirm: info.name })
              .then((ok) => { if (ok) void act(async () => { await Api.deleteWorkspace(info.name); await refresh(); switchTo(''); }, 'Espace supprimé'); })}>Supprimer l'espace…</button>
          </div>
        </section>
      )}
      {RANK[info.role] < RANK.admin && <div className="alert info"><Icon name="info" size={16} /><span>Pour inviter quelqu'un ou changer un rôle, demandez à un administrateur.</span></div>}
      {inviting && <InviteDialog onClose={() => setInviting(false)} onDone={() => void load()} />}
    </div>
  );
}
