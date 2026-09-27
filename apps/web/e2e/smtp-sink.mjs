// A mail server for the end-to-end tests: accepts every message over SMTP (port SMTP_PORT) and lists them over
// HTTP (port HTTP_PORT, GET /messages → [{ to, data }]). Nothing leaves the machine.
import { createServer as createHttp } from 'node:http';
import { createServer } from 'node:net';

const messages = [];
createServer((c) => {
  let inData = false, buf = '', data = '', to = [];
  c.write('220 sink ESMTP\r\n');
  c.on('data', (d) => {
    buf += String(d);
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (inData) {
        if (line === '.') { inData = false; messages.push({ to, data }); data = ''; to = []; c.write('250 queued\r\n'); }
        else data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'RCPT') { to.push(line.replace(/^RCPT TO:\s*<?([^>]*)>?.*$/i, '$1').toLowerCase()); c.write('250 ok\r\n'); }
      else if (cmd === 'DATA') { inData = true; c.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { c.write('221 bye\r\n'); c.end(); }
      else c.write('250 ok\r\n');
    }
  });
}).listen(Number(process.env.SMTP_PORT ?? 2525), process.env.HOST ?? '127.0.0.1');

createHttp((req, res) => {
  if (req.url === '/health') return res.end('ok');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(messages));
}).listen(Number(process.env.HTTP_PORT ?? 2526), process.env.HOST ?? '127.0.0.1');
