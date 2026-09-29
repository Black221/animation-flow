import { expect, test } from './fixtures';
import { signedIn, newProject } from './auth';

test('two people edit the same project at once: changes, presence and autosave', async ({ page, browser }) => {
  await signedIn(page);
  await newProject(page);
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  const url = page.url();

  // Léa joins the workspace as an editor and opens the same project
  const me = await (await page.request.get('/api/auth/me')).json();
  const inv = await (await page.request.post('/api/workspace/invitations', { data: { role: 'editor' }, headers: { 'x-workspace-id': me.workspaces[0].id } })).json();
  const other = await browser.newContext({ extraHTTPHeaders: { 'x-requested-with': 'animation-flow' } });
  const mate = await other.newPage();
  expect((await mate.request.post('/api/auth/signup', { data: { email: 'lea@example.org', name: 'Léa', password: 'mot-de-passe-solide-3', invitation: inv.path.split('/').pop() } })).status()).toBe(201);
  await mate.goto(url);

  // each sees the other
  await expect(page.getByTestId('peers')).toContainText('Léa');
  await expect(mate.getByTestId('peers')).toContainText('Olga');

  // Olga renames the project: Léa sees it without reloading
  await page.getByRole('tab', { name: 'Projet' }).click();
  await page.getByLabel('Titre', { exact: true }).fill('Titre en direct');
  await expect(mate.locator('.editor-bar h1')).toHaveText('Titre en direct');

  // Léa edits scene s1 in its JSON while Olga looks at it: Olga's text follows, and her own title edit stays
  await page.getByRole('tab', { name: /Scène/ }).click();
  await page.getByText('Code de la scène (JSON)').click();
  await mate.getByText('Code de la scène (JSON)').click();
  const hers = mate.getByLabel('scène (JSON)');
  await hers.fill((await hers.inputValue()).replace('"title": "La carte avant le voyage"', '"title": "Carte de Léa"'));
  await expect(page.getByLabel('scène (JSON)')).toHaveValue(/"title": "Carte de Léa"/);
  await expect(page.locator('.editor-bar h1')).toHaveText('Titre en direct');

  // where Léa is: a dot on the scene she selects
  await mate.locator('.scenes li button').nth(1).click();
  await expect(page.getByLabel('Léa est ici')).toBeVisible();
  await expect(page.locator('.scenes li button').nth(1).getByLabel('Léa est ici')).toBeVisible();

  // saved by itself: after a reload the changes are there
  await expect(page.getByTestId('save-state')).toHaveText(/^version \d+$/, { timeout: 15_000 });
  await expect(mate.getByTestId('save-state')).toHaveText(/^version \d+$/, { timeout: 15_000 });
  await mate.reload();
  await expect(mate.locator('.editor-bar h1')).toHaveText('Titre en direct');
  await expect(mate.locator('.scenes li button').first()).toContainText('Carte de Léa');
  await other.close();
});

test('without the live connection, the editor falls back to saving by hand', async ({ page }) => {
  await page.routeWebSocket(/\/live/, (ws) => ws.close({ code: 1011 })); // e.g. a proxy that does not pass WebSocket
  await signedIn(page);
  await newProject(page);
  await expect(page.getByTestId('live-state')).toHaveText('hors direct', { timeout: 15_000 });
  await page.getByRole('tab', { name: 'Projet' }).click();
  await page.getByLabel('Titre', { exact: true }).fill('Enregistré à la main');
  await expect(page.getByTestId('save-state')).toHaveText('modifié');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('version 2');
  await page.reload();
  await expect(page.locator('.editor-bar h1')).toHaveText('Enregistré à la main', { timeout: 15_000 });
});
