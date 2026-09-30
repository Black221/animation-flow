// Files are brought to the AI with the prompt, as MODELS: a picture of the mascot, a music, a project, a text. The
// request carries them; nothing is imported into a project afterwards (the editor and « Mes projets » only export).
import { signedIn, newProject } from './auth';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** a WAV of a beat (mono, 16 bits): a kick at `bpm` over a low tone */
function wav(seconds: number, bpm = 120, freq = 220, rate = 48000): Buffer {
  const n = Math.round(seconds * rate), b = Buffer.alloc(44 + n * 2), period = Math.round((60 / bpm) * rate);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const k = i % period; b.writeInt16LE(Math.round(5000 * Math.sin((2 * Math.PI * freq * i) / rate) + (k < rate / 4 ? 18000 * Math.sin((2 * Math.PI * 60 * k) / rate) * Math.exp(-k / (0.06 * rate)) : 0)), 44 + i * 2); }
  return b;
}
/** a zip with stored (uncompressed) entries: enough for a .docx */
function zip(files: Record<string, string>): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (d: Buffer) => { let c = 0xffffffff; for (const x of d) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), n = Buffer.from(name), c = crc(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt32LE(c, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    const h = Buffer.alloc(46); h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt32LE(c, 16); h.writeUInt32LE(data.length, 20); h.writeUInt32LE(data.length, 24); h.writeUInt16LE(n.length, 28); h.writeUInt32LE(offset, 42);
    locals.push(l, n, data); centrals.push(h, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
/** a one-page PDF with a line of text */
function pdf(text: string): Buffer {
  const content = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n';
  const at: number[] = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
/** a transparent PNG with a red disc, drawn by the browser */
const logo = async (page: Page) => Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 150; const x = c.getContext('2d')!; x.fillStyle = '#E63946'; x.beginPath(); x.arc(75, 75, 70, 0, Math.PI * 2); x.fill(); return c.toDataURL('image/png').split(',')[1]!; }), 'base64');
const choose = async (page: Page, click: () => Promise<void>, files: { name: string; mimeType: string; buffer: Buffer } | { name: string; mimeType: string; buffer: Buffer }[]) => {
  const chooser = page.waitForEvent('filechooser');
  await click();
  await (await chooser).setFiles(files);
};

test('models joined to the prompt: a mascot, a music, a project, a text — sent with the request', async ({ page }) => {
  test.setTimeout(90_000);
  await signedIn(page);
  await page.goto('/create');
  const ai = page.getByRole('region', { name: "créer avec l'IA" }), models = ai.getByLabel('modèles pour l’IA');
  await ai.getByLabel('texte source').fill('Une campagne fun pour les Jeux olympiques de la jeunesse Dakar 2026.');

  // a picture: what it shows (a character), its name, a few words — the AI draws after it
  await choose(page, () => ai.getByRole('button', { name: 'Joindre' }).click(), { name: 'lion.png', mimeType: 'image/png', buffer: await logo(page) });
  const dialog = page.getByRole('dialog', { name: 'Une image comme modèle' });
  await expect(dialog).toContainText('l’image elle-même n’est pas mise dans la vidéo');
  await expect(dialog.getByRole('radio', { name: 'Personnage' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('radio')).toHaveCount(4); // Personnage, Objet, Décor, Ambiance
  await dialog.getByLabel('nom du modèle').fill('Le lion Gaïndé');
  await dialog.getByLabel('précisions sur le modèle').fill('la mascotte officielle, t-shirt « DAKAR 2026 »');
  await dialog.getByRole('button', { name: 'Joindre' }).click();
  await expect(models.getByTestId('model').filter({ hasText: 'Le lion Gaïndé' })).toContainText('personnage');

  // a music (listened to: its tempo) and a project exported from here (its outline), dropped together on the box
  const project = { format: 'animation-flow', version: 1, project: { title: 'Notre dernière pub', style: 'flat', cast: { awa: { kind: 'awa', name: 'Awa' } }, scenes: [{ id: 's1', title: 'Le marché', duration: 8, narration: [{ id: 'l1', speaker: 'awa', text: 'Bienvenue au marché !' }] }] }, media: { images: {}, sounds: {} } };
  await page.evaluate(([music, json]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(music!), (ch) => ch.charCodeAt(0))], 'hymne.wav', { type: 'audio/wav' }));
    dt.items.add(new File([json!], 'pub.animation.json', { type: 'application/json' }));
    const target = document.querySelector('.safe-frame')!;
    for (const type of ['dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, [wav(8, 120).toString('base64'), JSON.stringify(project)]);
  await expect(models.getByTestId('model').filter({ hasText: 'hymne' })).toContainText(/musique · environ 1(19|20|21) BPM/, { timeout: 20_000 });
  await expect(models.getByTestId('model').filter({ hasText: 'Notre dernière pub' })).toContainText('projet');

  // what goes to the API: the models, the picture by its id, the music and the project by what was read in them
  let sent: any = null;
  await page.route('**/api/generations', async (route) => { sent = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'arrêt du test' } }); });
  await ai.getByRole('button', { name: 'Générer' }).click();
  await expect(ai.getByRole('alert')).toContainText('arrêt du test');
  expect(sent.references).toHaveLength(3);
  expect(sent.references[0]).toMatchObject({ id: 'le-lion-gainde', kind: 'character', name: 'Le lion Gaïndé', description: 'la mascotte officielle, t-shirt « DAKAR 2026 »', asset: expect.stringMatching(/^[0-9a-f]{32}$/) });
  expect(sent.references[0].url).toBeUndefined();
  expect(sent.references.find((r: any) => r.kind === 'music')).toMatchObject({ name: 'hymne', summary: expect.stringMatching(/BPM/) });
  expect(sent.references.find((r: any) => r.kind === 'project').summary).toContain('1. Le marché (8 s) — Awa : Bienvenue au marché !');

  // a model taken back is not sent
  await models.getByRole('button', { name: 'retirer hymne' }).click();
  await ai.getByRole('button', { name: 'Générer' }).click();
  await expect.poll(() => sent.references.length).toBe(2);
});

test('a text brought to the prompt is the brief: text, Word, PDF', async ({ page }) => {
  await signedIn(page);
  await page.goto('/create');
  const ai = page.getByRole('region', { name: "créer avec l'IA" });
  const box = ai.getByLabel('texte source'), button = ai.getByRole('button', { name: 'Joindre' });

  await choose(page, () => button.click(), { name: 'script.txt', mimeType: 'text/plain', buffer: Buffer.from('Une pub pour Pizza Time.\nLa pizza arrive en dix minutes.') });
  await expect(box).toHaveValue('Une pub pour Pizza Time.\nLa pizza arrive en dix minutes.');
  await expect(ai.getByTestId('imported-text')).toContainText('script.txt');

  const docx = zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Le renard et </w:t></w:r><w:r><w:t>le corbeau.</w:t></w:r></w:p><w:p><w:r><w:t>Une fable en trois scènes.</w:t></w:r></w:p></w:body></w:document>',
  });
  await choose(page, () => button.click(), { name: 'fable.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx });
  await expect(box).toHaveValue('Le renard et le corbeau.\n\nUne fable en trois scènes.');

  await choose(page, () => button.click(), { name: 'cours.pdf', mimeType: 'application/pdf', buffer: pdf('Comment une graine devient un arbre') });
  await expect(box).toHaveValue(/Comment une graine devient un arbre/, { timeout: 20_000 });

  // neither a text nor a model: said so, the box is kept
  await choose(page, () => button.click(), { name: 'donnees.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3, 4]) });
  await expect(ai.getByRole('alert')).toContainText('format de texte non pris en charge');
  await expect(box).toHaveValue(/Comment une graine/);
  await expect(ai.getByTestId('model')).toHaveCount(0);
});

test('nothing is imported into a project afterwards; a project still exports as one file', async ({ page }) => {
  await signedIn(page);
  await newProject(page, 'Awa et Jumo', 'Sans import');
  await expect(page.getByRole('button', { name: 'Importer', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: /Musique/ }).click();
  await expect(page.getByRole('button', { name: 'Importer une musique' })).toHaveCount(0);
  await page.getByRole('tab', { name: /Voix/ }).click();
  await expect(page.getByRole('button', { name: /importer la voix/ })).toHaveCount(0);

  await page.getByRole('tab', { name: /Projet/ }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter le projet' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('sans-import.animation.json');
  expect(JSON.parse(readFileSync((await file.path())!, 'utf8'))).toMatchObject({ format: 'animation-flow', project: { title: 'Sans import' } });

  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Mes projets' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Importer un projet' })).toHaveCount(0);
});
