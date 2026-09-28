// The platform's users: found by name or e-mail, filtered; one user's page (their workspaces with their plan, limits
// and usage; suspending, signing out everywhere). A user administers their own workspace in the app; nothing here
// makes them a manager (managers have accounts of their own). Every action asks first and goes to the audit log.
import { Icon, METRICS, Menu, PLAN_LABEL, PlanBadge, UsageMeter, useUI } from '@af/ui';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ago, Api, dateTime, ROLE, type UserDetail, type UserRow, type UserWorkspace, type Page } from '../api';
import { PageHead } from '../App';
import { BillingBadge, LimitsDialog, More, PlanSelect } from '../parts';
import { Bounce } from '../ui-bits';

const FILTERS = [['all', 'Tous'], ['paying', 'Payants'], ['suspended', 'Suspendus']] as const;

/** suspend, restore, sign out everywhere: each asked first */
export function useUserActions(onDone: () => void) {
  const ui = useUI();
  return async (u: { id: string; name: string; suspended: boolean }, b: { suspended?: boolean; signout?: boolean }) => {
    const what = b.signout ? { title: `Déconnecter ${u.name} partout ?`, message: 'Toutes ses sessions dans l’application se ferment ; son compte reste ouvert, il pourra se reconnecter.', confirm: 'Déconnecter' }
      : b.suspended === true ? { title: `Suspendre ${u.name} ?`, message: 'Ses sessions se ferment tout de suite et la connexion lui est refusée. Ses espaces, projets et films restent.', confirm: 'Suspendre', danger: true }
      : { title: `Réactiver ${u.name} ?`, message: 'Le compte pourra de nouveau se connecter.', confirm: 'Réactiver' };
    if (!(await ui.confirm(what))) return;
    try {
      if (b.signout) { const r = await Api.signOutUser(u.id); ui.toast(`${r.ended} session(s) fermée(s)`); }
      else { await Api.updateUser(u.id, { suspended: !!b.suspended }); ui.toast('C’est fait'); }
      onDone();
    } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
}

export function Users() {
  const ui = useUI(), nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '', filter = params.get('filter') ?? 'all';
  const [list, setList] = useState<Page<UserRow> | null>(null);
  const load = (offset = 0) => Api.users({ q, filter, offset }).then((r) => setList((l) => (offset && l ? { total: r.total, items: [...l.items, ...r.items] } : r))).catch((e) => ui.toast((e as Error).message, 'error'));
  useEffect(() => { const t = setTimeout(() => void load(), 200); return () => clearTimeout(t); }, [q, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = useUserActions(() => void load());
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v && v !== 'all') p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  return (
    <>
      <PageHead title="Utilisateurs" sub={list ? `${list.total} compte${list.total > 1 ? 's' : ''}` : 'Les comptes de la plateforme'} icon="user" />
      <div className="search-row">
        <label className="search"><Icon name="search" size={16} /><input value={q} onChange={(e) => set('q', e.target.value)} placeholder="Nom ou e-mail…" aria-label="chercher un utilisateur" /></label>
        <div className="segmented" role="group" aria-label="filtre">{FILTERS.map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => set('filter', k)}>{l}</button>)}</div>
      </div>
      {!list ? <Bounce /> : list.items.length === 0 ? <div className="empty"><p>Personne ne correspond.</p></div> : (
        <table className="admin-table" aria-label="utilisateurs">
          <thead><tr><th>Utilisateur</th><th className="hide-phone">Espaces</th><th className="hide-tablet">Inscription</th><th className="hide-tablet">Dernière visite</th><th><span className="sr-only">actions</span></th></tr></thead>
          <tbody>{list.items.map((u) => (
            <tr key={u.id} className={u.suspended ? 'suspended' : ''}>
              <td><span className="who-line"><Link to={`/users/${u.id}`}><strong>{u.name}</strong></Link>{u.suspended && <span className="badge error">suspendu</span>}</span><span className="muted small">{u.email}</span></td>
              <td className="hide-phone"><span className="ws-plans">{u.workspaces.map((w) => <Link key={w.id} to={`/workspaces/${w.id}`} title={`${w.name} (${ROLE[w.role] ?? w.role})`}><PlanBadge plan={w.plan} label={PLAN_LABEL[w.plan]} /></Link>)}</span></td>
              <td className="hide-tablet muted small">{ago(u.createdAt)}</td>
              <td className="hide-tablet muted small">{u.lastSeenAt ? ago(u.lastSeenAt) : 'jamais'}</td>
              <td className="actions">
                <Menu label={`actions sur ${u.name}`}>{(close) => <>
                  <button role="menuitem" onClick={() => { close(); nav(`/users/${u.id}`); }}><Icon name="info" /> Fiche du compte</button>
                  <button role="menuitem" onClick={() => { close(); void act(u, { signout: true }); }}><Icon name="logout" /> Déconnecter partout</button>
                  <button role="menuitem" className={u.suspended ? '' : 'danger-item'} onClick={() => { close(); void act(u, { suspended: !u.suspended }); }}><Icon name="ban" /> {u.suspended ? 'Réactiver' : 'Suspendre'}</button>
                </>}</Menu>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {list && <More shown={list.items.length} total={list.total} onMore={() => void load(list.items.length)} />}
    </>
  );
}

function WorkspaceCard({ w, onChanged }: { w: UserWorkspace; onChanged: () => void }) {
  const [limits, setLimits] = useState(false);
  return (
    <section className="card admin-ws" aria-label={`espace ${w.name}`}>
      <div className="row wrap">
        <Link to={`/workspaces/${w.id}`}><strong>{w.name}</strong></Link> <span className="muted small">{ROLE[w.role] ?? w.role}</span>
        <span className="spacer" />
        <PlanBadge plan={w.plan} label={PLAN_LABEL[w.plan]} /><BillingBadge status={w.billing.status} />
      </div>
      <div className="row wrap">
        <PlanSelect id={w.id} name={w.name} plan={w.plan} billing={w.billing} onChanged={onChanged} />
        <button className="small" onClick={() => setLimits(true)}><Icon name="sliders" size={14} /> Limites sur mesure{Object.keys(w.overrides).length ? ` (${Object.keys(w.overrides).length})` : ''}</button>
      </div>
      <div className="meters compact">{METRICS.map((m) => <UsageMeter key={m} metric={m} used={w.usage[m]} limit={w.limits[m]} compact />)}</div>
      <LimitsDialog ws={limits ? w : null} onClose={() => setLimits(false)} onSaved={onChanged} />
    </section>
  );
}

export function UserPage() {
  const { id = '' } = useParams();
  const [u, setU] = useState<UserDetail | null>(null), [error, setError] = useState('');
  const load = () => Api.user(id).then(setU).catch((e) => setError((e as Error).message));
  useEffect(() => { setU(null); void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = useUserActions(() => void load());
  if (error) return <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>;
  if (!u) return <Bounce />;
  return (
    <>
      <p className="bo-crumbs"><Link to="/users"><Icon name="back" size={14} /> Utilisateurs</Link></p>
      <PageHead title={u.name} sub={u.email} icon="user">
        <button onClick={() => void act(u, { signout: true })} disabled={u.sessions === 0}><Icon name="logout" size={16} /> Déconnecter partout</button>
        <button className={u.suspended ? 'primary' : 'danger'} onClick={() => void act(u, { suspended: !u.suspended })}><Icon name="ban" size={16} /> {u.suspended ? 'Réactiver' : 'Suspendre'}</button>
      </PageHead>
      {u.suspended && <div className="badges bo-badges"><span className="badge error"><Icon name="ban" size={12} /> suspendu {u.suspendedAt ? ago(u.suspendedAt) : ''}</span></div>}
      <dl className="details card">
        <dt>Inscription</dt><dd>{dateTime(u.createdAt)}</dd>
        <dt>Dernière visite</dt><dd>{u.lastSeenAt ? `${ago(u.lastSeenAt)} (${dateTime(u.lastSeenAt)})` : 'jamais'}</dd>
        <dt>Sessions ouvertes</dt><dd>{u.sessions}</dd>
        <dt>Films publiés</dt><dd>{u.publications ? <Link to={`/films?q=${encodeURIComponent(u.name)}`}>{u.publications}</Link> : 0}</dd>
      </dl>
      <div className="section-title"><h2>Espaces</h2><span className="badge">{u.workspaces.length}</span></div>
      {u.workspaces.length === 0 ? <div className="empty"><p>Membre d'aucun espace.</p></div> : <div className="bo-stack">{u.workspaces.map((w) => <WorkspaceCard key={w.id} w={w} onChanged={() => void load()} />)}</div>}
    </>
  );
}
