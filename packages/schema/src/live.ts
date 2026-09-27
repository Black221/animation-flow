// The client side of live co-editing, shared by the editor and the tests. The messages exchanged with the server,
// and LiveDoc, which keeps a client in step:
//
// - `confirmed` is the project as the server has it, as far as this client knows;
// - `pending` are this client's changes sent but not yet acknowledged;
// - `project` is what the user sees: confirmed + pending + what was typed since the last send.
//
// A change from someone else applies to `confirmed`, then pending changes are replayed on top: the user keeps what
// they typed, and everyone ends up with the server's order. A change the server refuses is dropped and the view
// rebuilt without it. After a reconnection, what was not acknowledged is replayed on the server's current project.
import { applyOps, diffJson, type Op } from './ops';
import { parseProject, type Project } from './index';

export interface Peer { userId: string; name: string; color: string; sceneId: string | null; tab: string | null }
export type LiveServerMsg =
  | { type: 'hello'; seq: number; version: number; project: Project; you: Peer; peers: Peer[]; canEdit: boolean }
  | { type: 'ops'; seq: number; ops: Op[]; by: { userId: string; name: string } }
  | { type: 'ack'; opId: string; seq: number }
  | { type: 'nack'; opId: string; error: string }
  | { type: 'presence'; peers: Peer[] }
  | { type: 'saved'; version: number; by: string | null; at: string }
  | { type: 'reset'; seq: number; version: number; project: Project; reason: string }
  | { type: 'event'; name: string; data: unknown };
export type LiveClientMsg =
  | { type: 'ops'; opId: string; ops: Op[] }
  | { type: 'presence'; sceneId: string | null; tab: string | null }
  | { type: 'save' };

/** why the view changed without the user typing: joined, someone else's change, a save from outside, a refusal */
export type LiveCause = 'hello' | 'remote' | 'reset' | 'refused';

/** the project an operation list gives, as the server would store it (validated, defaults filled), or null */
const next = (p: Project, ops: Op[]): Project | null => {
  try { const r = parseProject(applyOps(p, ops)); return r.ok ? r.project : null; } catch { return null; }
};

export class LiveDoc {
  project: Project | null = null;
  version = 0;
  private confirmed: Project | null = null;
  private sent: Project | null = null;
  private pending: { opId: string; ops: Op[] }[] = [];
  private n = 0;

  constructor(
    private send: (m: LiveClientMsg) => void,
    private onChange: (p: Project, cause: LiveCause, detail?: string) => void,
    private prefix = Math.random().toString(36).slice(2, 8),
  ) {}

  /** changes the server has not acknowledged yet (sent or not) */
  get unconfirmed() { return this.pending.length + (this.project !== this.sent ? 1 : 0); }

  /** the user changed the project; it is sent at the next flush() */
  edit(p: Project) { this.project = p; }

  /** send what changed since the last send */
  flush() {
    if (!this.project || !this.sent || this.project === this.sent) return;
    const ops = diffJson(this.sent, this.project);
    this.sent = this.project;
    if (!ops.length) return;
    const opId = `${this.prefix}-${++this.n}`;
    this.pending.push({ opId, ops });
    this.send({ type: 'ops', opId, ops });
  }

  receive(m: LiveServerMsg) {
    switch (m.type) {
      case 'hello': {
        // a reconnection: what the server never acknowledged is replayed on its current project
        const mine = m.canEdit && this.confirmed && this.project ? diffJson(this.confirmed, this.project) : [];
        this.confirmed = this.sent = m.project; this.pending = []; this.version = m.version;
        const rebased = mine.length ? next(m.project, mine) : null;
        this.project = rebased ?? m.project;
        this.onChange(this.project, mine.length && !rebased ? 'refused' : 'hello', mine.length && !rebased ? 'vos dernières modifications ne s\'appliquent plus au projet actuel' : undefined);
        if (rebased) this.flush();
        return;
      }
      case 'ops': {
        if (!this.confirmed) return;
        this.flush();
        this.confirmed = next(this.confirmed, m.ops) ?? this.confirmed;
        this.rebuild();
        this.onChange(this.project!, 'remote', m.by.name);
        return;
      }
      case 'ack': {
        const k = this.pending.findIndex((p) => p.opId === m.opId);
        if (k < 0 || !this.confirmed) return;
        // acknowledgements come in the order changes were sent: everything before k was refused
        const done = this.pending.splice(0, k + 1).pop()!;
        this.confirmed = next(this.confirmed, done.ops) ?? this.confirmed;
        return;
      }
      case 'nack': {
        const k = this.pending.findIndex((p) => p.opId === m.opId);
        this.flush();
        if (k >= 0) this.pending.splice(k, 1);
        this.rebuild();
        this.onChange(this.project!, 'refused', m.error);
        return;
      }
      case 'reset': {
        this.confirmed = this.sent = this.project = m.project; this.pending = []; this.version = m.version;
        this.onChange(m.project, 'reset', m.reason);
        return;
      }
      case 'saved': this.version = m.version; return;
      default: return;
    }
  }

  /** the view = confirmed + pending changes that still apply (those that do not will be refused by the server) */
  private rebuild() {
    let p = this.confirmed!;
    this.pending = this.pending.filter((x) => { const r = next(p, x.ops); if (r) p = r; return !!r; });
    this.project = this.sent = p;
  }
}
