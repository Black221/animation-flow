// AI generation jobs. A job runs in the API process (the model calls are network-bound): storyboard first, then,
// once the user has reviewed it (or at once with review: false), a drawing of every character, prop and decor it
// needs (each looked at by the model and corrected), then every scene, and a new project at the end.
// Progress, token counts and every model call (with the problems found in its answer) are kept on the job.
import { briefsOf, composeScore, designSounds, drawOne, editScene, generateDrawings, generateScenes, generateSound, generateStoryboard, InvalidAnswer, ModelError, PREVIEW_TIME, Storyboard, type DrawOptions, type Drawings, type FilmSound, type Step } from '@af/ai';
import { renderStill } from '@af/render';
import { timeProject } from '@af/engine';
import type { JsonPost } from '@af/providers';
import { Asset, parseProject, type ProjectInput } from '@af/schema';
import { stylePacks } from '@af/styles';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { drawingModel, modelFor, musicModel, NotConfigured } from '../ai/models';
import type { SecretBox } from '../crypto';
import { userOf, wsOf } from '../auth/context';
import type { Db } from '../db';
import { painterOf } from './images';
import type { Quotas } from '../plans';

type Status = 'storyboard' | 'review' | 'assets' | 'music' | 'scenes' | 'done' | 'failed' | 'canceled';
interface Row {
  id: string; workspace_id: string; created_by: string | null; status: Status; input: { text: string; language: string; style: string; targetSeconds?: number; instructions?: string; review: boolean };
  storyboard: unknown; project_id: string | null; scenes_done: number; scenes_total: number; steps: unknown[]; fallbacks: string[];
  assets: Drawings | null; assets_done: number; assets_total: number; audio: (FilmSound & { fallbacks: string[] }) | null;
  models: Record<string, string>; input_tokens: number; output_tokens: number; error: string | null; created_at: Date; updated_at: Date;
}
const Uuid = z.object({ id: z.string().uuid() });
const Input = z.object({
  text: z.string().trim().min(10, 'texte trop court').max(20000),
  language: z.string().max(12).default('fr'),
  style: z.string().default('watercolor'),
  targetSeconds: z.number().int().min(10).max(1800).optional(),
  instructions: z.string().max(2000).optional(),
  review: z.boolean().default(true),
});

export function generationRoutes(app: FastifyInstance, db: Db, box: SecretBox, fetchImpl: JsonPost | undefined, fontsDir: string | undefined, imagesDir: string, quota: Quotas) {
  // decors are painted only where the plan includes it (otherwise drawn in vectors, like without an image model)
  const paintersOf = async (ws: string) => ((await quota.has(ws, 'decorImages')) ? painterOf(db, box, ws, imagesDir, fetchImpl) : null);
  // a generation that fails or is canceled gives back what it counted
  const failed = async (id: string, error: string) => { await set(id, { status: 'failed', error }); await quota.refund(id); };
  const running = new Map<string, AbortController>();
  // what a model is shown of its drawing: rendered here, on the server's canvas
  const draw: DrawOptions = { preview: async (p: ProjectInput) => (await renderStill(p, { t: PREVIEW_TIME, width: 1024, ...(fontsDir ? { fontsDir } : {}) })).toString('base64') };
  const view = (r: Row) => ({
    id: r.id, status: r.status, input: r.input, storyboard: r.storyboard, projectId: r.project_id, scenesDone: r.scenes_done, scenesTotal: r.scenes_total,
    assetsDone: r.assets_done, assetsTotal: r.assets_total, drawings: r.assets ? Object.keys(r.assets) : [],
    composed: r.audio ? { pieces: Object.keys(r.audio.score), sounds: Object.keys(r.audio.sounds) } : null,
    steps: r.steps, fallbacks: r.fallbacks, models: r.models, usage: { inputTokens: r.input_tokens, outputTokens: r.output_tokens }, error: r.error, createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const load = async (id: string, ws?: string) => (await db.query<Row>(`SELECT * FROM generations WHERE id = $1${ws ? ' AND workspace_id = $2' : ''}`, ws ? [id, ws] : [id])).rows[0];
  const set = (id: string, fields: Record<string, unknown>) => {
    const keys = Object.keys(fields);
    return db.query(`UPDATE generations SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => (typeof fields[k] === 'object' && fields[k] !== null ? JSON.stringify(fields[k]) : fields[k]))]);
  };
  const logStep = (id: string) => (s: Step) => void db.query(
    `UPDATE generations SET steps = steps || $2::jsonb, input_tokens = input_tokens + $3, output_tokens = output_tokens + $4, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify([{ ...s, issues: s.issues.slice(0, 5) }]), s.usage.inputTokens, s.usage.outputTokens]).catch(() => undefined);
  const failure = (e: unknown) => e instanceof InvalidAnswer ? `${e.message} : ${e.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join(' ; ')}` : (e as Error).message;

  // a job cut off by a restart cannot resume: say so
  void db.query(`DELETE FROM usage_events WHERE ref IN (SELECT id::text FROM generations WHERE status IN ('storyboard', 'assets', 'music', 'scenes'))`)
    .then(() => db.query(`UPDATE generations SET status = 'failed', error = 'interrompue par un redémarrage du serveur', updated_at = now() WHERE status IN ('storyboard', 'assets', 'music', 'scenes')`)).catch(() => undefined);

  const runStoryboard = (id: string, ws: string, input: Row['input']) => {
    const ctrl = new AbortController(); running.set(id, ctrl);
    void (async () => {
      try {
        const model = await modelFor(db, box, ws, 'storyboard', fetchImpl);
        await set(id, { models: { storyboard: model.label } });
        const sb = await generateStoryboard(model, input.text, input, logStep(id));
        if (ctrl.signal.aborted) return;
        await set(id, { storyboard: sb, status: 'review', scenes_total: sb.scenes.length });
        if (!input.review) runScenes(id, ws, sb);
      } catch (e) { if (!ctrl.signal.aborted) await failed(id, failure(e)); }
      finally { if (running.get(id) === ctrl) running.delete(id); } // with review: false, runScenes has taken over the entry
    })();
  };

  const runScenes = (id: string, ws: string, sb: Storyboard) => {
    const ctrl = new AbortController(); running.set(id, ctrl);
    void (async () => {
      try {
        // 1. the drawings (kept on the job: a retry after a failure does not draw them again)
        let assets = (await load(id))?.assets ?? null;
        const briefs = briefsOf(sb), drawnFallbacks: string[] = [];
        if (!assets || briefs.some((b) => !assets![b.id])) {
          await set(id, { status: 'assets', assets_done: 0, assets_total: briefs.length, fallbacks: [] });
          const painter = await drawingModel(db, box, ws, fetchImpl), pictures = await paintersOf(ws);
          await set(id, { models: { ...((await load(id))?.models ?? {}), assets: painter.label, ...(pictures ? { images: pictures.label } : {}) } });
          let drawnCount = 0, progress: Promise<unknown> = Promise.resolve();
          const r = await generateDrawings(painter, sb, {
            ...draw, ...(pictures ? { paint: pictures.paint } : {}), concurrency: 2, signal: ctrl.signal, onStep: logStep(id),
            onAsset: (a) => { drawnCount++; if (a.fallback) drawnFallbacks.push(`dessin ${a.id}`); const now = { assets_done: drawnCount, fallbacks: [...drawnFallbacks] }; progress = progress.then(() => set(id, now)).catch(() => undefined); },
          });
          await progress;
          if (ctrl.signal.aborted) return;
          assets = r.assets;
          await set(id, { assets, assets_done: briefs.length });
        }
        // 2. the music and the sounds (kept on the job too)
        let audio = (await load(id))?.audio ?? null;
        if (!audio) {
          await set(id, { status: 'music', fallbacks: drawnFallbacks });
          const composer = await musicModel(db, box, ws, fetchImpl);
          await set(id, { models: { ...((await load(id))?.models ?? {}), music: composer.label } });
          audio = await generateSound(composer, sb, logStep(id));
          if (ctrl.signal.aborted) return;
          await set(id, { audio });
        }
        drawnFallbacks.push(...audio.fallbacks);
        // 3. the scenes, with them
        await set(id, { status: 'scenes', scenes_done: 0, scenes_total: sb.scenes.length, fallbacks: drawnFallbacks });
        const model = await modelFor(db, box, ws, 'scenes', fetchImpl);
        const models = (await load(id))?.models ?? {};
        await set(id, { models: { ...models, scenes: model.label } });
        // progress writes go one after the other: on a pool, two in flight could land in the wrong order
        let done = 0, progress: Promise<unknown> = Promise.resolve(); const fallbacks: string[] = [...drawnFallbacks];
        const { project } = await generateScenes(model, sb, assets!, { audio,
          concurrency: 2, signal: ctrl.signal, onStep: logStep(id),
          onScene: (_i, r) => {
            done++; if (r.fallback) fallbacks.push(r.scene.id);
            const now = { scenes_done: done, fallbacks: [...fallbacks] };
            progress = progress.then(() => set(id, now)).catch(() => undefined);
          },
        });
        await progress;
        if (ctrl.signal.aborted) return;
        const pid = randomUUID(), data = JSON.stringify(project), by = (await load(id))?.created_by ?? null;
        await db.tx(async (q) => {
          await q.query('INSERT INTO projects (id, title, data, workspace_id, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5)', [pid, project.title, data, ws, by]);
          await q.query('INSERT INTO project_versions (project_id, version, data, created_by) VALUES ($1, 1, $2, $3)', [pid, data, by]);
        });
        await set(id, { status: 'done', project_id: pid, scenes_done: done, fallbacks });
      } catch (e) { if (!ctrl.signal.aborted) await failed(id, failure(e)); }
      finally { if (running.get(id) === ctrl) running.delete(id); }
    })();
  };

  app.post('/api/generations', { config: { role: 'editor' } }, async (req, reply) => {
    const b = Input.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'requête invalide' });
    if (!stylePacks[b.data.style]) return reply.code(400).send({ error: `style inconnu : ${b.data.style}` });
    const ws = wsOf(req).id;
    // a film generated this month more, and room for the project it makes
    await quota.ensure(ws, 'generations'); await quota.ensure(ws, 'projects');
    try { await modelFor(db, box, ws, 'storyboard', fetchImpl); await modelFor(db, box, ws, 'scenes', fetchImpl); }
    catch (e) { if (e instanceof NotConfigured) return reply.code(400).send({ error: e.message }); throw e; }
    const id = randomUUID();
    await db.query('INSERT INTO generations (id, status, input, workspace_id, created_by) VALUES ($1, $2, $3, $4, $5)', [id, 'storyboard', JSON.stringify(b.data), ws, userOf(req).id]);
    await quota.record(ws, 'generations', 1, id, userOf(req).id);
    runStoryboard(id, ws, b.data);
    return reply.code(202).send(view((await load(id))!));
  });

  app.get('/api/generations', { config: { role: 'viewer' } }, async (req) => (await db.query<Row>('SELECT * FROM generations WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 20', [wsOf(req).id])).rows.map(view));

  app.get('/api/generations/:id', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), r = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    return r ? view(r) : reply.code(404).send({ error: 'génération introuvable' });
  });

  app.put('/api/generations/:id/storyboard', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), r = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    if (!r) return reply.code(404).send({ error: 'génération introuvable' });
    if (r.status !== 'review') return reply.code(409).send({ error: 'le storyboard ne se modifie qu\'en relecture' });
    const sb = Storyboard.safeParse((req.body as { storyboard?: unknown })?.storyboard);
    if (!sb.success) return reply.code(422).send({ error: 'storyboard invalide', issues: sb.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    await set(r.id, { storyboard: sb.data, scenes_total: sb.data.scenes.length, assets: null, audio: null, assets_total: briefsOf(sb.data).length }); // changed: draw and compose again
    return view((await load(r.id))!);
  });

  app.post('/api/generations/:id/storyboard/retry', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), r = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    if (!r) return reply.code(404).send({ error: 'génération introuvable' });
    if (!['review', 'failed', 'canceled'].includes(r.status) || r.project_id) return reply.code(409).send({ error: 'impossible à cette étape' });
    const extra = z.object({ instructions: z.string().max(2000).optional() }).safeParse(req.body ?? {});
    const input = { ...r.input, ...(extra.success && extra.data.instructions ? { instructions: extra.data.instructions } : {}) };
    if (r.status !== 'review') { await quota.ensure(r.workspace_id, 'generations'); await quota.refund(r.id); await quota.record(r.workspace_id, 'generations', 1, r.id, userOf(req).id); }
    await set(r.id, { status: 'storyboard', error: null, input, storyboard: null });
    runStoryboard(r.id, r.workspace_id, input);
    return view((await load(r.id))!);
  });

  app.post('/api/generations/:id/scenes', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), r = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    if (!r) return reply.code(404).send({ error: 'génération introuvable' });
    const sb = Storyboard.safeParse(r.storyboard);
    if (!['review', 'failed'].includes(r.status) || !sb.success || r.project_id) return reply.code(409).send({ error: 'relisez d\'abord le storyboard' });
    await quota.ensure(r.workspace_id, 'projects');
    if (r.status === 'failed') { await quota.ensure(r.workspace_id, 'generations'); await quota.refund(r.id); await quota.record(r.workspace_id, 'generations', 1, r.id, userOf(req).id); }
    await set(r.id, { status: 'assets', error: null });
    runScenes(r.id, r.workspace_id, sb.data);
    return view((await load(r.id))!);
  });

  app.post('/api/generations/:id/cancel', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), r = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    if (!r) return reply.code(404).send({ error: 'génération introuvable' });
    running.get(r.id)?.abort(); running.delete(r.id);
    if (['storyboard', 'assets', 'music', 'scenes'].includes(r.status)) { await set(r.id, { status: 'canceled' }); await quota.refund(r.id); }
    return view((await load(r.id))!);
  });

  // ask the model to change one scene of a project being edited (the editor applies the result to its draft)
  app.post('/api/ai/edit-scene', { config: { role: 'editor' } }, async (req, reply) => {
    const b = z.object({ project: z.unknown(), sceneIndex: z.number().int().min(0), instruction: z.string().trim().min(3).max(2000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'requête invalide' });
    const parsed = parseProject(b.data.project);
    if (!parsed.ok) return reply.code(422).send({ error: 'projet invalide', issues: parsed.issues });
    await quota.ensure(wsOf(req).id, 'aiActions');
    let model, painter, pictures;
    try { model = await modelFor(db, box, wsOf(req).id, 'scenes', fetchImpl); painter = await drawingModel(db, box, wsOf(req).id, fetchImpl); pictures = await paintersOf(wsOf(req).id); }
    catch (e) { if (e instanceof NotConfigured) return reply.code(400).send({ error: e.message }); throw e; }
    const usage = { inputTokens: 0, outputTokens: 0 }, onStep = (s: Step) => { usage.inputTokens += s.usage.inputTokens; usage.outputTokens += s.usage.outputTokens; };
    try {
      // what the change needs and the film does not have is drawn first
      const r = await editScene(model, parsed.project, b.data.sceneIndex, b.data.instruction, { onStep, drawModel: painter, draw: { ...draw, ...(pictures ? { paint: pictures.paint } : {}) } });
      await quota.record(wsOf(req).id, 'aiActions', 1, null, userOf(req).id);
      return { scene: r.scene, assets: r.assets, cast: r.cast, sounds: r.sounds, drawn: r.drawn.map((d) => ({ id: d.id, fallback: d.fallback, rounds: d.rounds, review: d.review })), usage, model: model.label };
    } catch (e) {
      if (e instanceof InvalidAnswer) return reply.code(422).send({ error: e.message, issues: e.issues, usage });
      if (e instanceof ModelError) return reply.code(502).send({ error: e.message, usage });
      throw e;
    }
  });

  // draw one thing for a project, or draw it again with a change (the editor's « Dessins » tab)
  app.post('/api/ai/draw', { config: { role: 'editor' } }, async (req, reply) => {
    const b = z.object({
      project: z.unknown(), id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/), kind: z.enum(['character', 'prop', 'decor']),
      name: z.string().trim().min(1).max(80), description: z.string().trim().min(3).max(800), instruction: z.string().trim().max(2000).optional(), current: z.unknown().optional(),
      /** a decor: also paint it as a picture when an image model is chosen (default) */
      picture: z.boolean().default(true),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'requête invalide' });
    const parsed = parseProject(b.data.project);
    if (!parsed.ok) return reply.code(422).send({ error: 'projet invalide', issues: parsed.issues });
    const current = b.data.current === undefined ? undefined : Asset.safeParse(b.data.current);
    if (current && !current.success) return reply.code(422).send({ error: 'dessin actuel invalide' });
    let painter, pictures;
    await quota.ensure(wsOf(req).id, 'aiActions');
    if (b.data.picture) { await quota.feature(wsOf(req).id, 'decorImages'); await quota.ensure(wsOf(req).id, 'storageMb', 0); }
    try { painter = await drawingModel(db, box, wsOf(req).id, fetchImpl); pictures = b.data.picture ? await painterOf(db, box, wsOf(req).id, imagesDir, fetchImpl) : undefined; }
    catch (e) { if (e instanceof NotConfigured) return reply.code(400).send({ error: e.message }); throw e; }
    const usage = { inputTokens: 0, outputTokens: 0 };
    const p = parsed.project, others = Object.entries(p.assets).filter(([id]) => id !== b.data.id).map(([id, a]) => ({ id, kind: a.kind, name: a.name, description: a.description }));
    try {
      const r = await drawOne(painter, { id: b.data.id, kind: b.data.kind, name: b.data.name, description: b.data.description }, { title: p.title, style: p.style, others },
        { ...draw, ...(pictures ? { paint: pictures.paint } : {}), onStep: (s) => { usage.inputTokens += s.usage.inputTokens; usage.outputTokens += s.usage.outputTokens; } }, b.data.instruction, current?.success ? current.data : undefined);
      await quota.record(wsOf(req).id, 'aiActions', 1, null, userOf(req).id); quota.touched(wsOf(req).id);
      return { asset: r.asset, fallback: r.fallback, rounds: r.rounds, review: r.review, issues: r.issues, usage, model: painter.label };
    } catch (e) {
      if (e instanceof ModelError) return reply.code(502).send({ error: e.message, usage });
      throw e;
    }
  });

  // compose the music of a project again (the editor's « Musique » tab): every scene, or with a direction
  app.post('/api/ai/compose', { config: { role: 'editor' } }, async (req, reply) => {
    const b = z.object({ project: z.unknown(), instruction: z.string().trim().max(2000).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'requête invalide' });
    const parsed = parseProject(b.data.project);
    if (!parsed.ok) return reply.code(422).send({ error: 'projet invalide', issues: parsed.issues });
    let composer;
    await quota.ensure(wsOf(req).id, 'aiActions');
    try { composer = await musicModel(db, box, wsOf(req).id, fetchImpl); } catch (e) { if (e instanceof NotConfigured) return reply.code(400).send({ error: e.message }); throw e; }
    const p = parsed.project, tl = timeProject(p), usage = { inputTokens: 0, outputTokens: 0 };
    // what each scene wants: its current piece's description, the direction given, its title
    const sb = { title: p.title, language: p.language, scenes: p.scenes.map((s, i) => {
      const cur = p.score[s.music.mood];
      return { id: s.id, title: s.title, duration: Math.round(tl.scenes[i]!.duration), music: [cur ? `${cur.name}: ${cur.description}` : s.music.mood, b.data.instruction].filter(Boolean).join(' — ') };
    }) } as unknown as Storyboard;
    try {
      const r = await composeScore(composer, sb, (st) => { usage.inputTokens += st.usage.inputTokens; usage.outputTokens += st.usage.outputTokens; });
      await quota.record(wsOf(req).id, 'aiActions', 1, null, userOf(req).id);
      return { score: r.score, music: r.music, fallback: r.fallback, issues: r.issues, usage, model: composer.label };
    } catch (e) { if (e instanceof ModelError) return reply.code(502).send({ error: e.message, usage }); throw e; }
  });

  // design one sound effect for a project
  app.post('/api/ai/sound', { config: { role: 'editor' } }, async (req, reply) => {
    const b = z.object({ project: z.unknown(), id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/), name: z.string().trim().min(1).max(80), description: z.string().trim().min(3).max(800) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'requête invalide' });
    const parsed = parseProject(b.data.project);
    if (!parsed.ok) return reply.code(422).send({ error: 'projet invalide', issues: parsed.issues });
    let composer;
    await quota.ensure(wsOf(req).id, 'aiActions');
    try { composer = await musicModel(db, box, wsOf(req).id, fetchImpl); } catch (e) { if (e instanceof NotConfigured) return reply.code(400).send({ error: e.message }); throw e; }
    const usage = { inputTokens: 0, outputTokens: 0 };
    try {
      const r = await designSounds(composer, [{ id: b.data.id, name: b.data.name, description: b.data.description }], parsed.project.title, (st) => { usage.inputTokens += st.usage.inputTokens; usage.outputTokens += st.usage.outputTokens; });
      await quota.record(wsOf(req).id, 'aiActions', 1, null, userOf(req).id);
      return { sound: r.sounds[b.data.id], fallback: r.fallbacks.length > 0, issues: r.issues, usage, model: composer.label };
    } catch (e) { if (e instanceof ModelError) return reply.code(502).send({ error: e.message, usage }); throw e; }
  });
}
