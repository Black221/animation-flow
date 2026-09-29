// The only way out to an address a person gave (a provider's baseUrl). The server must not become a way into its own
// network: each hop's name is resolved once, refused if any of its addresses is private, local, link-local or cloud
// metadata, and the connection goes to that checked address (Node never resolves the name again: no DNS rebinding;
// SNI, the certificate and Host still follow the name). Redirects are followed here, each hop checked again; time and
// response size are capped. ALLOW_PRIVATE_PROVIDERS=true lifts the address policy (a private server with Ollama), never
// the other limits. See docs/adr/0001-sorties-reseau-vers-des-adresses-utilisateur.md.
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import zlib from 'node:zlib';

/** the address (or name) is not one this server may call; the message is safe to show */
export class BlockedAddressError extends Error { override name = 'BlockedAddressError'; }
/** the answer is bigger than allowed */
export class ResponseTooLargeError extends Error { override name = 'ResponseTooLargeError'; }

export interface Resolved { address: string; family: 4 | 6 }
export interface Hop { url: URL; address: Resolved; method: string; headers: Record<string, string>; body: string | undefined; signal: AbortSignal; maxBytes: number }
export interface RawResponse { status: number; headers: [string, string][]; body: Uint8Array<ArrayBuffer> }

export interface SafeFetchOptions {
  /** lift the address policy (ALLOW_PRIVATE_PROVIDERS=true) */
  allowPrivate?: boolean;
  /** largest answer, in bytes (default 32 MiB: an image in base64, a minute of WAV) */
  maxBytes?: number;
  /** longest call, redirects included (default 5 minutes; the caller's signal may end it sooner) */
  timeoutMs?: number;
  maxRedirects?: number;
  /** name → addresses (tests); default: the system resolver, every address */
  resolve?: (host: string) => Promise<Resolved[]>;
  /** one request to one checked address (tests); default: node:http(s) pinned to that address */
  transport?: (hop: Hop) => Promise<RawResponse>;
}

export type SafeFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

// ---------- address policy ----------
const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, bits, 'ipv4');
// ::/96 holds ::, ::1 and the old IPv4-compatible form; 64:ff9b (NAT64), 2002 (6to4) and 2001::/32 (Teredo) carry IPv4
for (const [net, bits] of [
  ['::', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['100::', 64],
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16], ['2001::', 32],
] as const) blocked.addSubnet(net, bits, 'ipv6');
const BLOCKED_NAMES = new Set(['localhost', 'metadata', 'metadata.google.internal', 'metadata.goog']);

/** the 8 groups of an IPv6 address, as numbers (the address is known to be valid) */
function groups6(a: string): number[] {
  let s = a.toLowerCase();
  const v4 = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) s = s.slice(0, v4.index) + `${((+v4[1]! << 8) | +v4[2]!).toString(16)}:${((+v4[3]! << 8) | +v4[4]!).toString(16)}`;
  const [head, tail] = s.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const all = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return all.map((g) => parseInt(g, 16));
}

/** may this server connect to that address? (IPv4 written inside IPv6, ::ffff:a.b.c.d, is judged as IPv4) */
export function addressAllowed(address: string): boolean {
  const v = isIP(address);
  if (v === 4) return !blocked.check(address, 'ipv4');
  if (v !== 6) return false;
  const g = groups6(address);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return addressAllowed(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
  return !blocked.check(address, 'ipv6');
}

const refuse = (host: string) => new BlockedAddressError(`adresse refusée : ${host} est une adresse privée, locale ou réservée (un serveur privé peut les autoriser avec ALLOW_PRIVATE_PROVIDERS=true)`);

async function check(url: URL, allowPrivate: boolean, resolve: (host: string) => Promise<Resolved[]>): Promise<Resolved> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedAddressError(`adresse refusée : seuls http et https sont permis`);
  if (url.username || url.password) throw new BlockedAddressError('adresse refusée : identifiants dans l’adresse');
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  const literal = isIP(host);
  if (literal) {
    if (!allowPrivate && !addressAllowed(host)) throw refuse(host);
    return { address: host, family: literal as 4 | 6 };
  }
  if (!allowPrivate && (BLOCKED_NAMES.has(host) || host.endsWith('.localhost'))) throw refuse(host);
  const all = await resolve(host);
  if (!all.length) throw new Error(`${host} : nom introuvable`);
  // one bad address is enough: the system could pick any of them, and a name that mixes both is suspicious
  if (!allowPrivate && all.some((a) => !addressAllowed(a.address))) throw refuse(host);
  return all[0]!;
}

// ---------- the request itself ----------
const systemResolve = async (host: string): Promise<Resolved[]> =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family as 4 | 6 }));

/** a lookup that answers the checked address, whatever it is asked: Node connects there and nowhere else */
const pinned = (a: Resolved): LookupFunction => ((_host: string, options: unknown, cb?: unknown) => {
  const done = (typeof options === 'function' ? options : cb) as (...args: unknown[]) => void;
  if (typeof options === 'object' && options && (options as { all?: boolean }).all) done(null, [{ address: a.address, family: a.family }]);
  else done(null, a.address, a.family);
}) as LookupFunction;

function decoder(encoding: string | undefined, maxBytes: number): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null {
  const o = { maxOutputLength: maxBytes + 1 };
  if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.createGunzip(o);
  if (encoding === 'deflate') return zlib.createInflate(o);
  if (encoding === 'br') return zlib.createBrotliDecompress(o);
  return null;
}

/** node:http(s), connected to the checked address; no pooled socket (each call opens its own) */
export const nodeTransport = (hop: Hop): Promise<RawResponse> => new Promise((ok, bad) => {
  const mod = hop.url.protocol === 'https:' ? https : http;
  const req = mod.request({
    protocol: hop.url.protocol, hostname: hop.url.hostname.replace(/^\[|\]$/g, ''), port: hop.url.port || undefined,
    path: hop.url.pathname + hop.url.search, method: hop.method, headers: hop.headers, lookup: pinned(hop.address),
    agent: false, signal: hop.signal,
  }, (res) => {
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > hop.maxBytes) { res.destroy(); return bad(new ResponseTooLargeError('réponse trop volumineuse')); }
    const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase() || undefined;
    const dec = decoder(encoding, hop.maxBytes), stream = dec ? res.pipe(dec) : res;
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (c: Buffer) => {
      size += c.length;
      if (size > hop.maxBytes) { res.destroy(); stream.destroy(); bad(new ResponseTooLargeError('réponse trop volumineuse')); return; }
      chunks.push(c);
    });
    stream.on('error', (e: Error & { code?: string }) => bad(e.code === 'ERR_BUFFER_TOO_LARGE' ? new ResponseTooLargeError('réponse trop volumineuse') : e));
    res.on('error', bad);
    stream.on('end', () => {
      const headers: [string, string][] = [];
      for (let i = 0; i < res.rawHeaders.length; i += 2) {
        const k = res.rawHeaders[i]!.toLowerCase();
        // the body handed on is decoded and complete: its old length and encoding no longer describe it
        if (dec && (k === 'content-encoding' || k === 'content-length')) continue;
        headers.push([k, res.rawHeaders[i + 1]!]);
      }
      ok({ status: res.statusCode ?? 0, headers, body: new Uint8Array(Buffer.concat(chunks)) });
    });
  });
  req.on('error', bad);
  req.end(hop.body);
});

const KEY_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key', 'xi-api-key', 'cookie', 'proxy-authorization'];
const NO_BODY = new Set([101, 103, 204, 205, 304]);

/** a fetch for provider calls, with the policy above; returns a standard Response */
export function safeFetch(o: SafeFetchOptions = {}): SafeFetch {
  const allowPrivate = o.allowPrivate ?? false, maxBytes = o.maxBytes ?? 32 * 1024 * 1024, maxRedirects = o.maxRedirects ?? 5;
  const resolve = o.resolve ?? systemResolve, transport = o.transport ?? nodeTransport, timeoutMs = o.timeoutMs ?? 5 * 60_000;

  return async (input, init = {}) => {
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    let url = new URL(input), method = (init.method ?? 'GET').toUpperCase(), body = init.body;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
    headers['accept-encoding'] = 'identity';
    for (let hop = 0; ; hop++) {
      signal.throwIfAborted();
      const address = await check(url, allowPrivate, resolve);
      const r = await transport({ url, address, method, headers: { ...headers }, body, signal, maxBytes });
      const location = r.headers.find(([k]) => k === 'location')?.[1];
      if (r.status >= 300 && r.status < 400 && r.status !== 304 && location) {
        if (hop >= maxRedirects) throw new BlockedAddressError(`trop de redirections (${maxRedirects} au plus)`);
        const next = new URL(location, url);
        if (url.protocol === 'https:' && next.protocol === 'http:') throw new BlockedAddressError('adresse refusée : redirection de https vers http');
        if (next.origin !== url.origin) for (const k of KEY_HEADERS) delete headers[k];
        if (r.status === 303 || ((r.status === 301 || r.status === 302) && method === 'POST')) {
          method = method === 'HEAD' ? 'HEAD' : 'GET'; body = undefined;
          delete headers['content-type']; delete headers['content-length'];
        }
        url = next;
        continue;
      }
      const status = r.status >= 200 && r.status <= 599 ? r.status : 502;
      return new Response(NO_BODY.has(status) ? null : r.body, { status, headers: r.headers });
    }
  };
}
