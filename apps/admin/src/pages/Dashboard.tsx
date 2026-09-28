// The dashboard: the platform at a glance (accounts, money, the month's use), what needs doing, sign-ups over 30 days.
import { Bounce } from '../ui-bits';
import { Icon, METRIC, type Metric } from '@af/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Api, type Overview } from '../api';
import { PageHead } from '../App';
import { PlanTrack, SignupsChart, Tiles } from '../parts';

export function Dashboard() {
  const [o, setO] = useState<Overview | null>(null), [error, setError] = useState('');
  useEffect(() => { Api.overview().then(setO).catch((e) => setError((e as Error).message)); }, []);
  if (error) return <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>;
  if (!o) return <Bounce />;
  const todo = [
    o.openReports ? { to: '/moderation', icon: 'flag' as const, text: `${o.openReports} signalement${o.openReports > 1 ? 's' : ''} à traiter` } : null,
    o.pastDue ? { to: '/subscriptions', icon: 'card' as const, text: `${o.pastDue} abonnement${o.pastDue > 1 ? 's' : ''} en retard de paiement` } : null,
    o.suspended ? { to: '/users?filter=suspended', icon: 'ban' as const, text: `${o.suspended} compte${o.suspended > 1 ? 's' : ''} suspendu${o.suspended > 1 ? 's' : ''}` } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <>
      <PageHead title="Tableau de bord" sub="La plateforme d'un coup d'œil : les comptes, les revenus, ce que le mois a consommé." icon="gauge" />
      {!o.plansEnabled && <div className="alert info"><Icon name="info" size={16} /><span>Les plans sont désactivés sur ce serveur (PLANS=off) : rien n'est limité.</span></div>}
      {!o.payments && o.plansEnabled && <div className="alert info"><Icon name="info" size={16} /><span>Paiement en ligne non configuré (STRIPE_*) : les plans se changent ici, à la main.</span></div>}
      <Tiles items={[
        { label: 'Utilisateurs', value: o.users, sub: `${o.newUsers} ce mois`, icon: 'user' },
        { label: 'Actifs (30 j)', value: o.activeUsers, sub: `${Math.round((o.activeUsers / Math.max(1, o.users)) * 100)} % des comptes`, icon: 'eye' },
        { label: 'Espaces payants', value: o.paying, sub: `sur ${o.workspaces} espaces`, icon: 'card' },
        { label: 'Revenu mensuel', value: `${o.monthlyRevenue} €`, sub: 'abonnements Stripe en cours', icon: 'sparkles' },
        { label: 'Paiements en retard', value: o.pastDue, warn: o.pastDue > 0, icon: 'alert' },
        { label: 'Signalements', value: o.openReports, sub: 'à traiter', warn: o.openReports > 0, icon: 'flag' },
      ]} />
      {todo.length > 0 && (
        <section className="card bo-todo" aria-label="à faire">
          <h3>À faire</h3>
          <ul>{todo.map((t) => <li key={t.to}><Link to={t.to}><Icon name={t.icon} size={15} /> {t.text} <Icon name="chevron" size={14} /></Link></li>)}</ul>
        </section>
      )}
      <div className="bo-grid2">
        <section className="card" aria-label="inscriptions">
          <h3>Inscriptions, 30 derniers jours</h3>
          <SignupsChart days={o.signups} />
        </section>
        <section className="card" aria-label="espaces par plan">
          <h3>Espaces par plan</h3>
          <PlanTrack byPlan={o.byPlan} />
          <p className="muted small"><Link to="/workspaces">Voir les espaces</Link> · <Link to="/subscriptions">les abonnements</Link></p>
        </section>
      </div>
      <div className="section-title"><h2>Ce mois, sur toute la plateforme</h2></div>
      <Tiles small items={[
        ...(['generations', 'aiActions', 'renderMinutes'] as Metric[]).map((m) => ({ label: METRIC[m].label, value: METRIC[m].unit(o.usage[m] ?? 0), icon: METRIC[m].icon })),
        { label: 'Rendus lancés', value: o.renders, sub: `${o.queued} en cours ou en file`, icon: 'film' },
        { label: 'Projets', value: o.projects, icon: 'folder' },
        { label: 'Films publiés', value: o.publications, sub: o.hidden ? `${o.hidden} masqué${o.hidden > 1 ? 's' : ''}` : undefined, icon: 'globe' },
      ]} />
    </>
  );
}
