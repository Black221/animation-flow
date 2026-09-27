import { expect, test } from '@playwright/test';

test('render a video from the editor, follow it, watch it', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('modèle').selectOption('blank');
  await page.getByLabel('titre').fill('Rendu court');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page).toHaveURL(/\/p\//);

  const panel = page.getByRole('region', { name: 'rendu vidéo' });
  await panel.getByLabel('largeur').selectOption('640');
  await panel.getByRole('button', { name: 'Rendre la vidéo' }).click();
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
  } else await expect(panel).toContainText('ne lit pas les vidéos H.264');
});
