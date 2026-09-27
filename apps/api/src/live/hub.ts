// Live co-editing, across as many API processes as needed. Each process keeps a room per project it has people
// on; the truth is in the database:
//
// - every accepted change goes into `live_ops`, numbered per project (`projects.live_seq`) under a row lock, so all
//   processes see the same changes in the same order. A change is checked against the project as it is at that
//   number: refused if the place it edits was removed meanwhile, or if the project it would give is invalid;
// - NOTIFY tells the other processes a change is there (they read it from the log), and carries presence, saves,
//   comment events and closed connections. A process that missed a notification catches up within seconds
//   (every open room checks where the log is);
// - `projects.data` holds the project up to `saved_seq`. Saving: 2 s after the last change (10 s at most while people
//   keep typing), when the last person of a process leaves, and on "Enregistrer". Saves update the version this room
//   last wrote, while it stays the latest one, by the same author and less than 2 minutes old: one version per
//   sitting, not per keystroke. A version the room did not write (the creation, a save through the API) is never
//   overwritten; "Enregistrer" closes the current version. A save through the API is a `reset` in the log.
//
// Clients reconcile: they apply their own changes at once, keep them as "pending" until acknowledged, and replay
// them on top of every change from others. Everyone converges on the log's order.
import { applyOps, OpConflict, parseProject, type LiveClientMsg, type LiveServerMsg, type Op, type Peer, type Project } from '@af/schema';
import { randomUUID } from 'node:crypto';
import type { Db, Queryable } from '../db';

export type { Peer };
export type ServerMsg = LiveServerMsg;
export type ClientMsg = LiveClientMsg;
export interface LiveClient {
  id: string;
  user: { id: string; name: string };
  canEdit: boolean;
  presence: Peer;
  send(msg: ServerMsg): void;
  close(code: number, reason: string): void;
}

const COLORS = ['#2F6FB3', '#C8553D', '#3E7C4A', '#8A4FB3', '#D99A3D', '#1F8A8A', '#B3386A', '#5A6B7C'];
const colorOf = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]!; };
export const COALESCE_MS = 120_000;
export const CHANNEL = 'af_live';
/** presence from other processes is kept this long without news (a process that died drops out) */
const PEER_TTL = 45_000, HEARTBEAT = 15_000, CATCH_UP = 3_000;
/** changes already saved stay in the log this long, for processes that are behind */
const KEEP_OPS = '10 minutes';
/** NOTIFY payloads are limited to 8000 bytes */
const MAX_NOTIFY = 7900;

type Note =
  | { t: 'ops'; p: string; s: number }
  | { t: 'saved'; p: string; v: number; by: string | null; i: string }
  | { t: 'presence'; p: string; i: string; peers: Peer[] }
  | { t: 'who'; p: string; i: string }
  | { t: 'event'; p: string; name: string; data: unknown }
  | { t: 'kick'; w: string | null; u: string | null; i: string }
  | { t: 'gone'; p: string; i: string };
const notify = (q: Queryable, n: Note) => q.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(n)]);

interface LogRow { seq: string | number; kind: 'ops' | 'reset'; ops: Op[]; version: number | null; reason: string | null; author_id: string | null; author_name: string | null }
const readLog = async (q: Queryable, projectId: string, after: number) =>
  (await q.query<LogRow>('SELECT seq, kind, ops, version, reason, author_id, author_name FROM live_ops WHERE project_id = $1 AND seq > $2 ORDER BY seq', [projectId, after])).rows;
/** the project a change gives, as stored (validated, defaults filled); throws if it is not valid */
const next = (p: Project, ops: Op[]) => { const r = parseProject(applyOps(p, ops)); if (!r.ok) throw new Error('invalid'); return r.project; };

/** the project as the log has it: the saved data, then the changes not saved yet */
async function current(q: Queryable, projectId: string, lock = false) {
  const head = (await q.query<{ data: unknown; version: number; workspace_id: string; live_seq: string; saved_seq: string }>(
    `SELECT data, version, workspace_id, live_seq, saved_seq FROM projects WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [projectId])).rows[0];
  if (!head) return null;
  const base = parseProject(head.data);
  if (!base.ok) return null;
  let project = base.project, by: string | null = null;
  const saved = Number(head.saved_seq), live = Number(head.live_seq);
  for (const r of live > saved ? await readLog(q, projectId, saved) : []) { project = next(project, r.ops); by = r.author_id ?? by; }
  return { project, version: head.version, workspaceId: head.workspace_id, seq: live, unsavedBy: by, unsaved: live > saved };
}

/** write what the log has beyond the saved data into a version (under the row lock), and tell every process;
 *  null if nothing was new */
export async function saveLog(q: Queryable, projectId: string, coalesceInto: number | null, from = ''): Promise<{ version: number; by: string | null } | null> {
  const c = await current(q, projectId, true);
  if (!c || !c.unsaved) return null;
  const data = JSON.stringify(c.project), by = c.unsavedBy;
  const last = (await q.query<{ version: number; created_by: string | null; recent: boolean }>(
    `SELECT version, created_by, created_at > now() - make_interval(secs => $2) AS recent FROM project_versions WHERE project_id = $1 ORDER BY version DESC LIMIT 1`, [projectId, COALESCE_MS / 1000])).rows[0];
  let version: number;
  if (last && last.version === coalesceInto && last.recent && last.created_by === by) {
    version = last.version;
    await q.query('UPDATE project_versions SET data = $3, created_at = now() WHERE project_id = $1 AND version = $2', [projectId, version, data]);
  } else {
    version = (last?.version ?? 0) + 1;
    await q.query('INSERT INTO project_versions (project_id, version, data, created_by) VALUES ($1, $2, $3, $4)', [projectId, version, data, by]);
  }
  await q.query('UPDATE projects SET data = $2, title = $3, version = $4, saved_seq = live_seq, updated_at = now(), updated_by = $5 WHERE id = $1', [projectId, data, c.project.title, version, by]);
  await q.query(`DELETE FROM live_ops WHERE project_id = $1 AND seq <= $2 AND created_at < now() - interval '${KEEP_OPS}'`, [projectId, c.seq]);
  await notify(q, { t: 'saved', p: projectId, v: version, by, i: from });
  return { version, by };
}

/** a save that did not come through live editing (the REST API): recorded as a reset, so every process restarts
 *  from it (call after writing `data`, under the row lock) */
export async function logReset(q: Queryable, projectId: string, project: Project, version: number, by: { id: string; name: string }, reason: string) {
  const seq = Number((await q.query<{ live_seq: string }>('UPDATE projects SET live_seq = live_seq + 1, saved_seq = live_seq + 1 WHERE id = $1 RETURNING live_seq', [projectId])).rows[0]!.live_seq);
  await q.query(`INSERT INTO live_ops (project_id, seq, kind, ops, version, reason, author_id, author_name) VALUES ($1, $2, 'reset', $3, $4, $5, $6, $7)`,
    [projectId, seq, JSON.stringify([{ op: 'set', path: [], value: project }]), version, reason, by.id, by.name]);
  await notify(q, { t: 'ops', p: projectId, s: seq });
}

class Room {
  clients = new Map<string, LiveClient>();
  /** people connected to other processes, by process */
  remote = new Map<string, { peers: Peer[]; at: number }>();
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private firstDirtyAt = 0;
  /** everything that reads or changes the room's state runs one after the other, in order */
  private chain: Promise<unknown> = Promise.resolve();
  /** the version this room is writing into, until an explicit save closes it */
  private openVersion: number | null = null;

  constructor(private hub: LiveHub, private db: Db, readonly projectId: string, readonly workspaceId: string,
    public project: Project, public seq: number, public version: number, private saveDelay: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> { const r = this.chain.then(fn); this.chain = r.catch(() => undefined); return r; }

  peers() {
    const now = Date.now(), all = [...this.clients.values()].map((c) => c.presence);
    for (const [i, r] of this.remote) { if (now - r.at > PEER_TTL) this.remote.delete(i); else all.push(...r.peers); }
    return all;
  }
  broadcast(msg: ServerMsg, except?: string) { for (const c of this.clients.values()) if (c.id !== except) c.send(msg); }
  /** tell everyone here, and the other processes, who is here */
  presenceChanged(except?: string) {
    this.broadcast({ type: 'presence', peers: this.peers() }, except);
    void this.hub.publish({ t: 'presence', p: this.projectId, i: this.hub.id, peers: [...this.clients.values()].map((c) => c.presence) });
  }

  join(c: LiveClient) {
    // counted at once (a room whose last person is leaving must not be dropped); changes broadcast before its
    // hello are ignored by the client and included in the hello
    this.clients.set(c.id, c);
    return this.run(async () => {
      await this.catchUp(this.db);
      if (!this.clients.has(c.id)) return; // gone meanwhile
      c.send({ type: 'hello', seq: this.seq, version: this.version, project: this.project, you: c.presence, peers: this.peers(), canEdit: c.canEdit });
      this.presenceChanged(c.id); // the hello already said who is there
    });
  }

  async leave(c: LiveClient) {
    this.clients.delete(c.id);
    this.presenceChanged();
    // saving takes a moment: someone may have joined meanwhile, and then the room must stay
    if (!this.clients.size) { await this.flush(); if (!this.clients.size) this.hub.drop(this); }
  }

  handle(c: LiveClient, msg: ClientMsg) {
    if (msg.type === 'presence') {
      c.presence = { ...c.presence, sceneId: typeof msg.sceneId === 'string' ? msg.sceneId.slice(0, 64) : null, tab: typeof msg.tab === 'string' ? msg.tab.slice(0, 32) : null };
      this.presenceChanged();
      return;
    }
    if (msg.type === 'save') {
      void this.flush().then((saved) => {
        this.openVersion = null;
        if (!saved) c.send({ type: 'saved', version: this.version, by: null, at: new Date().toISOString() });
      });
      return;
    }
    if (msg.type !== 'ops' || typeof msg.opId !== 'string' || !Array.isArray(msg.ops)) return;
    if (!c.canEdit) return c.send({ type: 'nack', opId: String(msg.opId), error: 'lecture seule (rôle lecteur)' });
    void this.run(async () => {
      const r = await this.apply(msg.ops, c.user, c.id);
      c.send(r.ok ? { type: 'ack', opId: msg.opId, seq: r.seq } : { type: 'nack', opId: msg.opId, error: r.error });
    }).catch(() => c.send({ type: 'nack', opId: msg.opId, error: 'modification non enregistrée (base de données indisponible), réessayez' }));
  }

  /** check a change against the project at the head of the log, append it, tell everyone (inside `run`) */
  private async apply(ops: Op[], by: { id: string; name: string }, except: string): Promise<{ ok: true; seq: number } | { ok: false; error: string }> {
    const r = await this.db.tx(async (q) => {
      const head = (await q.query<{ live_seq: string }>('SELECT live_seq FROM projects WHERE id = $1 FOR UPDATE', [this.projectId])).rows[0];
      if (!head) return { ok: false as const, error: 'projet supprimé' };
      if (Number(head.live_seq) > this.seq) await this.catchUp(q);
      let project: Project;
      try {
        const parsed = parseProject(applyOps(this.project, ops));
        if (!parsed.ok) return { ok: false as const, error: `modification refusée, elle rendrait le projet invalide : ${parsed.issues.slice(0, 2).map((i) => `${i.path} ${i.message}`).join(' ; ')}` };
        project = parsed.project;
      } catch (e) { return { ok: false as const, error: e instanceof OpConflict ? "ce que vous modifiiez vient d'être supprimé par quelqu'un d'autre" : 'modification illisible' }; }
      const seq = this.seq + 1;
      await q.query(`INSERT INTO live_ops (project_id, seq, kind, ops, author_id, author_name) VALUES ($1, $2, 'ops', $3, $4, $5)`, [this.projectId, seq, JSON.stringify(ops), by.id, by.name]);
      await q.query('UPDATE projects SET live_seq = $2 WHERE id = $1', [this.projectId, seq]);
      await notify(q, { t: 'ops', p: this.projectId, s: seq });
      return { ok: true as const, seq, project };
    });
    if (!r.ok) return r;
    this.project = r.project; this.seq = r.seq;
    this.broadcast({ type: 'ops', seq: r.seq, ops, by: { userId: by.id, name: by.name } }, except);
    this.touch();
    return { ok: true, seq: r.seq };
  }

  /** apply what other processes (or the API) added to the log; resynchronise if part of it is gone */
  async catchUp(q: Queryable) {
    const rows = await readLog(q, this.projectId, this.seq);
    if (rows.length && Number(rows[0]!.seq) !== this.seq + 1) return this.resync(q);
    for (const r of rows) {
      const seq = Number(r.seq);
      try { this.project = next(this.project, r.ops); } catch { return this.resync(q); }
      this.seq = seq;
      if (r.kind === 'reset') {
        this.version = r.version ?? this.version; this.openVersion = null; this.dirty = false;
        this.broadcast({ type: 'reset', seq, version: this.version, project: this.project, reason: r.reason ?? 'rechargé' });
      } else this.broadcast({ type: 'ops', seq, ops: r.ops, by: { userId: r.author_id ?? '', name: r.author_name ?? '' } });
    }
  }

  /** this process fell too far behind (the log was trimmed): start again from the database */
  private async resync(q: Queryable) {
    const c = await current(q, this.projectId);
    if (!c) return;
    this.project = c.project; this.seq = c.seq; this.version = c.version;
    this.broadcast({ type: 'reset', seq: c.seq, version: c.version, project: c.project, reason: 'resynchronisé' });
  }

  touch() {
    this.dirty = true;
    const now = Date.now();
    if (!this.firstDirtyAt) this.firstDirtyAt = now;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.saveDelay, this.firstDirtyAt + this.saveDelay * 5 - now));
    this.timer = setTimeout(() => void this.flush(), wait);
  }

  /** save what the log has beyond the saved data; resolves to whether this call saved something */
  flush(): Promise<boolean> {
    return this.run(async () => {
      if (!this.dirty) return false;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.dirty = false; this.firstDirtyAt = 0;
      let saved: Awaited<ReturnType<typeof saveLog>>;
      try { saved = await this.db.tx((q) => saveLog(q, this.projectId, this.openVersion, this.hub.id)); }
      catch { this.touch(); return false; } // database unavailable: try again later
      if (!saved) return false;
      this.openVersion = saved.version;
      await this.savedAs(saved.version, saved.by);
      return true;
    });
  }

  async savedAs(version: number, by: string | null) {
    this.version = version;
    const name = by ? (await this.db.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [by])).rows[0]?.name ?? null : null;
    this.broadcast({ type: 'saved', version, by: name, at: new Date().toISOString() });
  }

  /** close everyone's connection here (their rights changed, or the project is gone) */
  closeAll(code: number, reason: string, userId?: string | null, discard = false) {
    if (discard) { this.dirty = false; if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
    for (const c of [...this.clients.values()]) if (!userId || c.user.id === userId) c.close(code, reason);
  }
}

export class LiveHub {
  /** this process, as the others see it */
  readonly id = randomUUID();
  private rooms = new Map<string, Promise<Room>>();
  private stopListening: (() => Promise<void>) | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(private db: Db, private saveDelay = 2000) {}

  /** listen to the other processes (NOTIFY); every room also checks the log every few seconds */
  async start() {
    this.stopListening = await this.db.listen(CHANNEL, (payload) => { let n: Note; try { n = JSON.parse(payload); } catch { return; } void this.receive(n).catch(() => undefined); });
    this.timers.push(setInterval(() => void this.catchUpAll(), CATCH_UP), setInterval(() => void this.heartbeat(), HEARTBEAT));
  }
  async close() { this.timers.forEach(clearInterval); await this.stopListening?.(); this.stopListening = null; await this.flushAll(); }

  async publish(n: Note) {
    let payload = JSON.stringify(n);
    if (Buffer.byteLength(payload) > MAX_NOTIFY) {
      if (n.t !== 'event') return;
      payload = JSON.stringify({ ...n, data: { kind: 'reload' } }); // too big to carry: the others reload
    }
    await this.db.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]).catch(() => undefined);
  }

  private async room(projectId: string) { const r = this.rooms.get(projectId); return r ? r.catch(() => null) : null; }

  private async receive(n: Note) {
    if (n.t === 'kick') { if (n.i !== this.id) this.kickHere(n.w, n.u); return; }
    const room = await this.room(n.p);
    if (!room) return;
    switch (n.t) {
      case 'ops': if (n.s > room.seq) await room.run(() => room.catchUp(this.db)); return;
      case 'saved': if (n.i !== this.id) await room.run(() => room.savedAs(n.v, n.by)); return;
      case 'presence': if (n.i !== this.id) { room.remote.set(n.i, { peers: n.peers, at: Date.now() }); room.broadcast({ type: 'presence', peers: room.peers() }); } return;
      case 'who': if (n.i !== this.id && room.clients.size) room.presenceChanged(); return;
      case 'event': room.broadcast({ type: 'event', name: n.name, data: n.data }); return;
      case 'gone': if (n.i !== this.id) room.closeAll(4404, 'projet supprimé', null, true); return;
    }
  }

  get(projectId: string): Promise<Room> | undefined { return this.rooms.get(projectId); }
  drop(room: Room) { void this.rooms.get(room.projectId)?.then((r) => { if (r === room) this.rooms.delete(room.projectId); }, () => undefined); }

  /** the room of a project (loaded on first use); null if the project is not in that workspace */
  async open(projectId: string, workspaceId: string): Promise<Room | null> {
    let r = this.rooms.get(projectId);
    if (!r) {
      r = (async () => {
        const c = await current(this.db, projectId);
        if (!c) throw new Error('not found');
        const room = new Room(this, this.db, projectId, c.workspaceId, c.project, c.seq, c.version, this.saveDelay);
        if (c.unsaved) room.touch(); // changes a stopped process left unsaved: save them
        void this.publish({ t: 'who', p: projectId, i: this.id }); // who is on it elsewhere?
        return room;
      })();
      this.rooms.set(projectId, r);
      r.catch(() => this.rooms.delete(projectId));
    }
    const room = await r.catch(() => null);
    return room && room.workspaceId === workspaceId ? room : null;
  }

  private kickHere(workspaceId: string | null, userId: string | null) {
    for (const r of this.rooms.values()) void r.then((room) => { if (workspaceId === null || room.workspaceId === workspaceId) room.closeAll(4001, 'droits modifiés', userId); }, () => undefined);
  }
  /** someone's role changed, they left, or their password changed: their connections close in every process, and
   *  reopen (or not) with their new rights */
  async kick(workspaceId: string | null, userId?: string) {
    await Promise.all([...this.rooms.values()].map((r) => r.catch(() => null)));
    this.kickHere(workspaceId, userId ?? null);
    await this.publish({ t: 'kick', w: workspaceId, u: userId ?? null, i: this.id });
  }
  /** the project was deleted */
  async closeProject(projectId: string) {
    (await this.room(projectId))?.closeAll(4404, 'projet supprimé', null, true);
    await this.publish({ t: 'gone', p: projectId, i: this.id });
  }

  /** a message for everyone in a project, in every process (comments…) */
  async emit(projectId: string, name: string, data: unknown) {
    if (this.stopListening) return this.publish({ t: 'event', p: projectId, name, data }); // comes back here too
    (await this.room(projectId))?.broadcast({ type: 'event', name, data });
  }

  private async catchUpAll() {
    const rooms = (await Promise.all([...this.rooms.values()].map((r) => r.catch(() => null)))).filter((r): r is Room => !!r && r.clients.size > 0);
    if (!rooms.length) return;
    const heads = await this.db.query<{ id: string; live_seq: string }>('SELECT id, live_seq FROM projects WHERE id = ANY($1)', [rooms.map((r) => r.projectId)]).catch(() => ({ rows: [] }));
    for (const h of heads.rows) { const room = rooms.find((r) => r.projectId === h.id); if (room && Number(h.live_seq) > room.seq) void room.run(() => room.catchUp(this.db)).catch(() => undefined); }
  }
  private async heartbeat() {
    for (const r of this.rooms.values()) { const room = await r.catch(() => null); if (room?.clients.size) room.presenceChanged(); }
  }

  async flushAll() { for (const r of this.rooms.values()) { const room = await r.catch(() => null); await room?.flush(); } }
  colorOf = colorOf;
}
