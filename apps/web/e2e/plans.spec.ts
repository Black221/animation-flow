import { expect, test } from './fixtures';
import type { Browser } from '@playwright/test';
import { backOffice, signedIn } from './auth';

const H = { 'x-requested-with': 'animation-flow' };

/** someone new, invited by the owner, who then opens a workspace of their own (on the free plan) */
async function newcomer(browser: Browser, owner: import('@playwright/test').Page, email: string, name: string) {
  const inv = await (await owner.request.post('/api/workspace/invitations', { data: { role: 'viewer' } })).json();
  const ctx = await browser.newContext({ extraHTTPHeaders: H });
  const page = await ctx.newPage();
  expect((await page.request.post('/api/auth/signup', { data: { email, name, password: 'mot-de-passe-solide-3', invitation: inv.path.split('/').pop() } })).status()).toBe(201);
  const ws = await (await page.request.post('/api/workspaces', { data: { name: `Studio de ${name}` } })).json();
  await page.addInitScript((id) => localStorage.setItem('af-workspace', id), ws.id);
  return { ctx, page, ws };
}

test('the free plan: a limit reached explains itself and leads to the plans; the admin changes the plan', async ({ page, browser }) => {
  await signedIn(page);
  const { ctx, page: nina, ws } = await newcomer(browser, page, `nina-${Date.now()}@example.org`, 'Nina');
  for (let i = 0; i < 3; i++) expect((await nina.request.post('/api/projects', { data: { template: 'blank' }, headers: { 'x-workspace-id': ws.id } })).status()).toBe(201);

  // the fourth project: a dialog says which limit, how much, and what a bigger plan gives
  await nina.goto('/projects');
  await expect(nina.getByRole('link', { name: /Abonnement/ })).toContainText('Gratuit');
  await nina.locator('.page-head').getByRole('button', { name: 'Nouveau projet' }).click();
  await nina.getByRole('dialog', { name: 'Nouveau projet' }).getByRole('button', { name: 'Créer', exact: true }).click();
  const over = nina.getByRole('dialog', { name: 'limite du plan atteinte' });
  await expect(over).toContainText('Le plan Gratuit comprend 3 projets');
  await expect(over.getByRole('meter', { name: 'Projets' })).toHaveAttribute('aria-valuenow', '3');
  await expect(over).toContainText('Premium');
  await over.getByRole('button', { name: 'Voir les plans' }).click();

  // the plans page: the meters, the four plans; no online payment on this server
  await expect(nina).toHaveURL(/\/plans$/);
  await expect(nina.getByRole('region', { name: 'plan actuel' })).toContainText('Gratuit');
  await expect(nina.getByRole('region', { name: 'plan actuel' }).getByRole('meter', { name: 'Projets' })).toHaveAttribute('aria-valuetext', '3 sur 3');
  // the sidebar shows the limit nearest to being reached
  await expect(nina.getByRole('link', { name: 'utilisation du plan' }).getByRole('meter')).toHaveAccessibleName('Projets');
  await expect(nina.getByRole('list', { name: 'plans' }).locator(':scope > li')).toHaveCount(3);
  await expect(nina.getByRole('button', { name: 'Plan actuel' })).toBeDisabled();
  await expect(nina.getByText("Le paiement en ligne n'est pas activé")).toBeVisible();

  // the platform admin (the first account), in the back office, finds her and moves her workspace to Premium
  const bo = await backOffice(browser);
  await bo.getByRole('navigation', { name: 'back-office' }).getByRole('link', { name: 'Utilisateurs' }).click();
  await bo.getByLabel('chercher un utilisateur').fill('nina');
  await bo.getByRole('link', { name: 'Nina', exact: true }).click();
  await bo.getByLabel('plan de Studio de Nina').selectOption('premium');
  await bo.getByRole('dialog', { name: /Passer « Studio de Nina » au plan Premium/ }).getByRole('button', { name: 'Changer de plan' }).click();
  await expect(bo.getByRole('region', { name: 'espace Studio de Nina' })).toContainText('Premium');
  await bo.context().close();

  // she can go on
  await nina.goto('/plans');
  await expect(nina.getByRole('region', { name: 'plan actuel' })).toContainText('Premium');
  expect((await nina.request.post('/api/projects', { data: { template: 'blank' }, headers: { 'x-workspace-id': ws.id } })).status()).toBe(201);
  await ctx.close();
});

test('reporting a film, and the moderation hiding it from the community', async ({ page, browser }) => {
  await signedIn(page);
  const pid = (await (await page.request.post('/api/projects', { data: { template: 'example' } })).json()).id;
  const pub = await (await page.request.post(`/api/projects/${pid}/publish`, { data: { title: `Film à signaler ${Date.now()}` } })).json();
  const { ctx, page: tom } = await newcomer(browser, page, `tom-${Date.now()}@example.org`, 'Tom');
  await tom.goto(`/c/${pub.id}`);
  await tom.getByRole('button', { name: 'signaler' }).click();
  const dlg = tom.getByRole('dialog', { name: 'Signaler ce film' });
  await dlg.getByLabel("Droits d'auteur").check();
  await dlg.getByLabel('précisions').fill('la musique est reprise sans accord');
  await dlg.getByRole('button', { name: 'Signaler' }).click();
  await expect(tom.getByText('la modération va regarder')).toBeVisible();

  const bo = await backOffice(browser);
  await bo.getByRole('navigation', { name: 'back-office' }).getByRole('link', { name: /Modération/ }).click();
  const item = bo.getByRole('list', { name: 'signalements' }).getByRole('listitem').filter({ hasText: pub.title });
  await expect(item).toContainText('la musique est reprise sans accord');
  await item.getByRole('button', { name: 'Masquer' }).click();
  await bo.getByRole('dialog', { name: /Masquer/ }).getByRole('button', { name: 'Masquer' }).click();
  await expect(item).toHaveCount(0);
  await bo.context().close();
  // gone for others, still there for its author (who is told)
  expect((await tom.request.get(`/api/community/${pub.id}`)).status()).toBe(404);
  await page.goto(`/c/${pub.id}`);
  await expect(page.getByText('Masqué par la modération')).toBeVisible();
  await ctx.close();
});

test('on a phone, the editor keeps the scene, the voices and the comments; no keyboard shortcuts on touch', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, extraHTTPHeaders: H });
  const page = await ctx.newPage();
  await signedIn(page);
  const pid = (await (await page.request.post('/api/projects', { data: { template: 'pizza' } })).json()).id;
  await page.goto(`/p/${pid}`);
  await expect(page.getByTestId('preview')).toBeVisible();
  const tabs = page.getByRole('tablist');
  for (const t of ['Scène', 'Voix', 'Commentaires']) await expect(tabs.getByRole('tab', { name: new RegExp(t) })).toBeVisible();
  for (const t of ['Dessins', 'Musique', 'Projet']) await expect(tabs.getByRole('tab', { name: t })).toHaveCount(0);
  await expect(page.getByText('sur une tablette ou un ordinateur')).toBeVisible();
  await expect(page.getByRole('button', { name: 'raccourcis clavier' })).toHaveCount(0);
  await ctx.close();
});
