// Comments on scenes: threads pinned to a scene, optionally to an element and a moment of the scene. The list
// follows the others live (event `comments` on the project's live connection) and every action of this user.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Project } from '@af/schema';
import { Api, type Comment, type NewComment } from '../api';
import { fmtTime, usePlayback, type Playback } from '../playback';

/** `reload`: a change too big to be carried between server processes; the list is fetched again */
export type CommentEvent = { kind: 'upsert'; comment: Comment } | { kind: 'delete'; id: string } | { kind: 'reload' };

export function useComments(projectId: string, epoch: number) {
  const [list, setList] = useState<Comment[]>([]);
  const [error, setError] = useState('');
  const [reloads, setReloads] = useState(0);
  useEffect(() => { let on = true; Api.comments(projectId).then((l) => on && setList(l), (e) => on && setError((e as Error).message)); return () => { on = false; }; }, [projectId, epoch, reloads]);
  useEffect(() => setList([]), [projectId, epoch]);
  const apply = useCallback((e: CommentEvent) => setList((l) => {
    if (e.kind === 'reload') { setReloads((n) => n + 1); return l; }
    if (e.kind === 'delete') return l.filter((c) => c.id !== e.id && c.parentId !== e.id);
    const i = l.findIndex((c) => c.id === e.comment.id);
    return i < 0 ? [...l, e.comment] : l.map((c, k) => (k === i ? e.comment : c));
  }), []);
  const run = useCallback(async (f: () => Promise<CommentEvent>) => {
    setError('');
    try { apply(await f()); return true; } catch (err) { setError((err as Error).message); return false; }
  }, [apply]);
  return {
    list, error, apply,
    add: (c: NewComment) => run(async () => ({ kind: 'upsert', comment: await Api.addComment(projectId, c) })),
    edit: (id: string, c: { body?: string; resolved?: boolean }) => run(async () => ({ kind: 'upsert', comment: await Api.updateComment(id, c) })),
    remove: (id: string) => run(async () => { await Api.deleteComment(id); return { kind: 'delete', id }; }),
  };
}
export type CommentsState = ReturnType<typeof useComments>;

/** open threads per scene (for the scene list) */
export const openThreads = (list: Comment[]) => {
  const n: Record<string, number> = {};
  for (const c of list) if (!c.parentId && !c.resolvedAt) n[c.sceneId] = (n[c.sceneId] ?? 0) + 1;
  return n;
};

const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** the playhead within the scene, updated as it plays */
function AtTime({ pb, start, duration, children }: { pb: Playback; start: number; duration: number; children: (t: number) => ReactNode }) {
  const { time } = usePlayback(pb);
  return <>{children(Math.max(0, Math.min(duration, time - start)))}</>;
}

export function CommentsPanel({ state, project, sceneId, sceneStart, sceneDuration, pb, me, canResolve, canModerate, onSeek }: {
  state: CommentsState; project: Project; sceneId: string; sceneStart: number; sceneDuration: number; pb: Playback;
  me: string | null; canResolve: boolean; canModerate: boolean; onSeek: (sceneId: string, t: number) => void;
}) {
  const [all, setAll] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [body, setBody] = useState('');
  const [atTime, setAtTime] = useState(true);
  const [element, setElement] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const scene = project.scenes.find((s) => s.id === sceneId);
  const exists = new Set(project.scenes.map((s) => s.id));
  const threads = state.list.filter((c) => !c.parentId && (all || c.sceneId === sceneId) && (showResolved || !c.resolvedAt));
  const replies = (id: string) => state.list.filter((c) => c.parentId === id);
  const hiddenResolved = state.list.filter((c) => !c.parentId && (all || c.sceneId === sceneId) && c.resolvedAt).length;

  return (
    <section className="comments" aria-label="commentaires">
      <AtTime pb={pb} start={sceneStart} duration={sceneDuration}>{(t) => (
        <form aria-label="nouveau commentaire" onSubmit={(e) => { e.preventDefault(); void state.add({ body, sceneId, elementId: element || null, t: atTime ? Math.round(t * 10) / 10 : null }).then((ok) => ok && setBody('')); }}>
          <textarea aria-label="commentaire" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Commenter la scène ${sceneId}…`} maxLength={4000} />
          <div className="row">
            <label className="small"><input type="checkbox" checked={atTime} onChange={(e) => setAtTime(e.target.checked)} /> à {fmtTime(t)}</label>
            <select aria-label="élément commenté" value={element} onChange={(e) => setElement(e.target.value)}>
              <option value="">toute la scène</option>
              {scene?.elements.map((el) => <option key={el.id} value={el.id}>{el.id}</option>)}
            </select>
            <button type="submit" className="primary" disabled={!body.trim()}>Commenter</button>
          </div>
        </form>
      )}</AtTime>
      <div className="row small">
        <label><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> toutes les scènes</label>
        <label><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> fils résolus{hiddenResolved ? ` (${hiddenResolved})` : ''}</label>
      </div>
      {state.error && <p className="error small" role="alert">{state.error}</p>}
      {!threads.length && <p className="muted small">Aucun commentaire {all ? 'ouvert' : 'ouvert sur cette scène'}.</p>}
      <ol className="threads">
        {threads.map((c) => {
          const mine = !!me && c.author?.id === me;
          return (
            <li key={c.id} className={c.resolvedAt ? 'resolved' : ''} data-testid="comment-thread">
              <div className="meta small">
                <strong>{c.author?.name ?? 'ancien membre'}</strong> <span className="muted">{when(c.createdAt)}{c.editedAt ? ' · modifié' : ''}</span>
                {(all || !exists.has(c.sceneId)) && <span className="sid">{exists.has(c.sceneId) ? c.sceneId : `${c.sceneId} (supprimée)`}</span>}
                {c.t != null && exists.has(c.sceneId) && <button type="button" className="link" onClick={() => onSeek(c.sceneId, c.t!)} title="aller à ce moment">à {fmtTime(c.t)}</button>}
                {c.elementId && <code>{c.elementId}</code>}
              </div>
              <p className="body">{c.body}</p>
              {replies(c.id).map((r) => (
                <div key={r.id} className="reply small" data-testid="comment-reply">
                  <strong>{r.author?.name ?? 'ancien membre'}</strong> <span className="muted">{when(r.createdAt)}</span>
                  {((me && r.author?.id === me) || canModerate) && <button type="button" className="link" onClick={() => void state.remove(r.id)} aria-label="supprimer la réponse">✕</button>}
                  <p className="body">{r.body}</p>
                </div>
              ))}
              {c.resolvedAt && <p className="muted small">Résolu par {c.resolvedBy ?? '—'}</p>}
              <div className="row small">
                <button type="button" onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReply(''); }}>Répondre</button>
                {(canResolve || mine) && <button type="button" onClick={() => void state.edit(c.id, { resolved: !c.resolvedAt })}>{c.resolvedAt ? 'Rouvrir' : 'Résoudre'}</button>}
                {(mine || canModerate) && <button type="button" onClick={() => { if (confirm('Supprimer ce fil et ses réponses ?')) void state.remove(c.id); }}>Supprimer</button>}
              </div>
              {replyTo === c.id && (
                <form aria-label="réponse" onSubmit={(e) => { e.preventDefault(); void state.add({ body: reply, parentId: c.id }).then((ok) => { if (ok) { setReply(''); setReplyTo(null); } }); }}>
                  <textarea aria-label="réponse" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} autoFocus maxLength={4000} />
                  <button type="submit" disabled={!reply.trim()}>Envoyer</button>
                </form>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
