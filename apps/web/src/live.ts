// Live co-editing in the browser: one WebSocket per open project. The project the editor shows comes from here
// while connected (LiveDoc keeps it in step with the server and the others); changes go out about every 150 ms,
// and the server saves them by itself. If the connection cannot be made at all (an old proxy without WebSocket),
// the editor falls back to saving by hand. A connection lost midway is retried, and what was typed meanwhile is
// sent on reconnection.
import { LiveDoc, type LiveCause, type LiveServerMsg, type Peer, type Project } from '@af/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getWorkspace } from './api';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';
export interface LiveNote { kind: 'info' | 'error'; text: string }

const FLUSH_MS = 150;
/** codes the server closes with when retrying would not help */
const FINAL = new Set([4403, 4404, 1008]);

export function useLive(projectId: string, epoch: number, onEvent?: (name: string, data: unknown) => void) {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [project, setProject] = useState<Project | null>(null);
  const [version, setVersion] = useState(0);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [you, setYou] = useState<Peer | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(0);
  const [unsaved, setUnsaved] = useState(false);
  const [savedBy, setSavedBy] = useState<string | null>(null);
  const [note, setNote] = useState<LiveNote | null>(null);
  /** bumps whenever the project changed without the user typing it: editors showing text follow */
  const [remoteN, setRemoteN] = useState(0);
  const sock = useRef<WebSocket | null>(null);
  const doc = useRef<LiveDoc | null>(null);
  const waiters = useRef<(() => void)[]>([]);
  const eventRef = useRef(onEvent); eventRef.current = onEvent;

  useEffect(() => {
    let stop = false, tries = 0, everLive = false, retry: ReturnType<typeof setTimeout> | undefined;
    const send = (m: unknown) => { if (sock.current?.readyState === WebSocket.OPEN) sock.current.send(JSON.stringify(m)); };
    const d = new LiveDoc(send, (p: Project, cause: LiveCause, detail?: string) => {
      setProject(p); setRemoteN((n) => n + 1);
      if (cause === 'refused') setNote({ kind: 'error', text: `Modification refusée : ${detail}` });
      else if (cause === 'reset') setNote({ kind: 'info', text: `Le projet a été rechargé (${detail}).` });
    });
    doc.current = d;
    setStatus('connecting'); setProject(null); setPeers([]); setNote(null);

    const connect = () => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/projects/${projectId}/live?ws=${encodeURIComponent(getWorkspace())}`;
      const s = new WebSocket(url);
      sock.current = s;
      s.onmessage = (e) => {
        let m: LiveServerMsg;
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m.type === 'hello') {
          everLive = true; tries = 0;
          setYou(m.you); setPeers(m.peers); setCanEdit(m.canEdit); setStatus('live');
        }
        if (m.type === 'presence') setPeers(m.peers);
        if (m.type === 'ops' || m.type === 'ack') setUnsaved(true);
        if (m.type === 'saved') { setUnsaved(false); if (m.by) setSavedBy(m.by); waiters.current.splice(0).forEach((f) => f()); }
        if (m.type === 'reset') setUnsaved(false);
        if (m.type === 'event') eventRef.current?.(m.name, m.data);
        d.receive(m);
        setVersion(d.version); setUnconfirmed(d.unconfirmed);
      };
      s.onclose = (e) => {
        if (sock.current === s) sock.current = null;
        if (stop) return;
        tries++;
        // refused for good, or never reachable: the editor saves by hand instead
        if (FINAL.has(e.code) || (!everLive && tries >= 3)) { setStatus('offline'); return; }
        setStatus(everLive ? 'reconnecting' : 'connecting');
        retry = setTimeout(connect, Math.min(15_000, 500 * 2 ** Math.min(tries, 5)));
      };
    };
    connect();
    const tick = setInterval(() => { d.flush(); setUnconfirmed(d.unconfirmed); }, FLUSH_MS);
    return () => { stop = true; clearInterval(tick); clearTimeout(retry); d.flush(); sock.current?.close(); sock.current = null; doc.current = null; };
  }, [projectId, epoch]);

  const edit = useCallback((p: Project) => { doc.current?.edit(p); setProject(p); setUnconfirmed(doc.current?.unconfirmed ?? 0); }, []);
  const presence = useCallback((sceneId: string | null, tab: string | null) => {
    if (sock.current?.readyState === WebSocket.OPEN) sock.current.send(JSON.stringify({ type: 'presence', sceneId, tab }));
  }, []);
  /** save now (and close the current version); resolves once the server has saved */
  const save = useCallback(() => new Promise<boolean>((ok) => {
    const s = sock.current;
    if (!s || s.readyState !== WebSocket.OPEN) return ok(false);
    doc.current?.flush();
    const t = setTimeout(() => ok(false), 10_000);
    waiters.current.push(() => { clearTimeout(t); ok(true); });
    s.send(JSON.stringify({ type: 'save' }));
  }), []);

  return { status, project, version, peers, you, canEdit, unconfirmed, unsaved: unsaved || unconfirmed > 0, savedBy, note, clearNote: () => setNote(null), remoteN, edit, presence, save };
}
