import { signedIn, newProject } from './auth';
import { expect, test } from './fixtures';

test('render a video from the editor, follow it, watch it', async ({ page }) => {
  await signedIn(page);
  await newProject(page, 'Projet vide', 'Rendu court');
  await expect(page).toHaveURL(/\/p\//);

  const panel = page.getByRole('region', { name: 'rendu vidéo' });
  await panel.getByLabel('taille').selectOption('360');
  await expect(panel.getByTestId('render-summary')).toContainText('MP4 · 640×360');
  await panel.getByRole('button', { name: 'Rendre en MP4' }).click();
  const job = panel.getByTestId('render').first();
  await expect(job).toContainText(/en attente|en cours|terminé/);
  await expect(job).toContainText('terminé', { timeout: 60_000 });

  const href = await job.getByRole('link', { name: 'Télécharger' }).getAttribute('href');
  expect(href).toMatch(/\/api\/renders\/[0-9a-f-]{36}\/video\?exp=\d+&sig=[\w-]+&download=1$/);
  const file = await page.request.get(href!);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('video/mp4');
  expect((await file.body()).subarray(4, 8).toString()).toBe('ftyp');

  // where the browser has H.264 (Chrome, Edge, Firefox, Safari) the signed link plays in the page
  const h264 = await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"') !== '');
  if (h264) {
    const video = panel.getByTestId('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => (v.readyState >= 1 ? v.duration : 0)), { timeout: 20_000 }).toBeGreaterThan(4.9);
  } else await expect(panel).toContainText('ne lit pas ce format');
});

test('deliver a vertical GIF: the preview shows the frame, the file is a GIF', async ({ page }) => {
  await signedIn(page);
  await newProject(page, 'Projet vide', 'GIF vertical');
  await expect(page).toHaveURL(/\/p\//);

  // the player previews what a vertical video keeps
  await page.getByLabel("cadre de l'aperçu").selectOption('9:16');
  const preview = page.getByTestId('preview');
  await expect.poll(() => preview.evaluate((c: HTMLCanvasElement) => c.height / c.width)).toBeGreaterThan(1.7);

  const panel = page.getByRole('region', { name: 'rendu vidéo' });
  await panel.getByRole('button', { name: /TikTok/ }).click();
  await expect(panel.getByRole('radio', { name: /Vertical/ })).toHaveAttribute('aria-checked', 'true');
  await panel.getByRole('radio', { name: 'GIF' }).click();
  // a GIF: no subtitle track, no sound, 540 lines at most
  await expect(panel.getByLabel('sous-titres')).toHaveValue('burned');
  await expect(panel.getByLabel('son du rendu')).toHaveCount(0);
  await panel.getByLabel('taille').selectOption('360');
  await expect(panel.getByTestId('render-summary')).toContainText('GIF · 360×640 · vertical 9:16 · suivre l’action');
  const sent = page.waitForRequest((r) => /\/renders$/.test(r.url()) && r.method() === 'POST');
  await panel.getByRole('button', { name: 'Rendre en GIF' }).click();
  expect((await sent).postDataJSON()).toMatchObject({ format: 'gif', aspect: '9:16', framing: 'follow', size: 360, subtitles: 'burned', audio: false });
  const job = panel.getByTestId('render').first();
  await expect(job).toContainText('GIF 360×640');
  await expect(job).toContainText('terminé', { timeout: 60_000 });
  const href = await job.getByRole('link', { name: 'Télécharger' }).getAttribute('href');
  const file = await page.request.get(href!);
  expect(file.headers()['content-type']).toBe('image/gif');
  expect((await file.body()).subarray(0, 6).toString()).toBe('GIF89a');
  await expect(panel.locator('img[data-testid=video]')).toBeVisible();
});
