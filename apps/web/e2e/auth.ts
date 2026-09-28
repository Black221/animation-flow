import { expect, type Browser, type Page } from '@playwright/test';
import { ADMIN } from '../playwright.config';

export const OWNER = { email: 'owner@example.org', name: 'Olga', password: 'mot-de-passe-solide-1' };

/** sign in as the owner (creating the first account on a fresh server); the page's context keeps the cookie. Signing
 *  in comes first: sign-ups are limited per address, and every test would spend one */
export async function signedIn(page: Page, who = OWNER) {
  if ((await page.request.post('/api/auth/login', { data: { email: who.email, password: who.password } })).ok()) return;
  const up = await page.request.post('/api/auth/signup', { data: who });
  if (up.status() !== 201) expect((await page.request.post('/api/auth/login', { data: { email: who.email, password: who.password } })).ok()).toBe(true);
}

/** create a project the way people do: « Nouveau projet », a template, a title, « Créer » (the editor opens) */
export async function newProject(page: Page, template = 'Awa et Jumo', title?: string) {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Nouveau projet' });
  await dlg.getByRole('radio', { name: new RegExp(template) }).click();
  if (title) await dlg.getByLabel('titre', { exact: true }).fill(title);
  await dlg.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
}

/** the back office, in a browser of its own, signed in as the owner (the platform admin) through its sign-in form */
export async function backOffice(browser: Browser, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, baseURL: ADMIN, extraHTTPHeaders: {} });
  const page = await ctx.newPage();
  await page.goto('/');
  const form = page.getByRole('form', { name: 'connexion au back-office' });
  await form.getByLabel('E-mail').fill(OWNER.email);
  await form.getByLabel('Mot de passe').fill(OWNER.password);
  await form.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  return page;
}
