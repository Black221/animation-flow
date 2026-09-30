// Security headers, for the app and the back office alike. Pages (the built editor, its files) get a strict Content
// Security Policy: only this origin's scripts, styles, workers and connections, pictures and sounds from here or made
// in the page (blob:, data:), never framed. API answers are data, never a page: nothing may run or load in them.
// Strict-Transport-Security only over HTTPS (the browser ignores it otherwise), by the same rule as the Secure cookie.
// connect-src 'self' covers the live-editing WebSocket (ws: and wss: to this host, CSP level 3: current Chrome, Edge,
// Firefox and Safari).
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** reached over HTTPS, or through a proxy that says so. X-Forwarded-Proto is believed even without TRUST_PROXY: it only
 *  adds protections (the cookie's Secure flag, HSTS) to the answers of whoever sends it, never removes one */
export const requestIsHttps = (req: FastifyRequest) => req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';

/** is this request for the API? Decided on the route it reached, not on the request line: /%61pi/… is routed to /api/…
 *  (the router decodes the path), and a check made on the raw characters would let it through. Without a route (404),
 *  on the decoded path */
export function isApiRequest(req: FastifyRequest): boolean {
  const route = req.routeOptions.url;
  if (route) return route.startsWith('/api/');
  let path = req.url.split('?')[0] ?? '';
  try { path = decodeURIComponent(path); } catch { /* malformed: judged as written */ }
  return path.startsWith('/api/');
}

export const PAGE_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' blob: data:", "media-src 'self' blob:",
  "font-src 'self' data:", "worker-src 'self'", "connect-src 'self'", "object-src 'none'", "frame-ancestors 'none'",
  "base-uri 'none'", "form-action 'self'",
].join('; ');
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
const PERMISSIONS = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()';

/** every answer of this server gets them; `referrer`: the back office leaks nothing, the app keeps its own origin */
export function securityHeaders(app: FastifyInstance, o: { referrer: 'same-origin' | 'no-referrer' }) {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('content-security-policy', isApiRequest(req) ? API_CSP : PAGE_CSP)
      .header('x-frame-options', 'DENY').header('x-content-type-options', 'nosniff')
      .header('referrer-policy', o.referrer).header('permissions-policy', PERMISSIONS);
    if (requestIsHttps(req)) reply.header('strict-transport-security', 'max-age=31536000');
  });
}
