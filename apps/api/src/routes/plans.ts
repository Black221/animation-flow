// Plans: the list (public: the pricing page), the current workspace's plan with what it has used, subscribing and
// managing the subscription (the owner, through Stripe), and Stripe's webhook, the only thing that grants a paid plan.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { userOf, wsOf } from '../auth/context';
import { StripeError, verifySignature, type PaidPlan, type Stripe, type StripeConfig } from '../billing';
import type { Db } from '../db';
import { PLAN_IDS, PLANS, planList, type PlanId, type Quotas } from '../plans';

interface Sub { id: string; customer: string; status: string; metadata?: { workspace_id?: string; plan?: string }; current_period_end?: number; items?: { data?: { price?: { id?: string }; current_period_end?: number }[] } }
const PAID = ['premium', 'pro'] as const;
const isUuid = (s: unknown): s is string => typeof s === 'string' && z.string().uuid().safeParse(s).success;

export function planRoutes(app: FastifyInstance, db: Db, quota: Quotas, billing: { stripe: Stripe; config: StripeConfig } | null = null) {
  app.get('/api/plans', { config: { auth: 'public' } }, async () => ({ enabled: quota.enabled, payments: !!billing, plans: planList() }));

  app.get('/api/workspace/plan', { config: { role: 'viewer' } }, async (req) => {
    const ws = wsOf(req), p = await quota.of(ws.id);
    return { enabled: quota.enabled, plan: p.plan, label: PLANS[p.plan].label, limits: p.limits, overrides: p.overrides, usage: await quota.usage(ws.id),
      billing: { payments: !!billing, ...p.billing }, canManage: ws.role === 'owner', plans: planList() };
  });

  app.post('/api/billing/checkout', { config: { role: 'owner' } }, async (req, reply) => {
    if (!billing) return reply.code(400).send({ error: "le paiement en ligne n'est pas configuré sur ce serveur : demandez à l'administrateur de changer votre plan" });
    const b = z.object({ plan: z.enum(PAID) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'plan inconnu' });
    const ws = wsOf(req).id;
    const r = (await db.query<{ stripe_customer_id: string | null; stripe_subscription_id: string | null; billing_status: string | null }>('SELECT stripe_customer_id, stripe_subscription_id, billing_status FROM workspaces WHERE id = $1', [ws])).rows[0]!;
    if (r.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(r.billing_status ?? '')) return reply.code(409).send({ error: 'cet espace a déjà un abonnement : changez de plan depuis « Gérer l’abonnement »' });
    try { return { url: (await billing.stripe.checkout({ plan: b.data.plan, workspaceId: ws, customer: r.stripe_customer_id, email: userOf(req).email })).url }; }
    catch (e) { if (e instanceof StripeError) { req.log.warn({ status: e.status }, 'stripe checkout refused'); return reply.code(502).send({ error: 'le paiement ne peut pas démarrer pour le moment : réessayez plus tard' }); } throw e; }
  });

  app.post('/api/billing/portal', { config: { role: 'owner' } }, async (req, reply) => {
    if (!billing) return reply.code(400).send({ error: "le paiement en ligne n'est pas configuré sur ce serveur" });
    const c = (await db.query<{ stripe_customer_id: string | null }>('SELECT stripe_customer_id FROM workspaces WHERE id = $1', [wsOf(req).id])).rows[0]?.stripe_customer_id;
    if (!c) return reply.code(400).send({ error: "cet espace n'a pas encore d'abonnement" });
    try { return { url: (await billing.stripe.portal(c)).url }; }
    catch (e) { if (e instanceof StripeError) { req.log.warn({ status: e.status }, 'stripe portal refused'); return reply.code(502).send({ error: "l'espace client ne s'ouvre pas pour le moment : réessayez plus tard" }); } throw e; }
  });

  if (!billing) return;
  const { stripe, config } = billing;
  const wsOfSub = async (s: { customer?: string; metadata?: { workspace_id?: string } }) => {
    if (isUuid(s.metadata?.workspace_id) && (await db.query('SELECT 1 FROM workspaces WHERE id = $1', [s.metadata!.workspace_id])).rows.length) return s.metadata!.workspace_id!;
    return s.customer ? (await db.query<{ id: string }>('SELECT id FROM workspaces WHERE stripe_customer_id = $1', [s.customer])).rows[0]?.id ?? null : null;
  };
  const apply = async (type: string, obj: Record<string, unknown>) => {
    if (type === 'checkout.session.completed') {
      const s = obj as { mode?: string; customer?: string; subscription?: string; client_reference_id?: string; metadata?: { workspace_id?: string; plan?: string } };
      const ws = await wsOfSub({ metadata: { ...(s.metadata?.workspace_id ? { workspace_id: s.metadata.workspace_id } : s.client_reference_id ? { workspace_id: s.client_reference_id } : {}) } });
      const plan = PAID.includes(s.metadata?.plan as PaidPlan) ? s.metadata!.plan! : null;
      if (s.mode !== 'subscription' || !ws || !plan) return;
      await db.query(`UPDATE workspaces SET stripe_customer_id = $2, stripe_subscription_id = $3, plan = $4, billing_status = 'active' WHERE id = $1`, [ws, s.customer ?? null, s.subscription ?? null, plan]);
    } else if (type.startsWith('customer.subscription.')) {
      const s = obj as unknown as Sub, ws = await wsOfSub(s);
      if (!ws) return;
      const item = s.items?.data?.[0], plan = stripe.planOfPrice(item?.price?.id) ?? (PAID.includes(s.metadata?.plan as PaidPlan) ? s.metadata!.plan as PaidPlan : null);
      const end = item?.current_period_end ?? s.current_period_end, renews = end ? new Date(end * 1000) : null;
      if (type === 'customer.subscription.deleted' || ['canceled', 'unpaid', 'incomplete_expired'].includes(s.status)) {
        // back to free (what was made stays; making more needs room in the free plan)
        await db.query(`UPDATE workspaces SET plan = 'free', billing_status = $2, stripe_subscription_id = NULL, plan_renews_at = NULL WHERE id = $1 AND (stripe_subscription_id IS NULL OR stripe_subscription_id = $3)`, [ws, s.status === 'active' ? 'canceled' : s.status, s.id]);
      } else if (['active', 'trialing'].includes(s.status) && plan) {
        await db.query(`UPDATE workspaces SET plan = $2, billing_status = $3, stripe_subscription_id = $4, stripe_customer_id = COALESCE(stripe_customer_id, $5), plan_renews_at = $6 WHERE id = $1`, [ws, plan, s.status, s.id, s.customer, renews]);
      } else {
        // past due, incomplete: the plan stays while Stripe retries the payment
        await db.query(`UPDATE workspaces SET billing_status = $2, plan_renews_at = COALESCE($3, plan_renews_at) WHERE id = $1`, [ws, s.status, renews]);
      }
    } else if (type === 'invoice.payment_failed') {
      const ws = await wsOfSub(obj as { customer?: string });
      if (ws) await db.query(`UPDATE workspaces SET billing_status = 'past_due' WHERE id = $1`, [ws]);
    }
  };

  // Stripe signs the raw body: this route reads it as bytes (its own scope), and needs no CSRF header (it is signed)
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scope.post('/api/billing/webhook', { config: { auth: 'public', csrf: false } }, async (req, reply) => {
      const raw = req.body as Buffer;
      if (!Buffer.isBuffer(raw) || !verifySignature(raw, req.headers['stripe-signature'] as string | undefined, config.webhookSecret)) return reply.code(400).send({ error: 'signature invalide' });
      let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
      try { event = JSON.parse(raw.toString('utf8')); } catch { return reply.code(400).send({ error: 'événement illisible' }); }
      if (!event.id || !event.type || !event.data?.object) return reply.code(400).send({ error: 'événement incomplet' });
      // each event once (Stripe sends again until it gets a 2xx)
      const fresh = (await db.query('INSERT INTO billing_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id', [event.id, event.type])).rows.length > 0;
      if (fresh) {
        try { await apply(event.type, event.data.object); }
        catch (e) { await db.query('DELETE FROM billing_events WHERE id = $1', [event.id]); throw e; }
      }
      return { received: true, duplicate: !fresh };
    });
  });
}

export const isPlan = (p: unknown): p is PlanId => PLAN_IDS.includes(p as PlanId);
