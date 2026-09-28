// Plans and quotas. A workspace has a plan (free, premium, pro); the platform admin may override any of its
// limits for one workspace. What the month allows (films generated, AI touch-ups, minutes of video rendered) is
// counted as usage events, given back when the job fails or is canceled; the rest (projects, members, storage) is
// measured from what exists. With plans off (PLANS=off: a self-hosted server), nothing is limited.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Queryable } from './db';

export type PlanId = 'free' | 'premium' | 'pro';
export const PLAN_IDS: PlanId[] = ['free', 'premium', 'pro'];
/** what can be counted: null means no limit */
export interface Limits {
  projects: number | null; members: number | null; storageMb: number | null;
  generations: number | null; aiActions: number | null; renderMinutes: number | null;
  /** widest video, in pixels */
  maxWidth: number;
  /** decors painted by an image model */
  decorImages: boolean;
  /** renders jump the queue */
  priority: boolean;
}
export type Metric = 'projects' | 'members' | 'storageMb' | 'generations' | 'aiActions' | 'renderMinutes';
export const METRICS: Metric[] = ['projects', 'members', 'storageMb', 'generations', 'aiActions', 'renderMinutes'];
export interface Plan { id: PlanId; label: string; price: number; tagline: string; limits: Limits }

export const PLANS: Record<PlanId, Plan> = {
  free: { id: 'free', label: 'Gratuit', price: 0, tagline: 'Pour découvrir : quelques films, en 720p.',
    limits: { projects: 3, members: 2, storageMb: 500, generations: 5, aiActions: 30, renderMinutes: 10, maxWidth: 1280, decorImages: false, priority: false } },
  premium: { id: 'premium', label: 'Premium', price: 15, tagline: 'Pour créer régulièrement : Full HD, décors peints, petite équipe.',
    limits: { projects: 30, members: 5, storageMb: 10_000, generations: 50, aiActions: 500, renderMinutes: 120, maxWidth: 1920, decorImages: true, priority: false } },
  pro: { id: 'pro', label: 'Pro', price: 39, tagline: 'Pour les studios : projets illimités, rendus prioritaires.',
    limits: { projects: null, members: 50, storageMb: 100_000, generations: 400, aiActions: null, renderMinutes: 600, maxWidth: 1920, decorImages: true, priority: true } },
};
const UNLIMITED: Limits = { projects: null, members: null, storageMb: null, generations: null, aiActions: null, renderMinutes: null, maxWidth: 1920, decorImages: true, priority: false };
/** a person may own this many workspaces on the free plan (their own, and one to try a team) */
export const FREE_WORKSPACES_PER_OWNER = 2;

const NOUN: Record<Metric, (n: number) => string> = {
  projects: (n) => `${n} projet${n > 1 ? 's' : ''}`,
  members: (n) => `${n} membre${n > 1 ? 's' : ''} (invitations en attente comprises)`,
  storageMb: (n) => (n >= 1000 ? `${n / 1000} Go` : `${n} Mo`) + ' de stockage',
  generations: (n) => `${n} film${n > 1 ? 's' : ''} généré${n > 1 ? 's' : ''} par l'IA par mois`,
  aiActions: (n) => `${n} retouche${n > 1 ? 's' : ''} IA par mois`,
  renderMinutes: (n) => `${n} min de rendu vidéo par mois`,
};

/** a limit reached: 402, with what is needed to explain it and offer a bigger plan */
export class QuotaError extends Error {
  statusCode = 402;
  constructor(public metric: Metric | 'maxWidth' | 'decorImages' | 'workspaces', public plan: PlanId, public limit: number | null, public used: number, message?: string) {
    super(message ?? (metric in NOUN ? `Le plan ${PLANS[plan].label} comprend ${NOUN[metric as Metric](limit ?? 0)} : c'est atteint. Passez à un plan supérieur, ou libérez de la place.` : 'limite du plan atteinte'));
  }
  get body() { return { error: this.message, quota: { metric: this.metric, plan: this.plan, limit: this.limit, used: this.used } }; }
}

export interface WorkspacePlan { plan: PlanId; limits: Limits; overrides: Partial<Limits>; billing: { status: string | null; renewsAt: Date | null; customer: boolean } }
export type Usage = Record<Metric, number>;

/** the sizes of the files under a folder (voices and pictures of a workspace), in bytes */
function sizeOf(dir: string): number {
  let n = 0;
  let entries: import('node:fs').Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) { const f = join(dir, e.name); n += e.isDirectory() ? sizeOf(f) : (() => { try { return statSync(f).size; } catch { return 0; } })(); }
  return n;
}

export interface Quotas {
  enabled: boolean;
  of(ws: string): Promise<WorkspacePlan>;
  usage(ws: string): Promise<Usage>;
  /** throws QuotaError when `amount` more of `metric` would go past the plan */
  ensure(ws: string, metric: Metric, amount?: number): Promise<void>;
  /** throws QuotaError when the plan lacks a feature, or the width is past it */
  feature(ws: string, f: 'decorImages'): Promise<void>;
  width(ws: string, width: number): Promise<void>;
  has(ws: string, f: 'decorImages' | 'priority'): Promise<boolean>;
  /** counts usage (renders in minutes); `ref` lets a failed job give it back */
  record(ws: string, kind: 'generations' | 'aiActions' | 'renderMinutes', amount: number, ref?: string | null, userId?: string | null): Promise<void>;
  refund(ref: string): Promise<void>;
  /** the file sizes changed (a recording, a picture): measure again next time */
  touched(ws: string): void;
}

export function quotas(db: Queryable, opts: { enabled: boolean; voicesDir: string; imagesDir: string }): Quotas {
  const disk = new Map<string, { at: number; bytes: number }>();
  const diskOf = (ws: string) => {
    const hit = disk.get(ws);
    if (hit && Date.now() - hit.at < 30_000) return hit.bytes;
    const bytes = sizeOf(join(opts.voicesDir, ws)) + sizeOf(join(opts.imagesDir, ws));
    disk.set(ws, { at: Date.now(), bytes });
    if (disk.size > 5000) disk.clear();
    return bytes;
  };
  const of = async (ws: string): Promise<WorkspacePlan> => {
    const r = (await db.query<{ plan: string; quotas: Partial<Limits> | null; billing_status: string | null; plan_renews_at: Date | null; stripe_customer_id: string | null }>(
      'SELECT plan, quotas, billing_status, plan_renews_at, stripe_customer_id FROM workspaces WHERE id = $1', [ws])).rows[0];
    const plan = (PLAN_IDS.includes(r?.plan as PlanId) ? r!.plan : 'free') as PlanId, overrides = r?.quotas ?? {};
    const limits = opts.enabled ? { ...PLANS[plan].limits, ...overrides } : UNLIMITED;
    return { plan, limits, overrides, billing: { status: r?.billing_status ?? null, renewsAt: r?.plan_renews_at ?? null, customer: !!r?.stripe_customer_id } };
  };
  const monthly = async (ws: string) => {
    const { rows } = await db.query<{ kind: string; n: number }>(
      `SELECT kind, COALESCE(sum(amount), 0)::float AS n FROM usage_events WHERE workspace_id = $1 AND created_at >= date_trunc('month', now()) GROUP BY kind`, [ws]);
    return Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)])) as Partial<Record<Metric, number>>;
  };
  const current = async (ws: string, metric: Metric): Promise<number> => {
    if (metric === 'projects') return (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM projects WHERE workspace_id = $1', [ws])).rows[0]!.n;
    if (metric === 'members') return (await db.query<{ n: number }>(`SELECT (SELECT count(*) FROM memberships WHERE workspace_id = $1) + (SELECT count(*) FROM invitations WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS n`, [ws])).rows[0]!.n * 1;
    if (metric === 'storageMb') {
      const videos = Number((await db.query<{ n: string | null }>(`SELECT COALESCE(sum(r.bytes), 0)::text AS n FROM renders r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = $1 AND r.status = 'done'`, [ws])).rows[0]!.n ?? 0);
      return Math.round(((diskOf(ws) + videos) / 1e6) * 10) / 10;
    }
    return Math.round(((await monthly(ws))[metric] ?? 0) * 10) / 10;
  };
  return {
    enabled: opts.enabled,
    of,
    async usage(ws) {
      const m = await monthly(ws), out = {} as Usage;
      for (const k of ['projects', 'members', 'storageMb'] as const) out[k] = await current(ws, k);
      for (const k of ['generations', 'aiActions', 'renderMinutes'] as const) out[k] = Math.round((m[k] ?? 0) * 10) / 10;
      return out;
    },
    async ensure(ws, metric, amount = 1) {
      if (!opts.enabled) return;
      const p = await of(ws), limit = p.limits[metric];
      if (limit == null) return;
      const used = await current(ws, metric);
      if (used + amount > limit + 1e-9) throw new QuotaError(metric, p.plan, limit, used,
        metric === 'renderMinutes' ? `Le plan ${PLANS[p.plan].label} comprend ${limit} min de rendu vidéo par mois : il en reste ${Math.max(0, Math.floor((limit - used) * 10) / 10)}, cette vidéo en demande ${Math.ceil(amount * 10) / 10}. Rendez une scène seule, ou passez à un plan supérieur.` : undefined);
    },
    async feature(ws, f) {
      if (!opts.enabled) return;
      const p = await of(ws);
      if (!p.limits[f]) throw new QuotaError(f, p.plan, null, 0, `Les décors peints par un modèle d'images sont inclus à partir du plan Premium (votre plan : ${PLANS[p.plan].label}).`);
    },
    async width(ws, width) {
      if (!opts.enabled) return;
      const p = await of(ws);
      if (width > p.limits.maxWidth) throw new QuotaError('maxWidth', p.plan, p.limits.maxWidth, width, `Le plan ${PLANS[p.plan].label} rend des vidéos jusqu'à ${p.limits.maxWidth} px de large : choisissez une largeur plus petite, ou passez au plan Premium.`);
    },
    async has(ws, f) { return !opts.enabled ? f !== 'priority' : !!(await of(ws)).limits[f]; },
    async record(ws, kind, amount, ref = null, userId = null) {
      await db.query('INSERT INTO usage_events (id, workspace_id, kind, amount, ref, user_id) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), ws, kind, amount, ref, userId]);
    },
    async refund(ref) { await db.query('DELETE FROM usage_events WHERE ref = $1', [ref]); },
    touched(ws) { disk.delete(ws); },
  };
}

/** what the web app shows: every plan and its limits */
export const planList = () => PLAN_IDS.map((id) => PLANS[id]);
