import { expect, test } from './fixtures';
import { signedIn, newProject } from './auth';

test('invite a teammate from the Team page; roles change what they can do', async ({ page, browser }) => {
  await signedIn(page);
  await newProject(page);
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByTestId('author')).toHaveText('par Olga');

  // the owner makes an invitation link for an editor
  // from the editor (no navigation there), back to the projects, then the team
  await page.getByRole('link', { name: 'Projets' }).click();
  await page.getByRole('link', { name: 'Équipe' }).click();
  await page.getByRole('button', { name: 'Inviter', exact: true }).click();
  const invite = page.getByRole('dialog', { name: /Inviter/ });
  await invite.getByLabel('rôle invité').selectOption('editor');
  await invite.getByRole('button', { name: 'Créer un lien' }).click();
  const link = await invite.getByLabel("lien d'invitation").inputValue();
  expect(link).toMatch(/\/invite\/[\w-]{20,}$/);

  // the teammate opens it in another browser, signs up, lands in the owner's workspace
  const other = await browser.newContext({ extraHTTPHeaders: { 'x-requested-with': 'animation-flow' } });
  const mate = await other.newPage();
  await mate.goto(link);
  await expect(mate.getByRole('main').or(mate.locator('body'))).toContainText('comme éditeur');
  const form = mate.getByRole('form', { name: 'inscription' });
  await form.getByLabel('Nom').fill('Ed');
  await form.getByLabel('E-mail').fill('ed@example.org');
  await form.getByLabel(/Mot de passe/).fill('mot-de-passe-solide-2');
  await form.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(mate.getByLabel('espace de travail')).toContainText('Mon espace · éditeur');
  await expect(mate.locator('.project-grid li').first()).toBeVisible(); // the workspace's projects (other tests add some meanwhile)

  // the owner sees Ed among the members and makes Ed a viewer
  await page.reload();
  await expect(page.getByTestId('member').filter({ has: page.getByText('ed@example.org', { exact: true }) })).toHaveCount(1);
  await page.getByLabel('rôle de Ed').selectOption('viewer');

  // now read-only for the teammate: no save, no creation, keys page locked
  await mate.goto('/');
  await expect(mate.getByText(/Rôle lecteur : vous consultez/)).toBeVisible();
  await expect(mate.getByRole('button', { name: 'Créer' })).toHaveCount(0);
  await mate.locator('.project-grid .title').first().click();
  await expect(mate.getByTestId('read-only')).toBeVisible();
  await expect(mate.getByRole('button', { name: 'Enregistrer', exact: true })).toHaveCount(0);
  await mate.goto('/settings');
  await expect(mate.getByTestId('read-only')).toBeVisible();

  // signing out closes the session
  await mate.getByRole('button', { name: /^compte de/ }).click();
  await mate.getByRole('menuitem', { name: 'Se déconnecter' }).click();
  await expect(mate.getByRole('form', { name: 'connexion' })).toBeVisible();
  await other.close();
});
