// AI generation jobs. A job runs in the API process (the model calls are network-bound): storyboard first, then,
// once the user has reviewed it (or at once with review: false), every scene, and a new project at the end.
// Progress, token counts and every model call (with the problems found in its answer) are kept on the job.
import { editScene, generateScenes, generateStoryboard, InvalidAnswer, ModelError, Storyboard, type Step } from '@af/ai';
import type { JsonPost } from '@af/providers';
import { parseProject } from '@af/schema';
import { stylePacks } from '@af/styles';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { modelFor, NotConfigured } from '../ai/models';
import type { SecretBox } from '../crypto';
import { userOf, wsOf } from '../auth/context';
import type { Db } from '../db';

type Status = 'storyboard' | 'review' | 'scenes' | 'done' | 'failed' | 'canceled';
interface Row {
  id: string; workspace_id: string; created_by: string | null; status: Status; input: { text: string; language: string; style: string; targetSeconds?: number; instructions?: string; review: boolean };
  storyboard: unknown; project_id: string | null; scenes_done: number; scenes_total: number; steps: unknown[]; fallbacks: string[];
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

export function generationRoutes(app: FastifyInstance, db: Db, box: SecretBox, fetchImpl?: JsonPost) {
  const running = new Map<string, AbortController>();
  const view = (r: Row) => ({
    id: r.id, status: r.status, input: r.input, storyboard: r.storyboard, projectId: r.project_id, scenesDone: r.scenes_done, scenesTotal: r.scenes_total,
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
  void db.query(`UPDATE generations SET status = 'failed', error = 'interrompue par un redémarrage du serveur', updated_at = now() WHERE status IN ('storyboard', 'scenes')`).catch(() => undefined);

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
      } catch (e) { if (!ctrl.signal.aborted) await set(id, { status: 'failed', error: failure(e) }); }
      finally { if (running.get(id) === ctrl) running.delete(id); } // with review: false, runScenes has taken over the entry
    })();
  };

  const runScenes = (id: string, ws: string, sb: Storyboard) => {
    const ctrl = new AbortController(); running.set(id, ctrl);
    void (async () => {
      try {
        await set(id, { status: 'scenes', scenes_done: 0, scenes_total: sb.scenes.length, fallbacks: [] });
        const model = await modelFor(db, box, ws, 'scenes', fetchImpl);
        const models = (await load(id))?.models ?? {};
        await set(id, { models: { ...models, scenes: model.label } });
        // progress writes go one after the other: on a pool, two in flight could land in the wrong order
        let done = 0, progress: Promise<unknown> = Promise.resolve(); const fallbacks: string[] = [];
        const { project } = await generateScenes(model, sb, {
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
      } catch (e) { if (!ctrl.signal.aborted) await set(id, { status: 'failed', error: failure(e) }); }
      finally { if (running.get(id) === ctrl) running.delete(id); }
    })();
  };

  app.post('/api/generations', { config: { role: 'editor' } }, async (req, reply) => {
    const b = Input.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'requête invalide' });
    if (!stylePacks[b.data.style]) return reply.code(400).send({ error: `style inconnu : ${b.data.style}` });
    const ws = wsOf(req).id;
    try { await modelFor(db, box, ws, 'storyboard', fetchImpl); await modelFor(db, box, ws, 'scenes', fetchImpl); }
    catch (e) { if (e instanceof NotConfigured) return reply.code(400).send({ error: e.message }); throw e; }
    const id = randomUUID();
    await db.query('INSERT INTO generations (id, status, input, workspace_id, created_by) VALUES ($1, $2, $3, $4, $5)', [id, 'storyboard', JSON.stringify(b.data), ws, userOf(req).id]);
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
    await set(r.id, { storyboard: sb.data, scenes_total: sb.data.scenes.length });
    return view((await load(r.id))!);
  });

  app.post('/api/generations/:id/storyboard/retry', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), r = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    if (!r) return reply.code(404).send({ error: 'génération introuvable' });
    if (!['review', 'failed', 'canceled'].includes(r.status) || r.project_id) return reply.code(409).send({ error: 'impossible à cette étape' });
    const extra = z.object({ instructions: z.string().max(2000).optional() }).safeParse(req.body ?? {});
    const input = { ...r.input, ...(extra.success && extra.data.instructions ? { instructions: extra.data.instructions } : {}) };
    await set(r.id, { status: 'storyboard', error: null, input, storyboard: null });
    runStoryboard(r.id, r.workspace_id, input);
    return view((await load(r.id))!);
  });

  app.post('/api/generations/:id/scenes', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), r = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    if (!r) return reply.code(404).send({ error: 'génération introuvable' });
    const sb = Storyboard.safeParse(r.storyboard);
    if (!['review', 'failed'].includes(r.status) || !sb.success || r.project_id) return reply.code(409).send({ error: 'relisez d\'abord le storyboard' });
    runScenes(r.id, r.workspace_id, sb.data);
    await set(r.id, { status: 'scenes', error: null });
    return view((await load(r.id))!);
  });

  app.post('/api/generations/:id/cancel', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), r = p.success ? await load(p.data.id, wsOf(req).id) : undefined;
    if (!r) return reply.code(404).send({ error: 'génération introuvable' });
    running.get(r.id)?.abort(); running.delete(r.id);
    if (r.status === 'storyboard' || r.status === 'scenes') await set(r.id, { status: 'canceled' });
    return view((await load(r.id))!);
  });

  // ask the model to change one scene of a project being edited (the editor applies the result to its draft)
  app.post('/api/ai/edit-scene', { config: { role: 'editor' } }, async (req, reply) => {
    const b = z.object({ project: z.unknown(), sceneIndex: z.number().int().min(0), instruction: z.string().trim().min(3).max(2000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'requête invalide' });
    const parsed = parseProject(b.data.project);
    if (!parsed.ok) return reply.code(422).send({ error: 'projet invalide', issues: parsed.issues });
    let model;
    try { model = await modelFor(db, box, wsOf(req).id, 'scenes', fetchImpl); } catch (e) { if (e instanceof NotConfigured) return reply.code(400).send({ error: e.message }); throw e; }
    const usage = { inputTokens: 0, outputTokens: 0 };
    try {
      const scene = await editScene(model, parsed.project, b.data.sceneIndex, b.data.instruction, (s) => { usage.inputTokens += s.usage.inputTokens; usage.outputTokens += s.usage.outputTokens; });
      return { scene, usage, model: model.label };
    } catch (e) {
      if (e instanceof InvalidAnswer) return reply.code(422).send({ error: e.message, issues: e.issues, usage });
      if (e instanceof ModelError) return reply.code(502).send({ error: e.message, usage });
      throw e;
    }
  });
}
