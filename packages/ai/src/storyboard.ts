// The storyboard: the film cut into scenes with their narration and shot intentions, and the list of everything that
// must be drawn for it (characters, props, places), described in words. A model writes it from the user's text; the
// user reviews it; then every drawing is made, then each scene is written in the animation format.
import { Color, Id } from '@af/schema';
import { z } from 'zod';

/** something to draw, described well enough to draw it */
const Thing = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  description: z.string().min(3).max(800),
});

export const StoryCast = Thing.extend({ voice: z.string().max(200).optional() });

export const StoryScene = z.object({
  id: Id,
  title: z.string().max(200).default(''),
  /** target length (s); the voice may make it longer */
  duration: z.number().min(2).max(180),
  /** id of one of the storyboard's decors */
  decor: Id,
  /** ids of the storyboard's props seen in this scene */
  props: z.array(Id).max(20).default([]),
  /** the music this scene wants, in words (mood, energy, instruments), or "none": the film's score is composed from it */
  music: z.string().max(300).default('none'),
  narration: z.array(z.object({ id: Id, speaker: z.string().default('narrator'), text: z.string().min(1).max(600) })).max(30).default([]),
  /** what we see, shot by shot, in plain words: the brief the scene is animated from */
  shots: z.array(z.string().min(1).max(400)).max(16).default([]),
});

const Base = z.object({
  title: z.string().min(1).max(200),
  language: z.string().default('fr'),
  style: z.string().default('watercolor'),
  /** the film's colours: every drawing takes from them */
  palette: z.array(Color).max(10).default([]),
  cast: z.array(StoryCast).max(12).default([]),
  props: z.array(Thing).max(40).default([]),
  decors: z.array(Thing).min(1).max(20),
  /** sound effects the film needs, described: each is designed for it */
  sounds: z.array(Thing).max(30).default([]),
  scenes: z.array(StoryScene).min(1).max(40),
});

/** storyboards written before drawings were generated: a library kind per cast member and per decor */
function upgrade(v: unknown): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const sb = { ...(v as Record<string, unknown>) };
  const scenes = Array.isArray(sb.scenes) ? (sb.scenes as Record<string, unknown>[]) : [];
  if (!Array.isArray(sb.decors) && scenes.some((s) => s?.decor && typeof s.decor === 'object')) {
    const decors = new Map<string, { id: string; name: string; description: string }>();
    sb.scenes = scenes.map((s) => {
      const d = s?.decor as { kind?: string } | undefined;
      if (!d || typeof d !== 'object' || typeof d.kind !== 'string') return s;
      decors.set(d.kind, { id: d.kind, name: d.kind, description: `décor « ${d.kind} »` });
      return { ...s, decor: d.kind };
    });
    sb.decors = [...decors.values()];
  }
  // music written as a built-in mood ({ mood, gain })
  sb.scenes = (Array.isArray(sb.scenes) ? (sb.scenes as Record<string, unknown>[]) : []).map((s) => (s && typeof s.music === 'object' && s.music ? { ...s, music: String((s.music as { mood?: unknown }).mood ?? 'none') } : s));
  if (Array.isArray(sb.cast)) sb.cast = (sb.cast as Record<string, unknown>[]).map((c) => (c && typeof c === 'object' && !c.description ? { ...c, description: [c.kind, c.name].filter(Boolean).join(' ') } : c));
  return sb;
}

export const Storyboard = z.preprocess(upgrade, Base.superRefine((s, ctx) => {
  // one name space: a character, a prop and a decor never share an id (they become the project's drawings)
  const owner = new Map<string, string>();
  const claim = (id: string, what: string, path: (string | number)[]) => { const o = owner.get(id); if (o) ctx.addIssue({ code: 'custom', path, message: `« ${id} » est déjà ${o}` }); else owner.set(id, what); };
  s.cast.forEach((c, i) => claim(c.id, 'un personnage', ['cast', i, 'id']));
  s.props.forEach((p, i) => claim(p.id, 'un accessoire', ['props', i, 'id']));
  s.decors.forEach((d, i) => claim(d.id, 'un décor', ['decors', i, 'id']));
  s.sounds.forEach((d, i) => claim(d.id, 'un son', ['sounds', i, 'id']));
  const castIds = new Set(s.cast.map((c) => c.id)), propIds = new Set(s.props.map((p) => p.id)), decorIds = new Set(s.decors.map((d) => d.id)), seen = new Set<string>();
  s.scenes.forEach((sc, i) => {
    if (seen.has(sc.id)) ctx.addIssue({ code: 'custom', path: ['scenes', i, 'id'], message: `scène « ${sc.id} » en double` });
    seen.add(sc.id);
    if (!decorIds.has(sc.decor)) ctx.addIssue({ code: 'custom', path: ['scenes', i, 'decor'], message: `décor « ${sc.decor} » absent de "decors" (${[...decorIds].join(', ')})` });
    sc.props.forEach((p, k) => { if (!propIds.has(p)) ctx.addIssue({ code: 'custom', path: ['scenes', i, 'props', k], message: `accessoire « ${p} » absent de "props"` }); });
    const lines = new Set<string>();
    sc.narration.forEach((l, k) => {
      if (lines.has(l.id)) ctx.addIssue({ code: 'custom', path: ['scenes', i, 'narration', k, 'id'], message: `réplique « ${l.id} » en double` });
      lines.add(l.id);
      if (l.speaker !== 'narrator' && !castIds.has(l.speaker)) ctx.addIssue({ code: 'custom', path: ['scenes', i, 'narration', k, 'speaker'], message: `« ${l.speaker} » n'est pas dans la distribution (ou « narrator »)` });
    });
  });
}));

export type Storyboard = z.output<typeof Storyboard>;
export type StoryScene = z.output<typeof StoryScene>;
export const storyboardJsonSchema = () => z.toJSONSchema(Base, { io: 'input' }) as Record<string, unknown>;

/** everything the storyboard asks to draw */
export const briefsOf = (sb: Storyboard) => [
  ...sb.cast.map((c) => ({ id: c.id, kind: 'character' as const, name: c.name, description: c.description })),
  ...sb.props.map((p) => ({ id: p.id, kind: 'prop' as const, name: p.name, description: p.description })),
  ...sb.decors.map((d) => ({ id: d.id, kind: 'decor' as const, name: d.name, description: d.description })),
];
