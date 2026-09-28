// Money: the subscriptions (paid through Stripe, granted here, ended), the monthly revenue by plan, the late payments;
// and the plans as this server has them (limits side by side, Stripe prices).
import { Icon, limitText, METRICS, METRIC, PLAN_LABEL, PlanBadge, widthText, type PlanId } from '@af/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Api, dateTime, type Subscription } from '../api';
import { PageHead } from '../App';
import { BillingBadge, Tiles } from '../parts';
import { Bounce } from '../ui-bits';

const SOURCE: Record<Subscription['source'], [string, string]> = { stripe: ['Stripe', 'ok'], granted: ['Offert', 'accent'], ended: ['Terminé', ''] };

export function Subscriptions() {
  const [data, setData] = useState<Awaited<ReturnType<typeof Api.subscriptions>> | null>(null), [error, setError] = useState('');
  const [source, setSource] = useState<'all' | Subscription['source']>('all');
  useEffect(() => { Api.subscriptions().then(setData).catch((e) => setError((e as Error).message)); }, []);
  if (error) return <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>;
  if (!data) return <Bounce />;
  const shown = data.items.filter((i) => source === 'all' || i.source === source), late = data.items.filter((i) => i.status === 'past_due');
  const total = data.revenue.reduce((a, r) => a + r.monthly, 0);
  return (
    <>
      <PageHead title="Abonnements" sub="Les espaces payants (Stripe), ceux dont le plan est offert, les abonnements terminés." icon="card" />
      {!data.payments && <div className="alert info"><Icon name="info" size={16} /><span>Stripe n'est pas configuré sur ce serveur : aucun abonnement payé, les plans sont offerts depuis les fiches des espaces.</span></div>}
      <Tiles items={[
        { label: 'Revenu mensuel', value: `${total} €`, sub: `${data.revenue.reduce((a, r) => a + r.count, 0)} abonnement(s) Stripe`, icon: 'sparkles' },
        ...data.revenue.map((r) => ({ label: PLAN_LABEL[r.plan], value: `${r.monthly} €`, sub: `${r.count} abonnement${r.count > 1 ? "s" : ""} Stripe`, icon: 'card' as const })),
        { label: 'En retard', value: late.length, warn: late.length > 0, sub: 'paiement à régulariser', icon: 'alert' },
      ]} />
      <div className="search-row">
        <div className="segmented" role="group" aria-label="origine">{([['all', 'Tous'], ['stripe', 'Stripe'], ['granted', 'Offerts'], ['ended', 'Terminés']] as const).map(([k, l]) => <button key={k} aria-pressed={source === k} onClick={() => setSource(k)}>{l}</button>)}</div>
      </div>
      {shown.length === 0 ? <div className="empty"><p>Rien ici.</p></div> : (
        <table className="admin-table" aria-label="abonnements">
          <thead><tr><th>Espace</th><th>Plan</th><th>Origine</th><th className="hide-phone">État</th><th className="hide-tablet">Renouvellement</th></tr></thead>
          <tbody>{shown.map((s) => (
            <tr key={s.id}>
              <td><Link to={`/workspaces/${s.id}`}><strong>{s.name}</strong></Link><span className="muted small" style={{ display: 'block' }}>{s.owner ? `${s.owner.name} · ${s.owner.email}` : ''}</span></td>
              <td><PlanBadge plan={s.plan} label={PLAN_LABEL[s.plan]} /></td>
              <td><span className={`badge ${SOURCE[s.source][1]}`}>{SOURCE[s.source][0]}</span></td>
              <td className="hide-phone"><BillingBadge status={s.status} /></td>
              <td className="hide-tablet muted small">{s.renewsAt ? dateTime(s.renewsAt) : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}

export function Plans() {
  const [data, setData] = useState<Awaited<ReturnType<typeof Api.plans>> | null>(null);
  useEffect(() => { void Api.plans().then(setData); }, []);
  if (!data) return <Bounce />;
  const cell = (id: PlanId, v: string | boolean) => <td key={id}>{typeof v === 'boolean' ? <Icon name={v ? 'check' : 'x'} size={15} title={v ? 'inclus' : 'non'} /> : v}</td>;
  return (
    <>
      <PageHead title="Plans" sub="Les plans tels que ce serveur les applique. Ils se changent dans le code (apps/api/src/plans.ts) ; un espace peut avoir des limites sur mesure." icon="sliders" />
      <div className="badges bo-badges">
        <span className={`badge ${data.enabled ? 'ok' : ''}`}>{data.enabled ? 'Plans appliqués' : 'Plans désactivés (PLANS=off)'}</span>
        <span className={`badge ${data.payments ? 'ok' : ''}`}>{data.payments ? 'Paiement Stripe actif' : 'Paiement non configuré'}</span>
      </div>
      <div className="bo-scroll">
        <table className="admin-table plans-table" aria-label="comparaison des plans">
          <thead><tr><th>Limite</th>{data.plans.map((p) => <th key={p.id}><PlanBadge plan={p.id} label={p.label} /> <span className="muted">{p.price} €/mois</span></th>)}</tr></thead>
          <tbody>
            {METRICS.map((m) => <tr key={m}><th scope="row"><Icon name={METRIC[m].icon} size={14} /> {METRIC[m].label}{METRIC[m].monthly ? ' / mois' : ''}</th>{data.plans.map((p) => cell(p.id, limitText(m, p.limits[m])))}</tr>)}
            <tr><th scope="row"><Icon name="film" size={14} /> Largeur des vidéos</th>{data.plans.map((p) => cell(p.id, widthText(p.limits.maxWidth)))}</tr>
            <tr><th scope="row"><Icon name="brush" size={14} /> Décors peints</th>{data.plans.map((p) => cell(p.id, p.limits.decorImages))}</tr>
            <tr><th scope="row"><Icon name="sparkles" size={14} /> Rendus prioritaires</th>{data.plans.map((p) => cell(p.id, p.limits.priority))}</tr>
            <tr><th scope="row"><Icon name="card" size={14} /> Prix Stripe</th>{data.plans.map((p) => cell(p.id, p.id === 'free' ? '—' : data.prices?.[p.id as Exclude<PlanId, 'free'>] ?? 'non configuré'))}</tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
