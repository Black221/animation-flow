// E-mail, optional: with SMTP_URL (and APP_URL for the links), invitations can be sent by e-mail and a forgotten
// password can be reset through a link. Without it, invitations are links to pass on by hand, and a password is
// changed from the profile. Links are built from APP_URL only, never from the request (a forged Host header would
// otherwise send people to another site).
export interface Mail { to: string; subject: string; text: string; html: string }
export interface Mailer { send(m: Mail): Promise<void> }
export interface MailSetup { mailer: Mailer; appUrl: string }

export async function smtpMailer(url: string, from: string): Promise<Mailer> {
  const { createTransport } = await import('nodemailer');
  const transport = createTransport(url);
  return { send: async (m) => { await transport.sendMail({ from, ...m }); } };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const page = (paragraphs: string[], link: { url: string; label: string }, after: string) => `<!doctype html><html lang="fr"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1d2433;max-width:560px;margin:auto;padding:24px">
${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n')}
<p><a href="${esc(link.url)}" style="display:inline-block;padding:10px 18px;background:#2F6FB3;color:#fff;border-radius:6px;text-decoration:none">${esc(link.label)}</a></p>
<p style="color:#667;font-size:13px">${esc(after)}<br>${esc(link.url)}</p>
</body></html>`;

const ROLE: Record<string, string> = { admin: 'administrateur', editor: 'éditeur', viewer: 'lecteur' };

export function invitationMail(o: { to: string; by: string; workspace: string; role: string; url: string; days: number }): Mail {
  const lines = [`Bonjour,`, `${o.by} vous invite à rejoindre l'espace « ${o.workspace} » sur animation-flow, comme ${ROLE[o.role] ?? o.role}.`];
  const after = `Le lien est valable ${o.days} jour(s) et ne sert qu'une fois. Si vous ne vous attendiez pas à cette invitation, ignorez ce message.`;
  return {
    to: o.to, subject: `${o.by} vous invite sur animation-flow`,
    text: `${lines.join('\n\n')}\n\nRejoindre l'équipe : ${o.url}\n\n${after}\n`,
    html: page(lines, { url: o.url, label: "Rejoindre l'équipe" }, after),
  };
}

export function resetMail(o: { to: string; name: string; url: string; minutes: number }): Mail {
  const lines = [`Bonjour ${o.name},`, `Quelqu'un (vous, sans doute) a demandé à changer le mot de passe de votre compte animation-flow.`];
  const after = `Le lien est valable ${o.minutes} minutes et ne sert qu'une fois. Si vous n'avez rien demandé, ignorez ce message : votre mot de passe ne change pas.`;
  return {
    to: o.to, subject: 'Changer votre mot de passe animation-flow',
    text: `${lines.join('\n\n')}\n\nChoisir un nouveau mot de passe : ${o.url}\n\n${after}\n`,
    html: page(lines, { url: o.url, label: 'Choisir un nouveau mot de passe' }, after),
  };
}
