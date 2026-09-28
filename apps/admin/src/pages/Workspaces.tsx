// The workspaces: found by name or owner, filtered by plan and billing; one workspace's page (plan and custom limits,
// the month's usage, its members, its billing with Stripe's references, what it used lately).
import { Icon, METRIC, METRICS, PLAN_IDS, PLAN_LABEL, PlanBadge, UsageMeter, useUI } from '@af/ui';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ago, Api, BILLING_STATUS, dateTime, ROLE, type Page, type WorkspaceDetail, type WorkspaceRow } from '../api';
import { PageHead } from '../App';
import { BillingBadge, LimitsDialog, More, PlanSelect } from '../parts';
import { Bounce } from '../ui-bits';

const BILLING = [['any', 'Tous'], ['subscribed', 'Abonnés'], ['past_due', 'En retard'], ['custom', 'Sur mesure']] as const;

export function Workspaces() {
  const ui = useUI();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '', plan = params.get('plan') ?? '', billing = params.get('billing') ?? 'any';
  const [list, setList] = useState<Page<WorkspaceRow> | null>(null);
  const load = (offset = 0) => Api.workspaces({ q, plan, billing, offset }).then((r) => setList((l) => (offset && l ? { total: r.total, items: [...l.items, ...r.items] } : r))).catch((e) => ui.toast((e as Error).message, 'error'));
  useEffect(() => { const t = setTimeout(() => void load(), 200); return () => clearTimeout(t); }, [q, plan, billing]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v && v !== 'any') p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  return (
    <>
      <PageHead title="Espaces" sub={list ? `${list.total} espace${list.total > 1 ? 's' : ''} de travail` : 'Les espaces de travail'} icon="folder" />
      <div className="search-row">
        <label className="search"><Icon name="search" size={16} /><input value={q} onChange={(e) => set('q', e.target.value)} placeholder="Nom de l'espace, propriétaire…" aria-label="chercher un espace" /></label>
        <select value={plan} onChange={(e) => set('plan', e.target.value)} aria-label="plan"><option value="">Tous les plans</option>{PLAN_IDS.map((p) => <option key={p} value={p}>{PLAN_LABEL[p]}</option>)}</select>
        <div className="segmented" role="group" aria-label="facturation">{BILLING.map(([k, l]) => <button key={k} aria-pressed={billing === k} onClick={() => set('billing', k)}>{l}</button>)}</div>
      </div>
      {!list ? <Bounce /> : list.items.length === 0 ? <div className="empty"><p>Aucun espace ne correspond.</p></div> : (
        <table className="admin-table" aria-label="espaces">
          <thead><tr><th>Espace</th><th>Plan</th><th className="hide-phone">Membres</th><th className="hide-phone">Projets</th><th className="hide-tablet">Créé</th></tr></thead>
          <tbody>{list.items.map((w) => (
            <tr key={w.id}>
              <td><span className="who-line"><Link to={`/workspaces/${w.id}`}><strong>{w.name}</strong></Link>{w.custom && <span className="badge accent">sur mesure</span>}</span><span className="muted small">{w.owner ? `${w.owner.name} · ${w.owner.email}` : 'sans propriétaire'}</span></td>
              <td><span className="ws-plans"><PlanBadge plan={w.plan} label={PLAN_LABEL[w.plan]} /><BillingBadge status={w.billingStatus} /></span></td>
              <td className="hide-phone">{w.members}</td>
              <td className="hide-phone">{w.projects}</td>
              <td className="hide-tablet muted small">{ago(w.createdAt)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {list && <More shown={list.items.length} total={list.total} onMore={() => void load(list.items.length)} />}
    </>
  );
}

export function WorkspacePage() {
  const { id = '' } = useParams();
  const [w, setW] = useState<WorkspaceDetail | null>(null), [error, setError] = useState(''), [limits, setLimits] = useState(false);
  const load = () => Api.workspace(id).then(setW).catch((e) => setError((e as Error).message));
  useEffect(() => { setW(null); void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>;
  if (!w) return <Bounce />;
  const owner = w.members.find((m) => m.role === 'owner');
  return (
    <>
      <p className="bo-crumbs"><Link to="/workspaces"><Icon name="back" size={14} /> Espaces</Link></p>
      <PageHead title={w.name} sub={`Créé ${ago(w.createdAt)}${owner ? ` · propriétaire : ${owner.name}` : ''} · ${w.projects} projet(s) · ${w.publications} film(s) publié(s)`} icon="folder">
        <PlanSelect id={w.id} name={w.name} plan={w.plan} billing={w.billing} onChanged={() => void load()} />
        <button onClick={() => setLimits(true)}><Icon name="sliders" size={16} /> Limites sur mesure{Object.keys(w.overrides).length ? ` (${Object.keys(w.overrides).length})` : ''}</button>
      </PageHead>
      <section className="card" aria-label="utilisation">
        <div className="row"><h3>Utilisation</h3><span className="spacer" /><PlanBadge plan={w.plan} label={PLAN_LABEL[w.plan]} /></div>
        <div className="meters">{METRICS.map((m) => <UsageMeter key={m} metric={m} used={w.usage[m]} limit={w.limits[m]} />)}</div>
      </section>
      <div className="bo-grid2">
        <section className="card" aria-label="facturation">
          <h3>Facturation</h3>
          <dl className="details">
            <dt>État</dt><dd>{w.billing.status ? <BillingBadge status={w.billing.status} /> : w.plan === 'free' ? 'plan gratuit' : 'plan offert (sans abonnement)'}</dd>
            {w.billing.renewsAt && <><dt>Renouvellement</dt><dd>{dateTime(w.billing.renewsAt)}</dd></>}
            <dt>Client Stripe</dt><dd>{w.billing.customerId ? <a href={`https://dashboard.stripe.com/customers/${w.billing.customerId}`} target="_blank" rel="noopener noreferrer"><code>{w.billing.customerId}</code></a> : '—'}</dd>
            <dt>Abonnement</dt><dd>{w.billing.subscriptionId ? <a href={`https://dashboard.stripe.com/subscriptions/${w.billing.subscriptionId}`} target="_blank" rel="noopener noreferrer"><code>{w.billing.subscriptionId}</code></a> : '—'}</dd>
          </dl>
          {w.billing.status && <p className="muted small">État tenu par Stripe : {BILLING_STATUS[w.billing.status] ?? w.billing.status}. Un changement fait ici peut être remplacé par le prochain événement de Stripe.</p>}
        </section>
        <section className="card" aria-label="activité récente">
          <h3>Activité récente</h3>
          {w.recentUsage.length === 0 ? <p className="muted small">Rien de consommé pour l'instant.</p> : (
            <ul className="bo-feed">{w.recentUsage.map((e, i) => <li key={i}><Icon name={METRIC[e.kind]?.icon ?? 'info'} size={14} /> <span>{METRIC[e.kind]?.label ?? e.kind} · {METRIC[e.kind]?.unit(e.amount) ?? e.amount}{e.by ? ` · ${e.by}` : ''}</span><span className="muted small">{ago(e.at)}</span></li>)}</ul>
          )}
        </section>
      </div>
      <div className="section-title"><h2>Membres</h2><span className="badge">{w.members.length}</span></div>
      <table className="admin-table" aria-label="membres">
        <thead><tr><th>Membre</th><th>Rôle</th><th className="hide-phone">Depuis</th></tr></thead>
        <tbody>{w.members.map((m) => <tr key={m.userId}><td><Link to={`/users/${m.userId}`}><strong>{m.name}</strong></Link><span className="muted small" style={{ display: 'block' }}>{m.email}</span></td><td>{ROLE[m.role] ?? m.role}</td><td className="hide-phone muted small">{ago(m.joinedAt)}</td></tr>)}</tbody>
      </table>
      <LimitsDialog ws={limits ? w : null} onClose={() => setLimits(false)} onSaved={() => void load()} />
    </>
  );
}
