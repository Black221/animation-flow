// Serve a file with HTTP byte ranges (seeking in <video> and <audio>).
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, statSync } from 'node:fs';

export function sendFile(req: FastifyRequest, reply: FastifyReply, file: string, type: string, downloadName?: string) {
  const size = statSync(file).size, range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  reply.header('accept-ranges', 'bytes').header('cache-control', 'private, max-age=3600').type(type);
  if (downloadName) reply.header('content-disposition', `attachment; filename="${downloadName}"`);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2])), end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return reply.code(416).header('content-range', `bytes */${size}`).send();
    reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', end - start + 1);
    return reply.send(createReadStream(file, { start, end }));
  }
  reply.header('content-length', size);
  return reply.send(createReadStream(file));
}
