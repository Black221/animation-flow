// Thumbnails: one frame of a project (or of a template), rendered here by the same engine as the videos, for the
// project cards. Kept in memory by version (a new save gives a new image), rendered one at a time so a page full of
// cards does not hold the server up.
import { timeProject } from '@af/engine';
import { renderStill } from '@af/render';
import { parseProject, type Project } from '@af/schema';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { wsOf } from '../auth/context';
import type { Db } from '../db';
import { TEMPLATES } from '../templates';
import { imagesOf } from './images';

const WIDTH = 480, KEEP = 300;

/** a frame that shows the film: well into a scene (the first by default), once things have appeared */
export const thumbnailTime = (p: Project, scene = 0) => { const s = timeProject(p).scenes[scene]; return s ? s.start + Math.min(s.duration * 0.6, 2.5) : 0; };

export type Thumbnailer = (key: string, project: Project, images: Record<string, string>) => Promise<Buffer>;
/** `shared`: an image anyone may see (the community); otherwise only the signed-in browser keeps it */
export const sendPng = (reply: FastifyReply, png: Buffer, immutable: boolean, shared = false) =>
  reply.type('image/png').header('cache-control', `${shared ? 'public' : 'private'}, ${immutable ? 'max-age=31536000, immutable' : 'max-age=60'}`).send(png);

export function thumbnailRoutes(app: FastifyInstance, db: Db, imagesDir: string, fontsDir?: string): Thumbnailer {
  const cache = new Map<string, Buffer>();
  let queue: Promise<unknown> = Promise.resolve();
  const render = (key: string, project: Project, images: Record<string, string>, scene = 0) => {
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return Promise.resolve(hit); }
    const job = queue.then(async () => {
      const png = await renderStill(project, { t: thumbnailTime(project, scene), width: WIDTH, images, ...(fontsDir ? { fontsDir } : {}) });
      cache.set(key, png);
      while (cache.size > KEEP) cache.delete(cache.keys().next().value!);
      return png;
    });
    queue = job.catch(() => undefined);
    return job;
  };
  const send = sendPng;

  app.get('/api/projects/:id/thumbnail.png', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = z.object({ id: z.string().uuid() }).safeParse(req.params), ws = wsOf(req).id;
    if (!p.success) return reply.code(404).send({ error: 'projet introuvable' });
    const { rows } = await db.query<{ data: unknown; version: number }>('SELECT data, version FROM projects WHERE id = $1 AND workspace_id = $2', [p.data.id, ws]);
    const parsed = rows[0] ? parseProject(rows[0].data) : null;
    if (!rows[0] || !parsed?.ok) return reply.code(404).send({ error: 'projet introuvable' });
    const png = await render(`${p.data.id}:${rows[0].version}`, parsed.project, imagesOf(imagesDir, ws, parsed.project));
    // the link names the version (?v=): that image never changes
    return send(reply, png, (req.query as { v?: string }).v === String(rows[0].version));
  });

  // public, like the templates themselves: the sign-in page shows one as a storyboard (?scene=: a frame of that scene;
  // a few images per template at most, each rendered once)
  app.get('/api/templates/:name/thumbnail.png', { config: { auth: 'public' } }, async (req, reply) => {
    const name = (req.params as { name: string }).name, make = TEMPLATES[name];
    const parsed = make ? parseProject(make()) : null;
    if (!parsed?.ok) return reply.code(404).send({ error: 'modèle inconnu' });
    const scene = z.coerce.number().int().min(0).max(parsed.project.scenes.length - 1).catch(-1).parse((req.query as { scene?: string }).scene ?? 0);
    if (scene < 0) return reply.code(404).send({ error: 'scène inconnue' });
    return send(reply, await render(`template:${name}:${scene}`, parsed.project, {}, scene), false, true);
  });
  return render;
}
