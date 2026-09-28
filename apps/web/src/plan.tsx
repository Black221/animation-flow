// The workspace's plan, for every page: what it allows, what the month has used. A limit reached anywhere (a 402
// from the API) opens one dialog that says which, how much, and what a bigger plan gives.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Dialog, Icon, limitText, METRIC, UsageMeter, widthText, type Limits, type Metric, type PlanId } from '@af/ui';
import { Api, onQuota, type QuotaInfo, type WorkspacePlan } from './api';
import { useSession } from './session';

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

export { limitText, METRIC, METRICS, PlanBadge, UsageMeter, widthText } from '@af/ui';
