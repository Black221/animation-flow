// Links to rendered videos. A <video> element cannot send an Authorization header, so a finished render is served
// through a short-lived signed URL: HMAC-SHA256 of "<id>.<expiry>" with a key derived from APP_ENCRYPTION_KEY.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export interface Signer { sign(id: string, ttlS?: number): string; verify(id: string, exp: string | undefined, sig: string | undefined): boolean }

export function signer(masterKey: Buffer, now: () => number = () => Date.now()): Signer {
  const key = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'animation-flow video links', 32));
  const mac = (id: string, exp: string) => createHmac('sha256', key).update(`${id}.${exp}`).digest('base64url');
  return {
    sign(id, ttlS = 3600) { const exp = String(Math.floor(now() / 1000) + ttlS); return `exp=${exp}&sig=${mac(id, exp)}`; },
    verify(id, exp, sig) {
      if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now() / 1000) return false;
      const a = Buffer.from(mac(id, exp)), b = Buffer.from(sig);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
