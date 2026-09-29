import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addressAllowed, safeFetch, type Hop, type RawResponse, type Resolved } from '../src/net/safe-fetch';

const PUBLIC: Resolved = { address: '93.184.216.34', family: 4 };
/** a resolver from a table: names not in it do not exist */
const dns = (table: Record<string, Resolved[]>) => async (host: string) => table[host] ?? [];
const ok = (body = '{"ok":true}', headers: [string, string][] = []): RawResponse => ({ status: 200, headers: [['content-type', 'application/json'], ...headers], body: new Uint8Array(Buffer.from(body)) });
const redirect = (status: number, location: string): RawResponse => ({ status, headers: [['location', location]], body: new Uint8Array() });

describe('address policy', () => {
  it('refuses private, local, link-local, reserved and IPv4-in-IPv6 addresses', () => {
    for (const a of ['127.0.0.1', '127.8.9.10', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
      '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::127.0.0.1', 'fd00:ec2::254',
      'fc00::1', 'fe80::1', 'ff02::1', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:0:4136:e378::1', 'not-an-address']) expect(addressAllowed(a), a).toBe(false);
  });
  it('judges IPv4 carried in IPv6 by that IPv4, and refuses documentation and translated ranges', () => {
    for (const a of ['64:ff9b::808:808', '2002:808:808::1']) expect(addressAllowed(a), a).toBe(true); // 8.8.8.8 via NAT64, 6to4
    for (const a of ['64:ff9b::a00:1', '2002:a9fe:a9fe::', '::ffff:0:7f00:1', '192.0.2.1', '198.51.100.7', '203.0.113.5', '192.88.99.1', '2001:db8::1']) expect(addressAllowed(a), a).toBe(false);
  });
  it('lets a private server reach private and local addresses, never the cloud metadata service', () => {
    for (const a of ['127.0.0.1', '10.0.0.8', '192.168.1.20', '::1', 'fd12::5']) expect(addressAllowed(a, true), a).toBe(true);
    for (const a of ['169.254.169.254', '::ffff:169.254.169.254', 'fe80::1', 'fd00:ec2::254', '64:ff9b::a9fe:a9fe', '::a9fe:a9fe', '::ffff:0:a9fe:a9fe',
      '64:ff9b:1::a9fe:a9fe', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '100.100.100.200', '192.0.0.192', '168.63.129.16']) expect(addressAllowed(a, true), a).toBe(false);
    expect(addressAllowed('168.63.129.16'), 'Azure WireServer, even by default').toBe(false);
  });
  it('accepts public addresses', () => {
    for (const a of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::6810:84e5', '::ffff:8.8.8.8']) expect(addressAllowed(a), a).toBe(true);
  });
});

describe('safeFetch', () => {
  it('refuses private addresses, however written, and never connects', async () => {
    const transport = vi.fn(async () => ok());
    const f = safeFetch({ resolve: dns({}), transport });
    for (const url of ['http://127.0.0.1:11434/v1/models', 'http://10.0.0.8/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]:8080/',
      'http://[::ffff:127.0.0.1]/', 'http://[fd00:ec2::254]/', 'http://0.0.0.0/', 'http://100.64.1.1/', 'http://2130706433/', 'http://0x7f.1/',
      'http://localhost:3000/', 'http://api.localhost/', 'http://metadata.google.internal/computeMetadata/v1/', 'http://LOCALHOST./']) {
      await expect(f(url), url).rejects.toMatchObject({ name: 'BlockedAddressError' });
    }
    await expect(f('ftp://example.org/')).rejects.toMatchObject({ name: 'BlockedAddressError' });
    await expect(f('file:///etc/passwd')).rejects.toMatchObject({ name: 'BlockedAddressError' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves to a private address, or to several addresses among which one is private', async () => {
    const transport = vi.fn(async () => ok());
    const f = safeFetch({ resolve: dns({ 'intranet.example': [{ address: '10.0.0.5', family: 4 }], 'mixed.example': [PUBLIC, { address: '::1', family: 6 }] }), transport });
    await expect(f('https://intranet.example/v1/models')).rejects.toMatchObject({ name: 'BlockedAddressError', message: expect.stringContaining('intranet.example') });
    await expect(f('https://mixed.example/v1/models')).rejects.toMatchObject({ name: 'BlockedAddressError' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('accepts a public address and connects to the address it checked', async () => {
    const hops: Hop[] = [];
    const f = safeFetch({ resolve: dns({ 'api.example': [PUBLIC] }), transport: async (h) => { hops.push(h); return ok('{"data":[1]}'); } });
    const r = await f('https://api.example/v1/models', { headers: { Authorization: 'Bearer k' } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ data: [1] });
    expect(hops).toHaveLength(1);
    expect(hops[0]!.address).toEqual(PUBLIC);
    expect(hops[0]!.url.hostname).toBe('api.example');
    expect(hops[0]!.headers).toMatchObject({ authorization: 'Bearer k', 'accept-encoding': 'identity' });
  });

  it('checks every redirect: one to a private address is refused before connecting to it', async () => {
    const transport = vi.fn(async (_h: Hop) => redirect(302, 'http://169.254.169.254/latest/meta-data/'));
    const f = safeFetch({ resolve: dns({ 'api.example': [PUBLIC] }), transport });
    await expect(f('http://api.example/v1/models')).rejects.toMatchObject({ name: 'BlockedAddressError' });
    expect(transport).toHaveBeenCalledTimes(1);
    const viaName = safeFetch({ resolve: dns({ 'api.example': [PUBLIC], 'internal.example': [{ address: '192.168.0.10', family: 4 }] }), transport: async () => redirect(307, 'http://internal.example/') });
    await expect(viaName('http://api.example/')).rejects.toMatchObject({ name: 'BlockedAddressError' });
  });

  it('follows 5 redirects at most, and never from https to http', async () => {
    let n = 0;
    const f = safeFetch({ resolve: dns({ 'api.example': [PUBLIC] }), transport: async () => redirect(302, `/hop${++n}`) });
    await expect(f('https://api.example/')).rejects.toThrow(/redirections/);
    expect(n).toBe(6);
    let m = 0;
    const five = safeFetch({ resolve: dns({ 'api.example': [PUBLIC] }), transport: async () => (++m <= 5 ? redirect(301, `/hop${m}`) : ok()) });
    expect((await five('https://api.example/')).status).toBe(200);
    const down = safeFetch({ resolve: dns({ 'api.example': [PUBLIC] }), transport: async () => redirect(302, 'http://api.example/') });
    await expect(down('https://api.example/')).rejects.toThrow(/https vers http/);
  });

  it('drops the keys when a redirect leaves the origin, keeps them within it; 303 after a POST becomes a GET without body', async () => {
    const hops: Hop[] = [];
    const answers = [redirect(307, '/v2/speech'), redirect(303, 'https://cdn.example/audio.wav'), ok('RIFF')];
    const f = safeFetch({ resolve: dns({ 'api.example': [PUBLIC], 'cdn.example': [PUBLIC] }), transport: async (h) => { hops.push(h); return answers.shift()!; } });
    const r = await f('https://api.example/v1/speech', { method: 'POST', headers: { 'xi-api-key': 'secret', 'content-type': 'application/json' }, body: '{"text":"hi"}' });
    expect(await r.text()).toBe('RIFF');
    expect(hops.map((h) => [h.method, h.url.href, h.body])).toEqual([
      ['POST', 'https://api.example/v1/speech', '{"text":"hi"}'], ['POST', 'https://api.example/v2/speech', '{"text":"hi"}'], ['GET', 'https://cdn.example/audio.wav', undefined]]);
    expect(hops[1]!.headers['xi-api-key']).toBe('secret');
    expect(hops[2]!.headers).not.toHaveProperty('xi-api-key');
    expect(hops[2]!.headers).not.toHaveProperty('content-type');
  });

  it('lets a private server call local providers when asked to (ALLOW_PRIVATE_PROVIDERS)', async () => {
    const hops: Hop[] = [];
    const f = safeFetch({ allowPrivate: true, resolve: dns({ localhost: [{ address: '127.0.0.1', family: 4 }] }), transport: async (h) => { hops.push(h); return ok(); } });
    expect((await f('http://localhost:11434/v1/models')).status).toBe(200);
    expect((await f('http://10.0.0.8/v1/models')).status).toBe(200);
    expect(hops.map((h) => h.address.address)).toEqual(['127.0.0.1', '10.0.0.8']);
    await expect(f('file:///etc/passwd')).rejects.toMatchObject({ name: 'BlockedAddressError' });
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://metadata.google.internal/computeMetadata/v1/', 'http://[fd00:ec2::254]/']) {
      await expect(f(url), url).rejects.toMatchObject({ name: 'BlockedAddressError' });
    }
    const viaName = safeFetch({ allowPrivate: true, resolve: dns({ 'meta.example': [{ address: '169.254.169.254', family: 4 }] }), transport: async () => ok() });
    await expect(viaName('http://meta.example/')).rejects.toMatchObject({ name: 'BlockedAddressError' });
  });

  it('does not wait on a slow DNS longer than the call may last', async () => {
    const f = safeFetch({ timeoutMs: 300, resolve: () => new Promise(() => undefined), transport: async () => ok() });
    const t0 = Date.now();
    await expect(f('https://slow-dns.example/')).rejects.toMatchObject({ name: expect.stringMatching(/AbortError|TimeoutError/) });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('safeFetch over a real connection', () => {
  let server: Server, port: number;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/big') { res.writeHead(200, { 'content-length': String(2048) }); return res.end(Buffer.alloc(2048)); }
      if (req.url === '/big-chunked') { res.writeHead(200); res.write(Buffer.alloc(800)); res.write(Buffer.alloc(800)); return res.end(); }
      if (req.url === '/gzip') { res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'application/json' }); return res.end(gzipSync('{"zipped":true}')); }
      if (req.url === '/bomb') { res.writeHead(200, { 'content-encoding': 'gzip' }); return res.end(gzipSync(Buffer.alloc(1_000_000))); }
      if (req.url === '/slow') return; // never answers
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ host: req.headers.host, path: req.url }));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }));

  // `rebind.test` does not exist in any DNS: reaching the server proves the connection went to the checked address
  const pinnedTo127 = (o: Parameters<typeof safeFetch>[0] = {}) => safeFetch({ allowPrivate: true, resolve: dns({ 'rebind.test': [{ address: '127.0.0.1', family: 4 }] }), ...o });

  it('connects to the checked address, and keeps the name for Host', async () => {
    const r = await pinnedTo127()(`http://rebind.test:${port}/v1/models?x=1`);
    expect(await r.json()).toEqual({ host: `rebind.test:${port}`, path: '/v1/models?x=1' });
  });

  it('refuses the local server without ALLOW_PRIVATE_PROVIDERS', async () => {
    await expect(safeFetch()(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({ name: 'BlockedAddressError' });
  });

  it('caps the size of the answer, announced or not, and after decompression', async () => {
    const f = pinnedTo127({ maxBytes: 1024 });
    await expect(f(`http://rebind.test:${port}/big`)).rejects.toMatchObject({ name: 'ResponseTooLargeError' });
    await expect(f(`http://rebind.test:${port}/big-chunked`)).rejects.toMatchObject({ name: 'ResponseTooLargeError' });
    await expect(f(`http://rebind.test:${port}/bomb`)).rejects.toMatchObject({ name: 'ResponseTooLargeError' });
    const z = await f(`http://rebind.test:${port}/gzip`);
    expect(await z.json()).toEqual({ zipped: true });
    expect(z.headers.get('content-encoding')).toBeNull();
  });

  it('gives up after its time limit, and when the caller aborts', async () => {
    const t0 = Date.now();
    await expect(pinnedTo127({ timeoutMs: 300 })(`http://rebind.test:${port}/slow`)).rejects.toMatchObject({ name: expect.stringMatching(/AbortError|TimeoutError/) });
    await expect(pinnedTo127()(`http://rebind.test:${port}/slow`, { signal: AbortSignal.timeout(300) })).rejects.toMatchObject({ name: expect.stringMatching(/AbortError|TimeoutError/) });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
