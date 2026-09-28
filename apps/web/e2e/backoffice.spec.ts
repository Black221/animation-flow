import { expect, test } from '@playwright/test';
import { ADMIN } from '../playwright.config';
import { backOffice, OWNER, signedIn } from './auth';

test('the back office is an app of its own: its sign-in refuses non-admins; the app links platform admins to it', async ({ page, browser }) => {
  await signedIn(page);
  // the app has no administration page; its admin gets a link to the back office
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'navigation' }).getByRole('link', { name: 'Back-office' })).toHaveAttribute('href', ADMIN);
  // a member without the rights cannot get in
  const inv = await (await page.request.post('/api/workspace/invitations', { data: { role: 'viewer' } })).json();
  const email = `zoe-${Date.now()}@example.org`;
  const other = await browser.newContext();
  expect((await other.request.post('/api/auth/signup', { data: { email, name: 'Zoé', password: 'mot-de-passe-solide-5', invitation: inv.path.split('/').pop() } })).status()).toBe(201);
  const ctx = await browser.newContext({ baseURL: ADMIN, extraHTTPHeaders: {} });
  const bo = await ctx.newPage();
  await bo.goto('/');
  const form = bo.getByRole('form', { name: 'connexion au back-office' });
  await form.getByLabel('E-mail').fill(email);
  await form.getByLabel('Mot de passe').fill('mot-de-passe-solide-5');
  await form.getByRole('button', { name: 'Se connecter' }).click();
  await expect(form.getByRole('alert')).toContainText('accès refusé');
  // the app's session opens nothing there
  expect((await other.request.get(`${ADMIN}/api/admin/overview`)).status()).toBe(401);
  await ctx.close(); await other.close();
});

test('the back office: dashboard, a workspace’s custom limits, the films, the audit log', async ({ page, browser }) => {
  await signedIn(page);
  const bo = await backOffice(browser);
  await expect(bo.getByRole('region', { name: 'inscriptions' })).toBeVisible();
  await expect(bo.getByRole('region', { name: 'espaces par plan' })).toContainText('Pro');

  // the owner's workspace: custom limits
  const nav = bo.getByRole('navigation', { name: 'back-office' });
  await nav.getByRole('link', { name: 'Espaces' }).click();
  await bo.getByLabel('chercher un espace').fill('Mon espace');
  await bo.getByRole('table', { name: 'espaces' }).getByRole('link', { name: 'Mon espace' }).first().click();
  await expect(bo.getByRole('table', { name: 'membres' })).toContainText(OWNER.name);
  await bo.getByRole('button', { name: /Limites sur mesure/ }).click();
  const limits = bo.getByRole('dialog', { name: 'Limites sur mesure' });
  await limits.getByLabel('Membres').fill('80');
  await limits.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(bo.getByRole('button', { name: 'Limites sur mesure (1)' })).toBeVisible();
  await expect(bo.getByRole('region', { name: 'utilisation' }).getByRole('meter', { name: 'Membres' })).toHaveAttribute('aria-valuemax', '80');

  // the films, hidden and brought back
  const pid = (await (await page.request.post('/api/projects', { data: { template: 'example' } })).json()).id;
  const title = `Film du back-office ${Date.now()}`;
  const pub = await (await page.request.post(`/api/projects/${pid}/publish`, { data: { title } })).json();
  await nav.getByRole('link', { name: 'Films publiés' }).click();
  await bo.getByLabel('chercher un film').fill(title);
  const row = bo.getByRole('table', { name: 'films' }).getByRole('row').filter({ hasText: title });
  await row.getByRole('button', { name: 'Masquer' }).click();
  await bo.getByRole('dialog', { name: /Masquer/ }).getByRole('button', { name: 'Masquer' }).click();
  await expect(row).toContainText('masqué');
  expect((await browser.newContext().then((c) => c.request.get(`/api/community/${pub.id}`, { failOnStatusCode: false }))).status()).toBe(404);
  await row.getByRole('button', { name: 'Remettre' }).click();
  await bo.getByRole('dialog', { name: /Remettre/ }).getByRole('button', { name: 'Remettre' }).click();
  await expect(row).not.toContainText('masqué');

  // all of it, in the audit log
  await nav.getByRole('link', { name: 'Journal' }).click();
  const log = bo.getByRole('list', { name: 'journal' });
  await expect(log).toContainText(`a remis dans la communauté « ${title} »`);
  await expect(log).toContainText(`a masqué « ${title} »`);
  await expect(log).toContainText('members 80');
  await expect(log).toContainText('connexion au back-office');
  // and back to the plan's limits
  await page.request.get('/api/health');
  await bo.goto('/workspaces');
  await bo.getByLabel('chercher un espace').fill('Mon espace');
  await bo.getByRole('table', { name: 'espaces' }).getByRole('link', { name: 'Mon espace' }).first().click();
  await bo.getByRole('button', { name: /Limites sur mesure/ }).click();
  await bo.getByRole('dialog', { name: 'Limites sur mesure' }).getByRole('button', { name: 'Tout remettre au plan' }).click();
  await bo.getByRole('dialog', { name: 'Limites sur mesure' }).getByRole('button', { name: 'Enregistrer' }).click();
  await expect(bo.getByRole('button', { name: 'Limites sur mesure', exact: true })).toBeVisible();
  await bo.context().close();
});

test('on a phone, the back office’s sections are in a drawer and nothing is wider than the screen', async ({ page, browser }) => {
  await signedIn(page);
  const bo = await backOffice(browser, { width: 390, height: 844 });
  await expect(bo.getByRole('navigation', { name: 'back-office' })).not.toBeInViewport();
  await bo.getByRole('button', { name: 'ouvrir le menu' }).click();
  await bo.getByRole('navigation', { name: 'back-office' }).getByRole('link', { name: 'Utilisateurs' }).click();
  await expect(bo).toHaveURL(/\/users$/);
  for (const path of ['/', '/users', '/workspaces', '/subscriptions', '/plans', '/moderation', '/films', '/audit']) {
    await bo.goto(path);
    await bo.waitForLoadState('networkidle');
    expect(await bo.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('.bo-main')?.scrollWidth ?? 0)), path).toBeLessThanOrEqual(390);
  }
  await bo.context().close();
});
