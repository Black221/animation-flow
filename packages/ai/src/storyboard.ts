// The storyboard: the film cut into scenes with their narration and shot intentions, before any animation detail.
// A model writes it from the user's text; the user reviews it; then each scene is written in the animation format.
import { catalog } from '@af/library';
import { Decor, Id, Music, Params } from '@af/schema';
import { z } from 'zod';

export const StoryCast = z.object({
  id: Id,
  kind: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(400).default(''),
  params: Params.default({}),
  voice: z.string().max(200).optional(),
});

export const StoryScene = z.object({
  id: Id,
  title: z.string().max(200).default(''),
  /** target length (s); the voice may make it longer */
  duration: z.number().min(2).max(180),
  decor: Decor,
  music: Music.default({ mood: 'none', gain: 0 }),
  narration: z.array(z.object({ id: Id, speaker: z.string().default('narrator'), text: z.string().min(1).max(600) })).max(30).default([]),
  /** what we see, shot by shot, in plain words: the brief the scene is animated from */
  shots: z.array(z.string().min(1).max(400)).max(16).default([]),
});

const Base = z.object({
  title: z.string().min(1).max(200),
  language: z.string().default('fr'),
  style: z.string().default('watercolor'),
  cast: z.array(StoryCast).max(12).default([]),
  scenes: z.array(StoryScene).min(1).max(40),
});

export const Storyboard = Base.superRefine((s, ctx) => {
  const kinds = new Set(catalog.characters.map((c) => c.kind)), decors = new Set(catalog.decors.map((d) => d.kind));
  const castIds = new Set(s.cast.map((c) => c.id)), seen = new Set<string>();
  s.cast.forEach((c, i) => { if (!kinds.has(c.kind)) ctx.addIssue({ code: 'custom', path: ['cast', i, 'kind'], message: `type de personnage « ${c.kind} » inconnu (${[...kinds].join(', ')})` }); });
  s.scenes.forEach((sc, i) => {
    if (seen.has(sc.id)) ctx.addIssue({ code: 'custom', path: ['scenes', i, 'id'], message: `scène « ${sc.id} » en double` });
    seen.add(sc.id);
    if (!decors.has(sc.decor.kind)) ctx.addIssue({ code: 'custom', path: ['scenes', i, 'decor', 'kind'], message: `décor « ${sc.decor.kind} » inconnu (${[...decors].join(', ')})` });
    const lines = new Set<string>();
    sc.narration.forEach((l, k) => {
      if (lines.has(l.id)) ctx.addIssue({ code: 'custom', path: ['scenes', i, 'narration', k, 'id'], message: `réplique « ${l.id} » en double` });
      lines.add(l.id);
      if (l.speaker !== 'narrator' && !castIds.has(l.speaker)) ctx.addIssue({ code: 'custom', path: ['scenes', i, 'narration', k, 'speaker'], message: `« ${l.speaker} » n'est pas dans la distribution (ou « narrator »)` });
    });
  });
});

export type Storyboard = z.output<typeof Storyboard>;
export type StoryScene = z.output<typeof StoryScene>;
export const storyboardJsonSchema = () => z.toJSONSchema(Base, { io: 'input' }) as Record<string, unknown>;
