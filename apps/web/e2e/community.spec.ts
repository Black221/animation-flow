import { expect, test } from './fixtures';
import { newProject, signedIn } from './auth';

test('publish a film, watch it signed out, like it, remix it', async ({ page, browser }) => {
  await signedIn(page);
  await newProject(page, 'Pizza', 'Pizza du quartier');
  // publishing, from the editor, in a dialog
  await page.getByRole('button', { name: 'Publier', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Publier dans la communauté' });
  await dlg.getByLabel('Description').fill('Une pub fun.');
  await dlg.getByLabel('Étiquettes').fill('pub, pizza');
  await dlg.getByRole('button', { name: 'Publier', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Publié dans la communauté');
  await expect(page.getByRole('button', { name: 'Publié' })).toBeVisible();

  // anyone can watch it: no account needed
  const anon = await browser.newContext({ extraHTTPHeaders: { 'x-requested-with': 'animation-flow' } });
  const visitor = await anon.newPage();
  await visitor.goto('/c');
  await visitor.getByRole('link', { name: 'Pizza du quartier' }).click();
  await expect(visitor.getByTestId('preview')).toBeVisible();
  await expect(visitor.getByRole('button', { name: 'Remixer' })).toBeDisabled();
  await expect(visitor.getByText(/pour remixer ce film/)).toBeVisible();
  await visitor.getByRole('button', { name: 'informations' }).click();
  await expect(visitor.getByRole('dialog', { name: 'Informations' })).toContainText('CC BY');
  await anon.close();

  // signed in: like it, then remix it into the workspace
  await page.goto('/c?tag=pizza');
  await page.getByRole('link', { name: 'Pizza du quartier' }).click();
  await page.getByRole('button', { name: "j'aime" }).click();
  await expect(page.getByRole('button', { name: "j'aime" })).toHaveText('1');
  await page.getByRole('button', { name: 'Remixer' }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  await expect(page.locator('.editor-bar h1')).toContainText('Pizza du quartier (remix)');
  await expect(page.locator('.editor-bar .origin')).toContainText('remix de « Pizza du quartier »');
});

test('on a phone, the navigation is a drawer and dialogs rise from the bottom', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-requested-with': 'animation-flow' } });
  const page = await ctx.newPage();
  await signedIn(page);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'navigation' })).not.toBeInViewport();
  await page.getByRole('button', { name: 'ouvrir le menu' }).click();
  await expect(page.getByRole('navigation', { name: 'navigation' })).toBeInViewport();
  await page.getByRole('navigation', { name: 'navigation' }).getByRole('link', { name: 'Mes projets' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('navigation', { name: 'navigation' })).not.toBeInViewport();
  await page.locator('.page-head').getByRole('button', { name: 'Nouveau projet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Nouveau projet' });
  // once it has risen (it slides up as it opens): full width, down to the bottom edge
  await expect.poll(async () => { const b = await sheet.boundingBox(); return b && [Math.round(b.width), Math.round(b.y + b.height)]; }).toEqual([390, 844]);
  await page.keyboard.press('Escape');
  // nothing wider than the screen, on any page
  for (const path of ['/', '/create', '/projects', '/c', '/settings', '/team']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
    // nor cut off inside the page (a card, a hero clips what sticks out of it): the idea box, its button
    for (const sel of ['.prompt', '.prompt .cta']) {
      if (!(await page.locator(sel).count())) continue;
      const box = await page.locator(sel).first().boundingBox();
      expect(box && box.x + box.width, `${path} ${sel}`).toBeLessThanOrEqual(390);
    }
  }
  await newProject(page, 'Pizza');
  await expect(page.getByTestId('preview')).toBeVisible();
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('.focus-layout, .editor')].map((e) => e.scrollWidth))), 'editor').toBeLessThanOrEqual(390);
  await ctx.close();
});

for (const [w, h] of [[820, 1180], [1024, 768], [1180, 820]] as const) {
  test(`on a ${w}×${h} tablet, nothing is wider than the screen and the editor shows preview and inspector together`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, extraHTTPHeaders: { 'x-requested-with': 'animation-flow' } });
    const page = await ctx.newPage();
    await signedIn(page);
    for (const path of ['/', '/create', '/projects', '/c', '/settings', '/team', '/profile']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(w);
    }
    await newProject(page, 'Pizza');
    await expect(page.getByTestId('preview')).toBeVisible();
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('.focus-layout, .editor')].map((e) => e.scrollWidth))), 'editor').toBeLessThanOrEqual(w);
    // in landscape, the preview and the inspector's tabs are both on screen at once
    if (w > h) {
      await expect(page.getByTestId('preview')).toBeInViewport();
      await expect(page.getByRole('tab', { name: /Commentaires/ })).toBeInViewport({ ratio: 1 });
    }
    await ctx.close();
  });
}
