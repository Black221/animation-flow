// The managers: the platform's staff, the only ones who get into the back office (their accounts are not the
// platform's users). A manager invites another (a link shown once, three days), disables or removes one — never
// themselves.
import { Dialog, Icon, Menu, useUI } from '@af/ui';
import { useEffect, useState } from 'react';
import { ago, Api, dateTime, type Manager, type ManagerInvitation } from '../api';
import { PageHead } from '../App';
import { Bounce } from '../ui-bits';

function InviteDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const ui = useUI();
  const [email, setEmail] = useState(''), [link, setLink] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setEmail(''); setLink(''); } }, [open]);
  const create = async () => {
    setBusy(true);
    try { const r = await Api.inviteManager(email.trim()); setLink(`${location.origin}${r.path}`); onDone(); } catch (e) { ui.toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Inviter un gérant" description="Un compte du back-office, pas un utilisateur de la plateforme. Le lien n'est montré qu'une fois et vaut trois jours." icon="shield" size="md"
      footer={link ? <button className="primary" onClick={onClose}>Terminé</button> : <><button className="ghost" onClick={onClose}>Annuler</button><button className="primary" onClick={() => void create()} disabled={busy || !email.includes('@')}>Créer le lien</button></>}>
      {!link ? <label className="field">E-mail du gérant<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom@exemple.org" aria-label="e-mail du gérant" autoFocus /></label> : <>
        <label className="field">Lien d'invitation<input readOnly value={link} aria-label="lien d'invitation" onFocus={(e) => e.currentTarget.select()} /></label>
        <div className="row"><button onClick={() => void navigator.clipboard?.writeText(link).then(() => ui.toast('Lien copié'))}><Icon name="copy" size={15} /> Copier</button><span className="muted small">Transmettez-le par un canal sûr : il ouvre l'accès au back-office.</span></div>
      </>}
    </Dialog>
  );
}

export function Staff() {
  const ui = useUI();
  const [data, setData] = useState<{ staff: Manager[]; invitations: ManagerInvitation[] } | null>(null), [inviting, setInviting] = useState(false);
  const load = () => Api.staff().then(setData).catch((e) => ui.toast((e as Error).message, 'error'));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = async (m: Manager) => {
    if (!(await ui.confirm(m.disabled ? { title: `Réactiver ${m.name} ?`, message: 'Il pourra de nouveau se connecter au back-office.', confirm: 'Réactiver' } : { title: `Désactiver ${m.name} ?`, message: 'Ses sessions se ferment tout de suite ; il ne peut plus se connecter.', confirm: 'Désactiver', danger: true }))) return;
    try { await Api.updateManager(m.id, !m.disabled); ui.toast('C’est fait'); void load(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  const remove = async (m: Manager) => {
    if (!(await ui.confirm({ title: `Retirer ${m.name} des gérants ?`, message: 'Son compte du back-office est supprimé ; le journal garde son nom.', confirm: 'Retirer', danger: true, typeToConfirm: m.email }))) return;
    try { await Api.removeManager(m.id); ui.toast('Gérant retiré'); void load(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  const revoke = async (i: ManagerInvitation) => {
    if (!(await ui.confirm({ title: `Annuler l'invitation de ${i.email} ?`, confirm: 'Annuler l’invitation', danger: true }))) return;
    try { await Api.revokeManagerInvitation(i.id); void load(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  return (
    <>
      <PageHead title="Gérants" sub="L'équipe qui gère la plateforme : les seuls comptes qui entrent dans ce back-office. Les utilisateurs de la plateforme administrent leur espace depuis l'application." icon="shield">
        <button className="primary" onClick={() => setInviting(true)}><Icon name="plus" size={16} /> Inviter un gérant</button>
      </PageHead>
      {!data ? <Bounce /> : <>
        <table className="admin-table" aria-label="gérants">
          <thead><tr><th>Gérant</th><th className="hide-phone">Dernière connexion</th><th className="hide-tablet">Depuis</th><th><span className="sr-only">actions</span></th></tr></thead>
          <tbody>{data.staff.map((m) => (
            <tr key={m.id} className={m.disabled ? 'suspended' : ''}>
              <td><span className="who-line"><strong>{m.name}</strong>{m.you && <span className="badge accent">vous</span>}{m.disabled && <span className="badge error">désactivé</span>}</span><span className="muted small">{m.email}</span></td>
              <td className="hide-phone muted small">{m.lastLoginAt ? ago(m.lastLoginAt) : 'jamais'}</td>
              <td className="hide-tablet muted small">{ago(m.createdAt)}{m.by ? ` · invité par ${m.by}` : ''}</td>
              <td className="actions">{!m.you && <Menu label={`actions sur ${m.name}`}>{(close) => <>
                <button role="menuitem" onClick={() => { close(); void toggle(m); }}><Icon name="ban" /> {m.disabled ? 'Réactiver' : 'Désactiver'}</button>
                <button role="menuitem" className="danger-item" onClick={() => { close(); void remove(m); }}><Icon name="trash" /> Retirer</button>
              </>}</Menu>}</td>
            </tr>
          ))}</tbody>
        </table>
        {data.invitations.length > 0 && <>
          <div className="section-title"><h2>Invitations en attente</h2><span className="badge">{data.invitations.length}</span></div>
          <ul className="bo-feed card" aria-label="invitations de gérants">{data.invitations.map((i) => <li key={i.id}><Icon name="link" size={14} /> <span>{i.email} <span className="muted small">· par {i.by ?? '?'} · expire le {dateTime(i.expiresAt)}</span></span><button className="small danger-ghost" onClick={() => void revoke(i)}>Annuler</button></li>)}</ul>
        </>}
      </>}
      <InviteDialog open={inviting} onClose={() => setInviting(false)} onDone={() => void load()} />
    </>
  );
}
