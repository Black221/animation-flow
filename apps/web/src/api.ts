// A thin client for the API. The optional team access token is kept in this browser only (localStorage); API keys
// for model providers are sent once to the server and never read back.
import type { Catalog } from '@af/engine';
import type { ProviderInfo, TaskInfo, TestResult } from '@af/providers';
import type { Issue, Project } from '@af/schema';

const TOKEN = 'af-access-token';
export const getToken = () => { try { return localStorage.getItem(TOKEN) ?? ''; } catch { return ''; } };
export const setToken = (t: string) => { try { if (t) localStorage.setItem(TOKEN, t); else localStorage.removeItem(TOKEN); } catch { /* private mode */ } };

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) { super(message); }
}

type Listener = () => void;
const unauthorized = new Set<Listener>();
export const onUnauthorized = (f: Listener) => { unauthorized.add(f); return () => { unauthorized.delete(f); }; };

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? null : JSON.stringify(init.body) });
  if (r.status === 401) unauthorized.forEach((f) => f());
  if (r.status === 204) return undefined as T;
  const text = await r.text(), body = text ? JSON.parse(text) : null;
  if (!r.ok) throw new ApiError(r.status, body?.error ?? `HTTP ${r.status}`, body);
  return body as T;
}

export interface Warning { path: string; message: string }
export interface ProjectSummary { id: string; title: string; version: number; createdAt: string; updatedAt: string }
export interface ProjectDoc extends ProjectSummary { project: Project; warnings: Warning[] }
export interface StyleInfo { id: string; label: string; description: string }
export interface Library { catalog: Catalog; styles: StyleInfo[]; templates: string[] }
export interface Credential { id: string; provider: string; label: string; hint: string; baseUrl: string | null; createdAt: string; lastTestedAt: string | null; lastTestOk: boolean | null }
export interface Assignment { task: string; credentialId: string | null; model: string }
export type { Issue, ProviderInfo, TaskInfo, TestResult };

export const Api = {
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
  assign: (task: string, credentialId: string | null, model: string) => api<Assignment>(`/api/assignments/${task}`, { method: 'PUT', body: { credentialId, model } }),
};
