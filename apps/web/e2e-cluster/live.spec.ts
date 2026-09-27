import { expect, test } from '@playwright/test';
import { PORTS } from '../playwright.cluster.config';

const [A, B] = PORTS.map((p) => `http://127.0.0.1:${p}`) as [string, string];

test('two people on two API processes edit the same project live', async ({ browser }) => {
  // Olga works through process A, Léa through process B
  const ca = await browser.newContext({ baseURL: A, extraHTTPHeaders: { 'x-requested-with': 'animation-flow' } });
  const cb = await browser.newContext({ baseURL: B, extraHTTPHeaders: { 'x-requested-with': 'animation-flow' } });
  const olga = await ca.newPage(), lea = await cb.newPage();
  expect((await olga.request.post('/api/auth/signup', { data: { email: 'olga@example.org', name: 'Olga', password: 'mot-de-passe-solide-1' } })).status()).toBe(201);
  const me = await (await olga.request.get('/api/auth/me')).json();
  const inv = await (await olga.request.post('/api/workspace/invitations', { data: { role: 'editor' }, headers: { 'x-workspace-id': me.workspaces[0].id } })).json();
  expect((await lea.request.post('/api/auth/signup', { data: { email: 'lea@example.org', name: 'Léa', password: 'mot-de-passe-solide-3', invitation: inv.path.split('/').pop() } })).status()).toBe(201);

  await olga.goto('/');
  await olga.getByRole('button', { name: 'Créer' }).click();
  await expect(olga).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  await lea.goto(new URL(olga.url()).pathname);

  await expect(olga.getByTestId('peers')).toContainText('Léa');
  await expect(lea.getByTestId('peers')).toContainText('Olga');

  await olga.getByRole('tab', { name: 'Projet' }).click();
  await olga.getByLabel('Titre', { exact: true }).fill('Titre depuis A');
  await expect(lea.locator('.editor-bar h1')).toHaveText('Titre depuis A');

  const hers = lea.getByLabel('scène (JSON)');
  await hers.fill((await hers.inputValue()).replace('"title": "La carte avant le voyage"', '"title": "Carte depuis B"'));
  await expect(olga.locator('.scenes li button').first()).toContainText('Carte depuis B');

  // a comment posted through B reaches A
  await lea.getByRole('tab', { name: /Commentaires/ }).click();
  await lea.getByRole('form', { name: 'nouveau commentaire' }).getByLabel('commentaire').fill('Vu depuis B');
  await lea.getByRole('button', { name: 'Commenter' }).click();
  await expect(olga.getByRole('tab', { name: 'Commentaires (1)' })).toBeVisible();

  await expect(olga.getByTestId('save-state')).toHaveText(/^version \d+$/, { timeout: 15_000 });
  await expect(lea.getByTestId('save-state')).toHaveText(/^version \d+$/, { timeout: 15_000 });
  await olga.reload();
  await expect(olga.locator('.editor-bar h1')).toHaveText('Titre depuis A');
  await expect(olga.locator('.scenes li button').first()).toContainText('Carte depuis B');
  await ca.close(); await cb.close();
});
