// A thin client for the API. The session lives in an HttpOnly cookie (the page never sees it); every request says
// which workspace it acts in, and writes carry the header the server requires against cross-site forgery.
import type { Catalog } from '@af/engine';
import type { ProviderInfo, TaskInfo, TestResult } from '@af/providers';
import type { Asset, Issue, Project } from '@af/schema';

const WS = 'af-workspace';
export const getWorkspace = () => { try { return localStorage.getItem(WS) ?? ''; } catch { return ''; } };
export const setWorkspace = (id: string) => { try { if (id) localStorage.setItem(WS, id); else localStorage.removeItem(WS); } catch { /* private mode */ } };

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) { super(message); }
}

type Listener = () => void;
const unauthorized = new Set<Listener>();
export const onUnauthorized = (f: Listener) => { unauthorized.add(f); return () => { unauthorized.delete(f); }; };
/** a limit of the plan reached (402): the app explains it and offers a bigger plan, wherever it happened */
export interface QuotaInfo { error: string; quota: { metric: string; plan: PlanId; limit: number | null; used: number } }
const overQuota = new Set<(q: QuotaInfo) => void>();
export const onQuota = (f: (q: QuotaInfo) => void) => { overQuota.add(f); return () => { overQuota.delete(f); }; };
/** the last limit reached: its dialog already says it, a toast with the same words would say it twice */
export const lastQuota = { text: '', at: 0 };
toastFilter.allow = (text, kind) => !(kind === 'error' && text === lastQuota.text && Date.now() - lastQuota.at < 5000);

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'animation-flow' };
  const ws = getWorkspace();
  if (ws) headers['x-workspace-id'] = ws;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? null : JSON.stringify(init.body) });
  if (r.status === 401) unauthorized.forEach((f) => f());
  if (r.status === 204) return undefined as T;
  const text = await r.text(), body = text ? JSON.parse(text) : null;
  if (r.status === 402 && body?.quota) { lastQuota.text = body.error; lastQuota.at = Date.now(); overQuota.forEach((f) => f(body as QuotaInfo)); }
  if (!r.ok) throw new ApiError(r.status, body?.error ?? `HTTP ${r.status}`, body);
  return body as T;
}

/** send a file as the request body (pictures, sounds): the server reads what it is from its bytes */
export async function upload<T>(path: string, file: Blob): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'animation-flow', 'content-type': file.type || 'application/octet-stream' };
  const ws = getWorkspace();
  if (ws) headers['x-workspace-id'] = ws;
  const r = await fetch(path, { method: 'POST', headers, body: file });
  if (r.status === 401) unauthorized.forEach((f) => f());
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* a proxy's page */ }
  if (r.status === 413) throw new ApiError(413, 'fichier trop gros', body);
  if (r.status === 402 && body?.quota) { lastQuota.text = body.error; lastQuota.at = Date.now(); overQuota.forEach((f) => f(body as QuotaInfo)); }
  if (!r.ok) throw new ApiError(r.status, body?.error ?? `HTTP ${r.status}`, body);
  return body as T;
}
export interface UploadedImage { asset: string; width: number; height: number; alpha: boolean; color: string; url: string }
export interface UploadedSound { asset: string; duration: number; truncated: boolean; maxSeconds: number; url: string }
export interface ImportResult { id: string; title: string; media: { images: number; sounds: number; missing: number; skipped: number }; warnings: Warning[] }

/** download what a GET returns as a file (the export needs the workspace header, a plain link cannot send it) */
export async function download(path: string, fallbackName: string) {
  const headers: Record<string, string> = { 'x-requested-with': 'animation-flow' }, ws = getWorkspace();
  if (ws) headers['x-workspace-id'] = ws;
  const r = await fetch(path, { headers });
  if (!r.ok) { let e = `HTTP ${r.status}`; try { e = (await r.json()).error ?? e; } catch { /* not JSON */ } throw new ApiError(r.status, e, null); }
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName, url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface Warning { path: string; message: string }
export interface ProjectSummary { id: string; title: string; version: number; createdAt: string; updatedAt: string; updatedBy: string | null; createdBy: string | null; remixOf?: { id: string; title: string } | null; publicationId?: string | null; scenes?: number[] }
export type License = 'cc-by' | 'cc-by-sa' | 'cc0';
export const LICENSE_LABEL: Record<License, string> = { 'cc-by': 'CC BY — citer l’auteur', 'cc-by-sa': 'CC BY-SA — citer l’auteur, même licence', cc0: 'CC0 — domaine public' };
export interface Publication {
  id: string; title: string; description: string; tags: string[]; license: License; duration: number; version: number; scenes?: number[];
  author: { id: string; name: string } | null; remixOf: { id: string; title: string; author: string | null; authorId: string | null } | null;
  remixes: number; likes: number; views: number; liked: boolean; createdAt: string; updatedAt: string;
}
export interface PublicationDetail extends Publication { project: Project; remixList: Publication[]; canManage: boolean; hidden?: boolean; licenseLabel: string; media: { voices: string[]; images: string[] } }
export interface CommunityPage { items: Publication[]; total: number; tags: { tag: string; count: number }[] }
export interface AuthorInfo { id: string; name: string; since: string; publications: number; likes: number; remixes: number }
export interface PublishMeta { title: string; description: string; tags: string[]; license: License }
/** where a publication's media are served (no link to sign: they are public) */
export const communityMedia = (id: string) => ({
  voices: async (assets: string[]) => Object.fromEntries(assets.map((a) => [a, `/api/community/${id}/voices/${a}.wav`])),
  images: async (assets: string[]) => Object.fromEntries(assets.map((a) => [a, `/api/community/${id}/images/${a}.jpg`])),
});
export interface ProjectDoc extends ProjectSummary { project: Project; warnings: Warning[] }
export interface StyleInfo { id: string; label: string; description: string }
export interface Library { catalog: Catalog; styles: StyleInfo[]; templates: string[] }
export interface Credential { id: string; provider: string; label: string; hint: string; baseUrl: string | null; createdAt: string; lastTestedAt: string | null; lastTestOk: boolean | null }
export interface Assignment { task: string; credentialId: string | null; model: string; voice: string }
export interface Recording { asset: string; textHash: string; duration: number; cached: boolean; url: string }
export type RenderStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
export interface RenderJob {
  id: string; projectId: string; projectVersion: number; status: RenderStatus;
  options: {
    style: string; width: number; height?: number; crf: number; sceneId?: string; subtitles: boolean; audio?: boolean;
    format?: OutputFormat; aspect?: OutputAspect; framing?: Framing; size?: number; burn?: boolean;
  };
  framesDone: number; framesTotal: number; fps: number | null; error: string | null; bytes: number | null; warnings: string[];
  createdAt: string; startedAt: string | null; finishedAt: string | null; videoUrl: string | null;
}
export type OutputFormat = 'mp4' | 'webm' | 'gif';
export type OutputAspect = '16:9' | '9:16' | '1:1' | '4:5';
export type Framing = 'follow' | 'center' | 'fit';
export interface RenderRequest {
  style?: string; format: OutputFormat; aspect: OutputAspect; framing: Framing; size: 360 | 540 | 720 | 1080;
  quality: 'draft' | 'standard' | 'high'; sceneId?: string; subtitles: 'track' | 'burned' | 'off'; audio: boolean;
}
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
export const ROLE_LABEL: Record<Role, string> = { owner: 'propriétaire', admin: 'administrateur', editor: 'éditeur', viewer: 'lecteur' };
import { toastFilter, type Limits, type Metric, type Plan, type PlanId } from '@af/ui';
export type { Limits, Metric, Plan, PlanId };
export interface WorkspacePlan {
  enabled: boolean; plan: PlanId; label: string; limits: Limits; overrides: Partial<Limits>; usage: Record<Metric, number>;
  billing: { payments: boolean; status: string | null; renewsAt: string | null; customer: boolean }; canManage: boolean; plans: Plan[];
}
export type ReportReason = 'inappropriate' | 'copyright' | 'spam' | 'other';
export const REPORT_REASON: Record<ReportReason, string> = { inappropriate: 'Contenu choquant ou inapproprié', copyright: "Droits d'auteur", spam: 'Spam ou publicité trompeuse', other: 'Autre chose' };
export interface Me { user: { id: string; email: string; name: string } | null; workspaces: { id: string; name: string; role: Role }[]; signup: 'invite' | 'open'; setup: boolean; mail: boolean }
export interface Member { userId: string; name: string; email: string; role: Role; joinedAt: string }
export interface PendingInvitation { id: string; role: Role; email: string | null; createdAt: string; expiresAt: string; by: string | null }
export interface WorkspaceInfo { id: string; name: string; role: Role; members: Member[]; invitations: PendingInvitation[] }
export type GenerationStatus = 'storyboard' | 'review' | 'assets' | 'music' | 'scenes' | 'done' | 'failed' | 'canceled';
export interface StoryLine { id: string; speaker: string; text: string }
export interface StorySceneT { id: string; title: string; duration: number; decor: string; props: string[]; music: string; narration: StoryLine[]; shots: string[] }
/** something the film needs drawn, described in words */
export interface StoryThing { id: string; name: string; description: string }
export interface StoryboardT { title: string; language: string; style: string; palette: string[]; cast: (StoryThing & { voice?: string })[]; props: StoryThing[]; decors: StoryThing[]; sounds: StoryThing[]; scenes: StorySceneT[] }
export interface GenStep { stage: string; target: string; attempt: number; ok: boolean; issues: Issue[]; usage: { inputTokens: number; outputTokens: number }; ms: number }
export interface Generation {
  id: string; status: GenerationStatus; input: { text: string; language: string; style: string; targetSeconds?: number; instructions?: string; review: boolean; media?: ProvidedMedia[] };
  storyboard: StoryboardT | null; projectId: string | null; scenesDone: number; scenesTotal: number; steps: GenStep[]; fallbacks: string[];
  assetsDone: number; assetsTotal: number; drawings: string[]; composed: { pieces: string[]; sounds: string[] } | null;
  models: { storyboard?: string; scenes?: string; assets?: string; music?: string }; usage: { inputTokens: number; outputTokens: number }; error: string | null; createdAt: string; updatedAt: string;
}
export interface DrawnInfo { id: string; fallback: boolean; rounds: number; review: string[] }
/** a picture of the workspace the AI uses as it is (a mascot, a logo, a place) */
export interface ProvidedMedia { id: string; kind: 'character' | 'prop' | 'decor'; name: string; description: string; asset: string; width: number; height: number; color?: string }
export interface GenerationRequest { text: string; language: string; style: string; targetSeconds?: number; instructions?: string; review: boolean; media?: ProvidedMedia[] }
export interface Comment {
  id: string; projectId: string; parentId: string | null; sceneId: string; elementId: string | null; t: number | null; body: string;
  author: { id: string; name: string } | null; createdAt: string; editedAt: string | null; resolvedAt: string | null; resolvedBy: string | null;
}
export interface NewComment { body: string; sceneId?: string; elementId?: string | null; t?: number | null; parentId?: string }
export type { Issue, ProviderInfo, TaskInfo, TestResult };

export const Api = {
  me: () => api<Me>('/api/auth/me'),
  signup: (b: { email: string; name: string; password: string; invitation?: string }) => api<Me>('/api/auth/signup', { method: 'POST', body: b }),
  login: (email: string, password: string) => api<Me>('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  updateMe: (b: { name?: string; password?: { current: string; next: string } }) => api<Me>('/api/auth/me', { method: 'PATCH', body: b }),
  invitation: (token: string) => api<{ workspace: string; role: Role; email: string | null; expiresAt: string }>(`/api/invitations/${token}`),
  acceptInvitation: (token: string) => api<{ workspace: { id: string; name: string; role: Role }; workspaces: Me['workspaces'] }>(`/api/invitations/${token}/accept`, { method: 'POST' }),
  workspace: () => api<WorkspaceInfo>('/api/workspace'),
  renameWorkspace: (name: string) => api<{ ok: boolean }>('/api/workspace', { method: 'PATCH', body: { name } }),
  createWorkspace: (name: string) => api<{ id: string; name: string; role: Role }>('/api/workspaces', { method: 'POST', body: { name } }),
  deleteWorkspace: (confirm: string) => api<void>('/api/workspace', { method: 'DELETE', body: { confirm } }),
  invite: (role: Role, email?: string, o: { days?: number; send?: boolean } = {}) => api<{ id: string; path: string; role: Role; email: string | null; days: number; sent: boolean; sendError?: string }>('/api/workspace/invitations', { method: 'POST', body: { role, ...(email ? { email } : {}), ...(o.days ? { days: o.days } : {}), ...(o.send ? { send: true } : {}) } }),
  forgot: (email: string) => api<{ ok: boolean }>('/api/auth/forgot', { method: 'POST', body: { email } }),
  resetInfo: (token: string) => api<{ email: string }>(`/api/auth/reset/${token}`),
  resetPassword: (token: string, password: string) => api<Me>(`/api/auth/reset/${token}`, { method: 'POST', body: { password } }),
  revokeInvitation: (id: string) => api<void>(`/api/workspace/invitations/${id}`, { method: 'DELETE' }),
  setRole: (userId: string, role: Role) => api<{ ok: boolean }>(`/api/workspace/members/${userId}`, { method: 'PATCH', body: { role } }),
  removeMember: (userId: string) => api<void>(`/api/workspace/members/${userId}`, { method: 'DELETE' }),
  health: () => api<{ ok: boolean; auth: boolean }>('/api/health'),
  plans: () => api<{ enabled: boolean; payments: boolean; plans: Plan[] }>('/api/plans'),
  workspacePlan: () => api<WorkspacePlan>('/api/workspace/plan'),
  checkout: (plan: Exclude<PlanId, 'free'>) => api<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { plan } }),
  billingPortal: () => api<{ url: string }>('/api/billing/portal', { method: 'POST' }),
  report: (publicationId: string, reason: ReportReason, message: string) => api<{ reported: boolean }>(`/api/community/${publicationId}/report`, { method: 'POST', body: { reason, message } }),

  library: () => api<Library>('/api/library'),
  projects: () => api<ProjectSummary[]>('/api/projects'),
  project: (id: string) => api<ProjectDoc>(`/api/projects/${id}`),
  createProject: (template: string, title?: string) => api<ProjectDoc>('/api/projects', { method: 'POST', body: { template, title } }),
  /** a new project from a whole project (a copy) */
  createProjectFrom: (project: unknown) => api<ProjectDoc>('/api/projects', { method: 'POST', body: { project } }),
  saveProject: (id: string, project: unknown, baseVersion: number) => api<ProjectDoc>(`/api/projects/${id}`, { method: 'PUT', body: { project, baseVersion } }),
  deleteProject: (id: string) => api<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  providers: () => api<{ providers: ProviderInfo[]; tasks: TaskInfo[] }>('/api/providers'),
  credentials: () => api<Credential[]>('/api/credentials'),
  addCredential: (c: { provider: string; label: string; apiKey?: string; baseUrl?: string }) => api<Credential>('/api/credentials', { method: 'POST', body: c }),
  updateCredential: (id: string, c: { label?: string; apiKey?: string; baseUrl?: string | null }) => api<Credential>(`/api/credentials/${id}`, { method: 'PATCH', body: c }),
  deleteCredential: (id: string) => api<void>(`/api/credentials/${id}`, { method: 'DELETE' }),
  testCredential: (id: string) => api<TestResult>(`/api/credentials/${id}/test`, { method: 'POST' }),
  assignments: () => api<Assignment[]>('/api/assignments'),
  uploadImage: (f: Blob) => upload<UploadedImage>('/api/uploads/image', f),
  uploadAudio: (f: Blob, use: 'voice' | 'music') => upload<UploadedSound>(`/api/uploads/audio?use=${use}`, f),
  exportProject: (id: string, media = true) => download(`/api/projects/${id}/export?media=${media ? 1 : 0}`, 'projet.animation.json'),
  importProject: (file: unknown) => api<ImportResult>('/api/projects/import', { method: 'POST', body: file }),
  renders: (projectId: string) => api<RenderJob[]>(`/api/projects/${projectId}/renders`),
  startRender: (projectId: string, r: RenderRequest) => api<RenderJob>(`/api/projects/${projectId}/renders`, { method: 'POST', body: r }),
  cancelRender: (id: string) => api<RenderJob>(`/api/renders/${id}/cancel`, { method: 'POST' }),
  deleteRender: (id: string) => api<void>(`/api/renders/${id}`, { method: 'DELETE' }),
  assign: (task: string, credentialId: string | null, model: string, voice = '') => api<Assignment>(`/api/assignments/${task}`, { method: 'PUT', body: { credentialId, model, voice } }),
  generations: () => api<Generation[]>('/api/generations'),
  generation: (id: string) => api<Generation>(`/api/generations/${id}`),
  generate: (r: GenerationRequest) => api<Generation>('/api/generations', { method: 'POST', body: r }),
  saveStoryboard: (id: string, storyboard: StoryboardT) => api<Generation>(`/api/generations/${id}/storyboard`, { method: 'PUT', body: { storyboard } }),
  retryStoryboard: (id: string, instructions?: string) => api<Generation>(`/api/generations/${id}/storyboard/retry`, { method: 'POST', body: instructions ? { instructions } : {} }),
  writeScenes: (id: string) => api<Generation>(`/api/generations/${id}/scenes`, { method: 'POST' }),
  cancelGeneration: (id: string) => api<Generation>(`/api/generations/${id}/cancel`, { method: 'POST' }),
  /** the scene changed as asked, and what it needed that the film did not have: new drawings (and cast members) */
  editScene: (project: unknown, sceneIndex: number, instruction: string) => api<{ scene: unknown; assets: Record<string, Asset>; cast: Project['cast']; sounds: Project['sounds']; drawn: DrawnInfo[]; usage: { inputTokens: number; outputTokens: number }; model: string }>('/api/ai/edit-scene', { method: 'POST', body: { project, sceneIndex, instruction } }),
  /** compose the project's music again (optionally with a direction) */
  compose: (project: unknown, instruction?: string) => api<{ score: Project['score']; music: Record<string, string>; fallback: boolean; usage: { inputTokens: number; outputTokens: number }; model: string }>('/api/ai/compose', { method: 'POST', body: { project, ...(instruction ? { instruction } : {}) } }),
  /** design one sound effect */
  designSound: (project: unknown, id: string, name: string, description: string) => api<{ sound: Project['sounds'][string]; fallback: boolean; usage: { inputTokens: number; outputTokens: number }; model: string }>('/api/ai/sound', { method: 'POST', body: { project, id, name, description } }),
  /** draw one thing for the project, or draw it again with a change */
  draw: (b: { project: unknown; id: string; kind: Asset['kind']; name: string; description: string; instruction?: string; current?: Asset; picture?: boolean }) => api<{ asset: Asset; fallback: boolean; rounds: number; review: string[]; usage: { inputTokens: number; outputTokens: number }; model: string }>('/api/ai/draw', { method: 'POST', body: b }),
  record: (text: string, voice?: string, language?: string) => api<Recording>('/api/voices', { method: 'POST', body: { text, ...(voice ? { voice } : {}), ...(language ? { language } : {}) } }),
  comments: (projectId: string) => api<Comment[]>(`/api/projects/${projectId}/comments`),
  addComment: (projectId: string, c: NewComment) => api<Comment>(`/api/projects/${projectId}/comments`, { method: 'POST', body: c }),
  updateComment: (id: string, c: { body?: string; resolved?: boolean }) => api<Comment>(`/api/comments/${id}`, { method: 'PATCH', body: c }),
  deleteComment: (id: string) => api<void>(`/api/comments/${id}`, { method: 'DELETE' }),
  voiceLinks: (assets: string[]) => api<Record<string, string>>('/api/voices/links', { method: 'POST', body: { assets } }),
  community: (q: { sort?: string; q?: string; tag?: string; author?: string; limit?: number; offset?: number } = {}) => api<CommunityPage>(`/api/community?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  publication: (id: string) => api<PublicationDetail>(`/api/community/${id}`),
  viewPublication: (id: string) => api<{ counted: boolean; views?: number }>(`/api/community/${id}/view`, { method: 'POST' }),
  like: (id: string, on: boolean) => api<{ liked: boolean; likes: number }>(`/api/community/${id}/like`, { method: on ? 'POST' : 'DELETE' }),
  remix: (id: string, title?: string) => api<{ id: string; title: string }>(`/api/community/${id}/remix`, { method: 'POST', body: title ? { title } : {} }),
  unpublish: (id: string) => api<void>(`/api/community/${id}`, { method: 'DELETE' }),
  author: (id: string) => api<AuthorInfo>(`/api/community/authors/${id}`),
  projectPublication: (projectId: string) => api<{ publication: Publication | null }>(`/api/projects/${projectId}/publication`),
  publish: (projectId: string, meta: PublishMeta) => api<Publication>(`/api/projects/${projectId}/publish`, { method: 'POST', body: meta }),
  imageLinks: (assets: string[]) => api<Record<string, string>>('/api/images/links', { method: 'POST', body: { assets } }),
  /** paint a decor as a picture with the image model (Réglages → Fournisseurs → Décors en images) */
  paintDecor: (b: { name: string; description: string; instruction?: string; style?: string; palette?: string[] }) => api<{ image: NonNullable<Asset['image']>; url: string; model: string }>('/api/ai/decor-image', { method: 'POST', body: b }),
};
