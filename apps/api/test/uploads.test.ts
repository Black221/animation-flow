// Files brought with the prompt as models: pictures (redrawn, PNG only with transparency) and music (decoded by
// FFmpeg from a named format, listened to, described, not kept); and a project exported as one file.
import { encodeWav, SR } from '@af/audio';
import { exampleProject, parseProject } from '@af/schema';
import { createCanvas } from '@napi-rs/canvas';
import type { FastifyInstance } from 'fastify';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { secretBox } from '../src/crypto';
import type { Db } from '../src/db';
import { buildServer } from '../src/server';
import { openTestDb } from './testdb';
import { signUp, type Client } from './client';

const voicesDir = mkdtempSync(join(tmpdir(), 'af-up-voices-')), imagesDir = mkdtempSync(join(tmpdir(), 'af-up-images-'));
let db: Db, app: FastifyInstance, ana: Client, ben: Client;

const logo = () => { const c = createCanvas(400, 200), x = c.getContext('2d'); x.fillStyle = '#E63946'; x.beginPath(); x.arc(100, 100, 90, 0, Math.PI * 2); x.fill(); return c.toBuffer('image/png'); };
const photo = () => { const c = createCanvas(1600, 900), x = c.getContext('2d'); x.fillStyle = '#3a7bd5'; x.fillRect(0, 0, 1600, 900); x.fillStyle = '#ffd166'; x.fillRect(0, 600, 1600, 300); return c.toBuffer('image/jpeg'); };
const tone = (seconds: number, lead = 0) => { const n = Math.round((seconds + lead) * SR), s = new Float32Array(n); for (let i = Math.round(lead * SR); i < n; i++) s[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR); return Buffer.from(encodeWav({ sampleRate: SR, channels: [s] }, 16)); };
const mp3 = (seconds: number) => {
  const f = join(mkdtempSync(join(tmpdir(), 'af-mp3-')), 'a.mp3');
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, '-ac', '2', f]);
  return readFileSync(f);
};
const up = (c: Client, url: string, body: Buffer, type: string) => c.inject({ method: 'POST', url, payload: body, headers: { 'content-type': type } });

beforeAll(async () => {
  db = await openTestDb();
  app = await buildServer({ db, box: secretBox(randomBytes(32)), voicesDir, imagesDir, signup: 'open' });
  ana = await signUp(app, 'ana@example.org');
  ben = await signUp(app, 'ben@example.org');
});
afterAll(async () => { await app.close(); await db.close(); });

describe('importing pictures', () => {
  it('keeps a transparent logo as PNG and a photo as JPEG, with their size and colour', async () => {
    const a = await up(ana, '/api/uploads/image', logo(), 'image/png');
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ width: 400, height: 200, alpha: true });
    expect(existsSync(join(imagesDir, ana.workspaces[0]!.id, `${a.json().asset}.png`))).toBe(true);
    const img = await ana.inject({ url: a.json().url });
    expect(img.headers['content-type']).toBe('image/png');
    const b = await up(ana, '/api/uploads/image', photo(), 'image/jpeg');
    expect(b.json()).toMatchObject({ width: 1600, height: 900, alpha: false });
    expect(b.json().color).toMatch(/^#[0-9a-f]{6}$/);
    expect((await ana.inject({ url: b.json().url })).headers['content-type']).toBe('image/jpeg');
    // the same file twice is stored once
    expect((await up(ana, '/api/uploads/image', logo(), 'image/png')).json().asset).toBe(a.json().asset);
  });

  it('refuses what is not a picture, whatever the browser says (SVG included)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await up(ana, '/api/uploads/image', svg, 'image/svg+xml')).statusCode).toBe(415);
    expect((await up(ana, '/api/uploads/image', Buffer.from('hello'), 'image/png')).statusCode).toBe(415);
    expect((await up(ana, '/api/uploads/image', Buffer.alloc(0), 'image/png')).statusCode).toBe(400);
  });

  it('asks for the CSRF header and an editor', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/uploads/image', payload: logo(), headers: { 'content-type': 'image/png', cookie: ana.cookie } });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/uploads/image', payload: logo(), headers: { 'content-type': 'image/png', 'x-requested-with': 'animation-flow' } })).statusCode).toBe(401);
  });
});

/** a beat: a kick on every beat over an A major chord (a model music to listen to) */
const beat = (seconds: number, bpm: number) => {
  const n = Math.round(seconds * SR), x = new Float32Array(n), period = Math.round((60 / bpm) * SR);
  for (let i = 0; i < n; i++) x[i] = 0.15 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 277.18 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 329.63 * i) / SR);
  for (let b = 0; b < n; b += period) for (let k = 0; k < SR / 4 && b + k < n; k++) x[b + k]! += 0.6 * Math.sin((2 * Math.PI * 60 * k) / SR) * Math.exp(-k / (0.06 * SR));
  return Buffer.from(encodeWav({ sampleRate: SR, channels: [x] }, 16));
};

describe('a music as a model', () => {
  it('is listened to and described (tempo, key, energy), and not kept', async () => {
    const before = existsSync(voicesDir) ? readdirSync(voicesDir, { recursive: true }).length : 0;
    const r = await up(ana, '/api/uploads/audio', beat(12, 120), 'audio/wav');
    expect(r.statusCode).toBe(200);
    expect(r.json().duration).toBeCloseTo(12, 0);
    expect(r.json().features.bpm).toBeGreaterThanOrEqual(116);
    expect(r.json().features.bpm).toBeLessThanOrEqual(124);
    expect(r.json().features).toMatchObject({ key: 'la', mode: 'major' });
    expect(r.json().summary).toMatch(/BPM.*tonalité probable la majeur/);
    expect(readdirSync(voicesDir, { recursive: true }).length).toBe(before);
    // an MP3 too
    expect((await up(ana, '/api/uploads/audio', mp3(4), 'audio/mpeg')).json().duration).toBeCloseTo(4, 0);
  });

  it('refuses a playlist or anything FFmpeg would follow elsewhere, and silence', async () => {
    const hls = Buffer.from('#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n');
    expect((await up(ana, '/api/uploads/audio', hls, 'audio/mpegurl')).statusCode).toBe(415);
    expect((await up(ana, '/api/uploads/audio', Buffer.from(encodeWav({ sampleRate: SR, channels: [new Float32Array(SR)] }, 16)), 'audio/wav')).statusCode).toBe(422);
    expect((await up(ana, '/api/uploads/audio', Buffer.alloc(0), 'audio/wav')).statusCode).toBe(400);
  });
});

describe('a project as a file', () => {
  it('exports a project with its pictures; nothing imports a project straight into a workspace', async () => {
    const pic = (await up(ana, '/api/uploads/image', logo(), 'image/png')).json();
    const base = structuredClone(exampleProject) as Record<string, any>;
    base.title = 'Avec un logo';
    base.assets = { ...(base.assets ?? {}), logo: { kind: 'prop', name: 'Logo', parts: [{ id: 'image', shapes: [{ type: 'image', asset: pic.asset, x: -150, y: -150, w: 300, h: 150 }] }] } };
    base.scenes[0].elements.push({ id: 'logo', type: 'prop', ref: 'logo', layer: 9, keys: [{ t: 0, x: 960, y: 500 }] });
    expect(parseProject(base).ok).toBe(true);
    const made = await ana.inject({ method: 'POST', url: '/api/projects', payload: { project: base } });
    expect(made.statusCode).toBe(201);

    const exp = await ana.inject({ url: `/api/projects/${made.json().id}/export` });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-disposition']).toContain('avec-un-logo.animation.json');
    const file = exp.json();
    expect(file).toMatchObject({ format: 'animation-flow', version: 1 });
    expect(Object.keys(file.media.images)).toEqual([pic.asset]);
    expect(Object.keys((await ana.inject({ url: `/api/projects/${made.json().id}/export?media=0` })).json().media.images)).toEqual([]);
    // viewers of another workspace cannot export it
    expect((await ben.inject({ url: `/api/projects/${made.json().id}/export` })).statusCode).toBe(404);
    // a project file is a model for the AI now (its outline, with the prompt), not something to import
    expect((await ben.inject({ method: 'POST', url: '/api/projects/import', payload: file })).statusCode).toBe(404);
  });
});
