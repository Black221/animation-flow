// The WebSocket of a project being edited: /api/projects/:id/live?ws=<workspace>. Members join (viewers watch,
// editors edit); the session cookie authenticates the upgrade, and the Origin must be this server's own
// (a page on another site cannot open it with the user's cookie).
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { RANK, userOf, wsOf } from '../auth/context';
import type { ClientMsg, LiveClient, LiveHub } from '../live/hub';

export function liveRoutes(app: FastifyInstance, hub: LiveHub) {
  app.get('/api/projects/:id/live', { websocket: true, config: { role: 'viewer' } }, async (socket: WebSocket, req) => {
    const origin = req.headers.origin, host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (origin && host && new URL(origin).host !== host) { socket.close(4403, 'origine refusée'); return; }
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    const ws = wsOf(req), user = userOf(req);
    const room = id.success ? await hub.open(id.data, ws.id) : null;
    if (!room) { socket.close(4404, 'projet introuvable'); return; }
    const client: LiveClient = {
      id: randomUUID(), user: { id: user.id, name: user.name }, canEdit: RANK[ws.role] >= RANK.editor,
      presence: { userId: user.id, name: user.name, color: hub.colorOf(user.id), sceneId: null, tab: null },
      send: (m) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m)); },
      close: (code, reason) => socket.close(code, reason),
    };
    let alive = true;
    const ping = setInterval(() => { if (!alive) { socket.terminate(); return; } alive = false; socket.ping(); }, 30_000);
    socket.on('pong', () => { alive = true; });
    socket.on('message', (raw) => {
      if ((raw as Buffer).length > 4 * 1024 * 1024) return;
      let msg: ClientMsg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      room.handle(client, msg);
    });
    socket.on('close', () => { clearInterval(ping); void room.leave(client); });
    room.join(client);
  });
}
