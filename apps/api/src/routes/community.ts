// The community: projects published for everyone to watch and remix.
//
// Publishing freezes the saved project (a copy, not a link: the author keeps editing theirs) and copies what it needs
// to be heard and seen beside it (its recorded lines, its painted decors) into COMMUNITY_DIR/<publication>/, so
// anyone can play it, signed in or not. Publishing the project again replaces the copy. Remixing makes a new project
// in the remixer's workspace from the copy, media included, and remembers where it came from: the remix, once
// published, shows its origin, and the origin counts its remixes. Only names are ever shown of people, never e-mails.
import type { Quotas } from '../plans';
import { timeProject } from '@af/engine';
import { parseProject, voiceIsCurrent, type Project } from '@af/schema';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { RANK, type Role } from '../auth/context';
import { userOf, wsOf } from '../auth/context';
import type { Db } from '../db';
import { sendFile } from '../files';
import { imageFile } from './images';
import { sendPng, type Thumbnailer } from './thumbnails';
import { voiceFile } from './voices';

export const LICENSES = {
  'cc-by': 'CC BY 4.0 — remix libre, en citant l’auteur',
  'cc-by-sa': 'CC BY-SA 4.0 — remix libre, en citant l’auteur, sous la même licence',
  cc0: 'CC0 — domaine public',
} as const;
type License = keyof typeof LICENSES;

interface PubRow {
  id: string; project_id: string | null; workspace_id: string; author_id: string | null; author_name: string | null;
  title: string; description: string; tags: string[]; license: License; data: unknown; project_version: number; duration: number; scenes?: number[]; hidden_at?: Date | null;
  remix_of: string | null; remixes: number; likes: number; views: number; created_at: Date; updated_at: Date;
  parent_title?: string | null; parent_author?: string | null; parent_author_id?: string | null; liked?: boolean;
}
const Uuid = z.object({ id: z.string().uuid() });
export const REPORT_REASONS = ['inappropriate', 'copyright', 'spam', 'other'] as const;
const Tag = z.string().trim().toLowerCase().min(1).max(24).regex(/^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u, 'étiquette : lettres, chiffres, espaces, tirets');
const Meta = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  tags: z.array(Tag).max(6).default([]),
  license: z.enum(Object.keys(LICENSES) as [License, ...License[]]).default('cc-by'),
});
const SELECT = `SELECT p.id, p.project_id, p.workspace_id, p.author_id, u.name AS author_name, p.title, p.description, p.tags, p.license,
  p.project_version, p.duration, p.scenes, p.remix_of, p.hidden_at, p.remixes, p.likes, p.views, p.created_at, p.updated_at,
  o.title AS parent_title, ou.name AS parent_author, o.author_id AS parent_author_id
  FROM publications p LEFT JOIN users u ON u.id = p.author_id
  LEFT JOIN publications o ON o.id = p.remix_of LEFT JOIN users ou ON ou.id = o.author_id`;

const summary = (r: PubRow) => ({
  id: r.id, title: r.title, description: r.description, tags: r.tags, license: r.license, duration: r.duration, scenes: r.scenes ?? [],
  author: r.author_id ? { id: r.author_id, name: r.author_name ?? 'ancien membre' } : null,
  remixOf: r.remix_of ? { id: r.remix_of, title: r.parent_title ?? '', author: r.parent_author ?? null, authorId: r.parent_author_id ?? null } : null,
  remixes: r.remixes, likes: r.likes, views: r.views, liked: !!r.liked, createdAt: r.created_at, updatedAt: r.updated_at, version: r.project_version,
});

/** the media a project needs to be played (current recordings, painted decors) */
const mediaOf = (p: Project) => ({
  voices: [...new Set(p.scenes.flatMap((s) => s.narration.filter(voiceIsCurrent).map((l) => l.audio!.asset)))],
  images: [...new Set(Object.values(p.assets).flatMap((a) => (a.image ? [a.image.asset] : [])))],
});
const dirOf = (root: string, id: string) => join(root, id);
const listMedia = (root: string, id: string, kind: 'voices' | 'images') => {
  const d = join(dirOf(root, id), kind);
  return existsSync(d) ? readdirSync(d).map((f) => f.replace(/\.(wav|jpg)$/, '')) : [];
};

export function communityRoutes(app: FastifyInstance, db: Db, dirs: { voicesDir: string; imagesDir: string; communityDir: string }, thumbnail: Thumbnailer, quota: Quotas) {
  mkdirSync(dirs.communityDir, { recursive: true });
  const me = (req: FastifyRequest) => req.ctx?.user?.id ?? null;
  // films published before their cards showed a timeline: measured once, in the background
  void (async () => {
    const { rows } = await db.query<{ id: string; data: unknown }>(`SELECT id, data FROM publications WHERE scenes = '[]'::jsonb LIMIT 1000`);
    for (const r of rows) {
      const parsed = parseProject(r.data);
      if (parsed.ok) await db.query('UPDATE publications SET scenes = $2 WHERE id = $1', [r.id, JSON.stringify(timeProject(parsed.project).scenes.map((s) => Math.round(s.duration * 10) / 10))]);
    }
  })().catch(() => undefined);

  const load = async (id: string, viewer: string | null) => (await db.query<PubRow>(
    `${SELECT.replace('p.updated_at,', `p.updated_at, ${viewer ? 'EXISTS (SELECT 1 FROM publication_likes l WHERE l.publication_id = p.id AND l.user_id = $2)' : 'false'} AS liked,`)} WHERE p.id = $1`,
    viewer ? [id, viewer] : [id])).rows[0];
  /** the author, or an admin of the workspace it was published from */
  const canManage = async (r: Pick<PubRow, 'author_id' | 'workspace_id'>, user: string | null) => {
    if (!user) return false;
    if (r.author_id === user) return true;
    const m = (await db.query<{ role: Role }>('SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2', [r.workspace_id, user])).rows[0];
    return !!m && RANK[m.role] >= RANK.admin;
  };

  /** copy what a project needs to be played into the publication's folder */
  const copyMedia = (ws: string, pub: string, p: Project) => {
    const root = dirOf(dirs.communityDir, pub), m = mediaOf(p);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, 'voices'), { recursive: true }); mkdirSync(join(root, 'images'), { recursive: true });
    for (const a of m.voices) { const f = voiceFile(dirs.voicesDir, ws, a); if (existsSync(f)) copyFileSync(f, join(root, 'voices', `${a}.wav`)); }
    for (const a of m.images) { const f = imageFile(dirs.imagesDir, ws, a); if (existsSync(f)) copyFileSync(f, join(root, 'images', `${a}.jpg`)); }
  };

  // ---------------------------------------------------------------- publishing (from a project of the workspace)
  app.get('/api/projects/:id/publication', { config: { role: 'viewer' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'projet introuvable' });
    const { rows } = await db.query<{ id: string }>('SELECT p.id FROM publications p JOIN projects j ON j.id = p.project_id WHERE p.project_id = $1 AND j.workspace_id = $2', [p.data.id, wsOf(req).id]);
    const r = rows[0] ? await load(rows[0].id, me(req)) : undefined;
    return { publication: r ? summary(r) : null };
  });

  app.post('/api/projects/:id/publish', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = Meta.safeParse(req.body ?? {}), ws = wsOf(req).id, user = userOf(req);
    if (!p.success) return reply.code(404).send({ error: 'projet introuvable' });
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? 'publication invalide' });
    const { rows } = await db.query<{ data: unknown; version: number; remix_of: string | null }>('SELECT data, version, remix_of FROM projects WHERE id = $1 AND workspace_id = $2', [p.data.id, ws]);
    const parsed = rows[0] ? parseProject(rows[0].data) : null;
    if (!rows[0] || !parsed?.ok) return reply.code(404).send({ error: 'projet introuvable' });
    const project = parsed.project, timeline = timeProject(project), duration = Math.round(timeline.duration * 10) / 10;
    const scenes = JSON.stringify(timeline.scenes.map((s) => Math.round(s.duration * 10) / 10));
    // a remix of a share-alike work stays share-alike
    let license = b.data.license;
    if (rows[0].remix_of) { const parent = (await db.query<{ license: License }>('SELECT license FROM publications WHERE id = $1', [rows[0].remix_of])).rows[0]; if (parent?.license === 'cc-by-sa') license = 'cc-by-sa'; }
    const existing = (await db.query<{ id: string }>('SELECT id FROM publications WHERE project_id = $1', [p.data.id])).rows[0];
    const id = existing?.id ?? randomUUID(), data = JSON.stringify(project), tags = JSON.stringify([...new Set(b.data.tags)]);
    copyMedia(ws, id, project);
    if (existing) {
      await db.query(`UPDATE publications SET title = $2, description = $3, tags = $4, license = $5, data = $6, project_version = $7, duration = $8, scenes = $9, updated_at = now() WHERE id = $1`,
        [id, b.data.title, b.data.description, tags, license, data, rows[0].version, duration, scenes]);
    } else {
      await db.query(`INSERT INTO publications (id, project_id, workspace_id, author_id, title, description, tags, license, data, project_version, duration, scenes, remix_of)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [id, p.data.id, ws, user.id, b.data.title, b.data.description, tags, license, data, rows[0].version, duration, scenes, rows[0].remix_of]);
    }
    return reply.code(existing ? 200 : 201).send(summary((await load(id, user.id))!));
  });

  app.delete('/api/community/:id', { config: { auth: 'user' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const r = p.success ? (await db.query<PubRow>('SELECT author_id, workspace_id FROM publications WHERE id = $1', [p.data.id])).rows[0] : undefined;
    if (!r) return reply.code(404).send({ error: 'publication introuvable' });
    if (!(await canManage(r, userOf(req).id))) return reply.code(403).send({ error: "seuls l'auteur et les administrateurs de son espace retirent une publication" });
    await db.query('DELETE FROM publications WHERE id = $1', [p.data!.id]);
    rmSync(dirOf(dirs.communityDir, p.data!.id), { recursive: true, force: true });
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- browsing (anyone)
  const List = z.object({
    sort: z.enum(['recent', 'popular', 'remixed']).default('recent'),
    q: z.string().trim().max(100).optional(), tag: z.string().trim().toLowerCase().max(24).optional(), author: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(60).default(24), offset: z.coerce.number().int().min(0).max(10_000).default(0),
  });
  app.get('/api/community', { config: { auth: 'public' } }, async (req, reply) => {
    const b = List.safeParse(req.query ?? {});
    if (!b.success) return reply.code(400).send({ error: 'recherche invalide' });
    const where: string[] = ['p.hidden_at IS NULL'], args: unknown[] = [], viewer = me(req);
    if (b.data.q) { args.push(`%${b.data.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); where.push(`(p.title ILIKE $${args.length} OR p.description ILIKE $${args.length})`); }
    if (b.data.tag) { args.push(JSON.stringify([b.data.tag])); where.push(`p.tags @> $${args.length}::jsonb`); }
    if (b.data.author) { args.push(b.data.author); where.push(`p.author_id = $${args.length}`); }
    const order = { recent: 'p.created_at DESC', popular: '(p.likes * 3 + p.remixes * 5 + p.views) DESC, p.created_at DESC', remixed: 'p.remixes DESC, p.likes DESC, p.created_at DESC' }[b.data.sort];
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM publications p ${cond}`, args)).rows[0]!.n);
    let sql = SELECT.replace('p.updated_at,', `p.updated_at, ${viewer ? `EXISTS (SELECT 1 FROM publication_likes l WHERE l.publication_id = p.id AND l.user_id = $${args.length + 1})` : 'false'} AS liked,`);
    const params = viewer ? [...args, viewer] : [...args];
    sql += ` ${cond} ORDER BY ${order} LIMIT ${b.data.limit} OFFSET ${b.data.offset}`;
    const tags = (await db.query<{ tag: string; n: string }>(`SELECT t.tag, count(*) AS n FROM publications, jsonb_array_elements_text(tags) AS t(tag) WHERE hidden_at IS NULL GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT 16`)).rows;
    return { items: (await db.query<PubRow>(sql, params)).rows.map(summary), total, tags: tags.map((t) => ({ tag: t.tag, count: Number(t.n) })) };
  });

  app.get('/api/community/:id', { config: { auth: 'public' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), viewer = me(req);
    const r = p.success ? await load(p.data.id, viewer) : undefined;
    if (!r) return reply.code(404).send({ error: 'publication introuvable' });
    // hidden by moderation: only its author and its workspace's admins still see it here (the managers, in the back office)
    const manage = await canManage(r, viewer);
    if (r.hidden_at && !manage) return reply.code(404).send({ error: 'publication introuvable' });
    const data = (await db.query<{ data: unknown }>('SELECT data FROM publications WHERE id = $1', [r.id])).rows[0]!.data;
    const remixes = (await db.query<PubRow>(`${SELECT} WHERE p.remix_of = $1 AND p.hidden_at IS NULL ORDER BY p.likes DESC, p.created_at DESC LIMIT 12`, [r.id])).rows.map(summary);
    return {
      ...summary(r), project: data, remixList: remixes, canManage: manage, hidden: !!r.hidden_at, licenseLabel: LICENSES[r.license],
      media: { voices: listMedia(dirs.communityDir, r.id, 'voices'), images: listMedia(dirs.communityDir, r.id, 'images') },
    };
  });

  // a view counts once per visitor and hour (in this process: a rough count, not an audience measurement)
  const seen = new Map<string, number>();
  app.post('/api/community/:id/view', { config: { auth: 'public' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'publication introuvable' });
    const key = `${p.data.id}:${me(req) ?? req.ip}`, now = Date.now();
    if ((seen.get(key) ?? 0) > now - 3_600_000) return { counted: false };
    seen.set(key, now);
    if (seen.size > 50_000) for (const [k, t] of seen) if (t < now - 3_600_000) seen.delete(k);
    const { rows } = await db.query<{ views: number }>('UPDATE publications SET views = views + 1 WHERE id = $1 RETURNING views', [p.data.id]);
    return rows[0] ? { counted: true, views: rows[0].views } : reply.code(404).send({ error: 'publication introuvable' });
  });

  const like = (on: boolean) => async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const p = Uuid.safeParse(req.params), user = userOf(req).id;
    if (!p.success || !(await db.query('SELECT 1 FROM publications WHERE id = $1', [p.data.id])).rows.length) return reply.code(404).send({ error: 'publication introuvable' });
    if (on) await db.query('INSERT INTO publication_likes (publication_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [p.data.id, user]);
    else await db.query('DELETE FROM publication_likes WHERE publication_id = $1 AND user_id = $2', [p.data.id, user]);
    const { rows } = await db.query<{ likes: number }>('UPDATE publications SET likes = (SELECT count(*) FROM publication_likes WHERE publication_id = $1) WHERE id = $1 RETURNING likes', [p.data.id]);
    return { liked: on, likes: rows[0]!.likes };
  };
  app.post('/api/community/:id/like', { config: { auth: 'user' } }, like(true));
  app.delete('/api/community/:id/like', { config: { auth: 'user' } }, like(false));

  app.get('/api/community/authors/:id', { config: { auth: 'public' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const u = p.success ? (await db.query<{ name: string; created_at: Date }>('SELECT name, created_at FROM users WHERE id = $1', [p.data.id])).rows[0] : undefined;
    if (!u) return reply.code(404).send({ error: 'auteur introuvable' });
    const stats = (await db.query<{ n: string; likes: string; remixes: string }>('SELECT count(*) AS n, coalesce(sum(likes), 0) AS likes, coalesce(sum(remixes), 0) AS remixes FROM publications WHERE author_id = $1 AND hidden_at IS NULL', [p.data!.id])).rows[0]!;
    return { id: p.data!.id, name: u.name, since: u.created_at, publications: Number(stats.n), likes: Number(stats.likes), remixes: Number(stats.remixes) };
  });

  // ---------------------------------------------------------------- reports (anyone signed in), read by the platform admins
  app.post('/api/community/:id/report', { config: { auth: 'user' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = z.object({ reason: z.enum(REPORT_REASONS), message: z.string().trim().max(1000).default('') }).safeParse(req.body ?? {});
    if (!p.success || !(await db.query('SELECT 1 FROM publications WHERE id = $1', [p.data.id])).rows.length) return reply.code(404).send({ error: 'publication introuvable' });
    if (!b.success) return reply.code(400).send({ error: 'motif attendu' });
    await db.query(`INSERT INTO reports (id, publication_id, reporter_id, reason, message) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (publication_id, reporter_id) WHERE status = 'open' DO UPDATE SET reason = EXCLUDED.reason, message = EXCLUDED.message`,
      [randomUUID(), p.data.id, userOf(req).id, b.data.reason, b.data.message]);
    return reply.code(201).send({ reported: true });
  });

  // ---------------------------------------------------------------- media and thumbnails (anyone)
  app.get('/api/community/:id/:kind/:file', { config: { auth: 'public' } }, async (req, reply) => {
    const { id, kind, file } = req.params as { id: string; kind: string; file: string };
    const m = kind === 'voices' ? /^([0-9a-f]{32})\.wav$/.exec(file) : kind === 'images' ? /^([0-9a-f]{32})\.jpg$/.exec(file) : null;
    if (!m || !Uuid.safeParse({ id }).success) return reply.code(404).send({ error: 'introuvable' });
    const f = join(dirOf(dirs.communityDir, id), kind, file);
    if (!existsSync(f)) return reply.code(404).send({ error: 'introuvable' });
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return sendFile(req, reply, f, kind === 'voices' ? 'audio/wav' : 'image/jpeg');
  });

  app.get('/api/community/:id/thumbnail.png', { config: { auth: 'public' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const r = p.success ? (await db.query<{ data: unknown; updated_at: Date }>('SELECT data, updated_at FROM publications WHERE id = $1', [p.data.id])).rows[0] : undefined;
    const parsed = r ? parseProject(r.data) : null;
    if (!r || !parsed?.ok) return reply.code(404).send({ error: 'publication introuvable' });
    const root = dirOf(dirs.communityDir, p.data!.id);
    const images = Object.fromEntries(listMedia(dirs.communityDir, p.data!.id, 'images').map((a) => [a, join(root, 'images', `${a}.jpg`)]));
    const stamp = String(r.updated_at.getTime());
    return sendPng(reply, await thumbnail(`pub:${p.data!.id}:${stamp}`, parsed.project, images), (req.query as { v?: string }).v === stamp, true);
  });

  // ---------------------------------------------------------------- remixing (into the remixer's workspace)
  app.post('/api/community/:id/remix', { config: { role: 'editor' } }, async (req, reply) => {
    const p = Uuid.safeParse(req.params), b = z.object({ title: z.string().trim().min(1).max(200).optional() }).safeParse(req.body ?? {}), ws = wsOf(req).id, user = userOf(req).id;
    if (!p.success || !b.success) return reply.code(400).send({ error: 'requête invalide' });
    const r = (await db.query<{ data: unknown; title: string }>('SELECT data, title FROM publications WHERE id = $1 AND hidden_at IS NULL', [p.data.id])).rows[0];
    const parsed = r ? parseProject(r.data) : null;
    if (!r || !parsed?.ok) return reply.code(404).send({ error: 'publication introuvable' });
    await quota.ensure(ws, 'projects'); await quota.ensure(ws, 'storageMb', 0);
    const project = { ...parsed.project, title: b.data.title ?? `${r.title} (remix)` };
    // its recordings and painted decors, into this workspace (named by content: nothing clashes)
    const root = dirOf(dirs.communityDir, p.data.id);
    for (const a of listMedia(dirs.communityDir, p.data.id, 'voices')) { const to = voiceFile(dirs.voicesDir, ws, a); if (!existsSync(to)) { mkdirSync(join(dirs.voicesDir, ws), { recursive: true }); copyFileSync(join(root, 'voices', `${a}.wav`), to); } }
    for (const a of listMedia(dirs.communityDir, p.data.id, 'images')) { const to = imageFile(dirs.imagesDir, ws, a); if (!existsSync(to)) { mkdirSync(join(dirs.imagesDir, ws), { recursive: true }); copyFileSync(join(root, 'images', `${a}.jpg`), to); } }
    const pid = randomUUID(), data = JSON.stringify(project);
    await db.tx(async (q) => {
      await q.query('INSERT INTO projects (id, title, data, workspace_id, created_by, updated_by, remix_of) VALUES ($1, $2, $3, $4, $5, $5, $6)', [pid, project.title, data, ws, user, p.data.id]);
      await q.query('INSERT INTO project_versions (project_id, version, data, created_by) VALUES ($1, 1, $2, $3)', [pid, data, user]);
      await q.query('UPDATE publications SET remixes = remixes + 1 WHERE id = $1', [p.data.id]);
    });
    return reply.code(201).send({ id: pid, title: project.title });
  });
}

/** the folders of a workspace's publications, removed with the workspace (the rows go by cascade) */
export async function publicationsOf(db: Db, ws: string): Promise<string[]> {
  return (await db.query<{ id: string }>('SELECT id FROM publications WHERE workspace_id = $1', [ws])).rows.map((r) => r.id);
}
