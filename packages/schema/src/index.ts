// The animation format. A project describes WHAT happens on screen (characters, props, text, camera, narration);
// it never says how to draw it: that is the job of a style pack (@af/styles). The same project therefore renders in
// every style, and the editor, a language model and the engine all read and write the same validated JSON.
//
// Times are either seconds from the scene start or references to a narration line ({ line, edge, offset }), so an
// action stays locked on the words when the voice is re-recorded and the line durations change.
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/, 'identifiant : lettres, chiffres, _ . - (64 max.)');
export const Color = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'couleur hexadécimale (#rgb, #rrggbb ou #rrggbbaa)');
export const Params = z.record(z.string(), z.unknown());

/** Seconds from the scene start, or a point on a narration line of the same scene. */
export const TimeRef = z.union([
  z.number().min(0),
  z.object({
    line: Id,
    edge: z.enum(['start', 'end']).default('start'),
    offset: z.number().default(0),
  }),
]);

/** Easing used to reach a key from the previous one. `step` holds the previous value until the key. */
export const Ease = z.enum(['linear', 'in', 'out', 'inOut', 'backOut', 'step']);

export const ElementKey = z.object({
  t: TimeRef,
  ease: Ease.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().positive().optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  /** discrete values: held from their key until the next one */
  pose: z.string().optional(),
  expression: z.string().optional(),
  facing: z.union([z.literal(1), z.literal(-1)]).optional(),
  text: z.string().optional(),
});

export const Element = z.object({
  id: Id,
  type: z.enum(['character', 'prop', 'text']),
  /** character: a cast id · prop: a prop kind from the library · text: unused */
  ref: z.string().optional(),
  params: Params.default({}),
  /** drawing order: higher is in front */
  layer: z.number().int().default(0),
  /** `screen` elements ignore the camera (titles, captions) */
  space: z.enum(['world', 'screen']).default('world'),
  enter: TimeRef.optional(),
  exit: TimeRef.optional(),
  keys: z.array(ElementKey).min(1),
});

export const CameraKey = z.object({
  t: TimeRef,
  ease: Ease.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  zoom: z.number().positive().optional(),
  rotation: z.number().optional(),
});

export const Line = z.object({
  id: Id,
  /** a cast id, or `narrator` */
  speaker: z.string().default('narrator'),
  text: z.string().min(1),
  /** forced start (s); otherwise the line follows the previous one */
  start: z.number().min(0).optional(),
  /** measured duration of the recorded voice (s); otherwise estimated from the text */
  duration: z.number().positive().optional(),
  /** extra silence after the line (s) */
  holdAfter: z.number().min(0).default(0),
  /** the recorded voice: an audio asset, and a hash of the text it says (a different text means it is out of date) */
  audio: z.object({ asset: z.string().regex(/^[0-9a-f]{32}$/, 'identifiant de fichier audio'), textHash: z.string() }).optional(),
});

/** Background music of a scene: a mood the score generator knows, and a level in dB relative to the default. */
export const Music = z.object({
  /** a piece of the project's score (composed for the film), one of the built-in moods (calm, curious, playful,
   *  epic, night, tense: older projects and fallbacks), or none */
  mood: Id.default('none'),
  gain: z.number().min(-40).max(12).default(0),
});

// ---------- music and sounds composed for the project ----------
// A piece is a loop of bars: a chord progression (roman numerals over the key's major scale: I ii iii IV V vi
// vii°, lower case = minor, b/# before, 7 maj7 m7 sus2 sus4 6 9 dim aug after) and parts that play it, each on a
// grid of 16 steps per bar ("x" a hit, "X" an accent, "-" hold, "." rest). A melody writes scale degrees of the
// mode per step (1 = the tonic, 8 = an octave up, "#"/"b" before, "'" up or "," down an octave after).
export const CHORD_RE = /^(b|#)?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(°|dim|\+|aug|maj7|m7|7|sus2|sus4|6|9)?$/;
export const STEPS_RE = /^[xX.-]{16}$/;
export const MELODY_RE = /^((\.|-|[#b]?\d{1,2}[',]*)\s+){15}(\.|-|[#b]?\d{1,2}[',]*)$/;
export const INSTRUMENTS = ['pad', 'strings', 'piano', 'organ', 'pluck', 'marimba', 'bells', 'lead', 'flute', 'bass', 'synthbass'] as const;
export const DRUMS = ['kick', 'snare', 'clap', 'hat', 'openhat', 'shaker', 'tom'] as const;
const Steps = z.string().regex(STEPS_RE, '16 pas par mesure : x (coup), X (accent), - (tenue), . (silence)');
export const Part = z.object({
  instrument: z.enum([...INSTRUMENTS, ...DRUMS]),
  /** chords: the chord of the bar · bass: its root · arp: its notes one at a time · melody: `notes` · drum: a hit */
  play: z.enum(['chords', 'bass', 'arp', 'melody', 'drum']),
  /** rhythm, one bar or one per bar (looped) */
  pattern: z.union([Steps, z.array(Steps).min(1).max(16)]).optional(),
  /** melody: one string of 16 tokens per bar (looped) */
  notes: z.array(z.string().regex(MELODY_RE, 'mélodie : 16 jetons par mesure (degré, - ou .), séparés par des espaces')).min(1).max(16).optional(),
  arp: z.enum(['up', 'down', 'updown', 'random']).default('up'),
  octave: z.number().int().min(-3).max(3).default(0),
  gain: z.number().min(-30).max(6).default(0),
  pan: z.number().min(-1).max(1).default(0),
}).superRefine((p, ctx) => {
  const drum = (DRUMS as readonly string[]).includes(p.instrument);
  if (drum !== (p.play === 'drum')) ctx.addIssue({ code: 'custom', path: ['play'], message: drum ? `« ${p.instrument} » est une percussion : play "drum"` : `play "drum" demande une percussion (${DRUMS.join(', ')})` });
  if (p.play === 'melody' && !p.notes) ctx.addIssue({ code: 'custom', path: ['notes'], message: 'une mélodie a des notes' });
  if ((p.play === 'drum' || p.play === 'arp') && !p.pattern) ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'un rythme est attendu' });
});
export const Piece = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(400).default(''),
  bpm: z.number().min(40).max(200),
  key: z.string().regex(/^[A-G](#|b)?$/, 'tonalité : C, C#, Db… B').default('A'),
  mode: z.enum(['major', 'minor', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'pentatonic', 'blues']).default('major'),
  /** one chord per bar, looped */
  chords: z.array(z.string().regex(CHORD_RE, 'accord en chiffres romains : I, vi, IV, V7, bVII, ii7…')).min(1).max(16),
  parts: z.array(Part).min(1).max(10),
  /** late off-beats (0 = straight) */
  swing: z.number().min(0).max(0.5).default(0),
  reverb: z.number().min(0).max(1).default(0.35),
});
/** a sound effect as synthesis: layers of a wave or noise, gliding in pitch, filtered, shaped by an envelope */
export const SoundLayer = z.object({
  wave: z.enum(['sine', 'triangle', 'square', 'saw', 'noise']),
  /** Hz, from → to (exponential glide); for noise, the filter does the pitch */
  freq: z.tuple([z.number().min(20).max(16000), z.number().min(20).max(16000)]).or(z.tuple([z.number().min(20).max(16000)])).default([440]),
  start: z.number().min(0).max(4).default(0),
  duration: z.number().min(0.005).max(4),
  attack: z.number().min(0).max(2).default(0.005),
  /** how fast it fades after the attack: time for the level to fall to about a third (s) */
  decay: z.number().min(0.005).max(10).default(0.3),
  filter: z.object({ type: z.enum(['lowpass', 'highpass', 'bandpass']), freq: z.tuple([z.number().min(20).max(18000), z.number().min(20).max(18000)]).or(z.tuple([z.number().min(20).max(18000)])), q: z.number().min(0.2).max(30).default(0.8) }).optional(),
  vibrato: z.object({ rate: z.number().min(0.1).max(40), depth: z.number().min(0).max(12) }).optional(),
  /** play it again: count times, every s seconds */
  repeat: z.object({ count: z.number().int().min(1).max(16), every: z.number().min(0.01).max(2) }).optional(),
  gain: z.number().min(-40).max(6).default(0),
});
export const SoundRecipe = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(400).default(''),
  layers: z.array(SoundLayer).min(1).max(8),
});

/** A sound effect at a moment of the scene (kinds: see the sound catalog of @af/audio). */
export const Sfx = z.object({
  t: TimeRef,
  kind: z.string().min(1),
  gain: z.number().min(-40).max(12).default(0),
  /** −1 left … 1 right */
  pan: z.number().min(-1).max(1).default(0),
});

export const Decor = z.object({ kind: z.string().min(1), params: Params.default({}) });

export const Scene = z.object({
  id: Id,
  title: z.string().default(''),
  /** minimum length (s); the scene grows if its narration needs more */
  duration: z.number().positive().optional(),
  decor: Decor,
  narration: z.array(Line).default([]),
  elements: z.array(Element).default([]),
  camera: z.array(CameraKey).default([]),
  transition: z.enum(['cut', 'fade']).default('cut'),
  music: Music.default({ mood: 'none', gain: 0 }),
  sfx: z.array(Sfx).default([]),
});

export const CastMember = z.object({
  /** character component from the library (`person`, `drone`, …) */
  kind: z.string().min(1),
  name: z.string().min(1),
  params: Params.default({}),
  /** voice id for this character's lines, with the narration provider; otherwise the narrator's voice */
  voice: z.string().optional(),
});

// ---------- drawings made for the project (by a model or by hand) ----------
// A drawing is a tree of parts. Each part holds shapes, in the drawing's own coordinates (characters and props:
// origin at the feet / base centre, y up is negative, about 340 px for a standing adult; decors: a 1920×1080 frame,
// drawn 300 px beyond it on every side). A part may hang from a parent and turn around its pivot: poses say how
// much, with an optional swing (walk cycles, waving, breathing). Parts of a `group` are alternatives (mouths, eyes):
// an expression picks one variant per group. It is data only: nothing in it runs.
const N = z.number().finite();
export const AssetPoint = z.tuple([N, N]);
const Paint = { fill: Color.optional(), stroke: Color.optional(), strokeWidth: z.number().min(0).max(40).optional(), opacity: z.number().min(0).max(1).optional(), role: z.enum(['body', 'detail', 'shade']).optional() };
export const AssetShape = z.discriminatedUnion('type', [
  /** SVG path data (`d`: M L H V C S Q T A Z, absolute or relative) or a list of points */
  z.object({ type: z.literal('path'), d: z.string().max(20_000).optional(), points: z.array(AssetPoint).max(600).optional(), closed: z.boolean().default(true), smooth: z.boolean().default(false),
    /** open paths: body thickness (limbs, stalks), drawn with round ends */
    width: z.number().min(0).max(300).optional(), ...Paint })
    .refine((p) => !!p.d !== !!p.points, 'un tracé a soit `d`, soit `points`'),
  z.object({ type: z.literal('ellipse'), cx: N, cy: N, rx: z.number().positive().max(5000), ry: z.number().positive().max(5000), ...Paint }),
  z.object({ type: z.literal('rect'), x: N, y: N, w: z.number().positive().max(10_000), h: z.number().positive().max(10_000), r: z.number().min(0).max(2000).default(0), ...Paint }),
  z.object({ type: z.literal('glow'), x: N, y: N, radius: z.number().positive().max(3000), color: Color, opacity: z.number().min(0).max(1).default(0.6) }),
  /** vertical gradient over a rectangle (skies, water) */
  z.object({ type: z.literal('gradient'), x: N, y: N, w: z.number().positive().max(10_000), h: z.number().positive().max(10_000), stops: z.array(z.tuple([z.number().min(0).max(1), Color])).min(2).max(8), opacity: z.number().min(0).max(1).optional() }),
  z.object({ type: z.literal('text'), x: N, y: N, text: z.string().min(1).max(200), size: z.number().positive().max(400), color: Color, font: z.enum(['display', 'body', 'marker', 'hand']).default('display'), weight: z.number().int().min(100).max(900).default(600), align: z.enum(['left', 'center', 'right']).default('center') }),
  /** a picture imported into the workspace (a logo, a product, a photo), over a rectangle of the drawing */
  z.object({ type: z.literal('image'), asset: z.string().regex(/^[0-9a-f]{32}$/, "identifiant d'image"), x: N, y: N, w: z.number().positive().max(10_000), h: z.number().positive().max(10_000), opacity: z.number().min(0).max(1).optional() }),
]);
export const AssetPart = z.object({
  id: Id,
  /** hangs from this part: follows it when it turns */
  parent: Id.optional(),
  /** where the part turns, in the drawing's coordinates at rest */
  pivot: AssetPoint.default([0, 0]),
  /** alternatives: in a group, only the variant the expression picks is drawn (by default the first one) */
  group: z.string().regex(/^[a-z0-9_-]{1,32}$/i).optional(),
  variant: z.string().regex(/^[a-z0-9_-]{1,32}$/i).optional(),
  shapes: z.array(AssetShape).max(80).default([]),
});
/** how a part is held in a pose: an angle (degrees, positive = clockwise on screen), an optional swing of `swing`
 *  degrees around it at `speed` cycles per second, a continuous turn (`spin`, degrees per second: wheels, blades), a
 *  shift (px) and a bounce (px, upwards, twice per cycle) */
export const AssetMotion = z.object({
  rot: N.min(-360).max(360).default(0),
  swing: N.min(0).max(180).default(0),
  speed: z.number().min(0).max(8).default(1),
  phase: z.number().min(0).max(1).default(0),
  dx: N.min(-2000).max(2000).default(0),
  dy: N.min(-2000).max(2000).default(0),
  bounce: N.min(0).max(200).default(0),
  spin: N.min(-3600).max(3600).default(0),
});
const Name = z.string().regex(/^[a-z0-9_-]{1,32}$/i, 'nom : lettres, chiffres, _ - (32 max.)');
export const Asset = z.object({
  kind: z.enum(['character', 'prop', 'decor']),
  name: z.string().min(1).max(80),
  /** what it is and looks like: the brief it was drawn from, kept to draw it again */
  description: z.string().max(2000).default(''),
  /** decors: colour under everything (no gap shows when the camera moves) */
  background: Color.optional(),
  parts: z.array(AssetPart).min(1).max(120),
  /** pose name → part id → motion; `idle` is used when a pose is not given */
  poses: z.record(Name, z.record(Id, AssetMotion)).default({}),
  /** expression name → group → variant; `neutral` is used when an expression is not given */
  expressions: z.record(Name, z.record(Name, Name)).default({}),
  /** decors: a picture made by an image model, over the whole decor (the frame and 300 px around it, 3:2); the
   *  parts stay underneath, drawn when the picture cannot be had */
  image: z.object({ asset: z.string().regex(/^[0-9a-f]{32}$/, "identifiant d'image"), width: z.number().int().positive(), height: z.number().int().positive(), by: z.string().max(200).optional() }).optional(),
  /** false: never mirrored when it faces the other way (a picture with writing on it, a logo) */
  flip: z.boolean().default(true),
  /** how it was made (model, rounds of visual review) */
  made: z.object({ by: z.string().max(200), rounds: z.number().int().min(0).max(20).default(0), at: z.string().max(40).optional() }).optional(),
}).superRefine((a, ctx) => {
  const ids = new Map(a.parts.map((p, i) => [p.id, i] as const));
  if (a.image && a.kind !== 'decor') ctx.addIssue({ code: 'custom', path: ['image'], message: 'seul un décor a une image' });
  if (ids.size !== a.parts.length) ctx.addIssue({ code: 'custom', path: ['parts'], message: 'identifiants de parties en double' });
  a.parts.forEach((p, i) => {
    if (p.parent && !ids.has(p.parent)) ctx.addIssue({ code: 'custom', path: ['parts', i, 'parent'], message: `partie parente « ${p.parent} » inconnue` });
    if (!!p.group !== !!p.variant) ctx.addIssue({ code: 'custom', path: ['parts', i, 'group'], message: '`group` et `variant` vont ensemble' });
    // a parent chain must end: no loops
    const seen = new Set<string>(); let cur: string | undefined = p.id;
    while (cur) { if (seen.has(cur)) { ctx.addIssue({ code: 'custom', path: ['parts', i, 'parent'], message: 'les parties forment une boucle' }); break; } seen.add(cur); cur = a.parts[ids.get(cur)!]?.parent; }
  });
  for (const [pose, m] of Object.entries(a.poses)) for (const part of Object.keys(m)) if (!ids.has(part)) ctx.addIssue({ code: 'custom', path: ['poses', pose, part], message: `pose « ${pose} » : partie « ${part} » inconnue` });
  const variants = new Map<string, Set<string>>();
  for (const p of a.parts) if (p.group && p.variant) { if (!variants.has(p.group)) variants.set(p.group, new Set()); variants.get(p.group)!.add(p.variant); }
  for (const [ex, m] of Object.entries(a.expressions)) for (const [g, v] of Object.entries(m)) {
    if (!variants.get(g)?.has(v)) ctx.addIssue({ code: 'custom', path: ['expressions', ex, g], message: `expression « ${ex} » : pas de variante « ${v} » dans le groupe « ${g} »` });
  }
});
/** the poses and expressions a drawing offers (idle and neutral always exist) */
export const assetPoses = (a: Pick<z.output<typeof Asset>, 'poses'>) => [...new Set(['idle', ...Object.keys(a.poses)])];
export const assetExpressions = (a: Pick<z.output<typeof Asset>, 'expressions'>) => [...new Set(['neutral', ...Object.keys(a.expressions)])];

export const ProjectBase = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  title: z.string().min(1),
  language: z.string().default('fr'),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).default(24),
  width: z.number().int().min(16).max(7680).default(1920),
  height: z.number().int().min(16).max(4320).default(1080),
  /** default style pack id (`flat`, `watercolor`, …) */
  style: z.string().default('flat'),
  cast: z.record(Id, CastMember).default({}),
  scenes: z.array(Scene).min(1),
  /** drawings made for this project: a cast member's `kind`, a prop's `ref` or a decor's `kind` may name one */
  assets: z.record(Id, Asset).default({}),
  /** music composed for this project: a scene's music.mood may name one of its pieces */
  score: z.record(Id, Piece).default({}),
  /** sound effects designed for this project: a sfx kind may name one */
  sounds: z.record(Id, SoundRecipe).default({}),
  /** a music file imported for the whole film: it plays from the start under the voices (lowered while someone
   *  speaks) and replaces the composed music of the scenes; looped, or once, fading out at the end of the film */
  soundtrack: z.object({
    asset: z.string().regex(/^[0-9a-f]{32}$/, 'identifiant de fichier audio'),
    name: z.string().min(1).max(120),
    /** seconds, measured when imported */
    duration: z.number().positive().max(3600),
    gain: z.number().min(-40).max(12).default(0),
    loop: z.boolean().default(true),
  }).optional(),
});

/** Cross-references a single object schema cannot express: unique ids, lines and cast members that exist. */
export const Project = ProjectBase.superRefine((p, ctx) => {
  const dup = (ids: string[], path: (string | number)[], what: string) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', path: [...path, i, 'id'], message: `${what} « ${id} » en double` });
      seen.add(id);
    });
  };
  dup(p.scenes.map((s) => s.id), ['scenes'], 'scène');
  p.scenes.forEach((s, si) => {
    const base = ['scenes', si];
    dup(s.narration.map((l) => l.id), [...base, 'narration'], 'réplique');
    dup(s.elements.map((e) => e.id), [...base, 'elements'], 'élément');
    const lines = new Set(s.narration.map((l) => l.id));
    const checkTime = (t: z.output<typeof TimeRef> | undefined, path: (string | number)[]) => {
      if (t && typeof t === 'object' && !lines.has(t.line)) ctx.addIssue({ code: 'custom', path, message: `réplique « ${t.line} » inconnue dans la scène « ${s.id} »` });
    };
    s.narration.forEach((l, li) => {
      if (l.speaker !== 'narrator' && !(l.speaker in p.cast)) ctx.addIssue({ code: 'custom', path: [...base, 'narration', li, 'speaker'], message: `personnage « ${l.speaker} » absent de la distribution` });
    });
    s.camera.forEach((k, ki) => checkTime(k.t, [...base, 'camera', ki, 't']));
    s.sfx.forEach((x, xi) => checkTime(x.t, [...base, 'sfx', xi, 't']));
    s.elements.forEach((e, ei) => {
      const ep = [...base, 'elements', ei];
      if (e.type === 'character' && !(e.ref && e.ref in p.cast)) ctx.addIssue({ code: 'custom', path: [...ep, 'ref'], message: `personnage « ${e.ref ?? ''} » absent de la distribution` });
      if (e.type === 'prop' && !e.ref) ctx.addIssue({ code: 'custom', path: [...ep, 'ref'], message: 'un accessoire doit nommer son type (ref)' });
      if (e.type === 'text' && !e.keys.some((k) => k.text != null) && typeof e.params.text !== 'string') ctx.addIssue({ code: 'custom', path: [...ep, 'keys'], message: 'un texte doit avoir un contenu (params.text ou keys[].text)' });
      checkTime(e.enter, [...ep, 'enter']);
      checkTime(e.exit, [...ep, 'exit']);
      e.keys.forEach((k, ki) => checkTime(k.t, [...ep, 'keys', ki, 't']));
    });
  });
});

export type TimeRef = z.output<typeof TimeRef>;
export type Ease = z.output<typeof Ease>;
export type ElementKey = z.output<typeof ElementKey>;
export type Element = z.output<typeof Element>;
export type CameraKey = z.output<typeof CameraKey>;
export type Line = z.output<typeof Line>;
export type Decor = z.output<typeof Decor>;
export type Music = z.output<typeof Music>;
export type Sfx = z.output<typeof Sfx>;
export type Scene = z.output<typeof Scene>;
export type CastMember = z.output<typeof CastMember>;
export type Project = z.output<typeof Project>;
export type Asset = z.output<typeof Asset>;
export type Piece = z.output<typeof Piece>;
export type Part = z.output<typeof Part>;
export type SoundRecipe = z.output<typeof SoundRecipe>;
export type SoundLayer = z.output<typeof SoundLayer>;
export type AssetPart = z.output<typeof AssetPart>;
export type AssetShape = z.output<typeof AssetShape>;
export type AssetMotion = z.output<typeof AssetMotion>;
/** what a person or a model may write: defaults not filled in yet */
export type ProjectInput = z.input<typeof Project>;

export interface Issue { path: string; message: string }
export type ParseResult = { ok: true; project: Project } | { ok: false; issues: Issue[] };

/** `scenes.0.elements.2.ref` style paths, readable in the editor and in model repair prompts */
export const formatPath = (path: readonly PropertyKey[]) => path.map(String).join('.') || '(racine)';

export function parseProject(input: unknown): ParseResult {
  const r = Project.safeParse(input);
  if (r.success) return { ok: true, project: r.data };
  return { ok: false, issues: r.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })) };
}

/** JSON Schema of the format, for models that accept a response schema and for editor tooling */
export const projectJsonSchema = () => z.toJSONSchema(ProjectBase, { io: 'input' });

/** what a line's audio.textHash must be for the recording to be up to date (FNV-1a of the trimmed text) */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  const s = text.trim();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
/** has this line a recording that says its current text? */
export const voiceIsCurrent = (l: Pick<Line, 'text' | 'audio'>) => !!l.audio && l.audio.textHash === textHash(l.text);

/** the recordings a project plays: its lines' up-to-date voices and its imported music (asset ids, once each) */
export function soundAssetsOf(p: Pick<Project, 'scenes'> & { soundtrack?: Project['soundtrack'] | undefined }): string[] {
  const out = new Set<string>();
  for (const s of p.scenes) for (const l of s.narration) if (voiceIsCurrent(l)) out.add(l.audio!.asset);
  if (p.soundtrack) out.add(p.soundtrack.asset);
  return [...out];
}

/** the pictures a project shows: decors painted by an image model and pictures imported into its drawings */
export function pictureAssetsOf(p: { assets?: Project['assets'] | undefined }): string[] {
  const out = new Set<string>();
  for (const a of Object.values(p.assets ?? {})) {
    if (a.image) out.add(a.image.asset);
    for (const part of a.parts) for (const sh of part.shapes) if (sh.type === 'image') out.add(sh.asset);
  }
  return [...out];
}

export { exampleProject } from './example';
export { diffJson, applyOps, OpConflict, OpInvalid, type Op, type PathSeg } from './ops';
export { LiveDoc, type LiveCause, type Peer, type LiveServerMsg, type LiveClientMsg } from './live';
export * from './picture';
