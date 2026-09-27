import { signedIn, newProject } from './auth';
import { expect, test, type Page } from '@playwright/test';

/** how many distinct colours the preview shows (sampled): a blank or failed canvas has one or two */
const colours = (page: Page) => page.getByTestId('preview').evaluate((c: HTMLCanvasElement) => {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, s = new Set<number>();
  for (let i = 0; i < d.length; i += 4 * 211) s.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
  return s.size;
});
const snapshot = (page: Page) => page.getByTestId('preview').evaluate((c: HTMLCanvasElement) => c.toDataURL());

test('create a project, preview it in both styles, edit a scene, save', async ({ page }) => {
  await signedIn(page);
  await newProject(page);
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('save-state')).toHaveText('version 1');

  // the preview paints a real image
  await expect.poll(() => colours(page)).toBeGreaterThan(30);

  // playback moves time forward
  await page.getByRole('button', { name: 'lecture' }).click();
  await expect.poll(async () => (await page.getByTestId('time').textContent())?.startsWith('0:00.0')).toBe(false);
  await page.getByRole('button', { name: 'pause' }).click();

  // switching style repaints differently
  const before = await snapshot(page);
  await page.getByLabel('style', { exact: true }).selectOption('flat');
  await expect.poll(() => snapshot(page)).not.toBe(before);
  await expect(page.getByTestId('save-state')).toHaveText('modifié');

  // an invalid scene edit is refused with a readable reason, a valid one applies
  await page.getByText('Code de la scène (JSON)').click(); // the scene's code is behind « advanced »
  const editor = page.getByLabel('scène (JSON)');
  const original = await editor.inputValue();
  await editor.fill(original.replace('"decor": {', '"decor": { "kind": 12, "x": {'));
  await expect(page.getByTestId('issues')).toBeVisible();
  await editor.fill(original.replace('"title": "La carte avant le voyage"', '"title": "Carte modifiée"'));
  await expect(page.getByTestId('issues')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /s1 · Carte modifiée/ }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('version 2');
  await page.reload();
  await expect(page.getByRole('button', { name: /s1 · Carte modifiée/ }).first()).toBeVisible();
});

test('add a model provider key: it is shown masked, never in full', async ({ page }) => {
  await signedIn(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Ajouter une clé' }).click();
  const form = page.getByRole('form', { name: 'ajouter une clé' });
  await form.getByLabel('Fournisseur').selectOption('openai');
  await form.getByLabel('Nom').fill('labo');
  await form.getByLabel(/Clé d'API/).fill('sk-test-THIS-IS-SECRET-4242');
  await page.getByRole('dialog', { name: 'Ajouter une clé' }).getByRole('button', { name: 'Ajouter', exact: true }).click();
  const card = page.getByTestId('credential').filter({ hasText: 'labo' });
  await expect(card).toContainText('…4242');
  await expect(page.locator('body')).not.toContainText('THIS-IS-SECRET');
  await page.reload();
  await expect(page.locator('body')).not.toContainText('THIS-IS-SECRET');
  // a key can be picked for a text task, not for the voice task of a provider without it
  await page.locator('.task').filter({ hasText: 'Texte → storyboard' }).getByLabel('Clé').selectOption({ label: 'labo (OpenAI)' });
  await expect(page.locator('.task').filter({ hasText: 'Texte → storyboard' }).getByLabel('Clé')).toHaveValue(/[0-9a-f-]{36}/);
});
