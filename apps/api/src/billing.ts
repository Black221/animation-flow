// Payments through Stripe, without its SDK: a Checkout session to subscribe (the card never touches this server), the
// customer portal to change plan, update the card or cancel, and the webhook that tells this server what happened —
// the only source of truth for a paid plan. The secret key only ever goes in the Authorization header; it is never
// logged nor sent to the browser. Off unless every STRIPE_* setting is given.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PlanId } from './plans';

export type PaidPlan = Exclude<PlanId, 'free'>;
export interface StripeConfig { secretKey: string; webhookSecret: string; prices: Record<PaidPlan, string>; appUrl: string }
export type StripeFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class StripeError extends Error { constructor(message: string, public status: number) { super(message); } }

/** Stripe's form encoding: nested objects as a[b][c]=v, arrays as a[0][b]=v */
export function formEncode(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(Array.isArray(v) ? Object.fromEntries(v.map((x, i) => [String(i), x])) : (v as Record<string, unknown>), key, out);
    else out.append(key, String(v));
  }
  return out;
}

export function stripeClient(cfg: StripeConfig, fetchImpl: StripeFetch = fetch as unknown as StripeFetch) {
  const call = async <T>(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}): Promise<T> => {
    const body = formEncode(params).toString();
    const r = await fetchImpl(`https://api.stripe.com/v1${path}${method === 'GET' && body ? `?${body}` : ''}`, {
      method, headers: { authorization: `Bearer ${cfg.secretKey}`, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': '2024-06-20' },
      ...(method === 'POST' ? { body } : {}),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    // Stripe's messages say what is wrong with the request, never the key
    if (!r.ok) throw new StripeError(j.error?.message ?? `Stripe a répondu ${r.status}`, r.status);
    return j as T;
  };
  return {
    checkout: (p: { plan: PaidPlan; workspaceId: string; customer: string | null; email: string }) => call<{ id: string; url: string }>('POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: cfg.prices[p.plan], quantity: 1 }],
      success_url: `${cfg.appUrl}/plans?paiement=ok`,
      cancel_url: `${cfg.appUrl}/plans?paiement=annule`,
      client_reference_id: p.workspaceId,
      allow_promotion_codes: true,
      ...(p.customer ? { customer: p.customer } : { customer_email: p.email }),
      metadata: { workspace_id: p.workspaceId, plan: p.plan },
      subscription_data: { metadata: { workspace_id: p.workspaceId, plan: p.plan } },
    }),
    portal: (customer: string) => call<{ url: string }>('POST', '/billing_portal/sessions', { customer, return_url: `${cfg.appUrl}/plans` }),
    planOfPrice: (price: string | undefined): PaidPlan | null => (Object.entries(cfg.prices).find(([, v]) => v === price)?.[0] as PaidPlan | undefined) ?? null,
  };
}
export type Stripe = ReturnType<typeof stripeClient>;

/** the Stripe-Signature header (t=…,v1=…): an HMAC of "t.body" with the webhook secret, recent enough */
export function verifySignature(raw: Buffer, header: string | undefined, secret: string, toleranceS = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceS) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  return parts.filter(([k]) => k === 'v1').some(([, v]) => { const got = Buffer.from(v ?? '', 'hex'); return got.length === expected.length && timingSafeEqual(got, expected); });
}

/** signs a payload the way Stripe does (tests, and a local `stripe listen` stand-in) */
export const signPayload = (raw: string, secret: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
