// The team of the current workspace: members and roles, invitation links, the workspace itself.
import { useCallback, useEffect, useState } from 'react';
import { Api, RANK, ROLE_LABEL, type Role, type WorkspaceInfo } from '../api';
import { useSession } from '../session';

const ROLES: Role[] = ['viewer', 'editor', 'admin'];
const DESCRIBE: Record<Role, string> = {
  viewer: 'consulte les projets et regarde les rendus',
  editor: 'édite, enregistre les voix, rend les vidéos, génère avec l\'IA',
  admin: 'gère aussi les clés d\'API, les modèles, les membres et les invitations',
  owner: 'peut aussi transmettre la propriété et supprimer l\'espace',
};

export function Team() {
  const { me, can, role, refresh, switchTo, epoch } = useSession();
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [error, setError] = useState('');
  const [invRole, setInvRole] = useState<Role>('editor'), [invEmail, setInvEmail] = useState('');
  const [link, setLink] = useState(''), [copied, setCopied] = useState(false), [send, setSend] = useState(true), [sentNote, setSentNote] = useState('');
  const [name, setName] = useState(''), [newWs, setNewWs] = useState(''), [confirm, setConfirm] = useState('');
  const load = useCallback(() => Api.workspace().then((w) => { setInfo(w); setName(w.name); }).catch((e) => setError((e as Error).message)), []);
  useEffect(() => { void load(); }, [load, epoch]);
  const act = async (f: () => Promise<unknown>, after?: () => void) => { setError(''); try { await f(); after?.(); await load(); } catch (e) { setError((e as Error).message); } };
  if (!info) return <div className="page muted">{error || 'Chargement…'}</div>;
  const admin = can('admin'), myId = me?.user?.id;

  return (
    <div className="page team">
      <h2>Équipe · {info.name}</h2>
      <p className="muted small">Votre rôle : {ROLE_LABEL[info.role]} — {DESCRIBE[info.role]}.</p>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="card">
        <h3>Membres</h3>
        <table className="members">
          <tbody>
            {info.members.map((m) => (
              <tr key={m.userId} data-testid="member">
                <td><strong>{m.name}</strong>{m.userId === myId && <span className="muted small"> (vous)</span>}<br /><span className="muted small">{m.email}</span></td>
                <td>
                  {admin && m.role !== 'owner' && m.userId !== myId
                    ? <select value={m.role} onChange={(e) => void act(() => Api.setRole(m.userId, e.target.value as Role))} aria-label={`rôle de ${m.name}`}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                    : <span className="badge">{ROLE_LABEL[m.role]}</span>}
                </td>
                <td className="actions">
                  {role === 'owner' && m.role !== 'owner' && <button className="ghost small" onClick={() => confirm_(`Transmettre la propriété à ${m.name} ? Vous deviendrez administrateur.`) && void act(() => Api.setRole(m.userId, 'owner'), () => void refresh())}>Transmettre la propriété</button>}
                  {m.userId !== myId && admin && m.role !== 'owner' && <button className="ghost small" onClick={() => confirm_(`Retirer ${m.name} de l'espace ?`) && void act(() => Api.removeMember(m.userId))}>Retirer</button>}
                  {m.userId === myId && m.role !== 'owner' && <button className="ghost small" onClick={() => confirm_("Quitter cet espace ?") && void act(() => Api.removeMember(m.userId), () => void refresh())}>Quitter</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {admin && (
        <section className="card form" aria-label="inviter">
          <h3>Inviter</h3>
          <div className="row wrap">
            <label>Rôle <select value={invRole} onChange={(e) => setInvRole(e.target.value as Role)} aria-label="rôle invité">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
            <input className="grow" type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="e-mail (facultatif : réserve le lien à cette adresse)" aria-label="e-mail invité" />
            {me?.mail && <label className="small"><input type="checkbox" checked={send && !!invEmail.trim()} disabled={!invEmail.trim()} onChange={(e) => setSend(e.target.checked)} /> envoyer par e-mail</label>}
            <button className="primary" onClick={() => void act(async () => {
              const to = invEmail.trim(), r = await Api.invite(invRole, to || undefined, { send: send && !!to && !!me?.mail });
              setLink(location.origin + r.path); setCopied(false); setInvEmail('');
              setSentNote(r.sent ? `Invitation envoyée à ${r.email}.` : r.sendError ?? '');
            })}>{send && invEmail.trim() && me?.mail ? 'Envoyer l\'invitation' : 'Créer un lien'}</button>
          </div>
          {sentNote && <p className="small" role="status" data-testid="invite-sent">{sentNote}</p>}
          <p className="muted small">{ROLE_LABEL[invRole]} : {DESCRIBE[invRole]}. Le lien est valable 7 jours, pour une seule personne. Il n'est affiché qu'une fois.</p>
          {link && (
            <div className="row invite-link">
              <input readOnly value={link} aria-label="lien d'invitation" onFocus={(e) => e.target.select()} />
              <button onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)); }}>{copied ? 'Copié' : 'Copier'}</button>
            </div>
          )}
          {info.invitations.length > 0 && (
            <ul className="pending">
              {info.invitations.map((i) => (
                <li key={i.id} className="row">
                  <span className="badge">{ROLE_LABEL[i.role]}</span>
                  <span className="small">{i.email ?? 'lien ouvert'} · par {i.by ?? '?'} · expire le {new Date(i.expiresAt).toLocaleDateString('fr-FR')}</span>
                  <button className="ghost small" onClick={() => void act(() => Api.revokeInvitation(i.id))}>Révoquer</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card form">
        <h3>Espaces de travail</h3>
        {admin && (
          <div className="row wrap">
            <input className="grow" value={name} onChange={(e) => setName(e.target.value)} aria-label="nom de l'espace" />
            <button onClick={() => void act(() => Api.renameWorkspace(name.trim()), () => void refresh())} disabled={!name.trim() || name === info.name}>Renommer</button>
          </div>
        )}
        <div className="row wrap">
          <input className="grow" value={newWs} onChange={(e) => setNewWs(e.target.value)} placeholder="nom d'un nouvel espace" aria-label="nouvel espace" />
          <button onClick={() => void act(async () => { const w = await Api.createWorkspace(newWs.trim()); setNewWs(''); await refresh(); switchTo(w.id); })} disabled={!newWs.trim()}>Créer un espace</button>
        </div>
      </section>

      {role === 'owner' && (
        <section className="card form danger" aria-label="supprimer l'espace">
          <h3>Supprimer l'espace</h3>
          <p className="small">Supprime définitivement ses projets, clés d'API, voix enregistrées, rendus et générations. Tapez « {info.name} » pour confirmer.</p>
          <div className="row wrap">
            <input className="grow" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="confirmation" />
            <button className="danger" disabled={confirm !== info.name} onClick={() => void act(async () => { await Api.deleteWorkspace(confirm); setConfirm(''); await refresh(); switchTo(''); })}>Supprimer</button>
          </div>
        </section>
      )}
      {RANK[info.role] < RANK.admin && <p className="muted small">Pour inviter quelqu'un ou changer un rôle, demandez à un administrateur.</p>}
    </div>
  );
}
const confirm_ = (q: string) => window.confirm(q);
