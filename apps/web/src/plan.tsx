// The workspace's plan, for every page: what it allows, what the month has used. A limit reached anywhere (a 402
// from the API) opens one dialog that says which, how much, and what a bigger plan gives.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Api, onQuota, type Limits, type Metric, type PlanId, type QuotaInfo, type WorkspacePlan } from './api';
import { Icon, type IconName } from './components/Icon';
import { Dialog } from './components/ui';
import { useSession } from './session';

export const METRIC: Record<Metric, { label: string; icon: IconName; unit: (n: number) => string; monthly?: boolean }> = {
  projects: { label: 'Projets', icon: 'folder', unit: (n) => `${n}` },
  members: { label: 'Membres', icon: 'users', unit: (n) => `${n}` },
  storageMb: { label: 'Stockage', icon: 'save', unit: (n) => (n >= 1000 ? `${Math.round(n / 100) / 10} Go` : `${Math.round(n)} Mo`) },
  generations: { label: 'Films générés', icon: 'sparkles', unit: (n) => `${n}`, monthly: true },
  aiActions: { label: 'Retouches IA', icon: 'wand', unit: (n) => `${n}`, monthly: true },
  renderMinutes: { label: 'Rendu vidéo', icon: 'film', unit: (n) => `${Math.round(n * 10) / 10} min`, monthly: true },
};
export const METRICS = Object.keys(METRIC) as Metric[];
export const limitText = (m: Metric, v: number | null) => (v == null ? 'illimité' : METRIC[m].unit(v));
export const widthText = (w: number) => (w >= 1920 ? 'Full HD (1080p)' : w >= 1280 ? 'HD (720p)' : `${w} px`);
/** the plan a limit first gets better at */
export const nextPlan = (plans: WorkspacePlan['plans'], current: PlanId, better: (l: Limits) => boolean) => plans.slice(plans.findIndex((p) => p.id === current) + 1).find((p) => better(p.limits)) ?? null;

interface PlanCtx { plan: WorkspacePlan | null; refresh: () => Promise<void> }
const Ctx = createContext<PlanCtx>({ plan: null, refresh: async () => undefined });
export const usePlan = () => useContext(Ctx);

export function PlanProvider({ children }: { children: ReactNode }) {
  const { me, workspace, epoch } = useSession(), nav = useNavigate(), at = useLocation().pathname;
  const [plan, setPlan] = useState<WorkspacePlan | null>(null);
  const [over, setOver] = useState<QuotaInfo | null>(null);
  const refresh = useCallback(async () => { if (!me?.user || !workspace) { setPlan(null); return; } try { setPlan(await Api.workspacePlan()); } catch { setPlan(null); } }, [me?.user, workspace]);
  useEffect(() => { void refresh(); }, [refresh, epoch, at]);
  useEffect(() => onQuota((q) => { setOver(q); void refresh(); }), [refresh]);
  const metric = over?.quota.metric as Metric | 'maxWidth' | 'decorImages' | 'workspaces' | undefined;
  const better = plan && metric ? nextPlan(plan.plans, plan.plan, (l) => (metric === 'decorImages' ? l.decorImages : metric === 'maxWidth' ? l.maxWidth > (over?.quota.limit ?? 0) : metric === 'workspaces' ? true : l[metric] == null || (l[metric] as number) > (over?.quota.limit ?? 0))) : null;
  return (
    <Ctx.Provider value={{ plan, refresh }}>
      {children}
      <Dialog open={!!over} onClose={() => setOver(null)} title="Limite du plan atteinte" icon="gauge" size="sm" label="limite du plan atteinte"
        footer={<>
          <button className="ghost" onClick={() => setOver(null)}>Plus tard</button>
          <button className="primary" onClick={() => { setOver(null); nav('/plans'); }}><Icon name="sparkles" size={16} /> Voir les plans</button>
        </>}>
        <p>{over?.error}</p>
        {plan && metric && metric in METRIC && over?.quota.limit != null && <UsageMeter metric={metric as Metric} used={over.quota.used} limit={over.quota.limit} />}
        {better && <div className="alert info"><Icon name="info" size={16} /><span>Le plan <strong>{better.label}</strong> ({better.price} € / mois) {metric === 'decorImages' ? 'inclut les décors peints' : metric === 'maxWidth' ? `rend jusqu'en ${widthText(better.limits.maxWidth)}` : metric && metric in METRIC ? `va jusqu'à ${limitText(metric as Metric, better.limits[metric as Metric])}${METRIC[metric as Metric].monthly ? ' par mois' : ''}` : 'lève cette limite'}.</span></div>}
      </Dialog>
    </Ctx.Provider>
  );
}

/** a meter drawn like a clip on a track: the used part filled, the rest empty, the limit as a keyframe */
export function UsageMeter({ metric, used, limit, compact = false }: { metric: Metric; used: number; limit: number | null; compact?: boolean }) {
  const m = METRIC[metric], ratio = limit == null ? 0 : limit === 0 ? 1 : Math.min(1, used / limit);
  const level = limit == null ? 'lv-free' : ratio >= 1 ? 'lv-full' : ratio >= 0.8 ? 'lv-high' : 'lv-ok';
  return (
    <div className={`meter ${level}${compact ? ' compact' : ''}`} role="meter" aria-label={m.label} aria-valuemin={0} aria-valuemax={limit ?? undefined} aria-valuenow={used} aria-valuetext={`${m.unit(used)} sur ${limitText(metric, limit)}`}>
      <span className="m-head"><Icon name={m.icon} size={14} /> <span className="m-label">{m.label}{m.monthly && !compact ? <span className="muted"> · ce mois</span> : null}</span><span className="m-val">{m.unit(used)} <span className="muted">/ {limitText(metric, limit)}</span></span></span>
      <span className="m-bar"><i style={{ width: `${limit == null ? 4 : ratio * 100}%` }} /></span>
    </div>
  );
}

export function PlanBadge({ plan, label }: { plan: PlanId; label: string }) {
  return <span className={`plan-badge ${plan}`}>{plan === 'pro' || plan === 'premium' ? <Icon name="sparkles" size={11} /> : null}{label}</span>;
}
