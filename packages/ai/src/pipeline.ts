// The generation pipeline. Every answer is validated: by the storyboard schema, then for scenes by the project
// schema and the library check (unknown poses, props…). When it fails, the model gets the list of problems, with
// their paths, and tries again (twice at most). A scene that still fails is replaced by a plain one built from the
// storyboard (decor, characters standing, narration, title), so the project that comes out is always valid.
import { checkAgainstLibrary } from '@af/engine';
import { catalog, registry } from '@af/library';
import type { ChatMessage, CompletionResult, Usage } from '@af/providers';
import { parseProject, Scene as SceneSchema, type Issue, type Project, type ProjectInput } from '@af/schema';
import { z } from 'zod';
import { extractJson } from './json';
import { editRequest, repairRequest, sceneRequest, scenePrompt, storyboardPrompt, type StoryboardOptions } from './prompts';
import { Storyboard, storyboardJsonSchema, type StoryScene } from './storyboard';

/** a text model bound to a provider, a key and a model id */
export interface Model {
  label: string;
  call(req: { system: string; messages: ChatMessage[]; json?: { name: string; schema: Record<string, unknown> }; maxTokens?: number }): Promise<CompletionResult>;
}

export interface Step { stage: 'storyboard' | 'scene' | 'edit'; target: string; attempt: number; ok: boolean; issues: Issue[]; usage: Usage; ms: number }
export type OnStep = (s: Step) => void;

export class ModelError extends Error { constructor(message: string, public status?: number) { super(message); this.name = 'ModelError'; } }
export class InvalidAnswer extends Error { constructor(message: string, public issues: Issue[]) { super(message); this.name = 'InvalidAnswer'; } }

type Check<T> = (v: unknown) => { ok: true; value: T } | { ok: false; issues: Issue[] };
const MAX_REPAIRS = 2;
const zIssues = (e: z.ZodError): Issue[] => e.issues.map((i) => ({ path: i.path.map(String).join('.') || '(racine)', message: i.message }));

async function ask<T>(model: Model, system: string, first: string, json: { name: string; schema: Record<string, unknown> }, check: Check<T>, stage: Step['stage'], target: string, onStep: OnStep, maxTokens = 8000): Promise<{ value: T | null; issues: Issue[] }> {
  const messages: ChatMessage[] = [{ role: 'user', content: first }];
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

// ---------- storyboard ----------
export async function generateStoryboard(model: Model, text: string, o: StoryboardOptions, onStep: OnStep = () => undefined): Promise<Storyboard> {
  const check: Check<Storyboard> = (v) => { const r = Storyboard.safeParse(v); return r.success ? { ok: true, value: r.data } : { ok: false, issues: zIssues(r.error) }; };
  const { value, issues } = await ask(model, storyboardPrompt(o), `The user's text:\n<<<\n${text}\n>>>`, { name: 'storyboard', schema: storyboardJsonSchema() }, check, 'storyboard', 'storyboard', onStep);
  if (!value) throw new InvalidAnswer("le modèle n'a pas produit de storyboard valide", issues);
  return { ...value, language: o.language, style: o.style };
}

// ---------- scenes ----------
export const castOf = (sb: Storyboard): ProjectInput['cast'] =>
  Object.fromEntries(sb.cast.map((c) => [c.id, { kind: c.kind, name: c.name, params: c.params, ...(c.voice ? { voice: c.voice } : {}) }]));

const baseProject = (sb: Storyboard, scenes: unknown[]): ProjectInput => ({ schemaVersion: 1, title: sb.title, language: sb.language, style: sb.style, cast: castOf(sb), scenes: scenes as ProjectInput['scenes'] });

/** a scene is valid when the project holding it is, and the library knows everything it uses */
function checkScene(sb: Storyboard, story: StoryScene, cast: ProjectInput['cast']): Check<z.output<typeof SceneSchema>> {
  return (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, issues: [{ path: '(racine)', message: 'un objet JSON (la scène) est attendu' }] };
    // the storyboard is the script the user approved: its narration and ids win over the model's
    const s = { ...(v as Record<string, unknown>), id: story.id, narration: story.narration };
    if (!('decor' in s)) (s as Record<string, unknown>).decor = story.decor;
    if (!('music' in s)) (s as Record<string, unknown>).music = story.music;
    if (!('title' in s)) (s as Record<string, unknown>).title = story.title;
    const r = parseProject({ ...baseProject(sb, [s]), cast });
    if (!r.ok) return { ok: false, issues: r.issues.map((i) => ({ path: i.path.replace(/^scenes\.0\.?/, '') || '(scène)', message: i.message })) };
    const warnings = checkAgainstLibrary(r.project, registry, catalog);
    if (warnings.length) return { ok: false, issues: warnings.map((w) => ({ path: w.path.replace(/^scenes\.0\.?/, ''), message: w.message })) };
    return { ok: true, value: r.project.scenes[0]! };
  };
}

/** a plain, always-valid scene from its storyboard entry: decor, the speaking characters standing, a title */
export function fallbackScene(sb: Storyboard, story: StoryScene): z.input<typeof SceneSchema> {
  const speakers = [...new Set(story.narration.map((l) => l.speaker).filter((s) => s !== 'narrator'))];
  const mentioned = sb.cast.filter((c) => speakers.includes(c.id) || story.shots.some((sh) => sh.toLowerCase().includes(c.name.toLowerCase()))).slice(0, 4);
  const people = mentioned.length ? mentioned : sb.cast.slice(0, 1);
  const first = story.narration[0]?.id;
  return {
    id: story.id, title: story.title, duration: story.duration, decor: story.decor, music: story.music, narration: story.narration, transition: 'fade',
    elements: [
      ...people.map((c, i) => {
        const x = Math.round(1920 * ((i + 1) / (people.length + 1))), drone = c.kind === 'drone';
        return { id: c.id, type: 'character' as const, ref: c.id, layer: 5 + i, keys: [{ t: 0, x, y: drone ? 520 : 900, facing: (i % 2 ? -1 : 1) as 1 | -1, pose: 'idle', expression: 'neutral', opacity: 0 }, { t: 0.6, opacity: 1 }, ...(first ? [{ t: { line: first }, expression: drone ? 'happy' : 'happy' }] : [])] };
      }),
      { id: 'title', type: 'text' as const, space: 'screen' as const, layer: 20, params: { text: story.title || sb.title, size: 64, color: '#1F3A5F' }, keys: [{ t: 0, x: 960, y: 160, opacity: 0 }, { t: 0.6, opacity: 1 }, { t: 2.6, opacity: 1 }, { t: 3.4, opacity: 0 }] },
    ],
  };
}

export interface SceneResult { scene: z.output<typeof SceneSchema>; fallback: boolean; issues: Issue[] }

export async function generateScene(model: Model, sb: Storyboard, story: StoryScene, onStep: OnStep = () => undefined): Promise<SceneResult> {
  const cast = castOf(sb), check = checkScene(sb, story, cast);
  const schema = z.toJSONSchema(SceneSchema, { io: 'input' }) as Record<string, unknown>;
  const { value, issues } = await ask(model, scenePrompt(sb.language), sceneRequest(sb, story, JSON.stringify(cast)), { name: 'scene', schema }, check, 'scene', story.id, onStep);
  if (value) return { scene: value, fallback: false, issues: [] };
  const fb = check(fallbackScene(sb, story));
  if (!fb.ok) throw new InvalidAnswer(`scène ${story.id} : même la scène de secours est invalide`, fb.issues);
  return { scene: fb.value, fallback: true, issues };
}

/** all scenes (a few at a time), then the project; `onScene` reports each one as it lands */
export async function generateScenes(model: Model, sb: Storyboard, o: { concurrency?: number; onStep?: OnStep; onScene?: (i: number, r: SceneResult) => void; signal?: AbortSignal } = {}): Promise<{ project: Project; results: SceneResult[] }> {
  const results: SceneResult[] = new Array(sb.scenes.length);
  let next = 0;
  const worker = async () => {
    while (next < sb.scenes.length) {
      if (o.signal?.aborted) throw new ModelError('génération annulée');
      const i = next++, r = await generateScene(model, sb, sb.scenes[i]!, o.onStep);
      results[i] = r; o.onScene?.(i, r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 2, sb.scenes.length)) }, worker));
  const parsed = parseProject(baseProject(sb, results.map((r) => r.scene)));
  if (!parsed.ok) throw new InvalidAnswer('les scènes ne forment pas un projet valide', parsed.issues);
  return { project: parsed.project, results };
}

// ---------- editing one scene ----------
/** What the model left out stays as it was; a line it kept (same id, same text) keeps its recording and measured
 * duration: an edit must not throw away voices already paid for. */
function keepFromCurrent(v: Record<string, unknown>, current: Project['scenes'][number]): Record<string, unknown> {
  const s: Record<string, unknown> = { ...v, id: current.id };
  for (const k of ['title', 'duration', 'decor', 'music', 'narration'] as const) if (!(k in s)) s[k] = current[k];
  if (Array.isArray(s.narration)) s.narration = (s.narration as Record<string, unknown>[]).map((l) => {
    const old = current.narration.find((o) => o.id === l?.id && o.text === l?.text);
    return old ? { ...l, ...(old.audio ? { audio: old.audio } : {}), ...(old.duration != null ? { duration: old.duration } : {}) } : l;
  });
  return s;
}

export async function editScene(model: Model, project: Project, index: number, instruction: string, onStep: OnStep = () => undefined): Promise<z.output<typeof SceneSchema>> {
  const current = project.scenes[index];
  if (!current) throw new InvalidAnswer('scène introuvable', []);
  const check: Check<z.output<typeof SceneSchema>> = (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, issues: [{ path: '(racine)', message: 'un objet JSON (la scène) est attendu' }] };
    const s = keepFromCurrent(v as Record<string, unknown>, current);
    const r = parseProject({ ...project, scenes: project.scenes.map((x, k) => (k === index ? s : x)) });
    if (!r.ok) return { ok: false, issues: r.issues.filter((i) => i.path.startsWith(`scenes.${index}`)).map((i) => ({ path: i.path.replace(new RegExp(`^scenes\\.${index}\\.?`), '') || '(scène)', message: i.message })).concat(r.issues.some((i) => !i.path.startsWith(`scenes.${index}`)) ? [{ path: '(projet)', message: r.issues[0]!.message }] : []) };
    const warnings = checkAgainstLibrary(r.project, registry, catalog).filter((w) => w.path.startsWith(`scenes.${index}`));
    if (warnings.length) return { ok: false, issues: warnings.map((w) => ({ path: w.path.replace(new RegExp(`^scenes\\.${index}\\.?`), ''), message: w.message })) };
    return { ok: true, value: r.project.scenes[index]! };
  };
  const schema = z.toJSONSchema(SceneSchema, { io: 'input' }) as Record<string, unknown>;
  const { value, issues } = await ask(model, scenePrompt(project.language) + `\nCast: ${JSON.stringify(project.cast)}`, editRequest(JSON.stringify(current), instruction), { name: 'scene', schema }, check, 'edit', current.id, onStep);
  if (!value) throw new InvalidAnswer("le modèle n'a pas produit de scène valide", issues);
  return value;
}
