// The generation pipeline: text → storyboard (reviewed by the user) → a drawing of everything the storyboard needs
// (see drawing.ts) → each scene, written with those drawings. Every answer is validated (storyboard schema; project
// schema, drawings' poses and expressions, nothing that is not one of the film's drawings) and repaired by the
// model from the list of problems (twice at most). A scene that still fails is replaced by a plain one built from
// the storyboard, so the project that comes out is always valid.
import { checkAgainstLibrary } from '@af/engine';
import { catalog, registry } from '@af/library';
import { parseProject, Scene as SceneSchema, type Asset, type Issue, type Piece, type Project, type ProjectInput, type SoundRecipe } from '@af/schema';
import { z } from 'zod';
import { ask, InvalidAnswer, ModelError, zIssues, type Check, type Model, type OnStep } from './ask';
import { composeScore, designSounds, moodFromWords } from './compose';
import { drawAll, type AssetBrief, type AssetResult, type DrawOptions } from './drawing';
import { drawingsBrief, drawnFrom, editRequest, PLAN_PROMPT, planRequest, referenceImages, sceneRequest, scenePrompt, storyboardPrompt, type Reference, type StoryboardOptions } from './prompts';
import { briefsOf, Storyboard, storyboardJsonSchema, type StoryScene } from './storyboard';

export { InvalidAnswer, ModelError, type Model, type OnStep, type Step } from './ask';

// ---------- storyboard ----------
export async function generateStoryboard(model: Model, text: string, o: StoryboardOptions, onStep: OnStep = () => undefined): Promise<Storyboard> {
  const check: Check<Storyboard> = (v) => {
    const r = Storyboard.safeParse(v);
    if (!r.success) return { ok: false, issues: zIssues(r.error) };
    // what the user brought a model of is in the film, in the right list, under its id
    const lists = { character: r.data.cast, prop: r.data.props, decor: r.data.decors } as const;
    const missing = (o.references ?? []).filter(drawnFrom).filter((p) => !lists[p.kind].some((x) => x.id === p.id));
    return missing.length ? { ok: false, issues: missing.map((p) => ({ path: p.kind === 'character' ? 'cast' : `${p.kind}s`, message: `le modèle « ${p.id} » (${p.name}) doit y figurer, avec cet id, décrit d'après son image` })) } : { ok: true, value: r.data };
  };
  const { value, issues } = await ask(model, storyboardPrompt(o), `The user's text:\n<<<\n${text}\n>>>`, { name: 'storyboard', schema: storyboardJsonSchema() }, check, 'storyboard', 'storyboard', onStep, 8000, referenceImages(o.references ?? []));
  if (!value) throw new InvalidAnswer("le modèle n'a pas produit de storyboard valide", issues);
  return { ...value, language: o.language, style: o.style };
}

// ---------- drawings ----------
export type Drawings = Record<string, Asset>;
/** draw everything the storyboard needs; what the user brought a model of is drawn after its picture */
export async function generateDrawings(model: Model, sb: Storyboard, o: DrawOptions & { concurrency?: number; signal?: AbortSignal; onAsset?: (r: AssetResult) => void } = {}): Promise<{ assets: Drawings; results: AssetResult[] }> {
  const results = await drawAll(model, briefsOf(sb), { title: sb.title, style: sb.style, palette: sb.palette }, o);
  return { assets: Object.fromEntries(results.map((r) => [r.id, r.asset])), results };
}

// ---------- music and sounds ----------
/** the film's sound, composed for it: the score, which piece each scene plays, the sound effects */
export interface FilmSound { score: Record<string, Piece>; music: Record<string, string>; sounds: Record<string, SoundRecipe> }
export async function generateSound(model: Model, sb: Storyboard, onStep: OnStep = () => undefined, references: readonly Reference[] = []): Promise<FilmSound & { fallbacks: string[] }> {
  const [score, sfx] = await Promise.all([composeScore(model, sb, onStep, references.filter((r) => r.kind === 'music')), designSounds(model, sb.sounds, sb.title, onStep)]);
  return { score: score.score, music: score.music, sounds: sfx.sounds, fallbacks: [...(score.fallback ? ['musique'] : []), ...sfx.fallbacks] };
}
/** without a composed score (older jobs): the built-in mood the scene's words point to */
const musicOf = (story: StoryScene, audio?: FilmSound) => ({ mood: audio?.music[story.id] ?? moodFromWords(story.music), gain: 0 });

// ---------- scenes ----------
/** each cast member is drawn by the drawing of the same id */
export const castOf = (sb: Storyboard): ProjectInput['cast'] =>
  Object.fromEntries(sb.cast.map((c) => [c.id, { kind: c.id, name: c.name, ...(c.voice ? { voice: c.voice } : {}) }]));

const baseProject = (sb: Storyboard, scenes: unknown[], assets: Drawings, audio?: FilmSound): ProjectInput => ({ schemaVersion: 1, title: sb.title, language: sb.language, style: sb.style, cast: castOf(sb), assets, ...(audio ? { score: audio.score, sounds: audio.sounds } : {}), scenes: scenes as ProjectInput['scenes'] });

/** everything on screen must be one of the film's drawings (no stock library) */
function onlyDrawings(p: Project, index: number): Issue[] {
  const s = p.scenes[index]!, a = p.assets, names = (k: Asset['kind']) => Object.keys(a).filter((id) => a[id]!.kind === k).join(', ') || 'aucun';
  const out: Issue[] = [];
  if (!a[s.decor.kind]) out.push({ path: 'decor.kind', message: `« ${s.decor.kind} » n'est pas un décor du film (${names('decor')})` });
  s.elements.forEach((e, i) => {
    if (e.type === 'prop' && (!e.ref || a[e.ref]?.kind !== 'prop')) out.push({ path: `elements.${i}.ref`, message: `« ${e.ref ?? ''} » n'est pas un accessoire du film (${names('prop')})` });
    if (e.type === 'character' && (!e.ref || !p.cast[e.ref])) out.push({ path: `elements.${i}.ref`, message: `« ${e.ref ?? ''} » n'est pas dans la distribution (${Object.keys(p.cast).join(', ')})` });
  });
  s.sfx.forEach((f, i) => { if (!p.sounds[f.kind]) out.push({ path: `sfx.${i}.kind`, message: `« ${f.kind} » n'est pas un son du film (${Object.keys(p.sounds).join(', ') || 'aucun : pas de bruitage'})` }); });
  return out;
}

/** a scene is valid when the project holding it is, and it uses the film's drawings as they are */
function checkScene(sb: Storyboard, story: StoryScene, assets: Drawings, audio?: FilmSound): Check<z.output<typeof SceneSchema>> {
  return (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, issues: [{ path: '(racine)', message: 'un objet JSON (la scène) est attendu' }] };
    // the storyboard is the script the user approved: its narration, ids and decor win over the model's
    // the music was composed for the film: the scene plays the piece chosen for it
    const s = { ...(v as Record<string, unknown>), id: story.id, narration: story.narration, music: musicOf(story, audio) };
    if (!('decor' in s)) (s as Record<string, unknown>).decor = { kind: story.decor };
    if (!('title' in s)) (s as Record<string, unknown>).title = story.title;
    const r = parseProject(baseProject(sb, [s], assets, audio));
    if (!r.ok) return { ok: false, issues: r.issues.map((i) => ({ path: i.path.replace(/^scenes\.0\.?/, '') || '(scène)', message: i.message })) };
    const issues = [...onlyDrawings(r.project, 0), ...checkAgainstLibrary(r.project, registry, catalog).map((w) => ({ path: w.path.replace(/^scenes\.0\.?/, ''), message: w.message }))];
    if (issues.length) return { ok: false, issues };
    return { ok: true, value: r.project.scenes[0]! };
  };
}

/** a plain, always-valid scene from its storyboard entry: the decor, the speaking characters standing, its props on
 *  the ground, a title */
export function fallbackScene(sb: Storyboard, story: StoryScene, audio?: FilmSound): z.input<typeof SceneSchema> {
  const speakers = [...new Set(story.narration.map((l) => l.speaker).filter((s) => s !== 'narrator'))];
  const mentioned = sb.cast.filter((c) => speakers.includes(c.id) || story.shots.some((sh) => sh.toLowerCase().includes(c.name.toLowerCase()))).slice(0, 4);
  const people = mentioned.length ? mentioned : sb.cast.slice(0, 1), props = story.props.slice(0, 3);
  const first = story.narration[0]?.id;
  return {
    id: story.id, title: story.title, duration: story.duration, decor: { kind: story.decor }, music: musicOf(story, audio), narration: story.narration, transition: 'fade',
    elements: [
      ...people.map((c, i) => ({ id: c.id, type: 'character' as const, ref: c.id, layer: 5 + i, keys: [{ t: 0, x: Math.round(1920 * ((i + 1) / (people.length + 1))), y: 900, facing: (i % 2 ? -1 : 1) as 1 | -1, pose: 'idle', expression: 'neutral', opacity: 0 }, { t: 0.6, opacity: 1 }, ...(first ? [{ t: { line: first }, pose: 'talk', expression: 'happy' }] : [])] })),
      ...props.map((p, i) => ({ id: `p-${p}`, type: 'prop' as const, ref: p, layer: 3, keys: [{ t: 0, x: Math.round(1920 * ((i + 1.5) / (props.length + 2))), y: 910, opacity: 0 }, { t: 1, opacity: 1 }] })),
      { id: 'title', type: 'text' as const, space: 'screen' as const, layer: 20, params: { text: story.title || sb.title, size: 64, color: '#1F3A5F' }, keys: [{ t: 0, x: 960, y: 160, opacity: 0 }, { t: 0.6, opacity: 1 }, { t: 2.6, opacity: 1 }, { t: 3.4, opacity: 0 }] },
    ],
  };
}

export interface SceneResult { scene: z.output<typeof SceneSchema>; fallback: boolean; issues: Issue[] }

export async function generateScene(model: Model, sb: Storyboard, assets: Drawings, story: StoryScene, onStep: OnStep = () => undefined, audio?: FilmSound): Promise<SceneResult> {
  const check = checkScene(sb, story, assets, audio);
  const schema = z.toJSONSchema(SceneSchema, { io: 'input' }) as Record<string, unknown>;
  const drawings = drawingsBrief({ cast: castOf(sb) as Project['cast'], assets, ...(audio ? { sounds: audio.sounds } : {}) });
  const { value, issues } = await ask(model, scenePrompt(sb.language, drawings), sceneRequest(sb, story), { name: 'scene', schema }, check, 'scene', story.id, onStep);
  if (value) return { scene: value, fallback: false, issues: [] };
  const fb = check(fallbackScene(sb, story, audio));
  if (!fb.ok) throw new InvalidAnswer(`scène ${story.id} : même la scène de secours est invalide`, fb.issues);
  return { scene: fb.value, fallback: true, issues };
}

/** all scenes (a few at a time), then the project; `onScene` reports each one as it lands */
export async function generateScenes(model: Model, sb: Storyboard, assets: Drawings, o: { concurrency?: number; onStep?: OnStep; onScene?: (i: number, r: SceneResult) => void; signal?: AbortSignal; audio?: FilmSound } = {}): Promise<{ project: Project; results: SceneResult[] }> {
  const results: SceneResult[] = new Array(sb.scenes.length);
  let next = 0;
  const worker = async () => {
    while (next < sb.scenes.length) {
      if (o.signal?.aborted) throw new ModelError('génération annulée');
      const i = next++, r = await generateScene(model, sb, assets, sb.scenes[i]!, o.onStep, o.audio);
      results[i] = r; o.onScene?.(i, r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 2, sb.scenes.length)) }, worker));
  const parsed = parseProject(baseProject(sb, results.map((r) => r.scene), assets, o.audio));
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

const Plan = z.object({ new: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/), kind: z.enum(['character', 'prop', 'decor', 'sound']), name: z.string().min(1).max(80), description: z.string().min(3).max(800) })).max(6).default([]) });

export interface EditResult {
  scene: z.output<typeof SceneSchema>;
  /** drawings the change needed, made for it (new cast members for new characters) */
  assets: Drawings;
  cast: Project['cast'];
  /** sound effects designed for the change */
  sounds: Record<string, SoundRecipe>;
  drawn: AssetResult[];
}

/** change one scene as asked; what it needs that the film does not have yet is drawn first (`drawModel`) */
export async function editScene(model: Model, project: Project, index: number, instruction: string, o: { onStep?: OnStep; drawModel?: Model; draw?: DrawOptions } = {}): Promise<EditResult> {
  const onStep = o.onStep ?? (() => undefined), current = project.scenes[index];
  if (!current) throw new InvalidAnswer('scène introuvable', []);
  // 1. what new drawings does the change need?
  const taken = new Set([...Object.keys(project.assets), ...Object.keys(project.cast), ...Object.keys(project.sounds)]);
  const planCheck: Check<(Omit<AssetBrief, 'kind'> & { kind: AssetBrief['kind'] | 'sound' })[]> = (v) => {
    const r = Plan.safeParse(v);
    if (!r.success) return { ok: false, issues: zIssues(r.error) };
    const clash = r.data.new.filter((n) => taken.has(n.id));
    return clash.length ? { ok: false, issues: clash.map((c) => ({ path: 'new', message: `« ${c.id} » existe déjà : choisissez un autre id, ou réutilisez-le` })) } : { ok: true, value: r.data.new };
  };
  const plan = await ask(model, PLAN_PROMPT, planRequest(drawingsBrief(project), JSON.stringify(current), instruction), { name: 'plan', schema: z.toJSONSchema(Plan, { io: 'input' }) as Record<string, unknown> }, planCheck, 'plan', current.id, onStep, 2000);
  const planned = plan.value ?? [], briefs = planned.filter((b): b is AssetBrief => b.kind !== 'sound');
  // 2. draw them, design the sounds
  const designed = await designSounds(model, planned.filter((b) => b.kind === 'sound'), project.title, onStep);
  const drawn = briefs.length ? await drawAll(o.drawModel ?? model, briefs, { title: project.title, style: project.style, others: Object.entries(project.assets).map(([id, a]) => ({ id, kind: a.kind, name: a.name, description: a.description })) }, { ...o.draw, onStep }) : [];
  const assets: Drawings = Object.fromEntries(drawn.map((r) => [r.id, r.asset]));
  const cast: Project['cast'] = Object.fromEntries(briefs.filter((b) => b.kind === 'character').map((b) => [b.id, { kind: b.id, name: b.name, params: {} }]));
  const withNew: Project = { ...project, assets: { ...project.assets, ...assets }, cast: { ...project.cast, ...cast }, sounds: { ...project.sounds, ...designed.sounds } };
  // 3. the scene, with them
  const check: Check<z.output<typeof SceneSchema>> = (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, issues: [{ path: '(racine)', message: 'un objet JSON (la scène) est attendu' }] };
    const s = keepFromCurrent(v as Record<string, unknown>, current);
    const r = parseProject({ ...withNew, scenes: withNew.scenes.map((x, k) => (k === index ? s : x)) });
    const mine = (p: string) => p.startsWith(`scenes.${index}`), strip = (p: string) => p.replace(new RegExp(`^scenes\\.${index}\\.?`), '') || '(scène)';
    if (!r.ok) return { ok: false, issues: r.issues.filter((i) => mine(i.path)).map((i) => ({ path: strip(i.path), message: i.message })).concat(r.issues.some((i) => !mine(i.path)) ? [{ path: '(projet)', message: r.issues.find((i) => !mine(i.path))!.message }] : []) };
    // projects made before drawings were generated keep their library kinds; new elements must be drawings
    // what the scene had keeps working (older projects use the built-in library); what is new must be the film's own
    const issues = Object.keys(project.assets).length || Object.keys(assets).length ? onlyDrawings(r.project, index).filter((i) => !current.elements.some((e, k) => i.path === `elements.${k}.ref` && e.ref === (r.project.scenes[index]!.elements[k]?.ref)) && !(i.path === 'decor.kind' && r.project.scenes[index]!.decor.kind === current.decor.kind) && !(i.path.startsWith('sfx.') && current.sfx.some((f) => f.kind === r.project.scenes[index]!.sfx[Number(i.path.split('.')[1])]?.kind))) : [];
    const warnings = checkAgainstLibrary(r.project, registry, catalog).filter((w) => mine(w.path)).map((w) => ({ path: strip(w.path), message: w.message }));
    if (issues.length || warnings.length) return { ok: false, issues: [...issues, ...warnings] };
    return { ok: true, value: r.project.scenes[index]! };
  };
  const schema = z.toJSONSchema(SceneSchema, { io: 'input' }) as Record<string, unknown>;
  const { value, issues } = await ask(model, scenePrompt(project.language, drawingsBrief(withNew)), editRequest(JSON.stringify(current), instruction), { name: 'scene', schema }, check, 'edit', current.id, onStep);
  if (!value) throw new InvalidAnswer("le modèle n'a pas produit de scène valide", issues);
  return { scene: value, assets, cast, sounds: designed.sounds, drawn };
}
