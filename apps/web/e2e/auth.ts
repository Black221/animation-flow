import { expect, type Page } from '@playwright/test';

export const OWNER = { email: 'owner@example.org', name: 'Olga', password: 'mot-de-passe-solide-1' };

/** sign in as the owner (creating the first account on a fresh server); the page's context keeps the cookie */
export async function signedIn(page: Page, who = OWNER) {
  const up = await page.request.post('/api/auth/signup', { data: who });
  if (up.status() !== 201) expect((await page.request.post('/api/auth/login', { data: { email: who.email, password: who.password } })).ok()).toBe(true);
}
