import { expect, test } from './fixtures';
import { ADMIN } from '../playwright.config';
import { backOffice, MANAGER, OWNER, signedIn } from './auth';

test('the back office is the platform manager’s: users of the platform — owners of their workspace included — cannot get in', async ({ page, browser }) => {
  await signedIn(page);
  // the app shows its users no way into the back office; they run their workspace from its Team page
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'navigation' }).getByRole('link', { name: 'Back-office' })).toHaveCount(0);
  await page.goto('/team');
  await expect(page.getByRole('button', { name: 'Inviter', exact: true })).toBeVisible();
  // the owner of a workspace, with the right password, is no manager
  const ctx = await browser.newContext({ baseURL: ADMIN, extraHTTPHeaders: {} });
  const bo = await ctx.newPage();
  await bo.goto('/');
  const form = bo.getByRole('form', { name: 'connexion au back-office' });
  await form.getByLabel('E-mail').fill(OWNER.email);
  await form.getByLabel('Mot de passe').fill(OWNER.password);
  await form.getByRole('button', { name: 'Se connecter' }).click();
  await expect(form.getByRole('alert')).toContainText('accès refusé');
  // nor does the app's session open anything there
  expect((await page.request.get(`${ADMIN}/api/admin/overview`)).status()).toBe(401);
  await ctx.close();
});

test('managers invite managers: the link, the new manager’s own account, the list', async ({ page, browser }) => {
  await signedIn(page);
  const bo = await backOffice(browser);
  await bo.getByRole('navigation', { name: 'back-office' }).getByRole('link', { name: 'Gérants' }).click();
  await expect(bo.getByRole('table', { name: 'gérants' })).toContainText(MANAGER.name);
  const email = `aide-${Date.now()}@example.org`;
  await bo.getByRole('button', { name: 'Inviter un gérant' }).click();
  const dlg = bo.getByRole('dialog', { name: 'Inviter un gérant' });
  await dlg.getByLabel('e-mail du gérant').fill(email);
  await dlg.getByRole('button', { name: 'Créer le lien' }).click();
  const link = await dlg.getByLabel("lien d'invitation").inputValue();
  expect(link).toMatch(new RegExp(`^${ADMIN}/join/[\\w-]{20,}$`));
  await dlg.getByRole('button', { name: 'Terminé' }).click();
  await expect(bo.getByRole('list', { name: 'invitations de gérants' })).toContainText(email);
  // the new manager opens the link in a browser of their own
  const ctx = await browser.newContext({ extraHTTPHeaders: {} });
  const them = await ctx.newPage();
  await them.goto(link);
  const join = them.getByRole('form', { name: 'rejoindre les gérants' });
  await expect(join).toContainText(email);
  await join.getByLabel('Nom').fill('Aïcha');
  await join.getByLabel(/Mot de passe/).fill('mot-de-passe-aide-01');
  await join.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(them.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  await bo.reload();
  await expect(bo.getByRole('table', { name: 'gérants' })).toContainText('Aïcha');
  await ctx.close(); await bo.context().close();
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
  await expect(log.getByText(MANAGER.name).first()).toBeVisible();
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
  for (const path of ['/', '/users', '/workspaces', '/subscriptions', '/plans', '/moderation', '/films', '/staff', '/audit']) {
    await bo.goto(path);
    await bo.waitForLoadState('networkidle');
    expect(await bo.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector('.bo-main')?.scrollWidth ?? 0)), path).toBeLessThanOrEqual(390);
  }
  await bo.context().close();
});
