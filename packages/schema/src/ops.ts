// Operations on project JSON, for live co-editing. diffJson(a, b) turns an edit into the smallest set of
// operations; applyOps(doc, ops) replays them (on a copy). Objects are compared key by key down to the leaves.
//
// Arrays of items with an id (scenes, elements, lines) are addressed by id, not by position: `{ id: 's2' }` in a
// path means "the item whose id is s2, wherever it is now". Adding, removing or reordering such items is a `list`
// operation that names the new order, the items it adds and the ones it removes; items it does not mention (added
// meanwhile by someone else) are kept, and items it keeps are kept as they are now (edited meanwhile by someone
// else). So an edit of scene s2 lands on s2 even if someone inserted a scene before it, and is refused if s2 was
// deleted. Other arrays (keys, camera) go element by element when their length is unchanged, and are replaced
// whole when it changes. Two people editing different fields merge; the same field goes to the last one the
// server received.
export type PathSeg = string | number | { id: string };
export type Op =
  | { op: 'set'; path: PathSeg[]; value: unknown }
  | { op: 'remove'; path: PathSeg[] }
  | { op: 'list'; path: PathSeg[]; ids: string[]; add: Record<string, unknown>; removed: string[] };

type Obj = Record<string, unknown>;
type Item = Obj & { id: string };
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** an array whose items all have a distinct string id */
const keyed = (a: unknown[]): a is Item[] => {
  if (!a.length) return false;
  const seen = new Set<string>();
  for (const x of a) { if (!isObj(x) || typeof x.id !== 'string' || seen.has(x.id)) return false; seen.add(x.id); }
  return true;
};

export function diffJson(a: unknown, b: unknown, path: PathSeg[] = [], out: Op[] = []): Op[] {
  if (a === b) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if ((a.length || b.length) && (!a.length || keyed(a)) && (!b.length || keyed(b))) {
      const A = a as Item[], B = b as Item[];
      const ai = A.map((x) => x.id), bi = B.map((x) => x.id), inA = new Set(ai), inB = new Set(bi);
      if (ai.join('\u0000') !== bi.join('\u0000')) {
        const add: Obj = {};
        for (const x of B) if (!inA.has(x.id)) add[x.id] = x;
        out.push({ op: 'list', path, ids: bi, add, removed: ai.filter((id) => !inB.has(id)) });
      }
      const byId = new Map(A.map((x) => [x.id, x]));
      for (const x of B) { const old = byId.get(x.id); if (old) diffJson(old, x, [...path, { id: x.id }], out); }
      return out;
    }
    if (a.length !== b.length) out.push({ op: 'set', path, value: b });
    else for (let i = 0; i < a.length; i++) diffJson(a[i], b[i], [...path, i], out);
    return out;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) if (!(k in b) || b[k] === undefined) { if (a[k] !== undefined) out.push({ op: 'remove', path: [...path, k] }); }
    for (const k of Object.keys(b)) if (b[k] !== undefined) { if (!(k in a) || a[k] === undefined) out.push({ op: 'set', path: [...path, k], value: b[k] }); else diffJson(a[k], b[k], [...path, k], out); }
    return out;
  }
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return out;
  out.push({ op: 'set', path, value: b });
  return out;
}

const show = (path: PathSeg[]) => path.map((s) => (typeof s === 'object' && s ? `[${s.id}]` : String(s))).join('.');
export class OpConflict extends Error { constructor(public path: PathSeg[]) { super(`the edited place no longer exists: ${show(path)}`); this.name = 'OpConflict'; } }
/** an operation that is not well formed (a buggy or hostile client) */
export class OpInvalid extends Error { constructor(msg: string) { super(msg); this.name = 'OpInvalid'; } }

/** the position `seg` designates in `node`, or undefined when it is not there (any more) */
function resolve(node: unknown, seg: PathSeg): string | number | undefined {
  if (Array.isArray(node)) {
    if (typeof seg === 'number') return seg < node.length ? seg : undefined;
    if (isObj(seg)) { const i = node.findIndex((x) => isObj(x) && x.id === seg.id); return i < 0 ? undefined : i; }
    return undefined;
  }
  return isObj(node) && typeof seg === 'string' ? seg : undefined;
}

function checkOp(o: unknown): asserts o is Op {
  if (!isObj(o) || !Array.isArray(o.path) || !['set', 'remove', 'list'].includes(o.op as string)) throw new OpInvalid('opération illisible');
  for (const s of o.path as unknown[]) {
    if (typeof s === 'string') { if (FORBIDDEN.has(s)) throw new OpInvalid('chemin interdit'); }
    else if (typeof s === 'number') { if (!Number.isInteger(s) || s < 0) throw new OpInvalid('indice invalide'); }
    else if (!isObj(s) || typeof s.id !== 'string') throw new OpInvalid('chemin illisible');
  }
  if (o.op === 'list') {
    const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
    if (!o.path.length || !strings(o.ids) || !strings(o.removed) || !isObj(o.add)) throw new OpInvalid('liste illisible');
  }
}

/** replay operations on a structural copy; throws OpConflict when the place an operation edits is gone (a
 *  concurrent edit removed it), OpInvalid when an operation is not well formed */
export function applyOps<T>(doc: T, ops: readonly Op[]): T {
  if (!Array.isArray(ops)) throw new OpInvalid('opérations illisibles');
  let root: unknown = doc;
  for (const o of ops) {
    checkOp(o);
    if (!o.path.length) {
      if (o.op !== 'set') throw new OpConflict(o.path);
      root = structuredClone(o.value);
      continue;
    }
    const c = copyPath(root, o.path.slice(0, -1));
    root = c.root;
    const parent = c.node, k = resolve(parent, o.path[o.path.length - 1]!);
    if (k === undefined) throw new OpConflict(o.path);
    if (o.op === 'list') {
      const cur = (parent as Obj)[k as string];
      if (!Array.isArray(cur)) throw new OpConflict(o.path);
      (parent as Obj)[k as string] = reorder(cur, o);
    } else if (Array.isArray(parent)) {
      if (o.op === 'remove') throw new OpConflict(o.path);
      parent[k as number] = structuredClone(o.value);
    } else if (o.op === 'remove') delete (parent as Obj)[k as string];
    else (parent as Obj)[k as string] = structuredClone(o.value);
  }
  return root as T;
}

/** the new order of a keyed array: the named items (as they are now, or the added ones), then the items the
 *  operation does not know about (added meanwhile by someone else), put back after the item that preceded them */
function reorder(cur: unknown[], o: Extract<Op, { op: 'list' }>): unknown[] {
  const idOf = (x: unknown) => (isObj(x) && typeof x.id === 'string' ? x.id : null);
  const byId = new Map<string, unknown>();
  for (const x of cur) { const id = idOf(x); if (id !== null && !byId.has(id)) byId.set(id, x); }
  const out: unknown[] = [], placed = new Set<string>();
  for (const id of o.ids) {
    if (placed.has(id)) continue;
    const v = byId.has(id) ? byId.get(id) : Object.hasOwn(o.add, id) ? structuredClone(o.add[id]) : undefined;
    if (v === undefined) continue; // removed meanwhile by someone else: the removal stands
    out.push(v); placed.add(id);
  }
  const removed = new Set(o.removed);
  cur.forEach((x, i) => {
    const id = idOf(x);
    if (id !== null && (placed.has(id) || removed.has(id))) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const pos = out.indexOf(cur[j]); if (pos >= 0) { at = pos + 1; break; } }
    out.splice(at, 0, x);
    if (id !== null) placed.add(id);
  });
  return out;
}

/** copy the containers along `path` (not the rest): the input is left untouched, unchanged branches are shared */
function copyPath(root: unknown, path: PathSeg[]): { root: unknown; node: unknown } {
  const copy = (v: unknown) => (Array.isArray(v) ? v.slice() : isObj(v) ? { ...v } : v);
  const top = copy(root);
  let node: unknown = top;
  for (const seg of path) {
    const k = resolve(node, seg);
    if (k === undefined) throw new OpConflict(path);
    const child = (node as Obj)[k as string];
    if (!(Array.isArray(child) || isObj(child))) throw new OpConflict(path);
    const c = copy(child);
    (node as Obj)[k as string] = c;
    node = c;
  }
  return { root: top, node };
}
