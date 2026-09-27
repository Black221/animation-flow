// Pictures of a project (decors painted by an image model), loaded through signed links for the previews. One
// image element per picture for the whole page; every preview showing it is told when it arrives.
import type { Project } from '@af/schema';
import { useEffect, useMemo } from 'react';
import { Api } from './api';

const images = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

/** a picture just received (from the image model): shown at once, without asking for a link */
export function addPicture(asset: string, url: string) {
  if (images.has(asset)) return;
  const img = new Image();
  img.onload = () => listeners.forEach((f) => f());
  img.src = url;
  images.set(asset, img);
}

/** the picture of an asset, once it has loaded */
export const pictureOf = (asset: string) => { const img = images.get(asset); return img?.complete && img.naturalWidth ? img : null; };

/** loads the project's pictures; `onReady` asks for a repaint when one arrives. Without them, decors show their drawing. */
export function usePictures(project: Pick<Project, 'assets'>, onReady: () => void) {
  const wanted = useMemo(() => [...new Set(Object.values(project.assets ?? {}).flatMap((a) => (a.image ? [a.image.asset] : [])))].sort().join(','), [project.assets]);
  useEffect(() => { listeners.add(onReady); return () => { listeners.delete(onReady); }; }, [onReady]);
  useEffect(() => {
    const need = wanted ? wanted.split(',').filter((a) => !images.has(a)) : [];
    if (!need.length) return;
    Api.imageLinks(need).then((links) => { for (const [asset, url] of Object.entries(links)) addPicture(asset, url); }).catch(() => undefined);
  }, [wanted]);
  return pictureOf;
}
