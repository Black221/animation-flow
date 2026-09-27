import { describe, expect, it } from 'vitest';
import { applyOps, diffJson, exampleProject, LiveDoc, OpConflict, OpInvalid, parseProject, type LiveClientMsg, type LiveServerMsg, type Op, type Project, type Scene } from '../src';

const base = () => { const r = parseProject(exampleProject); if (!r.ok) throw new Error(); return structuredClone(r.project); };
const sc = (p: Project, id: string) => p.scenes.find((s) => s.id === id)!;
const blank = (id: string): Scene => ({ id, title: id, decor: { kind: 'plain', params: {} }, narration: [], elements: [], camera: [], transition: 'cut', music: { mood: 'none', gain: 0 }, sfx: [] });

describe('diffJson / applyOps', () => {
  it('reduces an edit to the changed leaves, addressing items by id, and replays it exactly', () => {
    const a = base(), b = structuredClone(a);
    b.scenes[0]!.elements[4]!.keys[0]!.x = 123;
    b.title = 'Nouveau titre';
    b.scenes[1]!.title = '';
    const ops = diffJson(a, b);
    expect(ops).toEqual([
      { op: 'set', path: ['title'], value: 'Nouveau titre' },
      { op: 'set', path: ['scenes', { id: 's1' }, 'elements', { id: 'sensor1' }, 'keys', 0, 'x'], value: 123 },
      { op: 'set', path: ['scenes', { id: 's2' }, 'title'], value: '' },
    ]);
    expect(applyOps(a, ops)).toEqual(b);
    expect(a.title).not.toBe('Nouveau titre'); // the input is untouched
  });

  it('describes adding, removing and reordering items as a list of ids', () => {
    const a = base(), b = structuredClone(a);
    b.scenes[0]!.narration.push({ id: 'l9', speaker: 'narrator', text: 'Une de plus.', holdAfter: 0 });
    b.scenes.reverse();
    expect(diffJson(a, b)).toEqual([
      { op: 'list', path: ['scenes'], ids: ['s2', 's1'], add: {}, removed: [] },
      { op: 'list', path: ['scenes', { id: 's1' }, 'narration'], ids: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9'], add: { l9: b.scenes[1]!.narration[8] }, removed: [] },
    ]);
    expect(applyOps(a, diffJson(a, b))).toEqual(b);
  });

  it('merges two people editing different fields, in either order', () => {
    const a = base(), x = structuredClone(a), y = structuredClone(a);
    x.scenes[0]!.title = 'Titre de X';
    y.scenes[1]!.decor.params = { sky: ['#000000', '#111111'], stars: 10 };
    const ox = diffJson(a, x), oy = diffJson(a, y);
    expect(applyOps(applyOps(a, ox), oy)).toEqual(applyOps(applyOps(a, oy), ox));
    const merged = applyOps(applyOps(a, ox), oy);
    expect(merged.scenes[0]!.title).toBe('Titre de X');
    expect(merged.scenes[1]!.decor.params.stars).toBe(10);
  });

  it('lands an edit on the right scene when someone inserted, moved or removed others meanwhile', () => {
    const a = base(), ins = structuredClone(a), edit = structuredClone(a);
    ins.scenes.unshift(blank('s0'));
    edit.scenes[1]!.title = 'Titre de s2';
    for (const [first, second] of [[ins, edit], [edit, ins]] as const) {
      const m = applyOps(applyOps(a, diffJson(a, first)), diffJson(a, second));
      expect(m.scenes.map((s) => s.id)).toEqual(['s0', 's1', 's2']);
      expect(sc(m, 's2').title).toBe('Titre de s2');
    }
  });

  it('keeps items someone else added while another person reordered or removed', () => {
    const a = base(), add = structuredClone(a), moved = structuredClone(a);
    add.scenes.push(blank('s3'));
    moved.scenes.reverse();
    const m = applyOps(applyOps(a, diffJson(a, add)), diffJson(a, moved));
    expect(m.scenes.map((s) => s.id)).toEqual(['s2', 's3', 's1']); // s3 stays right after s2, which preceded it
    const gone = structuredClone(a); gone.scenes.pop();
    expect(applyOps(applyOps(a, diffJson(a, add)), diffJson(a, gone)).scenes.map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('refuses an edit whose place was removed meanwhile', () => {
    const a = base(), shrunk = structuredClone(a), edit = structuredClone(a);
    shrunk.scenes.pop();
    edit.scenes[1]!.title = 'perdu';
    const merged = applyOps(a, diffJson(a, shrunk));
    expect(() => applyOps(merged, diffJson(a, edit))).toThrow(OpConflict);
  });

  it('refuses operations that are not well formed', () => {
    const a = base();
    const bad: unknown[] = [
      [{ op: 'set', path: ['__proto__', 'polluted'], value: 1 }],
      [{ op: 'set', path: ['scenes', -1], value: 1 }],
      [{ op: 'nope', path: [] }],
      [{ op: 'list', path: ['scenes'], ids: 's1', add: {}, removed: [] }],
      'ops',
    ];
    for (const ops of bad) expect(() => applyOps(a, ops as Op[])).toThrow(OpInvalid);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

/** a server like the API's live room: applies, validates, sends to the others, acknowledges the sender */
function simulate(seed: number, people = 3, steps = 120) {
  let rnd = seed;
  const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  let server = base(), seq = 0;
  const toServer: { from: number; m: LiveClientMsg }[] = [];
  const inbox: LiveServerMsg[][] = Array.from({ length: people }, () => []);
  const clients = Array.from({ length: people }, (_, i) => new LiveDoc((m) => toServer.push({ from: i, m }), () => undefined, `c${i}`));
  const serve = () => {
    const { from, m } = toServer.shift()!;
    if (m.type !== 'ops') return;
    let ok: Project | null = null;
    try { const r = parseProject(applyOps(server, m.ops)); if (r.ok) ok = r.project; } catch { /* refused */ }
    if (!ok) { inbox[from]!.push({ type: 'nack', opId: m.opId, error: 'refusé' }); return; }
    server = ok; seq++;
    inbox.forEach((q, i) => { if (i !== from) q.push({ type: 'ops', seq, ops: m.ops, by: { userId: `u${from}`, name: `c${from}` } }); });
    inbox[from]!.push({ type: 'ack', opId: m.opId, seq });
  };
  clients.forEach((c, i) => c.receive({ type: 'hello', seq: 0, version: 1, project: server, you: {} as never, peers: [], canEdit: true } as LiveServerMsg) ?? i);
  let made = 0;
  for (let step = 0; step < steps; step++) {
    const r = rand();
    if (r < 0.45) { // someone edits
      const i = Math.floor(rand() * people), c = clients[i]!, p = structuredClone(c.project!);
      const kind = rand(), s = pick(p.scenes);
      if (kind < 0.3) s.title = `${s.id} par c${i} (${step})`;
      else if (kind < 0.5) { const e = s.elements[0]; if (e) e.keys[0]!.x = step; else s.duration = 3 + (step % 5); }
      else if (kind < 0.65) p.scenes.splice(Math.floor(rand() * (p.scenes.length + 1)), 0, blank(`c${i}n${made++}`));
      else if (kind < 0.8 && p.scenes.length > 2) p.scenes.splice(p.scenes.indexOf(s), 1);
      else if (kind < 0.9) p.scenes.reverse();
      else p.title = `titre ${step}`;
      c.edit(p);
      if (rand() < 0.7) c.flush();
    } else if (r < 0.7 && toServer.length) serve();
    else { const i = Math.floor(rand() * people); const m = inbox[i]!.shift(); if (m) clients[i]!.receive(m); }
  }
  // everyone stops typing: send, serve and deliver everything
  for (let k = 0; k < 10000; k++) {
    clients.forEach((c) => c.flush());
    if (toServer.length) { serve(); continue; }
    const i = inbox.findIndex((q) => q.length);
    if (i < 0) break;
    clients[i]!.receive(inbox[i]!.shift()!);
  }
  return { server, clients };
}

describe('LiveDoc', () => {
  it('converges: every client ends with the server project, whatever the interleaving', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { server, clients } = simulate(seed);
      for (const c of clients) { expect(c.project).toEqual(server); expect(c.unconfirmed).toBe(0); }
      expect(parseProject(server).ok).toBe(true);
    }
  });

  it('keeps what the user typed when a change from someone else arrives', () => {
    const sent: LiveClientMsg[] = [], causes: string[] = [];
    const d = new LiveDoc((m) => sent.push(m), (_p, cause) => causes.push(cause), 'x');
    const p0 = base();
    d.receive({ type: 'hello', seq: 0, version: 1, project: p0, you: {} as never, peers: [], canEdit: true });
    const mine = structuredClone(p0); mine.scenes[0]!.title = 'mine';
    d.edit(mine);
    d.receive({ type: 'ops', seq: 1, ops: [{ op: 'set', path: ['scenes', { id: 's2' }, 'title'], value: 'theirs' }], by: { userId: 'u', name: 'Ed' } });
    expect(sent).toHaveLength(1); // flushed before applying theirs
    expect(d.project!.scenes.map((s) => s.title)).toEqual(['mine', 'theirs']);
    d.receive({ type: 'nack', opId: 'x-1', error: 'non' });
    expect(d.project!.scenes.map((s) => s.title)).toEqual([p0.scenes[0]!.title, 'theirs']);
    expect(causes).toEqual(['hello', 'remote', 'refused']);
  });

  it('replays unacknowledged changes after a reconnection', () => {
    const sent: LiveClientMsg[] = [];
    const d = new LiveDoc((m) => sent.push(m), () => undefined, 'x');
    const p0 = base();
    d.receive({ type: 'hello', seq: 0, version: 1, project: p0, you: {} as never, peers: [], canEdit: true });
    const mine = structuredClone(p0); mine.title = 'hors ligne'; d.edit(mine); d.flush();
    // connection lost; meanwhile someone else changed scene 2
    const now = structuredClone(p0); now.scenes[1]!.title = 'pendant ce temps';
    d.receive({ type: 'hello', seq: 5, version: 2, project: now, you: {} as never, peers: [], canEdit: true });
    expect(d.project!.title).toBe('hors ligne');
    expect(d.project!.scenes[1]!.title).toBe('pendant ce temps');
    expect(sent.at(-1)).toMatchObject({ type: 'ops', ops: [{ op: 'set', path: ['title'], value: 'hors ligne' }] });
  });
});
