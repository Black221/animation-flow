// Passwords: scrypt with a random salt, compared in constant time. Stored as "scrypt$N$r$p$salt$hash".
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, len: number, o: ScryptOptions) => new Promise<Buffer>((ok, bad) => scryptCb(pw, salt, len, o, (e, k) => (e ? bad(e) : ok(k))));
const N = 1 << 15, R = 8, P = 1, LEN = 64;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16), key = await scrypt(pw.normalize('NFKC'), salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** a dummy hash to compare against when the e-mail is unknown, so a login takes the same time either way */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')));

export const PASSWORD_RULE = 'au moins 10 caractères';
export const passwordOk = (pw: string) => typeof pw === 'string' && pw.length >= 10 && pw.length <= 200;
