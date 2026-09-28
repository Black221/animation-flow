// Getting a picture ready before it goes to the workspace: its plain background taken off (when it has one), and
// the regions touched with the magic eraser (a patch of background enclosed by the subject, a shadow), undoable.
import { useEffect, useRef, useState } from 'react';
import { cutoutPixels, eraseAt, hasPlainBackground } from './cutout';

export interface PictureEdit {
  /** what to show: the picture as it will be sent */
  url: string;
  /** a plain background was found (the cut-out is offered) */
  plain: boolean;
  cut: boolean; setCut: (on: boolean) => void;
  /** erase the region at a point given as fractions of the picture's width and height */
  erase: (fx: number, fy: number) => void;
  erased: number; undo: () => void;
  /** the picture to upload: the file itself when nothing was changed */
  blob: () => Promise<Blob>;
  ready: boolean;
}

export function usePictureEdit(file: File | null, enabled = true): PictureEdit {
  const orig = useRef<ImageData | null>(null), canvas = useRef<HTMLCanvasElement | null>(null);
  const [plain, setPlain] = useState(false), [cut, setCut] = useState(true), [points, setPoints] = useState<[number, number][]>([]), [url, setUrl] = useState(''), [ready, setReady] = useState(false);
  useEffect(() => {
    orig.current = null; setPlain(false); setCut(true); setPoints([]); setReady(false); setUrl('');
    if (!file || !enabled) return;
    let alive = true;
    const u = URL.createObjectURL(file), img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(u);
      if (!alive) return;
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0);
      canvas.current = c; orig.current = x.getImageData(0, 0, c.width, c.height);
      setPlain(await hasPlainBackground(file).catch(() => false)); setReady(true);
    };
    img.onerror = () => URL.revokeObjectURL(u);
    img.src = u;
    return () => { alive = false; };
  }, [file, enabled]);
  const edited = (plain && cut) || points.length > 0;
  // the picture as it stands: the original, cut out if asked, then each erased point
  useEffect(() => {
    const c = canvas.current, o = orig.current;
    if (!ready || !c || !o) return;
    if (!edited) { setUrl(''); return; }
    const d = new ImageData(new Uint8ClampedArray(o.data), o.width, o.height);
    if (plain && cut) cutoutPixels(d.data, d.width, d.height);
    for (const [fx, fy] of points) eraseAt(d.data, d.width, d.height, fx * d.width, fy * d.height);
    c.getContext('2d')!.putImageData(d, 0, 0);
    setUrl(c.toDataURL('image/png'));
  }, [ready, plain, cut, points, edited]);
  const fileUrl = useFileUrl(file);
  return {
    url: edited && url ? url : fileUrl, plain, cut, setCut, ready,
    erase: (fx, fy) => setPoints((p) => [...p, [fx, fy]]), erased: points.length, undo: () => setPoints((p) => p.slice(0, -1)),
    blob: async () => (!edited || !canvas.current ? file! : await new Promise<Blob>((ok, bad) => canvas.current!.toBlob((b) => (b ? ok(b) : bad(new Error('image illisible'))), 'image/png'))),
  };
}

function useFileUrl(file: File | null) {
  const [u, setU] = useState('');
  useEffect(() => { if (!file) { setU(''); return; } const x = URL.createObjectURL(file); setU(x); return () => URL.revokeObjectURL(x); }, [file]);
  return u;
}

/** where a click on the shown picture landed, as fractions of the picture (object-fit: contain) */
export function pointOn(e: React.MouseEvent<HTMLImageElement>): [number, number] | null {
  const img = e.currentTarget, r = img.getBoundingClientRect(), k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k, x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top - (r.height - h) / 2) / h;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [x, y] : null;
}
