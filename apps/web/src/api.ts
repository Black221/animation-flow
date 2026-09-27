// A thin client for the API. The session lives in an HttpOnly cookie (the page never sees it); every request says
// which workspace it acts in, and writes carry the header the server requires against cross-site forgery.
import type { Catalog } from '@af/engine';
import type { ProviderInfo, TaskInfo, TestResult } from '@af/providers';
import type { Issue, Project } from '@af/schema';

const WS = 'af-workspace';
export const getWorkspace = () => { try { return localStorage.getItem(WS) ?? ''; } catch { return ''; } };
export const setWorkspace = (id: string) => { try { if (id) localStorage.setItem(WS, id); else localStorage.removeItem(WS); } catch { /* private mode */ } };

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) { super(message); }
}

type Listener = () => void;
const unauthorized = new Set<Listener>();
export const onUnauthorized = (f: Listener) => { unauthorized.add(f); return () => { unauthorized.delete(f); }; };

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'animation-flow' };
  const ws = getWorkspace();
  if (ws) headers['x-workspace-id'] = ws;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? null : JSON.stringify(init.body) });
  if (r.status === 401) unauthorized.forEach((f) => f());
  if (r.status === 204) return undefined as T;
  const text = await r.text(), body = text ? JSON.parse(text) : null;
  if (!r.ok) throw new ApiError(r.status, body?.error ?? `HTTP ${r.status}`, body);
  return body as T;
}

export interface Warning { path: string; message: string }
export interface ProjectSummary { id: string; title: string; version: number; createdAt: string; updatedAt: string; updatedBy: string | null; createdBy: string | null }
export interface ProjectDoc extends ProjectSummary { project: Project; warnings: Warning[] }
export interface StyleInfo { id: string; label: string; description: string }
export interface Library { catalog: Catalog; styles: StyleInfo[]; templates: string[] }
export interface Credential { id: string; provider: string; label: string; hint: string; baseUrl: string | null; createdAt: string; lastTestedAt: string | null; lastTestOk: boolean | null }
export interface Assignment { task: string; credentialId: string | null; model: string; voice: string }
export interface Recording { asset: string; textHash: string; duration: number; cached: boolean; url: string }
export type RenderStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
export interface RenderJob {
  id: string; projectId: string; projectVersion: number; status: RenderStatus;
  options: { style: string; width: number; crf: number; sceneId?: string; subtitles: boolean; audio?: boolean };
  framesDone: number; framesTotal: number; fps: number | null; error: string | null; bytes: number | null; warnings: string[];
  createdAt: string; startedAt: string | null; finishedAt: string | null; videoUrl: string | null;
}
export interface RenderRequest { style?: string; width: number; quality: 'draft' | 'standard' | 'high'; sceneId?: string; subtitles: boolean; audio: boolean }
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
export const ROLE_LABEL: Record<Role, string> = { owner: 'propriétaire', admin: 'administrateur', editor: 'éditeur', viewer: 'lecteur' };
export interface Me { user: { id: string; email: string; name: string } | null; workspaces: { id: string; name: string; role: Role }[]; signup: 'invite' | 'open'; setup: boolean; mail: boolean }
export interface Member { userId: string; name: string; email: string; role: Role; joinedAt: string }
export interface PendingInvitation { id: string; role: Role; email: string | null; createdAt: string; expiresAt: string; by: string | null }
export interface WorkspaceInfo { id: string; name: string; role: Role; members: Member[]; invitations: PendingInvitation[] }
export type GenerationStatus = 'storyboard' | 'review' | 'scenes' | 'done' | 'failed' | 'canceled';
export interface StoryLine { id: string; speaker: string; text: string }
export interface StorySceneT { id: string; title: string; duration: number; decor: { kind: string; params: Record<string, unknown> }; music: { mood: string; gain: number }; narration: StoryLine[]; shots: string[] }
export interface StoryboardT { title: string; language: string; style: string; cast: { id: string; kind: string; name: string; description: string; params: Record<string, unknown>; voice?: string }[]; scenes: StorySceneT[] }
export interface GenStep { stage: string; target: string; attempt: number; ok: boolean; issues: Issue[]; usage: { inputTokens: number; outputTokens: number }; ms: number }
export interface Generation {
  id: string; status: GenerationStatus; input: { text: string; language: string; style: string; targetSeconds?: number; instructions?: string; review: boolean };
  storyboard: StoryboardT | null; projectId: string | null; scenesDone: number; scenesTotal: number; steps: GenStep[]; fallbacks: string[];
  models: { storyboard?: string; scenes?: string }; usage: { inputTokens: number; outputTokens: number }; error: string | null; createdAt: string; updatedAt: string;
}
export interface GenerationRequest { text: string; language: string; style: string; targetSeconds?: number; instructions?: string; review: boolean }
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
  library: () => api<Library>('/api/library'),
  projects: () => api<ProjectSummary[]>('/api/projects'),
  project: (id: string) => api<ProjectDoc>(`/api/projects/${id}`),
  createProject: (template: string, title?: string) => api<ProjectDoc>('/api/projects', { method: 'POST', body: { template, title } }),
  saveProject: (id: string, project: unknown, baseVersion: number) => api<ProjectDoc>(`/api/projects/${id}`, { method: 'PUT', body: { project, baseVersion } }),
  deleteProject: (id: string) => api<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  providers: () => api<{ providers: ProviderInfo[]; tasks: TaskInfo[] }>('/api/providers'),
  credentials: () => api<Credential[]>('/api/credentials'),
  addCredential: (c: { provider: string; label: string; apiKey?: string; baseUrl?: string }) => api<Credential>('/api/credentials', { method: 'POST', body: c }),
  updateCredential: (id: string, c: { label?: string; apiKey?: string; baseUrl?: string | null }) => api<Credential>(`/api/credentials/${id}`, { method: 'PATCH', body: c }),
  deleteCredential: (id: string) => api<void>(`/api/credentials/${id}`, { method: 'DELETE' }),
  testCredential: (id: string) => api<TestResult>(`/api/credentials/${id}/test`, { method: 'POST' }),
  assignments: () => api<Assignment[]>('/api/assignments'),
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
  editScene: (project: unknown, sceneIndex: number, instruction: string) => api<{ scene: unknown; usage: { inputTokens: number; outputTokens: number }; model: string }>('/api/ai/edit-scene', { method: 'POST', body: { project, sceneIndex, instruction } }),
  record: (text: string, voice?: string, language?: string) => api<Recording>('/api/voices', { method: 'POST', body: { text, ...(voice ? { voice } : {}), ...(language ? { language } : {}) } }),
  comments: (projectId: string) => api<Comment[]>(`/api/projects/${projectId}/comments`),
  addComment: (projectId: string, c: NewComment) => api<Comment>(`/api/projects/${projectId}/comments`, { method: 'POST', body: c }),
  updateComment: (id: string, c: { body?: string; resolved?: boolean }) => api<Comment>(`/api/comments/${id}`, { method: 'PATCH', body: c }),
  deleteComment: (id: string) => api<void>(`/api/comments/${id}`, { method: 'DELETE' }),
  voiceLinks: (assets: string[]) => api<Record<string, string>>('/api/voices/links', { method: 'POST', body: { assets } }),
};
