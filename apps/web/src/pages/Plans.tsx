// Subscription: the workspace's plan and what the month has used, the four plans side by side, and paying (Stripe
// Checkout, then its customer portal to change plan, update the card or cancel). Only the owner pays; the others see.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Api, type Plan } from '../api';
import { Icon } from '@af/ui';
import { Loading } from '../components/Motion';
import { useUI } from '@af/ui';
import { limitText, METRICS, PlanBadge, UsageMeter, usePlan, widthText } from '../plan';
import { useSession } from '../session';

const STATUS: Record<string, string> = { active: 'actif', trialing: "période d'essai", past_due: 'paiement en retard', canceled: 'résilié', unpaid: 'impayé', incomplete: 'paiement à finaliser' };

function Features({ p }: { p: Plan }) {
  const l = p.limits;
  return (
    <ul className="features">
      <li><Icon name="folder" size={15} /> {l.projects == null ? 'Projets illimités' : `${l.projects} projets`}</li>
      <li><Icon name="sparkles" size={15} /> {limitText('generations', l.generations)} film{l.generations === 1 ? '' : 's'} généré{l.generations === 1 ? '' : 's'} / mois</li>
      <li><Icon name="wand" size={15} /> {l.aiActions == null ? 'Retouches IA illimitées' : `${l.aiActions} retouches IA / mois`}</li>
      <li><Icon name="film" size={15} /> {limitText('renderMinutes', l.renderMinutes)} de rendu / mois, {widthText(l.maxWidth)}</li>
      <li><Icon name="users" size={15} /> {l.members == null ? 'Membres illimités' : `${l.members} membre${l.members > 1 ? 's' : ''}`}</li>
      <li><Icon name="save" size={15} /> {limitText('storageMb', l.storageMb)} de stockage</li>
      <li className={l.decorImages ? '' : 'off'}><Icon name={l.decorImages ? 'check' : 'x'} size={15} /> Décors peints par un modèle d'images</li>
      <li className={l.priority ? '' : 'off'}><Icon name={l.priority ? 'check' : 'x'} size={15} /> Rendus prioritaires</li>
    </ul>
  );
}

export function Plans() {
  const { plan, refresh } = usePlan(), { workspace } = useSession(), ui = useUI();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState('');
  const paid = params.get('paiement');
  // back from Stripe: the webhook grants the plan within seconds; look again a few times
  useEffect(() => {
    if (paid !== 'ok') return;
    let n = 0; const t = setInterval(() => { n++; void refresh(); if (n >= 5) clearInterval(t); }, 2000);
    return () => clearInterval(t);
  }, [paid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!plan) return <Loading />;
  const subscribed = plan.billing.customer && ['active', 'trialing', 'past_due'].includes(plan.billing.status ?? '');
  const go = async (what: 'portal' | Plan['id']) => {
    setBusy(what);
    try { const { url } = what === 'portal' ? await Api.billingPortal() : await Api.checkout(what as Exclude<Plan['id'], 'free'>); window.location.assign(url); }
    catch (e) { ui.toast((e as Error).message, 'error'); setBusy(''); }
  };
  const current = plan.plans.find((p) => p.id === plan.plan)!;
  return (
    <div className="page plans-page">
      <div className="page-head">
        <div><h2>Abonnement</h2><p className="muted">Le plan de l'espace « {workspace?.name} » : ce qu'il permet, ce que le mois a utilisé.</p></div>
      </div>
      {paid === 'ok' && <div className="alert success" role="status"><Icon name="check" size={16} /><span>Merci ! Le paiement est validé : votre plan change dès que Stripe le confirme, en quelques secondes.</span><button className="ghost small" onClick={() => setParams({})}>Fermer</button></div>}
      {paid === 'annule' && <div className="alert info" role="status"><Icon name="info" size={16} /><span>Paiement annulé : rien n'a changé.</span><button className="ghost small" onClick={() => setParams({})}>Fermer</button></div>}
      {!plan.enabled && <div className="alert info"><Icon name="info" size={16} /><span>Ce serveur n'applique aucun plan : tout y est illimité.</span></div>}
      {plan.billing.status === 'past_due' && <div className="alert error" role="alert"><Icon name="alert" size={16} /><span>Le dernier paiement n'est pas passé : mettez à jour votre carte, sinon l'espace repassera au plan Gratuit.</span>{plan.canManage && plan.billing.payments && <button className="small" onClick={() => void go('portal')}>Mettre à jour</button>}</div>}

      {plan.enabled && (
        <section className="card current-plan" aria-label="plan actuel">
          <div className="cp-head">
            <div>
              <span className="muted small">Plan actuel</span>
              <h3><PlanBadge plan={plan.plan} label={plan.label} /> {current.price ? <span className="price">{current.price} €<span className="muted"> / mois</span></span> : <span className="price">0 €</span>}</h3>
              <span className="muted small">
                {plan.billing.status ? `Abonnement ${STATUS[plan.billing.status] ?? plan.billing.status}` : current.price ? 'Offert par la plateforme' : current.tagline}
                {plan.billing.renewsAt && ['active', 'trialing'].includes(plan.billing.status ?? '') ? ` · renouvelé le ${new Date(plan.billing.renewsAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` : ''}
                {Object.keys(plan.overrides).length ? ' · limites sur mesure' : ''}
              </span>
            </div>
            <span className="spacer" />
            {plan.canManage && plan.billing.payments && plan.billing.customer && <button onClick={() => void go('portal')} disabled={!!busy}><Icon name="card" size={16} /> {busy === 'portal' ? 'Ouverture…' : 'Gérer l’abonnement'}</button>}
          </div>
          <div className="meters">{METRICS.map((m) => <UsageMeter key={m} metric={m} used={plan.usage[m]} limit={plan.limits[m]} />)}</div>
          <p className="muted small">Les compteurs du mois repartent de zéro le 1ᵉʳ. Une génération ou un rendu qui échoue, ou que vous annulez, ne compte pas.</p>
        </section>
      )}

      <div className="section-title"><h2>Les plans</h2></div>
      {!plan.billing.payments && plan.enabled && <p className="muted small">Le paiement en ligne n'est pas activé sur ce serveur : l'administrateur de la plateforme change les plans des espaces.</p>}
      <ul className="plan-grid" aria-label="plans">
        {plan.plans.map((p, i) => {
          const isCurrent = p.id === plan.plan;
          let action;
          if (isCurrent) action = <button disabled>Plan actuel</button>;
          else if (!plan.canManage) action = <button disabled title="seul le propriétaire de l'espace change de plan">Réservé au propriétaire</button>;
          else if (!plan.billing.payments) action = <button disabled>Sur demande</button>;
          else if (subscribed) action = <button onClick={() => void go('portal')} disabled={!!busy}>{p.id === 'free' ? 'Résilier' : 'Changer'} dans l'espace client</button>;
          else if (p.id === 'free') action = null;
          else action = <button className={p.id === 'premium' ? 'cta' : 'primary'} onClick={() => void go(p.id)} disabled={!!busy}><Icon name="sparkles" size={16} /> {busy === p.id ? 'Redirection…' : `Choisir ${p.label}`}</button>;
          return (
            <li key={p.id} className={`plan-card ${p.id}${isCurrent ? ' current' : ''}`}>
              <span className="tier" aria-hidden>{Array.from({ length: 3 }, (_, k) => <i key={k} className={k <= i ? 'on' : ''} />)}</span>
              {p.id === 'premium' && <span className="ribbon">Le plus choisi</span>}
              <h3>{p.label}</h3>
              <p className="price">{p.price} €<span className="muted"> / mois</span></p>
              <p className="muted small">{p.tagline}</p>
              <Features p={p} />
              {action}
            </li>
          );
        })}
      </ul>
      <p className="muted small centered"><Icon name="lock" size={13} /> Paiement sécurisé par Stripe : la carte ne passe jamais par nos serveurs. Résiliable à tout moment ; ce qui a été créé reste.</p>
    </div>
  );
}
