// The platform's administration (platform admins): an overview, the accounts (a workspace's plan and custom limits,
// suspending, naming admins), and the reports on published films. Every action asks first.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Api, REPORT_REASON, type AdminOverview, type AdminUser, type AdminUserDetail, type AdminWorkspace, type Limits, type Metric, type PlanId, type Report } from '../api';
import { Icon } from '../components/Icon';
import { Bounce, Loading } from '../components/Motion';
import { Dialog, Menu, useUI } from '../components/ui';
import { limitText, METRIC, METRICS, PlanBadge, UsageMeter, widthText } from '../plan';
import { useSession } from '../session';
import { ago } from './Projects';

const PLAN_LABEL: Record<PlanId, string> = { free: 'Gratuit', basic: 'Basique', premium: 'Premium', pro: 'Pro' };
const PLANS: PlanId[] = ['free', 'basic', 'premium', 'pro'];
const TABS = [['overview', 'Vue d’ensemble', 'gauge'], ['users', 'Utilisateurs', 'users'], ['reports', 'Signalements', 'flag']] as const;

function Overview({ o }: { o: AdminOverview }) {
  const total = Math.max(1, PLANS.reduce((a, p) => a + o.byPlan[p], 0));
  const tiles: [string, string | number, string][] = [
    ['Utilisateurs', o.users, `${o.newUsers} nouveau${o.newUsers > 1 ? 'x' : ''} ce mois`], ['Actifs (30 j)', o.activeUsers, `${o.suspended} suspendu${o.suspended > 1 ? 's' : ''}`],
    ['Espaces payants', o.paying, `sur ${o.workspaces} espaces`], ['Revenu mensuel', `${o.monthlyRevenue} €`, 'abonnements en cours'],
    ['Films publiés', o.publications, `${o.projects} projets en tout`], ['Signalements', o.openReports, 'à traiter'],
  ];
  return (
    <>
      {!o.plansEnabled && <div className="alert info"><Icon name="info" size={16} /><span>Les plans sont désactivés sur ce serveur (PLANS=off) : rien n'est limité.</span></div>}
      <ul className="stat-tiles">{tiles.map(([l, v, s]) => <li key={l} className={l === 'Signalements' && o.openReports ? 'warn' : ''}><span className="muted small">{l}</span><strong>{v}</strong><span className="muted small">{s}</span></li>)}</ul>
      <div className="section-title"><h2>Espaces par plan</h2></div>
      {/* the plans as clips on one track: each as long as its share */}
      <div className="plan-track" role="img" aria-label={PLANS.map((p) => `${PLAN_LABEL[p]} : ${o.byPlan[p]}`).join(', ')}>
        {PLANS.filter((p) => o.byPlan[p]).map((p) => <span key={p} className={`clip ${p}`} style={{ flexGrow: o.byPlan[p] / total }}><b>{PLAN_LABEL[p]}</b> {o.byPlan[p]}</span>)}
      </div>
      <div className="section-title"><h2>Ce mois, sur toute la plateforme</h2></div>
      <ul className="stat-tiles small">{(['generations', 'aiActions', 'renderMinutes'] as Metric[]).map((m) => <li key={m}><span className="muted small"><Icon name={METRIC[m].icon} size={13} /> {METRIC[m].label}</span><strong>{METRIC[m].unit(o.usage[m] ?? 0)}</strong></li>)}</ul>
    </>
  );
}

/** a workspace's limits of its own: blank = the plan's, « illimité » = none */
function LimitsDialog({ ws, onClose, onSaved }: { ws: AdminWorkspace | null; onClose: () => void; onSaved: () => void }) {
  const ui = useUI();
  const [v, setV] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<{ maxWidth?: number; decorImages?: boolean; priority?: boolean }>({});
  useEffect(() => {
    if (!ws) return;
    const o = ws.overrides ?? {};
    setV(Object.fromEntries(METRICS.map((m) => [m, m in o ? (o[m] == null ? 'illimité' : String(o[m])) : ''])));
    setFlags({ ...(o.maxWidth ? { maxWidth: o.maxWidth } : {}), ...(o.decorImages != null ? { decorImages: o.decorImages } : {}), ...(o.priority != null ? { priority: o.priority } : {}) });
  }, [ws]);
  const save = async () => {
    const quotas: Partial<Limits> = {};
    for (const m of METRICS) {
      const s = (v[m] ?? '').trim().toLowerCase();
      if (!s) continue;
      if (s === 'illimité' || s === 'illimite') (quotas as Record<string, null>)[m] = null;
      else if (/^\d+$/.test(s)) (quotas as Record<string, number>)[m] = Number(s);
      else { ui.toast(`${METRIC[m].label} : un nombre, « illimité », ou vide`, 'error'); return; }
    }
    Object.assign(quotas, flags);
    try { await Api.admin.updateWorkspace(ws!.id, { quotas }); ui.toast('Limites enregistrées'); onSaved(); onClose(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  return (
    <Dialog open={!!ws} onClose={onClose} title="Limites sur mesure" description={ws ? `Pour « ${ws.name} », au-dessus du plan ${PLAN_LABEL[ws.plan]}. Laissez vide pour garder celle du plan.` : ''} icon="sliders" size="md"
      footer={<><button className="ghost" onClick={() => setV(Object.fromEntries(METRICS.map((m) => [m, ''])))}>Tout remettre au plan</button><span className="spacer" /><button className="ghost" onClick={onClose}>Annuler</button><button className="primary" onClick={() => void save()}>Enregistrer</button></>}>
      <div className="limits-form">
        {METRICS.map((m) => (
          <label key={m} className="field"><span><Icon name={METRIC[m].icon} size={14} /> {METRIC[m].label}{METRIC[m].monthly ? ' / mois' : ''}{m === 'storageMb' ? ' (Mo)' : m === 'renderMinutes' ? ' (min)' : ''}</span>
            <input value={v[m] ?? ''} onChange={(e) => setV({ ...v, [m]: e.target.value })} placeholder={`plan : ${limitText(m, ws?.limits && !(m in (ws.overrides ?? {})) ? ws.limits[m] : null)}`} aria-label={METRIC[m].label} list="limit-hints" />
          </label>
        ))}
        <datalist id="limit-hints"><option value="illimité" /></datalist>
        <label className="field"><span><Icon name="film" size={14} /> Largeur des vidéos</span>
          <select value={flags.maxWidth ?? ''} onChange={(e) => setFlags({ ...flags, ...(e.target.value ? { maxWidth: +e.target.value } : { maxWidth: undefined }) })} aria-label="largeur des vidéos">
            <option value="">celle du plan</option>{[640, 960, 1280, 1920].map((w) => <option key={w} value={w}>{widthText(w)}</option>)}
          </select>
        </label>
        <label className="switch"><input type="checkbox" checked={!!flags.decorImages} onChange={(e) => setFlags({ ...flags, decorImages: e.target.checked })} /> Décors peints</label>
        <label className="switch"><input type="checkbox" checked={!!flags.priority} onChange={(e) => setFlags({ ...flags, priority: e.target.checked })} /> Rendus prioritaires</label>
      </div>
    </Dialog>
  );
}

function UserDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const ui = useUI();
  const [u, setU] = useState<AdminUserDetail | null>(null);
  const [limits, setLimits] = useState<AdminWorkspace | null>(null);
  const load = () => { if (id) Api.admin.user(id).then(setU).catch((e) => ui.toast((e as Error).message, 'error')); };
  useEffect(() => { setU(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const setPlan = async (w: AdminWorkspace, plan: PlanId) => {
    if (!(await ui.confirm({ title: `Passer « ${w.name} » au plan ${PLAN_LABEL[plan]} ?`, message: w.billing?.customer ? 'Cet espace a un abonnement Stripe : le prochain événement de Stripe pourra remettre son plan payé. Changez plutôt l’abonnement dans Stripe.' : 'Ses limites changent tout de suite ; ce qui existe déjà reste.', confirm: 'Changer de plan' }))) return;
    try { await Api.admin.updateWorkspace(w.id, { plan }); ui.toast(`« ${w.name} » est en ${PLAN_LABEL[plan]}`); load(); onChanged(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  return (
    <>
      <Dialog open={!!id} onClose={onClose} title={u ? u.name : 'Utilisateur'} description={u ? `${u.email} · inscrit ${ago(u.createdAt)} · ${u.publications} film(s) publié(s)` : ''} icon="user" size="lg" label="détail de l'utilisateur">
        {!u ? <Bounce /> : (
          <div className="admin-user">
            <div className="badges">{u.admin && <span className="badge accent"><Icon name="shield" size={12} /> administrateur</span>}{u.suspended && <span className="badge error"><Icon name="ban" size={12} /> suspendu {u.suspendedAt ? ago(u.suspendedAt) : ''}</span>}</div>
            {u.workspaces.map((w) => (
              <section key={w.id} className="card admin-ws">
                <div className="row">
                  <strong>{w.name}</strong> <span className="muted small">{w.role === 'owner' ? 'propriétaire' : w.role}</span>
                  <span className="spacer" />
                  <PlanBadge plan={w.plan} label={PLAN_LABEL[w.plan]} />
                  {w.billing?.status && <span className="badge">Stripe : {w.billing.status}</span>}
                </div>
                <div className="row wrap">
                  <label className="opt">Plan <select value={w.plan} onChange={(e) => void setPlan(w, e.target.value as PlanId)} aria-label={`plan de ${w.name}`}>{PLANS.map((p) => <option key={p} value={p}>{PLAN_LABEL[p]}</option>)}</select></label>
                  <button className="small" onClick={() => setLimits(w)}><Icon name="sliders" size={14} /> Limites sur mesure{w.overrides && Object.keys(w.overrides).length ? ` (${Object.keys(w.overrides).length})` : ''}</button>
                </div>
                {w.usage && w.limits && <div className="meters compact">{METRICS.map((m) => <UsageMeter key={m} metric={m} used={w.usage![m]} limit={w.limits![m]} compact />)}</div>}
              </section>
            ))}
            {u.workspaces.length === 0 && <p className="muted">Membre d'aucun espace.</p>}
          </div>
        )}
      </Dialog>
      <LimitsDialog ws={limits} onClose={() => setLimits(null)} onSaved={load} />
    </>
  );
}

function Users() {
  const ui = useUI(), { me } = useSession();
  const [q, setQ] = useState(''), [filter, setFilter] = useState('all');
  const [list, setList] = useState<{ total: number; items: AdminUser[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = (offset = 0) => Api.admin.users({ q, filter, offset }).then((r) => setList((l) => (offset && l ? { total: r.total, items: [...l.items, ...r.items] } : r))).catch((e) => ui.toast((e as Error).message, 'error'));
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [q, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (u: AdminUser, b: { suspended?: boolean; admin?: boolean }) => {
    const what = b.suspended === true ? { title: `Suspendre ${u.name} ?`, message: 'Ses sessions se ferment tout de suite et la connexion lui est refusée. Ses espaces, projets et films restent.', confirm: 'Suspendre', danger: true }
      : b.suspended === false ? { title: `Réactiver ${u.name} ?`, message: 'Le compte pourra de nouveau se connecter.', confirm: 'Réactiver' }
      : b.admin ? { title: `Nommer ${u.name} administrateur de la plateforme ?`, message: 'Il verra tous les comptes, changera les plans et modérera la communauté.', confirm: 'Nommer' }
      : { title: `Retirer à ${u.name} les droits d'administration ?`, message: 'Son compte reste ; il n’a plus accès à cette page.', confirm: 'Retirer', danger: true };
    if (!(await ui.confirm(what))) return;
    try { await Api.admin.updateUser(u.id, b); ui.toast('C’est fait'); void load(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  return (
    <>
      <div className="search-row">
        <label className="search"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou e-mail…" aria-label="chercher un utilisateur" /></label>
        <div className="segmented" role="group" aria-label="filtre">{[['all', 'Tous'], ['paying', 'Payants'], ['admins', 'Admins'], ['suspended', 'Suspendus']].map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k!)}>{l}</button>)}</div>
      </div>
      {!list ? <Bounce /> : list.items.length === 0 ? <div className="empty"><p>Personne ne correspond.</p></div> : (
        <table className="admin-table" aria-label="utilisateurs">
          <thead><tr><th>Utilisateur</th><th className="hide-phone">Espaces</th><th className="hide-tablet">Inscription</th><th className="hide-tablet">Dernière visite</th><th><span className="sr-only">actions</span></th></tr></thead>
          <tbody>{list.items.map((u) => (
            <tr key={u.id} className={u.suspended ? 'suspended' : ''}>
              <td><span className="who-line"><button className="link-like" onClick={() => setOpen(u.id)}><strong>{u.name}</strong></button>{u.admin && <Icon name="shield" size={13} title="administrateur" />}{u.suspended && <span className="badge error">suspendu</span>}</span><span className="muted small">{u.email}</span></td>
              <td className="hide-phone"><span className="ws-plans">{u.workspaces.map((w) => <span key={w.id} title={`${w.name} (${w.role})`}><PlanBadge plan={w.plan} label={PLAN_LABEL[w.plan]} /></span>)}</span></td>
              <td className="hide-tablet muted small">{ago(u.createdAt)}</td>
              <td className="hide-tablet muted small">{u.lastSeenAt ? ago(u.lastSeenAt) : 'jamais'}</td>
              <td className="actions">
                <Menu label={`actions sur ${u.name}`}>{(close) => <>
                  <button role="menuitem" onClick={() => { close(); setOpen(u.id); }}><Icon name="info" /> Détail, plans et limites</button>
                  {u.id !== me?.user?.id && <>
                    <button role="menuitem" onClick={() => { close(); void act(u, { admin: !u.admin }); }}><Icon name="shield" /> {u.admin ? 'Retirer les droits d’admin' : 'Nommer administrateur'}</button>
                    <button role="menuitem" className={u.suspended ? '' : 'danger-item'} onClick={() => { close(); void act(u, { suspended: !u.suspended }); }}><Icon name="ban" /> {u.suspended ? 'Réactiver' : 'Suspendre'}</button>
                  </>}
                </>}</Menu>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {list && list.items.length < list.total && <div className="centered"><button onClick={() => void load(list.items.length)}>Afficher plus ({list.total - list.items.length})</button></div>}
      <UserDialog id={open} onClose={() => setOpen(null)} onChanged={() => void load()} />
    </>
  );
}

function Reports({ onCount }: { onCount: (n: number) => void }) {
  const ui = useUI();
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [list, setList] = useState<Report[] | null>(null);
  const load = () => Api.admin.reports(status).then((r) => { setList(r); if (status === 'open') onCount(r.length); }).catch((e) => ui.toast((e as Error).message, 'error'));
  useEffect(() => { setList(null); void load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const settle = async (r: Report, action: 'dismiss' | 'hide' | 'remove') => {
    const ask = { dismiss: { title: 'Classer sans suite ?', message: `« ${r.publication.title} » reste dans la communauté.`, confirm: 'Classer' },
      hide: { title: `Masquer « ${r.publication.title} » ?`, message: 'Il sort de la communauté ; son auteur le voit encore et vous pourrez le remettre.', confirm: 'Masquer', danger: true },
      remove: { title: `Retirer « ${r.publication.title} » pour de bon ?`, message: 'La publication et ses médias sont supprimés. Le projet de son auteur, lui, reste.', confirm: 'Retirer', danger: true, typeToConfirm: r.publication.title } }[action];
    if (!(await ui.confirm(ask))) return;
    try { await Api.admin.settle(r.id, action); ui.toast({ dismiss: 'Classé sans suite', hide: 'Film masqué', remove: 'Film retiré' }[action]); void load(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  return (
    <>
      <div className="segmented" role="group" aria-label="signalements">{([['open', 'À traiter'], ['resolved', 'Traités']] as const).map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
      {!list ? <Bounce /> : list.length === 0 ? <div className="empty"><p>{status === 'open' ? 'Aucun signalement à traiter.' : 'Aucun signalement traité.'}</p></div> : (
        <ul className="report-list" aria-label="signalements">{list.map((r) => (
          <li key={r.id} className="card">
            <div className="row wrap">
              <Link to={`/c/${r.publication.id}`}><strong>{r.publication.title}</strong></Link>
              <span className="muted small">de {r.publication.author?.name ?? 'ancien membre'}</span>
              {r.publication.hidden && <span className="badge">masqué</span>}
              <span className="spacer" />
              <span className="badge error"><Icon name="flag" size={12} /> {REPORT_REASON[r.reason]}</span>
            </div>
            {r.message && <blockquote>{r.message}</blockquote>}
            <span className="muted small">Signalé par {r.reporter ?? 'un ancien membre'} {ago(r.createdAt)}{r.publication.openReports > 1 ? ` · ${r.publication.openReports} signalements sur ce film` : ''}{r.resolvedAt ? ` · ${{ dismissed: 'classé', hidden: 'masqué', removed: 'retiré' }[r.status] ?? r.status} par ${r.resolvedBy ?? '?'} ${ago(r.resolvedAt)}` : ''}</span>
            {status === 'open' && <div className="row wrap">
              <button className="small" onClick={() => void settle(r, 'dismiss')}><Icon name="check" size={14} /> Rien à redire</button>
              <button className="small" onClick={() => void settle(r, 'hide')}><Icon name="eye" size={14} /> Masquer</button>
              <button className="small danger-ghost" onClick={() => void settle(r, 'remove')}><Icon name="trash" size={14} /> Retirer</button>
            </div>}
            {status === 'resolved' && r.publication.hidden && <div className="row"><button className="small" onClick={() => void Api.admin.hidePublication(r.publication.id, false).then(() => { ui.toast('De retour dans la communauté'); void load(); })}>Remettre dans la communauté</button></div>}
          </li>
        ))}</ul>
      )}
    </>
  );
}

export function Admin() {
  const { me } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([k]) => k === params.get('tab'))?.[0]) ?? 'overview';
  const [o, setO] = useState<AdminOverview | null>(null);
  useEffect(() => { if (me?.user?.admin) Api.admin.overview().then(setO).catch(() => undefined); }, [me?.user?.admin, tab]);
  if (!me?.user?.admin) return <div className="page"><div className="empty"><h2>Réservé aux administrateurs</h2><p>Cette page est celle des administrateurs de la plateforme.</p></div></div>;
  return (
    <div className="page admin-page">
      <div className="page-head"><div><h2><Icon name="shield" size={22} className="inline-icon" /> Administration</h2><p className="muted">Les comptes, les plans et la modération de la plateforme.</p></div></div>
      <div className="page-tabs" role="tablist" aria-label="administration">
        {TABS.map(([k, l, icon]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'overview' ? {} : { tab: k })}><Icon name={icon} size={16} /> {l}{k === 'reports' && o?.openReports ? <span className="count">{o.openReports}</span> : null}</button>)}
      </div>
      {tab === 'overview' && (o ? <Overview o={o} /> : <Loading />)}
      {tab === 'users' && <Users />}
      {tab === 'reports' && <Reports onCount={(n) => setO((x) => (x ? { ...x, openReports: n } : x))} />}
    </div>
  );
}
