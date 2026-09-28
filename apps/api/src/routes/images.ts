// Pictures: decors painted by the image model chosen for « Décors en images » (optional). A picture is stored once
// per workspace, named by what it contains (JPEG, at most 2560 px wide), and reached through signed links, like
// recorded lines. The project only holds its id and size: without the picture, the decor's drawing shows.
import { picturePrompt, type AssetBrief, type Picture } from '@af/ai';
import { normalizePicture } from '@af/render';
import type { JsonPost } from '@af/providers';
import { pictureAssetsOf, type Project } from '@af/schema';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { imageModel, NotConfigured, type ImageModel } from '../ai/models';
import { userOf, wsOf } from '../auth/context';
import type { Quotas } from '../plans';
import type { SecretBox } from '../crypto';
import type { Db } from '../db';
import { sendFile } from '../files';
import type { Signer } from '../render/sign';

const AssetId = z.string().regex(/^[0-9a-f]{32}$/);
/** where a picture is: JPEG, or PNG for an imported one with transparency (links always say .jpg: the file decides) */
export const imageFile = (dir: string, ws: string, asset: string) => { const png = join(dir, ws, `${asset}.png`); return existsSync(png) ? png : join(dir, ws, `${asset}.jpg`); };
export const imageMime = (file: string) => (file.endsWith('.png') ? 'image/png' : 'image/jpeg');

/** the stored pictures a project shows (asset id → file), for the server renderers */
export function imagesOf(dir: string, ws: string, project: Pick<Project, 'assets'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of pictureAssetsOf(project)) {
    const f = imageFile(dir, ws, a);
    if (existsSync(f)) out[a] = f;
  }
  return out;
}

/** paint with the workspace's image model and store the result: what drawOne's `paint` needs */
export function painter(model: ImageModel, dir: string, ws: string): (b: AssetBrief, prompt: string) => Promise<Picture> {
  return async (_b, prompt) => {
    const r = await model.paint(prompt);
    if (!r.ok) return { ok: false, error: r.error };
    let pic: Awaited<ReturnType<typeof normalizePicture>>;
    try { pic = await normalizePicture(r.data); } catch (e) { return { ok: false, error: (e as Error).message }; }
    const asset = createHash('sha256').update(ws).update(pic.data).digest('hex').slice(0, 32), file = imageFile(dir, ws, asset);
    mkdirSync(join(dir, ws), { recursive: true });
    if (!existsSync(file)) { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, pic.data); renameSync(tmp, file); }
    return { ok: true, image: { asset, width: pic.width, height: pic.height, by: model.label } };
  };
}

/** the painter of a workspace, or undefined when no image model is chosen */
export async function painterOf(db: Db, box: SecretBox, ws: string, dir: string, fetchImpl?: JsonPost) {
  const m = await imageModel(db, box, ws, fetchImpl);
  return m ? { label: m.label, paint: painter(m, dir, ws) } : undefined;
}

export function imageRoutes(app: FastifyInstance, db: Db, box: SecretBox, sign: Signer, dir: string, fetchImpl: JsonPost | undefined, quota: Quotas) {
  mkdirSync(dir, { recursive: true });
  const link = (ws: string, asset: string) => `/api/images/${ws}/${asset}.jpg?${sign.sign(`image:${ws}:${asset}`)}`;

  // paint (or paint again) one decor: the editor's « Dessins » tab
  app.post('/api/ai/decor-image', { config: { role: 'editor' } }, async (req, reply) => {
    const b = z.object({
      name: z.string().trim().min(1).max(80), description: z.string().trim().min(3).max(800), instruction: z.string().trim().max(2000).optional(),
      style: z.string().max(40).default('watercolor'), palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(10).optional(),
    }).safeParse(req.body), ws = wsOf(req).id;
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'requête invalide' });
    await quota.feature(ws, 'decorImages'); await quota.ensure(ws, 'aiActions'); await quota.ensure(ws, 'storageMb', 0);
    let p;
    try { p = await painterOf(db, box, ws, dir, fetchImpl); } catch (e) { if (e instanceof NotConfigured) return reply.code(400).send({ error: e.message }); throw e; }
    if (!p) return reply.code(400).send({ error: 'aucun modèle pour « Décors en images » : Réglages → Fournisseurs' });
    const d = b.data, description = d.instruction ? `${d.description} ${d.instruction}` : d.description;
    const r = await p.paint({ id: 'decor', kind: 'decor', name: d.name, description }, picturePrompt({ name: d.name, description }, { style: d.style, palette: d.palette }));
    if (!r.ok) return reply.code(502).send({ error: r.error });
    await quota.record(ws, 'aiActions', 1, null, userOf(req).id); quota.touched(ws);
    return { image: r.image, url: link(ws, r.image.asset), model: p.label };
  });

  // signed links for a project's pictures (the editor's preview loads them)
  app.post('/api/images/links', { config: { role: 'viewer' } }, async (req, reply) => {
    const b = z.object({ assets: z.array(AssetId).max(500) }).safeParse(req.body), ws = wsOf(req).id;
    if (!b.success) return reply.code(400).send({ error: 'liste invalide' });
    return Object.fromEntries(b.data.assets.filter((x) => existsSync(imageFile(dir, ws, x))).map((x) => [x, link(ws, x)]));
  });

  app.get('/api/images/:ws/:file', { config: { auth: 'public' } }, async (req, reply) => {
    const { ws, file: name } = req.params as { ws: string; file: string };
    const m = /^([0-9a-f]{32})\.(?:jpg|png)$/.exec(name), q = req.query as { exp?: string; sig?: string };
    if (!m || !z.string().uuid().safeParse(ws).success || !sign.verify(`image:${ws}:${m[1]}`, q.exp, q.sig)) return reply.code(403).send({ error: 'lien expiré ou invalide' });
    const file = imageFile(dir, ws, m[1]!);
    if (!existsSync(file)) return reply.code(404).send({ error: 'image introuvable' });
    return sendFile(req, reply, file, imageMime(file));
  });
}

/** a picture of the workspace as a model sees it: at most 1024 px on its longer side, PNG (transparency kept) */
export async function modelPicture(dir: string, ws: string, asset: string): Promise<{ mediaType: 'image/png'; data: string } | null> {
  const file = imageFile(dir, ws, asset);
  if (!existsSync(file)) return null;
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(readFileSync(file)), k = Math.min(1, 1024 / Math.max(img.width, img.height));
  const c = createCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { mediaType: 'image/png', data: c.toBuffer('image/png').toString('base64') };
}
