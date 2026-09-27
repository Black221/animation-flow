// Live co-editing. One room per open project, in this process: it holds the authoritative JSON, numbers every
// accepted change (seq), validates it (a change is refused if the project it would give is invalid, or if the
// place it edits was removed meanwhile), sends it to everyone else, and saves.
//
// Saving: 2 s after the last change (10 s at most while people keep typing) and when the last person leaves.
// Saves update the version this room last wrote, while it stays the latest one, by the same author and less than
// 2 minutes old: the history gets one version per sitting, not one per keystroke. A version the room did not
// write (the creation, a save through the API) is never overwritten, and an explicit save ("Enregistrer", Ctrl+S)
// closes the current version: the next change starts a new one.
//
// Clients reconcile: they apply their own changes at once, keep them as "pending" until the server acknowledges
// them, and replay pending changes on top of every change from others. Everyone converges on the server's order.
import { applyOps, OpConflict, parseProject, type LiveClientMsg, type LiveServerMsg, type Op, type Peer, type Project } from '@af/schema';
import type { Db } from '../db';

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

class Room {
  seq = 0;
  clients = new Map<string, LiveClient>();
  private dirty = false;
  private lastEditor: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private firstDirtyAt = 0;
  private saving: Promise<boolean> = Promise.resolve(false);
  /** the version this room is writing into, until an explicit save closes it */
  private openVersion: number | null = null;

  constructor(private db: Db, readonly projectId: string, readonly workspaceId: string, public project: Project, public version: number, private onEmpty: () => void, private saveDelay: number) {}

  peers() { return [...this.clients.values()].map((c) => c.presence); }
  broadcast(msg: ServerMsg, except?: string) { for (const c of this.clients.values()) if (c.id !== except) c.send(msg); }

  join(c: LiveClient) {
    this.clients.set(c.id, c);
    c.send({ type: 'hello', seq: this.seq, version: this.version, project: this.project, you: c.presence, peers: this.peers(), canEdit: c.canEdit });
    this.broadcast({ type: 'presence', peers: this.peers() }, c.id);
  }

  async leave(c: LiveClient) {
    this.clients.delete(c.id);
    this.broadcast({ type: 'presence', peers: this.peers() });
    // saving takes a moment: someone may have joined meanwhile, and then the room must stay
    if (!this.clients.size) { await this.flush(); if (!this.clients.size) this.onEmpty(); }
  }

  handle(c: LiveClient, msg: ClientMsg) {
    if (msg.type === 'presence') {
      c.presence = { ...c.presence, sceneId: typeof msg.sceneId === 'string' ? msg.sceneId.slice(0, 64) : null, tab: typeof msg.tab === 'string' ? msg.tab.slice(0, 32) : null };
      this.broadcast({ type: 'presence', peers: this.peers() });
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
    const r = this.apply(msg.ops, c.user, c.id);
    if (!r.ok) return c.send({ type: 'nack', opId: msg.opId, error: r.error });
    c.send({ type: 'ack', opId: msg.opId, seq: this.seq });
  }

  /** apply, validate, broadcast; changes that would break the project are refused */
  apply(ops: Op[], by: { id: string; name: string }, except?: string): { ok: true } | { ok: false; error: string } {
    let next: unknown;
    try { next = applyOps(this.project, ops); }
    catch (e) { return { ok: false, error: e instanceof OpConflict ? "ce que vous modifiiez vient d'être supprimé par quelqu'un d'autre" : 'modification illisible' }; }
    const parsed = parseProject(next);
    if (!parsed.ok) return { ok: false, error: `modification refusée, elle rendrait le projet invalide : ${parsed.issues.slice(0, 2).map((i) => `${i.path} ${i.message}`).join(' ; ')}` };
    this.project = parsed.project; this.seq++;
    this.broadcast({ type: 'ops', seq: this.seq, ops, by: { userId: by.id, name: by.name } }, except);
    this.touch(by.id);
    return { ok: true };
  }

  private touch(userId: string) {
    this.dirty = true; this.lastEditor = userId;
    const now = Date.now();
    if (!this.firstDirtyAt) this.firstDirtyAt = now;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.saveDelay, this.firstDirtyAt + this.saveDelay * 5 - now));
    this.timer = setTimeout(() => void this.flush(), wait);
  }

  /** save now if something changed; resolves to whether it saved */
  flush(): Promise<boolean> {
    this.saving = this.saving.then(async () => {
      if (!this.dirty) return false;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.dirty = false; this.firstDirtyAt = 0;
      const data = JSON.stringify(this.project), by = this.lastEditor;
      const v = await this.db.tx(async (q) => {
        const last = (await q.query<{ version: number; created_by: string | null; recent: boolean }>(
          `SELECT version, created_by, created_at > now() - make_interval(secs => $2) AS recent FROM project_versions WHERE project_id = $1 ORDER BY version DESC LIMIT 1`, [this.projectId, COALESCE_MS / 1000])).rows[0];
        if (last && last.version === this.openVersion && last.recent && last.created_by === by) {
          await q.query('UPDATE project_versions SET data = $3, created_at = now() WHERE project_id = $1 AND version = $2', [this.projectId, last.version, data]);
          await q.query('UPDATE projects SET data = $2, title = $3, updated_at = now(), updated_by = $4 WHERE id = $1', [this.projectId, data, this.project.title, by]);
          return last.version;
        }
        const next = (last?.version ?? 0) + 1;
        await q.query('INSERT INTO project_versions (project_id, version, data, created_by) VALUES ($1, $2, $3, $4)', [this.projectId, next, data, by]);
        await q.query('UPDATE projects SET data = $2, title = $3, version = $4, updated_at = now(), updated_by = $5 WHERE id = $1', [this.projectId, data, this.project.title, next, by]);
        return next;
      }).catch(() => { this.dirty = true; return null; });
      if (v == null) return false;
      this.version = this.openVersion = v;
      const name = by ? (await this.db.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [by])).rows[0]?.name ?? null : null;
      this.broadcast({ type: 'saved', version: v, by: name, at: new Date().toISOString() });
      return true;
    });
    return this.saving;
  }

  /** close everyone's connection (their rights changed, or the project is gone) */
  closeAll(code: number, reason: string, userId?: string, discard = false) {
    if (discard) { this.dirty = false; if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
    for (const c of [...this.clients.values()]) if (!userId || c.user.id === userId) c.close(code, reason);
  }

  /** a save that did not come through the room (the REST API): everyone restarts from it */
  reset(project: Project, version: number, reason: string) {
    this.project = project; this.version = version; this.seq++; this.dirty = false; this.openVersion = null;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.broadcast({ type: 'reset', seq: this.seq, version, project, reason });
  }
}

export class LiveHub {
  private rooms = new Map<string, Promise<Room>>();
  constructor(private db: Db, private saveDelay = 2000) {}

  get(projectId: string): Promise<Room> | undefined { return this.rooms.get(projectId); }

  /** the room of a project (loaded on first use); null if the project is not in that workspace */
  async open(projectId: string, workspaceId: string): Promise<Room | null> {
    let r = this.rooms.get(projectId);
    if (!r) {
      r = (async () => {
        const { rows } = await this.db.query<{ data: unknown; version: number; workspace_id: string }>('SELECT data, version, workspace_id FROM projects WHERE id = $1', [projectId]);
        const parsed = rows[0] ? parseProject(rows[0].data) : null;
        if (!rows[0] || !parsed?.ok) throw new Error('not found');
        return new Room(this.db, projectId, rows[0].workspace_id, parsed.project, rows[0].version, () => { if (this.rooms.get(projectId) === r) this.rooms.delete(projectId); }, this.saveDelay);
      })();
      this.rooms.set(projectId, r);
      r.catch(() => this.rooms.delete(projectId));
    }
    const room = await r.catch(() => null);
    return room && room.workspaceId === workspaceId ? room : null;
  }

  /** someone's role changed or they left: their connections close, and reopen (or not) with their new rights */
  async kick(workspaceId: string, userId?: string) {
    for (const r of this.rooms.values()) { const room = await r.catch(() => null); if (room?.workspaceId === workspaceId) room.closeAll(4001, 'droits modifiés', userId); }
  }
  /** the project was deleted */
  async closeProject(projectId: string) { const r = await this.rooms.get(projectId)?.catch(() => null); r?.closeAll(4404, 'projet supprimé', undefined, true); }

  /** a message for everyone in a project (comments…) */
  async emit(projectId: string, name: string, data: unknown) { const r = this.rooms.get(projectId); if (r) (await r).broadcast({ type: 'event', name, data }); }

  async flushAll() { for (const r of this.rooms.values()) await (await r).flush(); }
  colorOf = colorOf;
}
