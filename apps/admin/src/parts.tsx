// What several back-office pages use: a workspace's plan (picked, with a confirmation) and custom limits, stat tiles,
// the sign-ups chart, the plans as clips on one track, "show more".
import { Dialog, Icon, limitText, METRIC, METRICS, PLAN_IDS, PLAN_LABEL, useUI, widthText, type Limits, type PlanId } from '@af/ui';
import { useEffect, useState } from 'react';
import { Api, BILLING_STATUS, type Billing } from './api';

/** a workspace's plan, changed after a confirmation (and a word of warning when Stripe bills it) */
export function PlanSelect({ id, name, plan, billing, onChanged }: { id: string; name: string; plan: PlanId; billing?: Billing; onChanged: () => void }) {
  const ui = useUI();
  const change = async (to: PlanId) => {
    if (to === plan) return;
    const ok = await ui.confirm({ title: `Passer « ${name} » au plan ${PLAN_LABEL[to]} ?`, confirm: 'Changer de plan',
      message: billing?.customer ? 'Cet espace a un abonnement Stripe : le prochain événement de Stripe pourra remettre le plan payé. Changez plutôt l’abonnement dans Stripe.' : 'Ses limites changent tout de suite ; ce qui existe déjà reste. L’action est inscrite au journal.' });
    if (!ok) return;
    try { await Api.updateWorkspace(id, { plan: to }); ui.toast(`« ${name} » est en ${PLAN_LABEL[to]}`); onChanged(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  return <label className="opt">Plan <select value={plan} onChange={(e) => void change(e.target.value as PlanId)} aria-label={`plan de ${name}`}>{PLAN_IDS.map((p) => <option key={p} value={p}>{PLAN_LABEL[p]}</option>)}</select></label>;
}

/** a workspace's limits of its own: blank = the plan's, « illimité » = none */
export function LimitsDialog({ ws, onClose, onSaved }: { ws: { id: string; name: string; plan: PlanId; limits: Limits; overrides: Partial<Limits> } | null; onClose: () => void; onSaved: () => void }) {
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
    for (const [k, x] of Object.entries(flags)) if (x !== undefined) (quotas as Record<string, unknown>)[k] = x;
    try { await Api.updateWorkspace(ws!.id, { quotas }); ui.toast('Limites enregistrées'); onSaved(); onClose(); } catch (e) { ui.toast((e as Error).message, 'error'); }
  };
  return (
    <Dialog open={!!ws} onClose={onClose} title="Limites sur mesure" description={ws ? `Pour « ${ws.name} », au-dessus du plan ${PLAN_LABEL[ws.plan]}. Laissez vide pour garder celle du plan.` : ''} icon="sliders" size="md"
      footer={<><button className="ghost" onClick={() => { setV(Object.fromEntries(METRICS.map((m) => [m, '']))); setFlags({}); }}>Tout remettre au plan</button><span className="spacer" /><button className="ghost" onClick={onClose}>Annuler</button><button className="primary" onClick={() => void save()}>Enregistrer</button></>}>
      <div className="limits-form">
        {METRICS.map((m) => (
          <label key={m} className="field"><span><Icon name={METRIC[m].icon} size={14} /> {METRIC[m].label}{METRIC[m].monthly ? ' / mois' : ''}{m === 'storageMb' ? ' (Mo)' : m === 'renderMinutes' ? ' (min)' : ''}</span>
            <input value={v[m] ?? ''} onChange={(e) => setV({ ...v, [m]: e.target.value })} placeholder={`plan : ${ws ? limitText(m, m in (ws.overrides ?? {}) ? null : ws.limits[m]) : ''}`} aria-label={METRIC[m].label} list="limit-hints" />
          </label>
        ))}
        <datalist id="limit-hints"><option value="illimité" /></datalist>
        <label className="field"><span><Icon name="film" size={14} /> Largeur des vidéos</span>
          <select value={flags.maxWidth ?? ''} onChange={(e) => setFlags({ ...flags, maxWidth: e.target.value ? +e.target.value : undefined })} aria-label="largeur des vidéos">
            <option value="">celle du plan</option>{[640, 960, 1280, 1920].map((w) => <option key={w} value={w}>{widthText(w)}</option>)}
          </select>
        </label>
        <label className="switch"><input type="checkbox" checked={!!flags.decorImages} onChange={(e) => setFlags({ ...flags, decorImages: e.target.checked })} /> Décors peints</label>
        <label className="switch"><input type="checkbox" checked={!!flags.priority} onChange={(e) => setFlags({ ...flags, priority: e.target.checked })} /> Rendus prioritaires</label>
      </div>
    </Dialog>
  );
}

export function Tiles({ items, small = false }: { items: { label: string; value: string | number; sub?: string; warn?: boolean; icon?: Parameters<typeof Icon>[0]['name'] }[]; small?: boolean }) {
  return <ul className={`stat-tiles${small ? ' small' : ''}`}>{items.map((t) => <li key={t.label} className={t.warn ? 'warn' : ''}><span className="muted small">{t.icon && <Icon name={t.icon} size={13} />} {t.label}</span><strong>{t.value}</strong>{t.sub && <span className="muted small">{t.sub}</span>}</li>)}</ul>;
}

/** sign-ups day by day, as bars on a timeline ruler (keyframes where there were some) */
export function SignupsChart({ days }: { days: { day: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count)), total = days.reduce((a, d) => a + d.count, 0);
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return (
    <figure className="bo-chart" aria-label={`${total} inscription(s) sur 30 jours`}>
      <div className="bars" role="list">
        {days.map((d) => <span key={d.day} role="listitem" className={d.count ? 'on' : ''} style={{ height: `${Math.max(3, (d.count / max) * 100)}%` }} title={`${fmt(d.day)} : ${d.count}`} aria-label={`${fmt(d.day)} : ${d.count}`} />)}
      </div>
      <figcaption className="muted small"><span>{fmt(days[0]!.day)}</span><span>{total} inscription{total > 1 ? 's' : ''} en 30 jours · au plus {max} par jour</span><span>{fmt(days.at(-1)!.day)}</span></figcaption>
    </figure>
  );
}

/** the plans as clips on one track, each as long as its share */
export function PlanTrack({ byPlan }: { byPlan: Record<PlanId, number> }) {
  const total = Math.max(1, PLAN_IDS.reduce((a, p) => a + byPlan[p], 0));
  return (
    <div className="plan-track" role="img" aria-label={PLAN_IDS.map((p) => `${PLAN_LABEL[p]} : ${byPlan[p]}`).join(', ')}>
      {PLAN_IDS.filter((p) => byPlan[p]).map((p) => <span key={p} className={`clip ${p}`} style={{ flexGrow: byPlan[p] / total }}><b>{PLAN_LABEL[p]}</b> {byPlan[p]}</span>)}
    </div>
  );
}

export function BillingBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return <span className={`badge ${status === 'active' || status === 'trialing' ? 'ok' : status === 'past_due' || status === 'unpaid' ? 'error' : ''}`}>{BILLING_STATUS[status] ?? status}</span>;
}

export function More({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  return shown < total ? <div className="centered bo-more"><button onClick={onMore}>Afficher plus ({total - shown})</button></div> : null;
}
