// Files people bring into a workspace: pictures (a logo, a product, a photo for a decor) and sounds (their own voice
// for a line, a music for the film), and whole projects exported from here with their media.
//
// Nothing is kept as it came. A picture is decoded and drawn again (PNG when it has transparency, JPEG otherwise, at
// most 2560 px): no metadata, nothing hidden. A sound is recognised by its first bytes, decoded by FFmpeg from a
// local copy with that format named (a playlist or a link inside it is never followed) and stored as the 48 kHz WAV
// the mixer reads; a voice is trimmed of its silences and brought to the voices' loudness, like a synthesized one.
// Every file is named by its content in the workspace's folder, and counts in the plan's storage.
import { decodeWav, encodeWav, normalizeVoice, SR, trimSilence } from '@af/audio';
import { checkAgainstLibrary } from '@af/engine';
import { catalog, registry } from '@af/library';
import { decodeUpload, normalizeUpload } from '@af/render';
import { parseProject, pictureAssetsOf, soundAssetsOf, type Project } from '@af/schema';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { userOf, wsOf } from '../auth/context';
import type { Db } from '../db';
import type { Quotas } from '../plans';
import type { Signer } from '../render/sign';
import { imageFile } from './images';
import { voiceFile } from './voices';

export const LIMITS = {
  imageBytes: 15 * 1024 * 1024,
  audioBytes: 60 * 1024 * 1024,
  voiceSeconds: 180,
  musicSeconds: 600,
  /** a project file with its media */
  projectBytes: 200 * 1024 * 1024,
};
const Use = z.object({ use: z.enum(['voice', 'music']).default('voice') });
const Hex = z.string().regex(/^[0-9a-f]{32}$/);
const idOf = (ws: string, kind: string, data: Uint8Array) => createHash('sha256').update(kind).update(ws).update(data).digest('hex').slice(0, 32);
const mb = (bytes: number) => bytes / 1e6;
const put = (file: string, data: Uint8Array) => { if (existsSync(file)) return; const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, data); renameSync(tmp, file); };

/** the export file: the project and, optionally, the pictures and recordings it uses */
const ExportFile = z.object({
  format: z.literal('animation-flow'),
  version: z.literal(1),
  project: z.unknown(),
  media: z.object({
    images: z.record(Hex, z.string().max(30_000_000)).default({}),
    sounds: z.record(Hex, z.string().max(80_000_000)).default({}),
  }).default({ images: {}, sounds: {} }),
});

/** a project with its media ids changed (media imported again get new ids: they are named by their content) */
function remap(p: Project, ids: Map<string, string>): Project {
  const m = (a: string) => ids.get(a) ?? a;
  const assets = Object.fromEntries(Object.entries(p.assets).map(([k, a]) => [k, {
    ...a,
    ...(a.image ? { image: { ...a.image, asset: m(a.image.asset) } } : {}),
    parts: a.parts.map((part) => ({ ...part, shapes: part.shapes.map((s) => (s.type === 'image' ? { ...s, asset: m(s.asset) } : s)) })),
  }]));
  return {
    ...p, assets,
    scenes: p.scenes.map((s) => ({ ...s, narration: s.narration.map((l) => (l.audio ? { ...l, audio: { ...l.audio, asset: m(l.audio.asset) } } : l)) })),
    ...(p.soundtrack ? { soundtrack: { ...p.soundtrack, asset: m(p.soundtrack.asset) } } : {}),
  };
}

export function uploadRoutes(app: FastifyInstance, db: Db, sign: Signer, dirs: { voicesDir: string; imagesDir: string }, quota: Quotas) {
  const imageLink = (ws: string, asset: string) => `/api/images/${ws}/${asset}.jpg?${sign.sign(`image:${ws}:${asset}`)}`;
  const voiceLink = (ws: string, asset: string) => `/api/voices/${ws}/${asset}.wav?${sign.sign(`voice:${ws}:${asset}`)}`;

  /** store a picture; returns its id */
  const storeImage = async (ws: string, bytes: Uint8Array) => {
    const pic = await normalizeUpload(bytes), asset = idOf(ws, 'image', pic.data);
    mkdirSync(join(dirs.imagesDir, ws), { recursive: true });
    if (!existsSync(imageFile(dirs.imagesDir, ws, asset))) put(join(dirs.imagesDir, ws, `${asset}.${pic.ext}`), pic.data);
    return { asset, pic };
  };
  const storeSound = (ws: string, samples: Float32Array) => {
    const wav = encodeWav({ sampleRate: SR, channels: [samples] }, 16), asset = idOf(ws, 'sound', wav);
    mkdirSync(join(dirs.voicesDir, ws), { recursive: true });
    put(voiceFile(dirs.voicesDir, ws, asset), wav);
    return asset;
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

    s.post('/api/uploads/audio', { config: { role: 'editor' }, bodyLimit: LIMITS.audioBytes }, async (req, reply) => {
      const body = req.body, ws = wsOf(req).id, q = Use.safeParse(req.query ?? {});
      if (!q.success) return reply.code(400).send({ error: 'usage : voice ou music' });
      if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ error: 'aucun fichier reçu' });
      const voice = q.data.use === 'voice', max = voice ? LIMITS.voiceSeconds : LIMITS.musicSeconds;
      let decoded: Awaited<ReturnType<typeof decodeUpload>>;
      try { decoded = await decodeUpload(body, { rate: SR, maxSeconds: max }); } catch (e) { return reply.code(415).send({ error: (e as Error).message }); }
      const samples = voice ? normalizeVoice(trimSilence(decoded.samples)) : decoded.samples;
      if (samples.length < SR * 0.2) return reply.code(422).send({ error: 'le son est vide ou trop court' });
      await quota.ensure(ws, 'storageMb', mb(samples.length * 2));
      const asset = storeSound(ws, samples);
      quota.touched(ws);
      return reply.code(201).send({ asset, duration: Math.round((samples.length / SR) * 1000) / 1000, truncated: decoded.truncated, maxSeconds: max, url: voiceLink(ws, asset) });
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

  app.post('/api/projects/import', { config: { role: 'editor' }, bodyLimit: LIMITS.projectBytes }, async (req, reply) => {
    const ws = wsOf(req).id, by = userOf(req).id;
    // a bare project JSON is welcome too
    const raw = req.body as { format?: unknown } | null, file = raw && raw.format === 'animation-flow' ? ExportFile.safeParse(raw) : ExportFile.safeParse({ format: 'animation-flow', version: 1, project: raw });
    if (!file.success) return reply.code(400).send({ error: 'fichier de projet invalide' });
    const parsed = parseProject(file.data.project);
    if (!parsed.ok) return reply.code(422).send({ error: 'projet invalide', issues: parsed.issues.slice(0, 20) });
    await quota.ensure(ws, 'projects');
    // only the media the project uses, each decoded and stored again (a new id when its bytes change)
    const wantedImages = new Set(pictureAssetsOf(parsed.project)), wantedSounds = new Set(soundAssetsOf(parsed.project)), ids = new Map<string, string>(), skipped: string[] = [];
    let bytes = 0;
    for (const v of [...Object.values(file.data.media.images), ...Object.values(file.data.media.sounds)]) bytes += (v.length * 3) / 4;
    await quota.ensure(ws, 'storageMb', mb(bytes));
    for (const [id, b64] of Object.entries(file.data.media.images)) {
      if (!wantedImages.has(id)) continue;
      try { ids.set(id, (await storeImage(ws, Buffer.from(b64, 'base64'))).asset); } catch { skipped.push(id); }
    }
    for (const [id, b64] of Object.entries(file.data.media.sounds)) {
      if (!wantedSounds.has(id)) continue;
      try {
        const wav = decodeWav(Buffer.from(b64, 'base64'));
        if (wav.sampleRate !== SR || !wav.channels[0]) throw new Error('format');
        ids.set(id, storeSound(ws, wav.channels[0]));
      } catch { skipped.push(id); }
    }
    quota.touched(ws);
    const project = remap(parsed.project, ids), again = parseProject(project);
    if (!again.ok) return reply.code(422).send({ error: 'projet invalide', issues: again.issues.slice(0, 20) });
    const id = randomUUID(), data = JSON.stringify(again.project);
    await db.tx(async (q) => {
      await q.query('INSERT INTO projects (id, title, data, workspace_id, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5)', [id, again.project.title, data, ws, by]);
      await q.query('INSERT INTO project_versions (project_id, version, data, created_by) VALUES ($1, 1, $2, $3)', [id, data, by]);
    });
    // what the project names but this workspace does not have (a file exported without its media): drawn or
    // spoken without it, until recorded or imported again
    const missing = [...wantedImages].filter((a) => !existsSync(imageFile(dirs.imagesDir, ws, ids.get(a) ?? a))).length + [...wantedSounds].filter((a) => !existsSync(voiceFile(dirs.voicesDir, ws, ids.get(a) ?? a))).length;
    const count = (w: Set<string>) => [...ids.keys()].filter((k) => w.has(k)).length;
    return reply.code(201).send({ id, title: again.project.title, media: { images: count(wantedImages), sounds: count(wantedSounds), missing, skipped: skipped.length }, warnings: checkAgainstLibrary(again.project, registry, catalog) });
  });
}

