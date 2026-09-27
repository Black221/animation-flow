// Narration: say one line with the voice provider chosen for the "narration" task. The recording is identified by
// what it says and how (provider, model, voice, text), so the same line is never paid for twice; it is decoded,
// its silences trimmed, brought to a standard loudness and stored as a 48 kHz WAV. The editor writes the returned
// asset id and measured duration into the line: the clock of the scene follows the real voice from then on.
// Recordings belong to a workspace (their own folder, and the workspace in their id): no workspace can reach
// another's, even knowing a text and a voice.
import { encodeWav, normalizeVoice, SR, trimSilence } from '@af/audio';
import { providerById, synthesize, type PostFetch } from '@af/providers';
import { decodeAudio } from '@af/render';
import { textHash } from '@af/schema';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { SecretBox } from '../crypto';
import { wsOf } from '../auth/context';
import type { Db } from '../db';
import { sendFile } from '../files';
import type { Signer } from '../render/sign';

const Asset = z.string().regex(/^[0-9a-f]{32}$/);
const Body = z.object({ text: z.string().trim().min(1).max(4000), voice: z.string().max(200).optional(), language: z.string().max(12).optional() });

export const voiceFile = (dir: string, ws: string, asset: string) => join(dir, ws, `${asset}.wav`);
/** duration in seconds of a stored recording (16-bit mono WAV at 48 kHz: 44-byte header) */
const durationOf = (file: string) => Math.round(((statSync(file).size - 44) / 2 / SR) * 1000) / 1000;

export function voiceRoutes(app: FastifyInstance, db: Db, box: SecretBox, sign: Signer, voicesDir: string, fetchImpl?: PostFetch) {
  mkdirSync(voicesDir, { recursive: true });
  const link = (ws: string, asset: string) => `/api/voices/${ws}/${asset}.wav?${sign.sign(`voice:${ws}:${asset}`)}`;

  app.post('/api/voices', { config: { role: 'editor' } }, async (req, reply) => {
    const b = Body.safeParse(req.body), ws = wsOf(req).id;
    if (!b.success) return reply.code(400).send({ error: 'texte manquant ou trop long' });
    const { rows } = await db.query<{ credential_id: string | null; model: string; voice: string; provider: string | null; secret: string | null; base_url: string | null }>(
      `SELECT a.credential_id, a.model, a.voice, c.provider, c.secret, c.base_url FROM model_assignments a LEFT JOIN credentials c ON c.id = a.credential_id WHERE a.task = 'narration' AND a.workspace_id = $1`, [ws]);
    const a = rows[0];
    if (!a?.credential_id || !a.provider) return reply.code(400).send({ error: 'aucune voix configurée : Réglages → Fournisseurs → Narration' });
    const p = providerById(a.provider)!, voice = b.data.voice || a.voice || p.tts?.voices?.[0] || '', model = a.model || p.tts?.defaultModel || '';
    const text = b.data.text, asset = createHash('sha256').update(JSON.stringify(['v2', ws, a.provider, model, voice, text])).digest('hex').slice(0, 32);
    const file = voiceFile(voicesDir, ws, asset);
    mkdirSync(join(voicesDir, ws), { recursive: true });
    if (existsSync(file)) return { asset, textHash: textHash(text), duration: durationOf(file), cached: true, url: link(ws, asset) };

    let apiKey: string;
    try { apiKey = box.open(a.secret ?? ''); } catch { return reply.code(500).send({ error: 'la clé ne peut pas être déchiffrée : saisissez-la de nouveau' }); }
    const r = await synthesize(a.provider, { apiKey, baseUrl: a.base_url ?? undefined }, { text, voice, model, language: b.data.language }, fetchImpl);
    if (!r.ok) return reply.code(502).send({ error: r.error, status: r.status });
    let samples: Float32Array;
    try { samples = normalizeVoice(trimSilence(await decodeAudio(r.audio, SR))); }
    catch (e) { return reply.code(502).send({ error: `son illisible : ${(e as Error).message}` }); }
    if (samples.length < SR * 0.05) return reply.code(502).send({ error: 'le fournisseur a renvoyé un silence' });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, encodeWav({ sampleRate: SR, channels: [samples] }, 16));
    renameSync(tmp, file);
    return { asset, textHash: textHash(text), duration: durationOf(file), cached: false, url: link(ws, asset) };
  });

  // signed links for a list of recordings (the editor's preview downloads them)
  app.post('/api/voices/links', { config: { role: 'viewer' } }, async (req, reply) => {
    const b = z.object({ assets: z.array(Asset).max(2000) }).safeParse(req.body), ws = wsOf(req).id;
    if (!b.success) return reply.code(400).send({ error: 'liste invalide' });
    return Object.fromEntries(b.data.assets.filter((x) => existsSync(voiceFile(voicesDir, ws, x))).map((x) => [x, link(ws, x)]));
  });

  app.get('/api/voices/:ws/:file', { config: { auth: 'public' } }, async (req, reply) => {
    const { ws, file: name } = req.params as { ws: string; file: string };
    const m = /^([0-9a-f]{32})\.wav$/.exec(name), q = req.query as { exp?: string; sig?: string };
    if (!m || !z.string().uuid().safeParse(ws).success || !sign.verify(`voice:${ws}:${m[1]}`, q.exp, q.sig)) return reply.code(403).send({ error: 'lien expiré ou invalide' });
    const file = voiceFile(voicesDir, ws, m[1]!);
    if (!existsSync(file)) return reply.code(404).send({ error: 'enregistrement introuvable' });
    return sendFile(req, reply, file, 'audio/wav');
  });
}

/** the stored recordings of a project, decoded (for the mixer) */
export function loadVoices(voicesDir: string, ws: string, assets: Iterable<string>, decode: (bytes: Uint8Array) => Float32Array): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  for (const a of assets) { const f = voiceFile(voicesDir, ws, a); if (existsSync(f)) out.set(a, decode(readFileSync(f))); }
  return out;
}

/** recordings made before workspaces existed lie at the root of the folder: they belong to the first workspace */
export function adoptLegacyVoices(voicesDir: string, ws: string): number {
  if (!existsSync(voicesDir)) return 0;
  const legacy = readdirSync(voicesDir).filter((f) => /^[0-9a-f]{32}\.wav$/.test(f));
  if (!legacy.length) return 0;
  mkdirSync(join(voicesDir, ws), { recursive: true });
  for (const f of legacy) renameSync(join(voicesDir, f), join(voicesDir, ws, f));
  return legacy.length;
}
