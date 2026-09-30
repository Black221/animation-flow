import { expect, test } from './fixtures';
import { signedIn, newProject } from './auth';

test('comment a scene at a moment; a reader replies live; the thread is resolved', async ({ page, browser }) => {
  await signedIn(page);
  await newProject(page);
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  const url = page.url();

  // Olga comments scene s1 at 0:02.0, on Awa
  await page.getByRole('slider', { name: 'position' }).fill('2');
  await page.getByRole('tab', { name: /Commentaires/ }).click();
  const form = page.getByRole('form', { name: 'nouveau commentaire' });
  await expect(form).toContainText('à 0:02.0');
  await form.getByLabel('commentaire').fill('Awa entre trop tôt');
  await form.getByLabel('élément commenté').selectOption('awa');
  await form.getByRole('button', { name: 'Commenter' }).click();
  const thread = page.getByTestId('comment-thread').filter({ hasText: 'Awa entre trop tôt' });
  await expect(thread).toContainText('à 0:02.0');
  await expect(thread).toContainText('awa');
  await expect(page.getByRole('tab', { name: 'Commentaires (1)' })).toBeVisible();
  await expect(page.locator('.scenes li button').first().getByLabel('1 commentaire(s) ouvert(s)')).toBeVisible();

  // Vi, a reader, sees it and replies; Olga sees the reply without reloading
  const me = await (await page.request.get('/api/auth/me')).json();
  const inv = await (await page.request.post('/api/workspace/invitations', { data: { role: 'viewer' }, headers: { 'x-workspace-id': me.workspaces[0].id } })).json();
  const other = await browser.newContext({ extraHTTPHeaders: { 'x-requested-with': 'animation-flow' } });
  const vi = await other.newPage();
  expect((await vi.request.post('/api/auth/signup', { data: { email: 'vi-comments@example.org', name: 'Vi', password: 'mot-de-passe-solide-4', invitation: inv.path.split('/').pop() } })).status()).toBe(201);
  await vi.goto(url);
  await expect(vi.getByTestId('read-only')).toBeVisible();
  await vi.getByRole('tab', { name: /Commentaires/ }).click();
  const hers = vi.getByTestId('comment-thread').filter({ hasText: 'Awa entre trop tôt' });
  await hers.getByRole('button', { name: 'Répondre' }).click();
  await hers.getByRole('textbox', { name: 'réponse' }).fill('Plutôt à 0:04 ?');
  await hers.getByRole('button', { name: 'Envoyer' }).click();
  await expect(thread.getByTestId('comment-reply')).toContainText('Plutôt à 0:04 ?');
  await expect(hers.getByRole('button', { name: 'Résoudre' })).toHaveCount(0); // a reader does not resolve others' threads

  // the time link seeks to that moment
  await page.getByRole('slider', { name: 'position' }).fill('10');
  await thread.getByRole('button', { name: 'à 0:02.0' }).click();
  await expect(page.getByTestId('time')).toHaveText(/^0:02\.0/);

  // Olga resolves it: it leaves the open list for both
  await thread.getByRole('button', { name: 'Résoudre' }).click();
  await expect(page.getByTestId('comment-thread')).toHaveCount(0);
  await expect(vi.getByTestId('comment-thread')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Commentaires', exact: true })).toBeVisible();
  await page.getByLabel(/fils résolus/).check();
  await expect(thread).toContainText('Résolu par Olga');
  await other.close();
});
