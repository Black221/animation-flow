import { expect, test } from '@playwright/test';
import { signedIn } from './auth';

const bg = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('light, dark or as the system says: the choice is kept, and applied before the page draws', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  await signedIn(page);
  await page.goto('/');
  const light = await bg(page);

  await page.getByRole('button', { name: /^compte de/ }).click();
  await page.getByRole('group', { name: 'thème' }).getByRole('button', { name: 'Sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const dark = await bg(page);
  expect(dark).not.toBe(light);

  // kept across reloads, set by the inline script before React starts
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg(page)).toBe(dark);

  // « Auto » follows the system (here: light), and follows it when it changes
  await page.getByRole('button', { name: /^compte de/ }).click();
  await page.getByRole('group', { name: 'thème' }).getByRole('button', { name: 'Auto' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  expect(await bg(page)).toBe(light);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => bg(page)).toBe(dark);
  await ctx.close();
});
