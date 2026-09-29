// Security headers, for the app and the back office alike. Pages (the built editor, its files) get a strict Content
// Security Policy: only this origin's scripts, styles, workers and connections, pictures and sounds from here or made
// in the page (blob:, data:), never framed. API answers are data, never a page: nothing may run or load in them.
// Strict-Transport-Security only over HTTPS (the browser ignores it otherwise), by the same rule as the Secure cookie.
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** reached over HTTPS, directly or through a proxy that says so (see TRUST_PROXY) */
export const requestIsHttps = (req: FastifyRequest) => req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';

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
    reply.header('content-security-policy', req.url.startsWith('/api/') ? API_CSP : PAGE_CSP)
      .header('x-frame-options', 'DENY').header('x-content-type-options', 'nosniff')
      .header('referrer-policy', o.referrer).header('permissions-policy', PERMISSIONS);
    if (requestIsHttps(req)) reply.header('strict-transport-security', 'max-age=31536000');
  });
}
