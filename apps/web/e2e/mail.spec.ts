import { expect, test } from './fixtures';
import { MAIL_HTTP } from '../playwright.config';
import { signedIn } from './auth';

/** the last message the sink received for an address with a link of that kind, and the link */
async function mailTo(address: string, kind: 'invite' | 'reset') {
  const decode = (d: string) => d.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  const pattern = new RegExp(`http://127\\.0\\.0\\.1:\\d+/${kind}/[\\w-]+`);
  let found = '';
  await expect.poll(async () => {
    const all: { to: string[]; data: string }[] = await (await fetch(`http://127.0.0.1:${MAIL_HTTP}/messages`)).json();
    found = all.filter((m) => m.to.includes(address) && pattern.test(decode(m.data))).map((m) => decode(m.data)).at(-1) ?? '';
    return !!found;
  }, { timeout: 10_000 }).toBe(true);
  return { text: found, link: found.match(pattern)![0] };
}

test('invite by e-mail, then reset a forgotten password from the e-mailed link', async ({ page, browser }) => {
  await signedIn(page);
  await page.goto('/team');
  await page.getByRole('button', { name: 'Inviter', exact: true }).click();
  const invite = page.getByRole('dialog', { name: /Inviter/ });
  await invite.getByLabel('rôle invité').selectOption('editor');
  await invite.getByLabel('e-mail invité').fill('mailed@example.org');
  await expect(invite.getByLabel('envoyer par e-mail')).toBeChecked();
  await invite.getByRole('button', { name: "Envoyer l'invitation" }).click();
  await expect(invite.getByTestId('invite-sent')).toHaveText('Invitation envoyée à mailed@example.org.');

  const invitation = await mailTo('mailed@example.org', 'invite');
  expect(invitation.text).toContain('Olga vous invite');
  const other = await browser.newContext({ extraHTTPHeaders: { 'x-requested-with': 'animation-flow' } });
  const mate = await other.newPage();
  await mate.goto(invitation.link);
  const form = mate.getByRole('form', { name: 'inscription' });
  await expect(form.getByLabel('E-mail')).toHaveValue('mailed@example.org');
  await form.getByLabel('Nom').fill('Mia');
  await form.getByLabel(/Mot de passe/).fill('premier-mot-de-passe-5');
  await form.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(mate.getByLabel('espace de travail')).toContainText('éditeur');

  // Mia signs out, forgets her password, resets it from the e-mail
  await mate.getByRole('button', { name: /^compte de/ }).click();
  await mate.getByRole('menuitem', { name: 'Se déconnecter' }).click();
  await mate.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  // scoped to the form: the login page stays mounted for a moment while the router switches pages
  const forgot = mate.getByRole('form', { name: 'mot de passe oublié' });
  await forgot.getByLabel('E-mail').fill('mailed@example.org');
  await forgot.getByRole('button', { name: 'Envoyer le lien' }).click();
  await expect(mate.getByTestId('forgot-sent')).toBeVisible();
  const reset = await mailTo('mailed@example.org', 'reset');
  expect(reset.link).toContain('/reset/');
  await mate.goto(reset.link);
  const fresh = mate.getByRole('form', { name: 'nouveau mot de passe' });
  await expect(fresh).toContainText('mailed@example.org');
  await fresh.getByLabel(/Nouveau mot de passe/).fill('second-mot-de-passe-6');
  await fresh.getByLabel('Encore une fois').fill('second-mot-de-passe-6');
  await fresh.getByRole('button', { name: 'Changer le mot de passe' }).click();
  await expect(mate.getByLabel('espace de travail')).toContainText('éditeur');
  // the link served once
  await mate.goto(reset.link);
  await expect(mate.getByRole('alert')).toContainText('déjà utilisé');
  await other.close();
});
