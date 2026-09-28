// What a plan is, for both apps (the creator app shows its own; the back office shows every workspace's): its limits,
// how each is said, a usage meter drawn like a clip on a track, the plan's badge.
import { Icon, type IconName } from './Icon';

export type PlanId = 'free' | 'premium' | 'pro';
export type Metric = 'projects' | 'members' | 'storageMb' | 'generations' | 'aiActions' | 'renderMinutes';
export interface Limits { projects: number | null; members: number | null; storageMb: number | null; generations: number | null; aiActions: number | null; renderMinutes: number | null; maxWidth: number; decorImages: boolean; priority: boolean }
export interface Plan { id: PlanId; label: string; price: number; tagline: string; limits: Limits }
export const PLAN_LABEL: Record<PlanId, string> = { free: 'Gratuit', premium: 'Premium', pro: 'Pro' };
export const PLAN_IDS: PlanId[] = ['free', 'premium', 'pro'];

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
