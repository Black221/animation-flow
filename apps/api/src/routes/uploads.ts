// Files people bring to the AI with their prompt, as MODELS: a picture (a character, an object, a place, a look) the
// AI draws after, a music it listens to and composes in the spirit of. Nothing brought is put in a film as it is.
// And a project as one file, to keep or to give (its export).
//
// Nothing is kept as it came. A picture is decoded and drawn again (PNG when it has transparency, JPEG otherwise, at
// most 2560 px): no metadata, nothing hidden; it is kept in the workspace's folder, named by its content, for the
// generation to show it to the models. A music is recognised by its first bytes, decoded by FFmpeg from a local copy
// with that format named (a playlist or a link inside it is never followed), described (tempo, key, energy) and
// forgotten: only the description is returned.
import { describeMusic, musicFeatures } from '@af/audio';
import { decodeUpload, normalizeUpload } from '@af/render';
import { parseProject, pictureAssetsOf, soundAssetsOf } from '@af/schema';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { wsOf } from '../auth/context';
import type { Db } from '../db';
import type { Quotas } from '../plans';
import type { Signer } from '../render/sign';
import { imageFile } from './images';
import { voiceFile } from './voices';

export const LIMITS = {
  imageBytes: 15 * 1024 * 1024,
  audioBytes: 60 * 1024 * 1024,
  /** how much of a music is listened to */
  musicSeconds: 600,
};
const idOf = (ws: string, kind: string, data: Uint8Array) => createHash('sha256').update(kind).update(ws).update(data).digest('hex').slice(0, 32);
const mb = (bytes: number) => bytes / 1e6;
const put = (file: string, data: Uint8Array) => { if (existsSync(file)) return; const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, data); renameSync(tmp, file); };

export function uploadRoutes(app: FastifyInstance, db: Db, sign: Signer, dirs: { voicesDir: string; imagesDir: string }, quota: Quotas) {
  const imageLink = (ws: string, asset: string) => `/api/images/${ws}/${asset}.jpg?${sign.sign(`image:${ws}:${asset}`)}`;

  /** store a picture; returns its id */
  const storeImage = async (ws: string, bytes: Uint8Array) => {
    const pic = await normalizeUpload(bytes), asset = idOf(ws, 'image', pic.data);
    mkdirSync(join(dirs.imagesDir, ws), { recursive: true });
    if (!existsSync(imageFile(dirs.imagesDir, ws, asset))) put(join(dirs.imagesDir, ws, `${asset}.${pic.ext}`), pic.data);
    return { asset, pic };
  };

  app.register(async (s) => {
    // the file itself is the body; its type is read from its bytes, not from what the browser says
    s.addContentTypeParser(/^(image|audio|video)\/|^application\/octet-stream/, { parseAs: 'buffer', bodyLimit: LIMITS.audioBytes }, (_req, body, done) => done(null, body));

    s.post('/api/uploads/image', { config: { role: 'editor' }, bodyLimit: LIMITS.imageBytes }, async (req, reply) => {
      const body = req.body, ws = wsOf(req).id;
      if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ error: 'aucun fichier reçu' });
      await quota.ensure(ws, 'storageMb', mb(body.length));
      let r: Awaited<ReturnType<typeof storeImage>>;
      try { r = await storeImage(ws, body); } catch (e) { return reply.code(415).send({ error: (e as Error).message }); }
      quota.touched(ws);
      return reply.code(201).send({ asset: r.asset, width: r.pic.width, height: r.pic.height, alpha: r.pic.alpha, color: r.pic.color, url: imageLink(ws, r.asset) });
    });

    // a music brought as a model for the AI: listened to, described, not kept
    s.post('/api/uploads/audio', { config: { role: 'editor' }, bodyLimit: LIMITS.audioBytes }, async (req, reply) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ error: 'aucun fichier reçu' });
      let d: Awaited<ReturnType<typeof decodeUpload>>;
      try { d = await decodeUpload(body, { rate: 11025, maxSeconds: LIMITS.musicSeconds }); } catch (e) { return reply.code(415).send({ error: (e as Error).message }); }
      if (d.samples.length < 11025 * 2) return reply.code(422).send({ error: 'le son est vide ou trop court' });
      const features = musicFeatures(d.samples, 11025);
      return { duration: Math.round(features.seconds * 10) / 10, features, summary: describeMusic(features) };
    });
  });

  // ---------------------------------------------------------------- a project as one file, with its media
  app.get('/api/projects/:id/export', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = z.object({ id: z.string().uuid() }).safeParse(req.params), q = z.object({ media: z.enum(['0', '1']).default('1') }).safeParse(req.query ?? {}), ws = wsOf(req).id;
    if (!p.success || !q.success) return reply.code(404).send({ error: 'projet introuvable' });
    const row = (await db.query<{ data: unknown; title: string }>('SELECT data, title FROM projects WHERE id = $1 AND workspace_id = $2', [p.data.id, ws])).rows[0];
    const parsed = row ? parseProject(row.data) : null;
    if (!row || !parsed?.ok) return reply.code(404).send({ error: 'projet introuvable' });
    const images: Record<string, string> = {}, sounds: Record<string, string> = {};
    if (q.data.media === '1') {
      for (const a of pictureAssetsOf(parsed.project)) { const f = imageFile(dirs.imagesDir, ws, a); if (existsSync(f)) images[a] = readFileSync(f).toString('base64'); }
      for (const a of soundAssetsOf(parsed.project)) { const f = voiceFile(dirs.voicesDir, ws, a); if (existsSync(f)) sounds[a] = readFileSync(f).toString('base64'); }
    }
    const name = (row.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'projet').toLowerCase();
    reply.header('content-disposition', `attachment; filename="${name}.animation.json"`);
    return { format: 'animation-flow', version: 1, exportedAt: new Date().toISOString(), project: parsed.project, media: { images, sounds } };
  });
}
