import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A local stand-in for a voice provider speaking the OpenAI API: every line comes back as a WAV of tone whose length
// follows the text. The real stack does the rest: key storage, synthesis, trimming, timing, mixing, rendering.
function wav(seconds: number) {
  const sr = 24000, n = Math.round(seconds * sr), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 190 * i) / sr) * 6000 * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / sr))), 44 + i * 2);
  return b;
}
let server: Server, base = '';
const said: string[] = [];
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/v1/audio/speech') { const t = JSON.parse(body).input as string; said.push(t); res.writeHead(200, { 'content-type': 'audio/wav' }).end(wav(0.5 + t.length / 25)); }
      else res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
test.afterAll(() => { server.close(); });

test('record the narration, hear it in the preview, render it into the video', async ({ page }) => {
  // a voice key and the narration task, through the API (the settings page drives the same routes)
  const cred = await (await page.request.post('/api/credentials', { data: { provider: 'openai', label: 'voix locale', apiKey: 'sk-local-test-000000', baseUrl: base } })).json();
  expect((await page.request.put('/api/assignments/narration', { data: { credentialId: cred.id, model: 'tts-1', voice: 'nova' } })).ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.locator('.tl-line.estimated').first()).toBeVisible(); // durations are estimates before any voice

  await page.getByRole('tab', { name: 'Voix' }).click();
  await page.getByRole('button', { name: /Enregistrer les voix manquantes \(9\)/ }).click();
  await expect(page.getByRole('button', { name: 'Toutes les répliques ont leur voix' })).toBeVisible({ timeout: 30_000 });
  expect(said).toHaveLength(9);
  await expect(page.getByTestId('voice-line').filter({ hasText: 'enregistrée' })).toHaveCount(9);
  await expect(page.locator('.tl-line.estimated')).toHaveCount(0); // the clock now follows the recorded voices
  await expect(page.getByTestId('sound-info')).toHaveText('son prêt', { timeout: 20_000 });

  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('version 2');

  // render one scene with its sound, and check the file carries video, audio and subtitles
  const panel = page.getByRole('region', { name: 'rendu vidéo' });
  await panel.getByLabel('largeur').selectOption('640');
  await panel.getByLabel('portée').selectOption('scene');
  await page.getByRole('button', { name: /s2 · Jumo/ }).first().click();
  await panel.getByRole('button', { name: 'Rendre la vidéo' }).click();
  const job = panel.getByTestId('render').first();
  await expect(job).toContainText('terminé', { timeout: 60_000 });
  await expect(job).not.toContainText('sans voix');
  const href = await job.getByRole('link', { name: 'Télécharger' }).getAttribute('href');
  const file = join(mkdtempSync(join(tmpdir(), 'af-e2e-video-')), 'v.mp4');
  writeFileSync(file, await (await page.request.get(href!)).body());
  const streams = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim().split('\n');
  expect(streams).toEqual(['video', 'audio', 'subtitle']);
});
