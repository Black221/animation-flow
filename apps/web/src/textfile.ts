// The text of a document someone brings to the AI (a script, an article, a course): read in the browser, never sent
// as a file. Plain text and Markdown as they are; subtitles (SRT, VTT) without their numbers and times; a web page
// without its tags; Word (DOCX) and OpenDocument (ODT) from the XML inside their zip; PDF with pdf.js, loaded only
// then.

export const TEXT_ACCEPT = '.txt,.md,.markdown,.srt,.vtt,.html,.htm,.docx,.odt,.pdf,text/plain,text/markdown,text/html,application/pdf';
export const TEXT_MAX_BYTES = 20 * 1024 * 1024;

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';

/** the files in a zip, by name: the central directory, then each entry stored or deflated */
async function unzip(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf), u8 = new Uint8Array(buf), out = new Map<string, Uint8Array>();
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('fichier abîmé (zip)');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  for (let k = 0; k < count && v.getUint32(p, true) === 0x02014b50; k++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (!wanted(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true), data = u8.slice(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
  }
  return out;
}

/** paragraphs of an XML document: `para` elements, their text runs joined */
function paragraphs(xml: string, para: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.getElementsByTagName(para)].map((p) => p.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean).join('\n\n');
}

async function pdfText(buf: ArrayBuffer): Promise<string> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true }), pdf = await task.promise, pages: string[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 200); i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    pages.push(c.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+\n/g, '\n').trim());
  }
  await task.destroy();
  return pages.filter(Boolean).join('\n\n');
}

/** subtitles: the words only */
const subtitles = (s: string) => s.replace(/^WEBVTT.*$/m, '').split(/\r?\n/).filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).map((l) => l.replace(/<[^>]+>/g, '')).join('\n');

export async function readTextFile(f: File): Promise<string> {
  if (f.size > TEXT_MAX_BYTES) throw new Error('fichier trop gros (20 Mo au plus)');
  const e = ext(f.name);
  let text: string;
  if (e === 'pdf' || f.type === 'application/pdf') text = await pdfText(await f.arrayBuffer());
  else if (e === 'docx') { const z = await unzip(await f.arrayBuffer(), (n) => n === 'word/document.xml'); const x = z.get('word/document.xml'); if (!x) throw new Error('document Word illisible'); text = paragraphs(new TextDecoder().decode(x), 'w:p'); }
  else if (e === 'odt') { const z = await unzip(await f.arrayBuffer(), (n) => n === 'content.xml'); const x = z.get('content.xml'); if (!x) throw new Error('document OpenDocument illisible'); text = paragraphs(new TextDecoder().decode(x), 'text:p'); }
  else if (e === 'html' || e === 'htm' || f.type === 'text/html') { const d = new DOMParser().parseFromString(await f.text(), 'text/html'); d.querySelectorAll('script,style,noscript').forEach((n) => n.remove()); text = (d.body?.innerText ?? d.body?.textContent ?? '').trim(); }
  else if (e === 'srt' || e === 'vtt') text = subtitles(await f.text());
  else if (['txt', 'md', 'markdown', ''].includes(e) || f.type.startsWith('text/')) text = await f.text();
  else throw new Error('format de texte non pris en charge (TXT, MD, SRT, HTML, DOCX, ODT ou PDF)');
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('aucun texte trouvé dans ce fichier (un PDF scanné n’a que des images)');
  return text;
}
