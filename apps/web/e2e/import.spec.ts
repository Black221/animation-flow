import { signedIn, newProject } from './auth';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** a WAV of a tone (mono, 16 bits) */
function wav(seconds: number, freq = 440, rate = 48000): Buffer {
  const n = Math.round(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * freq * i) / rate)), 44 + i * 2);
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
const choose = async (page: Page, click: () => Promise<void>, files: { name: string; mimeType: string; buffer: Buffer }) => {
  const chooser = page.waitForEvent('filechooser');
  await click();
  await (await chooser).setFiles(files);
};

test('import a logo, a music and a recorded voice into a project; export it and import it again', async ({ page }) => {
  test.setTimeout(120_000);
  await signedIn(page);
  await newProject(page, 'Awa et Jumo', 'Avec mes fichiers');
  await expect(page).toHaveURL(/\/p\//);

  // a picture: a transparent PNG is offered as an object, placed in the scene
  await choose(page, () => page.getByRole('button', { name: 'Importer', exact: true }).click(), { name: 'logo pizza.png', mimeType: 'image/png', buffer: await logo(page) });
  const dialog = page.getByRole('dialog', { name: 'Importer un fichier' });
  await expect(dialog.getByRole('radio', { name: 'Objet' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByLabel('nom du dessin')).toHaveValue('logo pizza');
  await dialog.getByRole('button', { name: 'Importer' }).click();
  await expect(page.getByText('« logo pizza » ajouté à la scène s1')).toBeVisible();
  await page.getByRole('tab', { name: /Dessins/ }).click();
  await expect(page.getByTestId('drawing-logo-pizza')).toContainText('importée');

  // a picture dropped on the editor, as the decor of the scene
  const jpeg = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 900; const x = c.getContext('2d')!; x.fillStyle = '#3a7bd5'; x.fillRect(0, 0, 1600, 900); return c.toDataURL('image/jpeg').split(',')[1]!; }), 'base64');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)), dt = new DataTransfer();
    dt.items.add(new File([bytes], 'ciel.jpg', { type: 'image/jpeg' }));
    const target = document.querySelector('.stage')!;
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, jpeg.toString('base64'));
  await expect(dialog.getByRole('radio', { name: 'Décor' })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: 'Importer' }).click();
  await expect(page.getByText('« ciel » est le décor de la scène s1')).toBeVisible();

  // a music for the whole film, from the Music tab
  await page.getByRole('tab', { name: /Musique/ }).click();
  await choose(page, () => page.getByRole('button', { name: 'Importer une musique' }).click(), { name: 'ma musique.wav', mimeType: 'audio/wav', buffer: wav(3, 330) });
  await expect(page.getByTestId('soundtrack')).toContainText('ma musique.wav');
  await expect(page.getByTestId('soundtrack')).toContainText('0:03');

  // one's own voice for a line
  await page.getByRole('tab', { name: /Voix/ }).click();
  await choose(page, () => page.getByRole('button', { name: 'importer la voix de s1/l1' }).click(), { name: 'moi.wav', mimeType: 'audio/wav', buffer: wav(1.5) });
  await expect(page.getByTestId('voice-line').first()).toContainText('enregistrée · 1.5 s');

  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('version 2');

  // export it with its media, then import it as a new project
  await page.getByRole('tab', { name: /Projet/ }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter le projet' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('avec-mes-fichiers.animation.json');
  const exported = JSON.parse(readFileSync((await file.path())!, 'utf8'));
  expect(exported.format).toBe('animation-flow');
  expect(Object.keys(exported.media.images)).toHaveLength(2);
  expect(Object.keys(exported.media.sounds)).toHaveLength(2);

  await page.goto('/projects');
  await choose(page, () => page.getByRole('button', { name: 'Importer un projet' }).click(), { name: 'avec-mes-fichiers.animation.json', mimeType: 'application/json', buffer: readFileSync((await file.path())!) });
  await expect(page.getByText('« Avec mes fichiers » importé avec 2 image(s) et 2 son(s)')).toBeVisible();
  await expect(page.getByRole('list', { name: 'projets' }).getByRole('link', { name: 'Avec mes fichiers' })).toHaveCount(2);
});

test('the AI reads a document brought in: text, Word, PDF', async ({ page }) => {
  await signedIn(page);
  await page.goto('/create');
  const ai = page.getByRole('region', { name: "créer avec l'IA" });
  const box = ai.getByLabel('texte source'), button = ai.getByRole('button', { name: 'Importer un texte' });

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

  // not a text: said so, the box is kept
  await choose(page, () => button.click(), { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  await expect(ai.getByRole('alert')).toContainText('format de texte non pris en charge');
  await expect(box).toHaveValue(/Comment une graine/);
});
