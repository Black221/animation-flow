// The back office's client for its own server: the session is its HttpOnly cookie (the page never sees it), every
// write carries the back office's CSRF header. A 401 means signed out (the session ended, or the rights were taken).
import type { Limits, Metric, Plan, PlanId } from '@af/ui';

export class ApiError extends Error { constructor(public status: number, message: string, public body: unknown) { super(message); } }
const signedOut = new Set<() => void>();
export const onSignedOut = (f: () => void) => { signedOut.add(f); return () => { signedOut.delete(f); }; };

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'animation-flow-admin' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? null : JSON.stringify(init.body), credentials: 'same-origin' });
  if (r.status === 401 && !path.startsWith('/api/auth/')) signedOut.forEach((f) => f());
  if (r.status === 204) return undefined as T;
  const text = await r.text(), body = text ? JSON.parse(text) : null;
  if (!r.ok) throw new ApiError(r.status, body?.error ?? `HTTP ${r.status}`, body);
  return body as T;
}
const qs = (q: Record<string, unknown>) => { const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString(); return p ? `?${p}` : ''; };

export interface Admin { id: string; name: string; email: string }
export type Usage = Record<Metric, number>;
export interface Billing { payments?: boolean; status: string | null; renewsAt: string | null; customer: boolean; customerId?: string | null; subscriptionId?: string | null }
export interface Overview {
  plansEnabled: boolean; payments: boolean; users: number; newUsers: number; suspended: number; activeUsers: number; workspaces: number; byPlan: Record<PlanId, number>;
  paying: number; monthlyRevenue: number; pastDue: number; projects: number; publications: number; hidden: number; renders: number; queued: number;
  usage: Partial<Record<Metric, number>>; openReports: number; signups: { day: string; count: number }[];
}
export interface UserRow { id: string; name: string; email: string; createdAt: string; lastSeenAt: string | null; admin: boolean; suspended: boolean; workspaces: { id: string; name: string; role: string; plan: PlanId }[] }
export interface UserWorkspace { id: string; name: string; role: string; plan: PlanId; limits: Limits; overrides: Partial<Limits>; billing: Billing; usage: Usage }
export interface UserDetail { id: string; name: string; email: string; createdAt: string; admin: boolean; suspended: boolean; suspendedAt: string | null; workspaces: UserWorkspace[]; publications: number; sessions: number; lastSeenAt: string | null }
export interface WorkspaceRow { id: string; name: string; plan: PlanId; billingStatus: string | null; renewsAt: string | null; custom: boolean; createdAt: string; owner: { id: string; name: string; email: string } | null; members: number; projects: number }
export interface WorkspaceDetail {
  id: string; name: string; createdAt: string; plan: PlanId; limits: Limits; overrides: Partial<Limits>; usage: Usage; billing: Billing;
  members: { userId: string; name: string; email: string; role: string; joinedAt: string }[]; projects: number; publications: number;
  recentUsage: { kind: Metric; amount: number; at: string; by: string | null }[];
}
export interface Subscription { id: string; name: string; plan: PlanId; status: string | null; renewsAt: string | null; customerId: string | null; subscriptionId: string | null; owner: { name: string; email: string } | null; source: 'stripe' | 'granted' | 'ended' }
export interface Film { id: string; title: string; createdAt: string; hidden: boolean; likes: number; views: number; remixes: number; duration: number; author: { id: string; name: string } | null; openReports: number }
export type ReportReason = 'inappropriate' | 'copyright' | 'spam' | 'other';
export const REPORT_REASON: Record<ReportReason, string> = { inappropriate: 'Contenu choquant ou inapproprié', copyright: "Droits d'auteur", spam: 'Spam ou publicité trompeuse', other: 'Autre chose' };
export interface Report {
  id: string; reason: ReportReason; message: string; status: string; createdAt: string; resolvedAt: string | null; resolvedBy: string | null; reporter: string | null;
  publication: { id: string; title: string; hidden: boolean; author: { id: string; name: string } | null; openReports: number };
}
export interface AuditEntry { id: string; admin: { id: string | null; name: string }; action: string; target: { type: string; id: string | null }; summary: string; ip: string | null; at: string }
export interface Page<T> { total: number; items: T[] }

export const Api = {
  me: () => api<{ user: Admin | null; appUrl?: string | null }>('/api/auth/me'),
  login: (email: string, password: string) => api<{ user: Admin }>('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  overview: () => api<Overview>('/api/admin/overview'),
  users: (q: { q?: string; filter?: string; offset?: number } = {}) => api<Page<UserRow>>(`/api/admin/users${qs(q)}`),
  user: (id: string) => api<UserDetail>(`/api/admin/users/${id}`),
  updateUser: (id: string, b: { suspended?: boolean; admin?: boolean }) => api<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'PATCH', body: b }),
  signOutUser: (id: string) => api<{ ended: number }>(`/api/admin/users/${id}/signout`, { method: 'POST' }),
  workspaces: (q: { q?: string; plan?: string; billing?: string; offset?: number } = {}) => api<Page<WorkspaceRow>>(`/api/admin/workspaces${qs(q)}`),
  workspace: (id: string) => api<WorkspaceDetail>(`/api/admin/workspaces/${id}`),
  updateWorkspace: (id: string, b: { plan?: PlanId; quotas?: Partial<Limits> }) => api<{ plan: PlanId; limits: Limits; overrides: Partial<Limits>; usage: Usage }>(`/api/admin/workspaces/${id}`, { method: 'PATCH', body: b }),
  subscriptions: () => api<{ payments: boolean; items: Subscription[]; revenue: { plan: PlanId; count: number; monthly: number }[] }>('/api/admin/subscriptions'),
  plans: () => api<{ enabled: boolean; payments: boolean; prices: Record<Exclude<PlanId, 'free'>, string> | null; plans: Plan[] }>('/api/admin/plans'),
  films: (q: { q?: string; status?: string; offset?: number } = {}) => api<Page<Film>>(`/api/admin/publications${qs(q)}`),
  hideFilm: (id: string, hidden: boolean) => api<{ ok: boolean }>(`/api/admin/publications/${id}`, { method: 'PATCH', body: { hidden } }),
  removeFilm: (id: string) => api<void>(`/api/admin/publications/${id}`, { method: 'DELETE' }),
  reports: (status: 'open' | 'resolved' | 'all' = 'open') => api<Report[]>(`/api/admin/reports?status=${status}`),
  settle: (id: string, action: 'dismiss' | 'hide' | 'remove') => api<{ ok: boolean; status: string }>(`/api/admin/reports/${id}`, { method: 'POST', body: { action } }),
  audit: (q: { q?: string; offset?: number } = {}) => api<Page<AuditEntry>>(`/api/admin/audit${qs(q)}`),
};

export const ago = (d: string | Date) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  if (s < 86400 * 30) return `il y a ${Math.round(s / 86400)} j`;
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
export const dateTime = (d: string | Date) => new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const BILLING_STATUS: Record<string, string> = { active: 'actif', trialing: 'essai', past_due: 'paiement en retard', canceled: 'résilié', unpaid: 'impayé', incomplete: 'à finaliser', incomplete_expired: 'expiré' };
export const ROLE: Record<string, string> = { owner: 'propriétaire', admin: 'administrateur', editor: 'éditeur', viewer: 'lecteur' };
