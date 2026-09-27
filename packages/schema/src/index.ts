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
});

export const CastMember = z.object({
  /** character component from the library (`person`, `drone`, …) */
  kind: z.string().min(1),
  name: z.string().min(1),
  params: Params.default({}),
});

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
export type Scene = z.output<typeof Scene>;
export type CastMember = z.output<typeof CastMember>;
export type Project = z.output<typeof Project>;
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

export { exampleProject } from './example';
