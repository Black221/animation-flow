// Asking a model for JSON and holding it to a check: when the answer fails, the model gets the list of problems,
// with their paths, and tries again (twice at most).
import type { ChatImage, ChatMessage, CompletionResult, Usage } from '@af/providers';
import type { Issue } from '@af/schema';
import { z } from 'zod';
import { extractJson } from './json';
import { repairRequest } from './prompts';

/** a text model bound to a provider, a key and a model id */
export interface Model {
  label: string;
  call(req: { system: string; messages: ChatMessage[]; json?: { name: string; schema: Record<string, unknown> }; maxTokens?: number }): Promise<CompletionResult>;
}

export interface Step { stage: 'storyboard' | 'asset' | 'review' | 'picture' | 'music' | 'sound' | 'plan' | 'scene' | 'edit'; target: string; attempt: number; ok: boolean; issues: Issue[]; usage: Usage; ms: number }
export type OnStep = (s: Step) => void;

export class ModelError extends Error { constructor(message: string, public status?: number) { super(message); this.name = 'ModelError'; } }
export class InvalidAnswer extends Error { constructor(message: string, public issues: Issue[]) { super(message); this.name = 'InvalidAnswer'; } }

export type Check<T> = (v: unknown) => { ok: true; value: T } | { ok: false; issues: Issue[] };
export const MAX_REPAIRS = 2;
export const zIssues = (e: z.ZodError): Issue[] => e.issues.map((i) => ({ path: i.path.map(String).join('.') || '(racine)', message: i.message }));

/** `images`: pictures sent with the first message (the models the user brought, for a model that sees) */
export async function ask<T>(model: Model, system: string, first: string, json: { name: string; schema: Record<string, unknown> }, check: Check<T>, stage: Step['stage'], target: string, onStep: OnStep, maxTokens = 8000, images?: ChatImage[]): Promise<{ value: T | null; issues: Issue[] }> {
  const messages: ChatMessage[] = [{ role: 'user', content: first, ...(images?.length ? { images } : {}) }];
  let issues: Issue[] = [];
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const t0 = Date.now(), r = await model.call({ system, messages, json, maxTokens });
    if (!r.ok) throw new ModelError(r.error, r.status);
    let parsed: unknown = null;
    try { parsed = extractJson(r.text); } catch (e) { issues = [{ path: 'JSON', message: (e as Error).message }]; }
    if (parsed !== null) { const c = check(parsed); if (c.ok) { onStep({ stage, target, attempt, ok: true, issues: [], usage: r.usage, ms: Date.now() - t0 }); return { value: c.value, issues: [] }; } issues = c.issues; }
    onStep({ stage, target, attempt, ok: false, issues, usage: r.usage, ms: Date.now() - t0 });
    messages.push({ role: 'assistant', content: r.text }, { role: 'user', content: repairRequest(issues) });
  }
  return { value: null, issues };
}

